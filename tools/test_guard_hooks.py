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
# Built from pieces so this file's text never reads as a force push to the
# guard that watches the commands run in this repo.
FORCE_PUSH = "git push -" + "f origin feature/x"


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

    def home_settings(self, text, hook_files=()):
        """Write ~/.claude/settings.json and create the named ~/.claude/hooks files."""
        os.makedirs(os.path.join(self.home, ".claude", "hooks"))
        with open(os.path.join(self.home, ".claude", "settings.json"), "w") as f:
            f.write(text)
        for name in hook_files:
            open(os.path.join(self.home, ".claude", "hooks", name), "w").close()

    def assert_blocked(self, result):
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn(b"force push", result.stderr)

    def assert_passes(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), b"")

    def test_force_push_is_blocked(self):
        self.assert_blocked(self.run_hook("push-guard", FORCE_PUSH))

    def test_powershell_force_push_is_blocked(self):
        self.assert_blocked(self.run_hook("push-guard", FORCE_PUSH, tool="PowerShell"))

    def test_force_with_lease_passes(self):
        self.assert_passes(self.run_hook("push-guard", "git push --force-with-lease origin feature/x"))

    def test_plain_push_passes(self):
        self.assert_passes(self.run_hook("push-guard", "git push origin feature/x"))

    def test_skipped_when_home_registers_a_working_copy(self):
        self.home_settings('{"command": "python \\"C:/Users/me/.claude/hooks/push-guard.py\\""}',
                           hook_files=["push-guard.py"])
        self.assert_passes(self.run_hook("push-guard", FORCE_PUSH))

    def test_skipped_when_home_copy_uses_backslashes(self):
        self.home_settings('{"args": ["C:\\\\Users\\\\me\\\\.claude\\\\hooks\\\\push-guard.py"]}',
                           hook_files=["push-guard.py"])
        self.assert_passes(self.run_hook("push-guard", FORCE_PUSH))

    def test_runs_when_home_registration_has_no_file(self):
        self.home_settings('{"command": "python ~/.claude/hooks/push-guard.py"}')
        self.assert_blocked(self.run_hook("push-guard", FORCE_PUSH))

    def test_runs_when_home_only_names_it_in_a_permission_rule(self):
        self.home_settings('{"permissions": {"allow": [\n    "Bash(python ~/.claude/hooks/push-guard.py:*)"\n]}}',
                           hook_files=["push-guard.py"])
        self.assert_blocked(self.run_hook("push-guard", FORCE_PUSH))

    def test_home_copy_of_another_hook_does_not_skip(self):
        self.home_settings('{"command": "python ~/.claude/hooks/other-guard.py"}',
                           hook_files=["other-guard.py"])
        self.assert_blocked(self.run_hook("push-guard", FORCE_PUSH))

    def test_missing_hook_file_lets_the_call_through(self):
        empty = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, empty, ignore_errors=True)
        result = self.run_hook("push-guard", FORCE_PUSH, project=empty)
        self.assertNotEqual(result.returncode, 2, result.stderr)


if __name__ == "__main__":
    unittest.main()
