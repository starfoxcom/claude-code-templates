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
import sys
import tempfile
import unittest
import warnings

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
# The deep-review trigger, split so a review that quotes this file cannot
# carry the whole phrase into a PR comment and start a deep review.
DEEP_TRIGGER = "@cla" + "ude rev" + "iew this PR"


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
            f"gh pr comment 5 --body '{DEEP_TRIGGER} - re-check on the parser'",
            "git commit -m 'fix(ui): show pointer with cursor on toggle rows'",
            "git commit -m 'docs: add guide for using " + "Cla" + "ude Code'",
            "git commit -m 'feat(bind): generate settings compatible with " + "Cla" + "ude Code'",
            "git commit -m 'docs(rules): clarify what counts as a commit with AI trailers'",
            "git commit -m 'feat: add integration with LLM providers'",
        ):
            with self.subTest(command=command):
                self.assert_passes(self.attr(command))

    def test_cursor_tool_name_is_denied(self):
        self.assert_denied(self.attr("git commit -m 'feat: x' -m 'Written with Cursor AI'"))

    def test_colon_trailer_forms_are_denied(self):
        for line in ("Assisted-by: " + "Cla" + "ude:opus", "Generated-by: " + "Cla" + "ude",
                     "Generated by: an AI assistant", "Generated with: " + "Cla" + "ude Code",
                     "Made-with: Cursor", "Co-written-by: Cursor"):
            with self.subTest(line=line):
                self.assert_denied(self.attr(f"git commit -m 'docs: x' -m '{line}'"))

    def test_colon_after_a_plain_phrase_passes(self):
        for line in ("Made with: love", "Generated files: see below", "Created by: Jane Doe",
                     "Generated: AI model card", "Made: cursor hover state"):
            with self.subTest(line=line):
                self.assert_passes(self.attr(f"git commit -m 'docs: x' -m '{line}'"))

    def test_the_ci_check_can_import_the_hook(self):
        # The Attribution workflow loads develop's copy as a module and reads
        # these two names; importing it must not run main() or read stdin. A
        # main() call at import exits through SystemExit, which prints here.
        import sys
        path = os.path.join(REPO, "_core", "global-template", "hooks", "no-ai-attribution.py")
        code = ("import importlib.util, sys\n"
                "spec = importlib.util.spec_from_file_location('attribution_hook', sys.argv[1])\n"
                "hook = importlib.util.module_from_spec(spec)\n"
                "try:\n"
                "    spec.loader.exec_module(hook)\n"
                "except SystemExit:\n"
                "    print('exited')\n"
                "assert hook.ATTRIBUTION.search and callable(hook.strip_paths)\n")
        result = subprocess.run([sys.executable, "-c", code, path], input="", capture_output=True,
                                text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_attribution_next_to_repo_name_is_denied(self):
        self.assert_denied(self.attr(
            f"gh pr comment 1 --repo starfoxcom/claude-code-templates --body '{AI_TRAILER}'"))


    def test_everyday_commands_pass(self):
        for command in ("git cherry-pick -n abc123", "git revert -n abc123", "git tag -n",
                        "git merge -n feature/x", "git commit -m 'docs(hooks): explain core.hooksPath and -n'",
                        "gh pr comment 5 --body 'Run `npm test` first'",
                        'git commit -m "feat(hooks): add eval fixture"',
                        "gh api graphql -f query='query($owner: String!) { repository(owner: $owner) { id } }' "
                        "-F owner=o",
                        "gh gist create --filename notes.txt -",
                        "gh api repos/o/r/issues/5/comments -F body=@-",
                        'gh issue create --template "Bug report"',
                        "gh pr create --template default.md --base develop",
                        "gh repo create x --template o/r",
                        "gh pr create --title t --body-file - <<'EOF'\n## What\n| a | b |\n|---|---|\nEOF"):
            with self.subTest(command=command):
                self.assert_passes(self.attr(command))

    def test_file_flags_mentioned_in_message_text_pass(self):
        for command in ("git commit -m 'fix(hooks): honor --file=path form'",
                        'git commit -m "docs(hooks): add Get-Content example"',
                        "gh pr comment 5 --body 'the -F flag is case-sensitive'",
                        "gh pr create --title t --body-file - <<'EOF'\nUse --body-file notes.md here\nEOF",
                        "gh pr create --title t --body @'\nthe -F flag reads a file\n'@"):
            with self.subTest(command=command):
                self.assert_passes(self.attr(command))

    def test_lowercase_f_is_not_a_message_file(self):
        for command in ("git tag -f v1.0.0", "gh pr create -f --base develop"):
            with self.subTest(command=command):
                self.assert_passes(self.attr(command))

    def test_attribution_inside_a_heredoc_is_denied(self):
        self.assert_denied(self.attr(f"gh pr create --title t --body-file - <<'EOF'\n{AI_TRAILER}\nEOF"))

    def body_file(self, text):
        fd, path = tempfile.mkstemp(suffix=".md")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        self.addCleanup(os.remove, path)
        return path

    def test_attribution_in_a_body_file_is_denied(self):
        path = self.body_file(f"## What\n- x\n\n{GENERATED_LINE}\n")
        for command in (f'gh pr create --title t --body-file "{path}"', f'git commit -F "{path}"',
                        f'git commit -F"{path}"', f'gh pr create --title t --body-file="{path}"',
                        f'git commit --file="{path}"', f"git commit --template='{path}'"):
            with self.subTest(command=command):
                self.assert_denied(self.attr(command))

    def test_backticks_in_a_message_do_not_hide_a_body_file(self):
        # In bash a backtick is not an escape inside double quotes; in
        # PowerShell it is, and a doubled backtick is a literal one.
        path = self.body_file(f"## What\n- x\n\n{GENERATED_LINE}\n")
        self.assert_denied(self.attr(f'git commit -m "docs: run `make`" -F "{path}"'))
        self.assert_denied(self.attr(f'git commit -m "docs: run ``make``" -F "{path}"', tool="PowerShell"))

    def test_clean_body_file_passes(self):
        path = self.body_file("## What\n- Ships the guard\n\n## Why\nFewer surprises.\n")
        for command in (f'gh pr create --title t --body-file "{path}"',
                        f'gh pr create --title t --body-file="{path}"'):
            with self.subTest(command=command):
                self.assert_passes(self.attr(command))

    def test_unreadable_body_file_is_denied(self):
        for command in ("gh pr create --title t --body-file /no/such/body.md",
                        "gh pr create --title t --body-file=/no/such/body.md"):
            with self.subTest(command=command):
                self.assert_denied(self.attr(command))

    def test_read_only_commands_pass(self):
        for command in ("git log -5", "gh pr view 5 --json body", "git config --get core.hooksPath"):
            with self.subTest(command=command):
                self.assert_passes(self.attr(command))


GUARDS = os.path.join(REPO, "_core", "global-template", "mods", "guards", "scripts")


class GuardsScriptsTest(unittest.TestCase):
    """The hook scripts the guards mod runs, started as the mod starts them:
    the script on its own, the tool call on stdin."""

    def run_script(self, path, command, cwd=REPO, tool="Bash"):
        payload = {"hook_event_name": "PreToolUse", "tool_name": tool,
                   "tool_input": {"command": command}, "cwd": cwd}
        result = subprocess.run([sys.executable, path], input=json.dumps(payload).encode("utf-8"),
                                capture_output=True, cwd=cwd if os.path.isdir(cwd) else REPO, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        out = result.stdout.decode("utf-8").strip()
        return json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"] if out else None

    def script(self, name):
        return os.path.join(GUARDS, name)

    def pr_script(self, root):
        """A copy of the PR-body script with one repo listed, as a machine's own copy would be."""
        with open(self.script("pr-body-contract.py"), encoding="utf-8") as f:
            source = f.read()
        table = ('REPOS = {"my-game": (re.compile(r"^(Resolves|Part of) #\\d+\\s*$", re.M), '
                 're.compile(r"^(docs|chore)(\\(|:)"))}')
        self.assertIn("REPOS = {}\n", source)
        source = source.replace("REPOS = {}\n", table + "\n").replace("SKIP = ()", 'SKIP = ("board",)')
        path = os.path.join(root, "pr-body-contract.py")
        with open(path, "w", encoding="utf-8") as f:
            f.write(source)
        return path

    def test_attribution_script_is_the_shipped_global_hook(self):
        with open(self.script("no-ai-attribution.py"), "rb") as a, \
                open(os.path.join(REPO, "_core", "global-template", "hooks", "no-ai-attribution.py"), "rb") as b:
            self.assertEqual(a.read(), b.read())

    def test_attribution_script_refuses_credit_and_passes_mentions(self):
        path = self.script("no-ai-attribution.py")
        self.assertIn("attribution", self.run_script(path, f"git commit -m 'fix: x' -m '{AI_TRAILER}'") or "")
        for command in ('git commit -m "docs: compatible with Cla' + 'ude Code"',
                        f"git commit -m 'fix: x' -m '{HUMAN_TRAILER}'", "git status"):
            with self.subTest(command=command):
                self.assertIsNone(self.run_script(path, command))

    def test_run_watch_script_refuses_only_the_watch_subcommand(self):
        path = self.script("block-gh-run-watch.py")
        for command, tool in (("gh run wat" + "ch 123", "Bash"), ("gh -R o/r run wat" + "ch", "PowerShell")):
            with self.subTest(command=command):
                self.assertIn("Watching CI", self.run_script(path, command, tool=tool) or "")
        for command in ("git push origin feature/ci-watch-incident", "gh run list --limit 5", "gh pr checks 3"):
            with self.subTest(command=command):
                self.assertIsNone(self.run_script(path, command))

    def test_pr_body_script_ships_with_no_repo_listed(self):
        path = self.script("pr-body-contract.py")
        for folder in ("my-game", "gameproject-demo", "appproject"):
            with self.subTest(folder=folder):
                self.assertIsNone(self.run_script(path, 'gh pr create -t t --body "x"', cwd=os.path.join(REPO, folder)))

    def test_pr_body_script_holds_a_listed_repo_to_the_format(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        repo = os.path.join(root, "my-game")
        os.makedirs(repo)
        full = "## What\n- add the sky\n\n## Why\nIt was missing.\n\nResolves #12\n"
        bodies = {"full.md": full, "short.md": "## What\n", "norow.md": full.replace("Resolves #12\n", ""),
                  "emptynotes.md": full + "## Notes\n\n"}
        for name, text in bodies.items():
            with open(os.path.join(repo, name), "w", encoding="utf-8") as f:
                f.write(text)
        path = self.pr_script(root)
        for command, reason in (('gh pr create -t "feat: x" --body "## What"', "inline `--body`"),
                                ("gh pr create --fill", "`--fill*`"),
                                ('gh pr create -t "feat: x"', "--body-file"),
                                ('gh pr create -t "feat: x" --body-file short.md', "`## What`"),
                                ('gh pr create -t "feat: x" --body-file norow.md', "no issue line"),
                                ('gh pr create -t "feat: x" --body-file emptynotes.md', "`## Notes`")):
            with self.subTest(command=command):
                self.assertIn(reason, self.run_script(path, command, cwd=repo) or "")
        for command in ('gh pr create -t "feat: x" --body-file full.md',
                        'gh pr create -t "docs: x" --body-file norow.md',
                        "gh pr edit 3 --add-label bug",
                        'gh pr create -R o/board -t t --body "x"'):
            with self.subTest(command=command):
                self.assertIsNone(self.run_script(path, command, cwd=repo))


class HookSourceTest(unittest.TestCase):
    """Every shipped hook and script compiles without a warning.

    Python compiles a hook on each call, so a warning such as an invalid
    escape (a DeprecationWarning before 3.12, a SyntaxWarning from 3.12)
    reaches stderr on every tool call."""

    DIRS = (".claude/hooks", "_core/global-template/hooks",
            "_core/project-template/.claude/hooks", "_core/project-template/.claude/scripts",
            "_core/global-template/mods/guards/scripts")

    def test_compiles_without_warnings(self):
        files = [os.path.join(d, name) for d in self.DIRS
                 for name in sorted(os.listdir(os.path.join(REPO, d))) if name.endswith(".py")]
        self.assertGreaterEqual(len(files), 10)
        for rel in files:
            with self.subTest(file=rel):
                with open(os.path.join(REPO, rel), encoding="utf-8") as f:
                    source = f.read()
                with warnings.catch_warnings():
                    warnings.simplefilter("error")
                    compile(source, rel, "exec")


if __name__ == "__main__":
    unittest.main()
