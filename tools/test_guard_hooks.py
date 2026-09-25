"""Tests for the repo's guard hooks as Claude Code starts them.

Each test runs `sh .claude/hooks/run-hook.sh <name>` with a tool call on
stdin, the way the committed .claude/settings.json does, under a throwaway
HOME so the maintainer's own ~/.claude hooks never decide the result.

Run from the repo root: python -m unittest tools/test_guard_hooks.py
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAUNCHER = os.path.join(REPO, ".claude", "hooks", "run-hook.sh")


def find_sh():
    """A POSIX sh: on PATH, or Git for Windows' copy next to git.exe."""
    sh = shutil.which("sh")
    if sh or os.name != "nt":
        return sh
    git = shutil.which("git")
    if git:
        for rel in (r"..\bin\sh.exe", r"..\usr\bin\sh.exe", r"..\..\bin\sh.exe"):
            path = os.path.normpath(os.path.join(os.path.dirname(git), rel))
            if os.path.exists(path):
                return path
    return None


SH = find_sh()

# Built from pieces so this file's own text never reads as a real trailer.
TRAILER = "Co-" + "Authored-By: Someone <x@example.com>"


@unittest.skipIf(SH is None, "needs a POSIX sh on PATH (Git Bash on Windows)")
class GuardHookTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)

    def run_hook(self, name, command, project=REPO, tool="Bash"):
        env = dict(os.environ, HOME=self.home, CLAUDE_PROJECT_DIR=project)
        env.pop("USERPROFILE", None)
        payload = {"tool_name": tool, "tool_input": {"command": command}, "cwd": project}
        return subprocess.run(
            [SH, LAUNCHER, name], input=json.dumps(payload).encode("utf-8"),
            capture_output=True, env=env, timeout=60)

    def global_copy(self, text):
        os.makedirs(os.path.join(self.home, ".claude"))
        with open(os.path.join(self.home, ".claude", "settings.json"), "w") as f:
            f.write(text)

    def assert_denied(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        decision = json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"]
        self.assertEqual(decision, "deny")

    def assert_silent(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), b"")

    def test_attribution_trailer_is_denied(self):
        self.assert_denied(self.run_hook(
            "no-ai-attribution", f"git commit -m 'docs: x' -m '{TRAILER}'"))

    def test_clean_commit_passes(self):
        self.assert_silent(self.run_hook("no-ai-attribution", "git commit -m 'docs: fix a typo'"))

    def test_force_push_is_blocked(self):
        result = self.run_hook("push-guard", "git push -f origin feature/x")
        self.assertEqual(result.returncode, 2)
        self.assertIn(b"force push", result.stderr)

    def test_force_with_lease_passes(self):
        self.assert_silent(self.run_hook("push-guard", "git push --force-with-lease origin feature/x"))

    def test_powershell_force_push_is_blocked(self):
        result = self.run_hook("push-guard", "git push --force origin feature/x", tool="PowerShell")
        self.assertEqual(result.returncode, 2)

    def test_skipped_when_home_registers_a_copy(self):
        self.global_copy('{"command": "python \\"C:/Users/me/.claude/hooks/push-guard.py\\""}')
        self.assert_silent(self.run_hook("push-guard", "git push -f origin feature/x"))

    def test_skipped_when_home_copy_uses_backslashes(self):
        self.global_copy('{"command": "python C:\\\\Users\\\\me\\\\.claude\\\\hooks\\\\no-ai-attribution.py"}')
        self.assert_silent(self.run_hook(
            "no-ai-attribution", f"git commit -m 'docs: x' -m '{TRAILER}'"))

    def test_home_copy_of_another_hook_does_not_skip(self):
        self.global_copy('{"command": "python ~/.claude/hooks/no-ai-attribution.py"}')
        self.assertEqual(self.run_hook("push-guard", "git push -f origin x").returncode, 2)

    def test_missing_hook_file_lets_the_call_through(self):
        empty = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, empty, ignore_errors=True)
        result = self.run_hook("push-guard", "git push -f origin x", project=empty)
        self.assertNotEqual(result.returncode, 2, result.stderr)


if __name__ == "__main__":
    unittest.main()
