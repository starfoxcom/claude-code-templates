"""Tests for the repo's guard hooks as Claude Code starts them.

Each test runs the hook's command string from the committed
.claude/settings.json through `sh -c`, with a tool call on stdin, under a
throwaway HOME so the maintainer's own ~/.claude hooks never decide the
result.

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
SETTINGS = os.path.join(REPO, ".claude", "settings.json")
# Built from pieces so this file's text never reads as a force push to the
# guard that watches the commands run in this repo.
FORCE_PUSH = "git push -" + "f origin feature/x"
# Same for attribution samples and the guard that scans this repo's commands.
AI_TRAILER = "Co-" + "Authored-By: Cla" + "ude <noreply@anthro" + "pic.com>"
HUMAN_TRAILER = "Co-" + "Authored-By: Jane Doe <12345+jane@users.noreply.github.com>"
GENERATED_LINE = "Gener" + "ated with [Cla" + "ude Code](https://cla" + "ude.com/claude-code)"
SESSION_LINK = "https://cla" + "ude.ai/code/session_" + "01V8SAUxUZBbVPekZUHDL9FZ"


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


def settings_command(name):
    """The committed PreToolUse command string that starts hook <name>."""
    with open(SETTINGS, encoding="utf-8") as f:
        groups = json.load(f)["hooks"]["PreToolUse"]
    return next(h["command"] for g in groups for h in g["hooks"] if f" {name}" in h["command"])


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
            [SH, "-c", settings_command(name)], input=json.dumps(payload).encode("utf-8"),
            capture_output=True, env=env, timeout=60)

    def temp_project(self, files=()):
        """A throwaway project dir holding the named files from .claude/hooks/."""
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        os.makedirs(os.path.join(root, ".claude", "hooks"))
        for name in files:
            shutil.copy(os.path.join(REPO, ".claude", "hooks", name), os.path.join(root, ".claude", "hooks"))
        return root

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

    def test_runs_when_permission_rule_sits_in_a_compact_array(self):
        self.home_settings('{"permissions": {"allow": ["Bash(python3 ~/.claude/hooks/push-guard.py:*)"]}}',
                           hook_files=["push-guard.py"])
        self.assert_blocked(self.run_hook("push-guard", FORCE_PUSH))

    def test_runs_when_permission_rule_quotes_the_path(self):
        self.home_settings('{"permissions":{"allow":["Bash(python \\"C:/u/.claude/hooks/push-guard.py\\":*)"]}}',
                           hook_files=["push-guard.py"])
        self.assert_blocked(self.run_hook("push-guard", FORCE_PUSH))

    def test_skipped_when_minified_file_registers_a_working_copy(self):
        self.home_settings('{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command",'
                           '"command":"python \\"C:/u/.claude/hooks/push-guard.py\\""}]}]}}',
                           hook_files=["push-guard.py"])
        self.assert_passes(self.run_hook("push-guard", FORCE_PUSH))

    def test_home_copy_of_another_hook_does_not_skip(self):
        self.home_settings('{"command": "python ~/.claude/hooks/other-guard.py"}',
                           hook_files=["other-guard.py"])
        self.assert_blocked(self.run_hook("push-guard", FORCE_PUSH))

    def test_missing_hook_file_lets_the_call_through(self):
        project = self.temp_project(files=["run-hook.sh"])
        result = self.run_hook("push-guard", FORCE_PUSH, project=project)
        self.assertNotEqual(result.returncode, 2, result.stderr)

    def test_missing_launcher_lets_the_call_through(self):
        # dash exits 2 when it cannot open a script; the entry must test first.
        result = self.run_hook("push-guard", FORCE_PUSH, project=self.temp_project())
        self.assertNotEqual(result.returncode, 2, result.stderr)

    def test_launcher_is_the_one_the_settings_start(self):
        self.assertIn("/.claude/hooks/run-hook.sh", settings_command("push-guard"))
        self.assertTrue(os.path.exists(LAUNCHER))

    # --- no-ai-attribution: attribution is denied, mentions pass ---

    def assert_denied(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.strip(), "expected a deny, got silence")
        decision = json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"]
        self.assertEqual(decision, "deny")

    def attr(self, command, **kw):
        return self.run_hook("no-ai-attribution", command, **kw)

    def test_ai_co_author_is_denied(self):
        self.assert_denied(self.attr(f"git commit -m 'docs: x' -m '{AI_TRAILER}'"))

    def test_human_co_author_passes(self):
        self.assert_passes(self.attr(f"git commit -m 'docs: x' -m '{HUMAN_TRAILER}'"))

    def test_generated_with_line_is_denied(self):
        for line in (GENERATED_LINE, "Written by an AI assistant", "docs: x via " + "Cla" + "ude Code"):
            with self.subTest(line=line):
                self.assert_denied(self.attr(f"git commit -m 'docs: x' -m '{line}'"))

    def test_session_link_and_robot_are_denied(self):
        for body in (SESSION_LINK, "Done \U0001F916", "Cla" + "ude-Session: abc"):
            with self.subTest(body=body):
                self.assert_denied(self.attr(f"gh pr comment 5 --body '{body}'"))

    def test_plain_mentions_pass(self):
        for command in (
            "git commit -m 'fix(hooks): block force pushes in " + "Cla" + "ude Code sessions'",
            "git commit -m 'docs: update CLAUDE.md and .claude/rules/git.md'",
            "gh pr comment 1 --repo starfoxcom/claude-code-templates --body 'docs: x'",
            "gh pr create --title 't' --body 'See https://github.com/starfoxcom/claude-code-templates/issues/3 "
            "and https://starfoxcom.github.io/claude-code-templates/'",
            "gh pr create --head hotfix/drop-admin-text-claude-yml --title 'fix(ci): x' --body 'y'",
            "gh pr comment 5 --body '@claude review this PR - re-check on the parser'",
            "git commit -m 'fix(ui): show pointer with cursor on toggle rows'",
        ):
            with self.subTest(command=command):
                self.assert_passes(self.attr(command))

    def test_cursor_tool_name_is_denied(self):
        self.assert_denied(self.attr("git commit -m 'feat: x' -m 'Written with Cursor AI'"))

    def test_attribution_next_to_repo_name_is_denied(self):
        self.assert_denied(self.attr(
            f"gh pr comment 1 --repo starfoxcom/claude-code-templates --body '{AI_TRAILER}'"))

    def test_no_n_flags_that_are_not_no_verify_pass(self):
        for command in ("git cherry-pick -n abc123", "git revert -n abc123", "git tag -n",
                        "git merge -n feature/x", "git commit -m 'docs(hooks): explain core.hooksPath and -n'",
                        "git commit -m x && git config --get core.hooksPath"):
            with self.subTest(command=command):
                self.assert_passes(self.attr(command))

    def test_hook_skips_are_denied(self):
        for command in ("git commit -n -m x", "git commit -an -m x", "git commit --no-verify -m x",
                        "git push --no-verify origin feature/x", "git -c core.hooksPath=/dev/null commit -m x",
                        "git config core.hooksPath /tmp/none && git commit -m x"):
            with self.subTest(command=command):
                self.assert_denied(self.attr(command))

    def test_body_from_stdin_is_denied(self):
        for command in ("gh pr create --title t --body-file - < body.md",
                        "gh release create v1 --notes-file - < notes.md",
                        "cat x.json | gh api -X POST repos/o/r/issues --input -",
                        "echo 'a<<b' | gh pr create --title t --body-file -",
                        "cat evil.md | gh pr create --title t --body-file - # <<",
                        "gh pr comment 5 --body-file - <<EOF\n$(cat /tmp/body.md)\nEOF"):
            with self.subTest(command=command):
                self.assert_denied(self.attr(command))

    def test_body_from_a_quoted_heredoc_passes(self):
        self.assert_passes(self.attr(
            "gh pr create --title t --body-file - <<'EOF'\n## What\n| a | b |\n|---|---|\nEOF"))

    def test_attribution_inside_a_heredoc_is_denied(self):
        self.assert_denied(self.attr(f"gh pr create --title t --body-file - <<'EOF'\n{AI_TRAILER}\nEOF"))


if __name__ == "__main__":
    unittest.main()
