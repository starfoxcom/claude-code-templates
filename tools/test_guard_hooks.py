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

    def project_with_remote(self, url, folder="proj"):
        """A throwaway project: the attribution hook plus a git remote."""
        root = os.path.join(tempfile.mkdtemp(), folder)
        self.addCleanup(shutil.rmtree, os.path.dirname(root), ignore_errors=True)
        os.makedirs(os.path.join(root, ".claude", "hooks"))
        os.makedirs(os.path.join(root, ".git"))
        shutil.copy(os.path.join(REPO, ".claude", "hooks", "no-ai-attribution.py"),
                    os.path.join(root, ".claude", "hooks"))
        with open(os.path.join(root, ".git", "config"), "w") as f:
            f.write(f'[remote "origin"]\n\turl = {url}\n')
        return root

    def test_own_repo_slug_passes(self):
        project = self.project_with_remote("https://github.com/someone/claude-widget.git")
        self.assert_silent(self.run_hook(
            "no-ai-attribution", "gh pr comment 1 --repo someone/claude-widget --body 'docs: x'",
            project=project))

    def test_own_repo_links_pass(self):
        project = self.project_with_remote("git@github.com:someone/claude-widget.git")
        self.assert_silent(self.run_hook(
            "no-ai-attribution",
            "gh pr create --title 'docs: x' --body 'See https://github.com/someone/claude-widget/issues/3 "
            "and https://someone.github.io/claude-widget/'",
            project=project))

    def test_attribution_still_denied_next_to_own_repo_name(self):
        project = self.project_with_remote("https://github.com/someone/claude-widget.git")
        self.assert_denied(self.run_hook(
            "no-ai-attribution", f"gh pr comment 1 --repo someone/claude-widget --body '{TRAILER}'",
            project=project))

    def test_repo_named_like_a_marker_is_not_masked(self):
        project = self.project_with_remote("https://github.com/someone/claude.git", folder="claude")
        self.assert_denied(self.run_hook(
            "no-ai-attribution", "git commit -m 'docs: x' -m 'Generated with Claude'", project=project))

    def test_review_workflow_branch_name_passes(self):
        self.assert_silent(self.run_hook(
            "no-ai-attribution",
            "gh pr create --head hotfix/drop-admin-text-claude-yml --title 'fix(ci): x' --body 'y'"))

    def test_cursor_as_ui_word_passes(self):
        self.assert_silent(self.run_hook(
            "no-ai-attribution", "git commit -m 'fix(ui): show pointer with cursor on toggle rows'"))

    def test_cursor_tool_name_is_denied(self):
        self.assert_denied(self.run_hook(
            "no-ai-attribution", "git commit -m 'feat: x' -m 'Written with Cursor AI'"))

    def test_missing_hook_file_lets_the_call_through(self):
        empty = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, empty, ignore_errors=True)
        result = self.run_hook("push-guard", "git push -f origin x", project=empty)
        self.assertNotEqual(result.returncode, 2, result.stderr)


if __name__ == "__main__":
    unittest.main()
