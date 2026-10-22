"""Tests for .github/scripts/review_gate.py, the review gate's shared logic."""

import json
import os
import runpy
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, ".github", "scripts"))
import review_gate as gate  # noqa: E402

SCRIPT = os.path.join(ROOT, ".github", "scripts", "review_gate.py")
MARK = r"Code Review[^a-zA-Z]+claude-code-templates"
with open(os.path.join(ROOT, ".github", "review-gate.yml"), encoding="utf-8") as _fh:
    # This repo's own always-reviewed paths, from its gate settings.
    ALWAYS = gate.settings(_fh.read())["triage.always_review"]


def triage(paths, incomplete=False):
    return gate.triage(paths, incomplete, ALWAYS)


def comment(body, at="2026-10-21T10:00:00Z", login="claude[bot]"):
    return {"user": {"login": login}, "created_at": at, "body": body}


class Triage(unittest.TestCase):
    def test_reviewable_and_not(self):
        self.assertTrue(triage(["engine/bind.js"]))
        self.assertTrue(triage(["_core/project-template/CLAUDE.md"]))
        self.assertTrue(triage(["bundles/2-multi-dev-oss/bundle.toggles.md"]))
        self.assertFalse(triage(["README.md", "docs/v2/PLAN.md"]))
        self.assertFalse(triage(["assets/logo.PNG", "fonts/geist.woff2", "docs/a.jpeg"]))
        self.assertFalse(triage([]))

    def test_anything_but_markdown_images_and_fonts_is_reviewed(self):
        for path in ("tools/run.sh", ".gitattributes", ".lfsconfig", "assets/logo.svg",
                     "LICENSE", "VERSION", "index.html", "package-lock.json"):
            with self.subTest(path=path):
                self.assertTrue(gate.triage(["README.md", path]))

    def test_only_the_review_workflow_never_counts(self):
        self.assertFalse(gate.triage([".github/workflows/claude-code-review.yml", "CHANGELOG.md"]))
        for path in (".github/workflows/claude-code-review.yaml",
                     ".github/workflows/helper.sh", ".github/workflows/lib/action.yml", ".github/workflows/sub/x.py",
                     ".github/workflows/tests.yml", ".github/workflows/pages.yaml", ".github/workflows/claude.yml",
                     ".github/workflows/claude-deploy.yml", ".github/workflows/sub/claude-code-review.yml"):
            with self.subTest(path=path):
                self.assertTrue(gate.triage([path]))

    def test_always_reviewed_paths_count_whatever_the_file_type(self):
        for path in (".github/scripts/json.pyc", ".github/scripts/run.sh", "redesign/notes.md",
                     "_core/project-template/README.md", ".github/review-gate.yml", "SETUP.md",
                     "CLAUDE.md", "engine/CLAUDE.md", ".claude/rules/git.md", ".claude/skills/find/SKILL.md",
                     "bundles/1-solo-personal/bundle.toggles.md", "_core/x/logo.png",
                     "_Core/project-template/.claude/rules/zz.md", "Bundles/x/bundle.toggles.md", "setup.MD",
                     "TOGGLES.md", "COMPARISON.md", "CLAUDE.local.md", "engine/claude.LOCAL.md",
                     "engine/.claude/skills/x/SKILL.md", "a/b/.Claude/rules/r.md"):
            with self.subTest(path=path):
                self.assertTrue(triage([path]))
        self.assertFalse(triage([".github/notes.md", "docs/redesign/x.md", "docs/a.claude/x.md", "docs/xclaude.md"]))

    def test_the_gates_own_paths_need_no_setting(self):
        for path in (".github/scripts/notes.md", ".claude/rules/git.md", "a/.claude/x.md",
                     "CLAUDE.md", "engine/CLAUDE.local.md"):
            with self.subTest(path=path):
                self.assertTrue(gate.triage([path]))
        for path in ("_core/x.md", "bundles/x.md", "SETUP.md", "redesign/a.md"):
            with self.subTest(path=path):
                self.assertFalse(gate.triage([path]))

    def test_a_project_setting_adds_paths(self):
        self.assertTrue(gate.triage(["docs/security/runbook.md"], always_review="docs/security/"))
        self.assertTrue(gate.triage(["Docs/Security/a/b.MD"], always_review="docs/security/"))
        self.assertTrue(gate.triage(["guide/x.md"], always_review="README.md, guide/*.md"))
        self.assertTrue(gate.triage(["guide/a/x.md"], always_review="guide/*.md"))
        self.assertFalse(gate.triage(["docs/securityx.md", "docs/other/a.md"], always_review="docs/security/"))
        self.assertFalse(gate.triage([".github/workflows/claude-code-review.yml"], always_review=".github/"))

    def test_the_setting_comes_from_the_file(self):
        with tempfile.TemporaryDirectory() as d:
            files, settings = os.path.join(d, "files.txt"), os.path.join(d, "gate.yml")
            with open(files, "w", encoding="utf-8") as fh:
                fh.write("docs/security/runbook.md\n")
            with open(settings, "w", encoding="utf-8") as fh:
                fh.write("triage:\n  always_review: docs/security/\n")
            run = lambda *extra: subprocess.run([sys.executable, "-I", SCRIPT, "triage", files, *extra],
                                                capture_output=True, text=True).stdout.strip()
            self.assertEqual(run("--file", settings), '{"review": true}')
            self.assertEqual(run("--file", os.path.join(d, "none.yml")), '{"review": false}')
            with open(settings, "w", encoding="utf-8") as fh:
                fh.write("triage:\n  always_review: docs/<x>\n")
            self.assertIn('"error"', run("--file", settings))

    def test_an_incomplete_listing_is_reviewed(self):
        self.assertTrue(triage(["README.md"], incomplete=True))
        self.assertTrue(triage(["docs/%d.md" % i for i in range(gate.LISTING_CAP)]))
        self.assertFalse(triage(["docs/%d.md" % i for i in range(gate.LISTING_CAP - 1)]))


CHECKS_DIR = os.path.join(ROOT, ".github", "review-checks")


class ReviewChecks(unittest.TestCase):
    """This repo's own pre-screen checks (prescreen.dir), run as the
    Project pre-screen job runs them: FILES DIFF, from the PR's checkout."""

    def run_check(self, name, files, contents):
        with tempfile.TemporaryDirectory() as d:
            for path, text in contents.items():
                os.makedirs(os.path.join(d, os.path.dirname(path)), exist_ok=True)
                with open(os.path.join(d, path), "w", encoding="utf-8") as fh:
                    fh.write(text)
            with open(os.path.join(d, "files.txt"), "w", encoding="utf-8") as fh:
                fh.write("".join(f + "\n" for f in files))
            open(os.path.join(d, "pr.diff"), "w").close()
            p = subprocess.run([sys.executable, "-I", os.path.join(CHECKS_DIR, name), "files.txt", "pr.diff"],
                               cwd=d, capture_output=True, text=True)
            return p.returncode, p.stdout

    def test_the_settings_name_this_folder(self):
        with open(os.path.join(ROOT, ".github", "review-gate.yml"), encoding="utf-8") as fh:
            self.assertEqual(gate.settings(fh.read())["prescreen.dir"], ".github/review-checks")

    def test_toggle_markers(self):
        t = "_core/project-template/x.md"
        code, out = self.run_check("template_markers.py", [t, "missing.md"],
                                   {t: "<!-- TOGGLE:a START -->\n<!-- TOGGLE:b START --><!-- TOGGLE:b END -->\n"})
        self.assertEqual((code, out.strip()), (1, "TOGGLE_UNBALANCED: %s: name=a START=1 END=0" % t))
        self.assertEqual(self.run_check("template_markers.py", [t], {t: "<!-- TOGGLE:a START -->x<!-- TOGGLE:a END -->"})[0], 0)
        self.assertEqual(self.run_check("template_markers.py", ["docs/x.md"], {"docs/x.md": "<!-- TOGGLE:a START -->"})[0], 0)

    def test_placeholders(self):
        t = "_core/project-template/y.md.template"
        code, out = self.run_check("template_placeholders.py", [t], {t: "{{PROJECT_NAME}} {{NOPE_THING}}"})
        self.assertEqual(code, 1)
        self.assertIn("{{NOPE_THING}}", out)
        self.assertNotIn("PROJECT_NAME", out)
        self.assertEqual(self.run_check("template_placeholders.py", ["docs/z.md"], {"docs/z.md": "{{NOPE}}"})[0], 0)

    def test_template_names(self):
        # Names a check could not open from the one-per-line list fail.
        names = runpy.run_path(os.path.join(CHECKS_DIR, "template_names.py"))
        for name in (b"a\nb.md", b"a\rb.md", b"tab\tx.md", b"n\xe9.md", b"del\x7f.md"):
            with self.subTest(name=name):
                self.assertTrue(names["odd"](name))
        for name in (b"README.md.template", "caf\u00e9.md".encode(), b"with space.md"):
            with self.subTest(name=name):
                self.assertFalse(names["odd"](name))
        t = "_core/project-template/x/y.md"
        self.assertEqual(self.run_check("template_names.py", [t], {t: "x"})[0], 0)

    def test_page_parity_only_warns(self):
        code, out = self.run_check("page_parity.py", ["redesign/app.jsx"], {"redesign/app.jsx": "<a/>"})
        self.assertEqual(code, 0)
        self.assertIn("JSX_HTML_PARITY", out)
        code, out = self.run_check("page_parity.py", ["redesign/app.jsx", "index.html"], {})
        self.assertNotIn("JSX_HTML_PARITY", out)


class Verdict(unittest.TestCase):
    def pages(self, *pages):
        return "\n".join(json.dumps(p) for p in pages)

    def test_last_matching_bot_comment_and_its_last_verdict_line(self):
        text = self.pages(
            [comment("## Code Review — claude-code-templates\n🔴 Blocking — must fix", "2026-10-21T09:00:00Z")],
            [comment("## Code Review — claude-code-templates\nAll clear 🟢 so far\n...\n🔴 Blocking — must fix"),
             comment("## Code Review — claude-code-templates\n🟢 LGTM", login="someone"),
             comment("unrelated 🟢")],
        )
        self.assertEqual(gate.verdict(text, "2026-10-21T09:30:00Z", "routine", MARK),
                         {"verdict": "block", "line": "🔴 Blocking — must fix"})

    def test_older_than_the_run_or_without_a_verdict_is_missing(self):
        old = self.pages([comment("## Code Review — claude-code-templates\n🟢 LGTM", "2026-10-21T08:00:00Z")])
        self.assertEqual(gate.verdict(old, "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")
        none = self.pages([comment("## Code Review — claude-code-templates\nLooks fine overall.")])
        self.assertEqual(gate.verdict(none, "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")
        self.assertEqual(gate.verdict("", "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")

    def test_a_long_run_of_markup_reads_in_linear_time(self):
        # A comment can be 65,536 characters; a pattern that backtracks over
        # every split of a run would hang the verdict step.
        for seed in (" ", "_", "*", "#", "-", "[ ]", ":", "—", "> ", "`a`", "x"):
            line = (seed * 60000)[:60000]
            started = time.perf_counter()
            gate._line("## Deep review\n" + line + "Blockin\n🟢 LGTM")
            gate._line(line)
            self.assertLess(time.perf_counter() - started, 2, repr(seed))

    def test_the_actions_footer_under_the_verdict_is_skipped(self):
        for tail in ("", "\n\n---\n[View job](https://github.com/o/r/actions/runs/1) · "
                     "[Branch](https://github.com/o/r/tree/b)", "\n · `fix/x`", "\n• [Branch](https://github.com/o/r/tree/b)  ",
                     "\n---\n[View job](https://github.com/o/r/actions/runs/1)\n***",
                     "\n\n---\n · branch [`feat/x`](https://github.com/o/r/tree/feat/x)", "\n--- · `chore/x`",
                     "\n · `fix/x` ·", "\n• Branch: `fix/x`", "\n ·", "\n--- · [branch](https://github.com/o/r/tree/b)",
                     "\n[View job](https://github.com/o/r/actions/runs/1) · Branch: [`b`](https://github.com/o/r/tree/b)"):
            body = "**Claude finished**\n\n🟢 LGTM" + tail
            self.assertEqual(gate._line(body)[:2], ("pass", "🟢 LGTM"), tail)
        body = "**Claude finished**\n\n## 🟢 All clear\nVerdict = Blocking\n---\n[View job](https://github.com/o/r/actions/runs/1)"
        self.assertEqual(gate._line(body)[0], "missing")

    def test_a_trailing_line_with_words_is_the_last_line(self):
        # Only lines that say nothing are skipped: an open item, a bullet with
        # words or a link followed by text ends the comment and is missing.
        for tail in ("\n- [ ] `a.py:12` drops the filter, fix before merge", "\n- [x] Post verdict",
                     "\n• Actually this needs changes: a.py:12", "\n· request changes: fix a.py",
                     "\n---\n• Request changes", "\n[View job](https://github.com/o/r/actions/runs/1) request changes",
                     "\n· `fix/x` must change", "\n[Docs](https://example.com/x)", "\n· `must fix a.py`",
                     "\n· [fix this](https://github.com/o/r/pull/1)", "\n***bold claim***",
                     "\n`DO-NOT-MERGE`", "\n[Changes_requested](https://github.com/o/r/pull/1)",
                     "\n--- `wip`", "\n· `must-fix-a.py:12`", "\n· [Changes](https://github.com/o/r/pull/1)"):
            body = "## Code Review — claude-code-templates\n### 🟢 All clear on hooks" + tail
            self.assertEqual(gate._line(body)[0], "missing", tail)
        # A glyph anywhere in a link keeps the line: it is never a footer.
        for tail in ("\n · [View job](https://github.com/o/r🔴/actions/runs/1)",
                     "\n · [`b`](https://github.com/o🔴/r/tree/b)"):
            self.assertEqual(gate._line("## Deep review\n🟢 LGTM" + tail)[0], "block", tail)

    def test_a_red_on_the_last_glyph_line_blocks_without_a_verdict_line(self):
        # Never missing: a missing deep verdict starts a second review that
        # could bury the 🔴.
        for body, line in (
                ("## Deep review\nx\n**Verdict — 🔴 request changes**\n\nHappy to re-check after a fix.",
                 "**Verdict — 🔴 request changes**"),
                ("## Deep review\nx\nVerdict: 🔴 the writer races in a.py:40\nHappy to re-check.",
                 "Verdict: 🔴 the writer races in a.py:40"),
                ("## Deep review\n🟢 hooks\nFinal verdict 🔴 — a.py:40 races\n- [x] Post verdict",
                 "Final verdict 🔴 — a.py:40 races")):
            self.assertEqual(gate._line(body), ("block", line, "glyph"))
        self.assertEqual(gate._line("## Deep review\nVerdict: 🔴 x\n🟢 hooks are fine\nThanks")[0], "missing")

    def test_a_quoted_verdict_is_not_this_reviews_verdict(self):
        body = "## Deep review\nThe writer races in a.py:40; this must be fixed.\nThe routine review said:\n> 🟢 LGTM"
        self.assertEqual(gate._line(body)[0], "missing")
        self.assertEqual(gate._line("## Deep review\n> 🔴 Blocking — x")[0], "block")

    def test_the_last_glyph_line_decides_and_a_glyphless_blocking_blocks(self):
        head = "## Code Review — claude-code-templates\n"
        alone = "no 🔴/🟢 line; a line opening with Blocking"
        over = "a line opening with Blocking outranks the 🟢 line"
        red = "a line opening with 🔴 outranks the later 🟢 line"
        cases = [
            # (routine comment body, verdict, line, recovered)
            (head + "**Blocking** — hook is not POSIX-portable", "block",
             "**Blocking** — hook is not POSIX-portable", alone),
            (head + "The 🔴 from the last pass is fixed.\n🟢 LGTM", "pass", "🟢 LGTM", None),
            (head + "The format is \"🟢 LGTM\".\n🔴 Must fix: hook is not portable", "block",
             "🔴 Must fix: hook is not portable", None),
            # No line opens with a glyph: a 🔴 on the last glyph line still blocks.
            (head + "Post a binary 🔴/🟢 verdict", "block", "Post a binary 🔴/🟢 verdict", None),
            (head + "Post a binary verdict 🟢 or not", "missing", "", None),
            ("**Code Review - claude-code-templates**\n🟢 LGTM", "pass", "🟢 LGTM", None),
            # A dropped glyph next to a 🟢 elsewhere still blocks.
            (head + "**Blocking** — must fix\nOnce fixed, this is 🟢 LGTM.", "block",
             "**Blocking** — must fix", over),
            (head + "## 🟢 All clear on hooks\nBlocking: the writer races", "block",
             "Blocking: the writer races", over),
            # A verdict line with a 🟢 heading after it, and list-style tags.
            (head + "🔴 Blocking — the writer races\n## 🟢 All clear on hooks", "block",
             "🔴 Blocking — the writer races", red),
            (head + "1. **Blocking** — drops the filter\n## 🟢 All clear on hooks", "block",
             "1. **Blocking** — drops the filter", over),
            (head + "- **[Blocking]** — drops the filter", "block",
             "- **[Blocking]** — drops the filter", alone),
            (head + "> Blocking: the writer races\n🟢 LGTM", "block", "> Blocking: the writer races", over),
            (head + "+ Blocking — drops the filter\n🟢 LGTM", "block", "+ Blocking — drops the filter", over),
            (head + "[Blocking] — drops the filter", "block", "[Blocking] — drops the filter", alone),
            (head + "_Blocking_ — drops the filter\n🟢 LGTM", "block", "_Blocking_ — drops the filter", over),
            # A 🔴 Blocking list item between a 🟢 recap and a 🟢 heading.
            (head + "The routine tier said 🟢 LGTM.\n1. 🔴 **Blocking** — drops the filter\n"
             "## 🟢 All clear on hooks", "block", "1. 🔴 **Blocking** — drops the filter", red),
            (head + "- 🔴 Blocking — drops the filter\n🟢 LGTM", "block",
             "- 🔴 Blocking — drops the filter", red),
            # A 🔴 after any bullet blocks too: prose naming a 🔴 keeps it in backticks.
            (head + "  - 🔴 when any finding exists: checked\n🟢 LGTM", "block", "- 🔴 when any finding exists: checked", red),
            (head + "* 🔴 when any finding exists: checked\n🟢 LGTM", "block", "* 🔴 when any finding exists: checked", red),
            (head + "+ 🔴 when any finding exists: checked\n🟢 LGTM", "block", "+ 🔴 when any finding exists: checked", red),
            (head + "1. 🔴 when any finding exists: checked\n🟢 LGTM", "block", "1. 🔴 when any finding exists: checked", red),
            (head + "> 🔴 when any finding exists: checked\n🟢 LGTM", "block", "> 🔴 when any finding exists: checked", red),
            (head + "- 🔴 `hook.sh:12` — raised earlier, now fixed\n🟢 LGTM", "block", "- 🔴 `hook.sh:12` — raised earlier, now fixed", red),
            (head + "- `🔴` when any finding exists: checked\n🟢 LGTM", "pass", "🟢 LGTM", None),
            # A label then "Blocking" in any case blocks; a hyphenated word does not.
            (head + "## 🟢 All clear\n**Verdict:** blocking — must fix", "block",
             "**Verdict:** blocking — must fix", over),
            (head + "**VERDICT:** BLOCKING\n🟢 LGTM", "block", "**VERDICT:** BLOCKING", over),
            (head + "- `a.py:1` — Blocking: the writer races\n🟢 LGTM", "block",
             "- `a.py:1` — Blocking: the writer races", over),
            (head + "Non-blocking: none\n🟢 LGTM", "pass", "🟢 LGTM", None),
            # After a dash only "Blocking"/"BLOCKING" counts: the adjective in prose passes.
            (head + "**Change 3 — blocking verdict output summary (~line 244):**\n🟢 LGTM",
             "pass", "🟢 LGTM", None),
            (head + "- Step 2 – blocking call removed\n🟢 LGTM", "pass", "🟢 LGTM", None),
            (head + "**Verdict** — BLOCKING\n🟢 LGTM", "block", "**Verdict** — BLOCKING", over),
            # A lower-case "blocking" after a dash or a 🔴 is a verdict unless a word
            # or a code span follows it; "finding" and "issue" still make it one.
            (head + "#### Finding \u2014 blocking\n🟢 LGTM", "block",
             "#### Finding \u2014 blocking", over),
            (head + "- **#1 (threading) \u2014 blocking, real correctness bug.**\n🟢 LGTM",
             "block", "- **#1 (threading) \u2014 blocking, real correctness bug.**", over),
            (head + "**`a.json` \u2014 blocking finding:**\n🟢 LGTM", "block",
             "**`a.json` \u2014 blocking finding:**", over),
            (head + "Verdict 🔴 blocking\n🟢 LGTM", "block", "Verdict 🔴 blocking", over),
            (head + "### 4. Invariant 3 \u2014 blocking `wait()` in the loop\n🟢 LGTM",
             "pass", "🟢 LGTM", None),
            # Emphasis or a bracket before the next word keeps it prose; "finding" still counts.
            (head + "- `x.py:3` — blocking **I/O** in the event loop\n🟢 LGTM", "pass", "🟢 LGTM", None),
            (head + "Change 3 — blocking (synchronous) writes\n🟢 LGTM", "pass", "🟢 LGTM", None),
            (head + "Change 3 — blocking _output_\n🟢 LGTM", "pass", "🟢 LGTM", None),
            # A double-backtick span quoting a backtick stays code: no label after it.
            (head + "- The class `` [^`] `` excludes backticks, so `- [ ] Blocking` stays quoted.\n🟢 LGTM", "pass", "🟢 LGTM", None),
            (head + "| ``(?i:blocking)`` | lower-case after a dash |\n🟢 LGTM", "pass", "🟢 LGTM", None),
            (head + "**`a.json` — blocking **finding**:**\n🟢 LGTM", "block",
             "**`a.json` — blocking **finding**:**", over),
            (head + "**Verdict** — blocking.\n🟢 LGTM", "block", "**Verdict** — blocking.", over),
            (head + "- `a.py:1` 🔴 Blocking: race\n🟢 LGTM", "block",
             "- `a.py:1` 🔴 Blocking: race", over),
            (head + "\u26a0\ufe0f Blocking — race\n🟢 LGTM", "block", "\u26a0\ufe0f Blocking — race", over),
            (head + "| [ ] " * 200 + "| ok\n🟢 LGTM", "pass", "🟢 LGTM", None),
            # A glyph-less verdict under a 🟢 heading is missing, never a pass.
            (head + "## 🟢 All clear on hooks\nVerdict = request changes", "missing", "", None),
            (head + "## 🟢 All clear on hooks\n\u274c Request changes", "missing", "", None),
            (head + "🟢 LGTM\nThanks!", "missing", "", None),
            # Bold, italics and headings are markup, not bullets: they open.
            (head + "**🔴 Blocking — the writer races**\n## 🟢 All clear on hooks", "block",
             "**🔴 Blocking — the writer races**", red),
            (head + "*🔴 the writer races*\n🟢 LGTM", "block", "*🔴 the writer races*", red),
            (head + "# 🔴 the writer races\n🟢 LGTM", "block", "# 🔴 the writer races", red),
            (head + "Blockings and Blockingly are not the word.\n🟢 LGTM", "pass", "🟢 LGTM", None),
            # Fails closed on a heading that opens with the word: none of the
            # repo's 513 passing verdicts to 2026-10-22 had one.
            (head + "## Blocking findings\nNone.\n🟢 LGTM", "block", "## Blocking findings", over),
            # A bare LGTM never passes: prose opens the same way.
            (head + "LGTM", "missing", "", None),
            (head + "LGTM otherwise, but the END marker must be fixed", "missing", "", None),
            (head + "no blocking issues found", "missing", "", None),
            # Without its heading a comment is never the routine verdict.
            ("Review done.\n🟢 LGTM", "missing", "", None),
            ("Review done.\n🔴 Blocking — race in the writer", "missing", "", None),
        ]
        for body, result, line, recovered in cases:
            with self.subTest(body=body):
                got = gate.verdict(self.pages([comment(body)]), "2026-10-21T09:00:00Z", "routine", MARK)
                want = {"verdict": result, "line": line}
                if recovered:
                    want["recovered"] = recovered
                self.assertEqual(got, want)

    def test_requests_and_tracking_comments_are_never_the_routine_verdict(self):
        text = self.pages([
            comment("## Code Review — claude-code-templates\n🟢 LGTM", "2026-10-21T09:10:00Z"),
            comment("@claude review this PR — depth pass on the Code Review — claude-code-templates gate.\n"
                    "🔴 Blocking when ANY real finding exists", "2026-10-21T09:11:00Z"),
            comment("Claude Code is working… <img src=\"spinner\">\n🔴 Blocking", "2026-10-21T09:12:00Z"),
            comment("**Claude encountered an error** — [View job](x)\n🔴 Blocking", "2026-10-21T09:13:00Z"),
        ])
        self.assertEqual(gate.verdict(text, "2026-10-21T09:00:00Z", "routine", MARK),
                         {"verdict": "pass", "line": "🟢 LGTM"})
        only_request = self.pages([comment("@claude review this PR\n🟢 LGTM")])
        self.assertEqual(gate.verdict(only_request, "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")

    def test_deep_run_comments_never_stand_in_for_the_routine_verdict(self):
        # However the deep review was asked for, its comments carry glyphs
        # into the same thread; without the routine heading none counts.
        for request_by in ("claude[bot]", "maintainer"):
            text = self.pages([
                comment("@claude review this PR — depth pass.", "2026-10-21T09:05:00Z", login=request_by),
                comment("Review done.\n🔴 Blocking — race in the writer", "2026-10-21T09:10:00Z"),
                comment("Deep pass notes\n🟢 LGTM", "2026-10-21T09:12:00Z"),
                comment("# Deep Review — Code Review — claude-code-templates\n🟢 LGTM", "2026-10-21T09:13:00Z"),
            ])
            with self.subTest(request_by=request_by):
                self.assertEqual(gate.verdict(text, "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")

    def test_a_deep_verdict_without_a_glyph_only_ever_blocks(self):
        text = self.pages([comment("## Deep review\nBlocking — race in the writer")])
        self.assertEqual(gate.verdict(text, "2026-10-21T09:00:00Z", "deep"),
                         {"verdict": "block", "line": "Blocking — race in the writer",
                          "recovered": "no 🔴/🟢 line; a line opening with Blocking"})
        bare = self.pages([comment("## Deep review\nAll clear.\nLGTM")])
        self.assertEqual(gate.verdict(bare, "2026-10-21T09:00:00Z", "deep")["verdict"], "missing")

    def test_the_tiers_never_read_each_others_comments(self):
        text = self.pages([
            comment("## Code Review — claude-code-templates\n🔴 Blocking", "2026-10-21T09:10:00Z"),
            comment("**Claude finished the task**\nThe Code Review — claude-code-templates verdict was 🔴.\n🟢 LGTM",
                    "2026-10-21T09:20:00Z"),
        ])
        self.assertEqual(gate.verdict(text, "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "block")
        self.assertEqual(gate.verdict(text, "2026-10-21T09:00:00Z", "deep")["verdict"], "pass")
        credits = self.pages([comment("## Deep review\n🔴 Blocking — race in the writer")])
        self.assertEqual(gate.verdict(credits, "2026-10-21T09:00:00Z", "deep")["verdict"], "block")
        self.assertEqual(gate.verdict(credits, "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")


class Decide(unittest.TestCase):
    def test_every_path(self):
        cases = [
            (("skip",), {}, "completed", "success"),
            (("skip",), {"deep": "pass"}, "completed", "success"),
            (("skip",), {"deep": "block"}, "completed", "failure"),
            (("skip",), {"escalated": True}, "in_progress", None),
            (("skip",), {"escalated": True, "deep": "pass"}, "completed", "success"),
            (("reviewable", "pass"), {}, "completed", "success"),
            (("reviewable", "block"), {}, "completed", "failure"),
            (("reviewable", "missing"), {}, "completed", "failure"),
            (("reviewable", "error"), {"escalated": True}, "completed", "failure"),
            (("reviewable", "pending"), {}, "in_progress", None),
            (("reviewable", "pending"), {"deep": "pass"}, "in_progress", None),
            (("reviewable", "pending"), {"deep": "error"}, "completed", "failure"),
            (("reviewable", "block"), {"deep": "pass"}, "completed", "failure"),
            (("reviewable", "pass"), {"escalated": True}, "in_progress", None),
            (("reviewable", "pass"), {"deep": "pass"}, "completed", "success"),
            (("reviewable", "pass"), {"escalated": True, "deep": "pass"}, "completed", "success"),
            (("reviewable", "pass"), {"escalated": True, "deep": "block"}, "completed", "failure"),
            (("reviewable", "pass"), {"escalated": True, "deep": "missing"}, "completed", "failure"),
            (("reviewable", "pass"), {"escalated": True, "deep": "error"}, "completed", "failure"),
        ]
        for args, kw, status, conclusion in cases:
            with self.subTest(args=args, kw=kw):
                out = gate.decide(*args, **kw)
                self.assertEqual((out["status"], out["conclusion"]), (status, conclusion))
                self.assertTrue(out["title"] and out["summary"])


class GateState(unittest.TestCase):
    def test_each_workflow_adds_its_facts_and_the_last_one_decides(self):
        start = gate.gate("")
        self.assertEqual((start["status"], start["state"]),
                         ("in_progress", "triage=reviewable;routine=pending;escalated=no;deep=none;routine_by=0.0.0;deep_by=0.0.0"))
        # A deep review started by hand before the routine one finished...
        deep_started = gate.gate(start["state"], escalated=True, deep="none")
        deep_done = gate.gate(deep_started["state"], deep="block")
        self.assertEqual(deep_done["conclusion"], "failure")
        # ...still blocks once the routine review passes afterwards.
        routine_done = gate.gate(deep_done["state"], triage="reviewable", routine="pass")
        self.assertEqual((routine_done["conclusion"], routine_done["state"]),
                         ("failure", "triage=reviewable;routine=pass;escalated=yes;deep=block;routine_by=0.0.0;deep_by=0.0.0"))

    def test_escalation_only_turns_on(self):
        asked = gate.gate("", routine="pass", escalated=True)
        self.assertEqual(asked["status"], "in_progress")
        self.assertEqual(gate.gate(asked["state"], routine="pass")["status"], "in_progress")

    def test_an_older_run_never_replaces_a_newer_runs_facts(self):
        # The deep run that replaced a cancelled one has started...
        held = gate.gate("", escalated=True, deep="none", order="200.1.0")
        # ...when the cancelled run's last step reports its error: ignored.
        late = gate.gate(held["state"], deep="error", order="100.1.1")
        self.assertEqual((late["status"], late["state"]),
                         ("in_progress", "triage=reviewable;routine=pending;escalated=yes;deep=none;"
                                         "routine_by=0.0.0;deep_by=200.1.0"))
        # A later step of the same run, or a re-run attempt, does replace them.
        done = gate.gate(late["state"], deep="pass", order="200.1.1")
        again = gate.gate(done["state"], deep="block", order="200.2.0")
        self.assertEqual(gate.parse_state(again["state"])["deep"], "block")
        # The tiers are stamped apart: a newer deep run leaves routine facts alone.
        routine = gate.gate(again["state"], triage="reviewable", routine="pass", order="150.1.1")
        self.assertEqual(gate.parse_state(routine["state"])["routine"], "pass")

    def test_a_bad_state_or_fact_is_an_error(self):
        for state, facts in [("routine=maybe", {}), ("colour=red", {}), ("routine", {}), ("", {"deep": "pending"}),
                             ("", {"routine": "none"}), ("deep_by=1.2", {}), ("routine_by=x.1.1", {}),
                             ("", {"routine": "pass", "order": "12"}), ("", {"deep": "pass", "order": "1.1.1.1"})]:
            with self.subTest(state=state, facts=facts):
                with self.assertRaises(gate.GateError):
                    gate.gate(state, **facts)


class Upsert(unittest.TestCase):
    SHA = "a" * 40

    def setUp(self):
        # A fake check store. `wipes` stands for another workflow whose stale
        # write lands right after each of the next N PATCHes, putting back the
        # start state.
        self.calls, self.existing, self.wipes = [], [], 0
        real, settle = gate._gh, gate.SETTLE_SECONDS

        def fake(path, method="GET", body=None):
            self.calls.append((method, path, body))
            if method == "GET":
                return {"check_runs": self.existing}
            if method == "POST":
                self.existing.append(dict(body, id=1))
                return {}
            run = next(r for r in self.existing if path.endswith("/%d" % r["id"]))
            run["external_id"] = body["external_id"]
            if self.wipes:
                self.wipes -= 1
                run["external_id"] = ""
            return {}
        gate._gh, gate.SETTLE_SECONDS = fake, (0, 0)
        self.addCleanup(setattr, gate, "_gh", real)
        self.addCleanup(setattr, gate, "SETTLE_SECONDS", settle)

    def patches(self):
        return [body for method, _, body in self.calls if method == "PATCH"]

    def test_first_call_creates_the_check_with_the_start_state(self):
        out = gate.upsert("o/r", self.SHA, "Set up by the routine workflow.")
        self.assertEqual(out["status"], "in_progress")
        [(method, path, body)] = [c for c in self.calls if c[0] != "GET"]
        self.assertEqual((method, path), ("POST", "repos/o/r/check-runs"))
        self.assertEqual((body["name"], body["head_sha"], body["status"]), ("Review gate", self.SHA, "in_progress"))
        self.assertNotIn("conclusion", body)
        self.assertTrue(body["output"]["summary"].endswith("Set up by the routine workflow."))

    def test_later_calls_update_the_newest_check_from_its_state(self):
        self.existing = [
            {"id": 7, "name": "Review gate", "external_id": "triage=reviewable;routine=pending;escalated=yes;deep=block"},
            {"id": 3, "name": "Review gate", "external_id": ""},
            {"id": 9, "name": "Other check", "external_id": ""},
        ]
        out = gate.upsert("o/r", self.SHA, routine="pass", order="5.1.1")
        [body] = self.patches()
        self.assertIn(("PATCH", "repos/o/r/check-runs/7", body), self.calls)
        self.assertEqual((out["conclusion"], body["conclusion"], body["external_id"]),
                         ("failure", "failure",
                          "triage=reviewable;routine=pass;escalated=yes;deep=block;routine_by=5.1.1;deep_by=0.0.0"))

    def test_a_wiped_write_is_written_again(self):
        self.existing = [{"id": 7, "name": "Review gate", "external_id": ""}]
        self.wipes = 1
        out = gate.upsert("o/r", self.SHA, triage="reviewable", routine="pass", escalated=True, order="5.1.1")
        self.assertEqual(len(self.patches()), 2)
        self.assertEqual((out["status"], self.existing[0]["external_id"]),
                         ("in_progress", "triage=reviewable;routine=pass;escalated=yes;deep=none;"
                                         "routine_by=5.1.1;deep_by=0.0.0"))

    def test_a_write_wiped_every_time_fails_the_step(self):
        self.existing = [{"id": 7, "name": "Review gate", "external_id": ""}]
        self.wipes = 99
        with self.assertRaises(gate.GateError):
            gate.upsert("o/r", self.SHA, deep="pass", order="5.1.1")
        self.assertEqual(len(self.patches()), gate.WRITE_ROUNDS)

    def test_a_newer_runs_facts_count_as_held(self):
        self.existing = [{"id": 7, "name": "Review gate", "external_id": "routine=block;routine_by=9.1.1"}]
        out = gate.upsert("o/r", self.SHA, routine="pass", order="5.1.1")
        self.assertEqual((out["conclusion"], len(self.patches())), ("failure", 1))

    def test_tier_facts_need_an_order(self):
        for facts in [{"routine": "pass"}, {"triage": "skip"}, {"deep": "none", "escalated": True}]:
            with self.subTest(facts=facts):
                with self.assertRaises(gate.GateError):
                    gate.upsert("o/r", self.SHA, **facts)
        self.assertEqual(self.calls, [])

    def test_bad_repo_or_sha_is_refused_before_any_call(self):
        for repo, sha in [("o/r/../x", self.SHA), ("o/r", "HEAD"), ("o/r", self.SHA[:39])]:
            with self.subTest(repo=repo, sha=sha):
                with self.assertRaises(gate.GateError):
                    gate.upsert(repo, sha)
        self.assertEqual(self.calls, [])


class Settings(unittest.TestCase):
    def test_defaults_and_overrides(self):
        self.assertEqual(gate.settings(""), gate.DEFAULTS)
        text = "checks: two  # both checks\nroutine:\n  model: claude-opus-5-5\n  max_turns: 80\nfallback:\n  effort: \"medium\"\n"
        got = gate.settings(text)
        self.assertEqual((got["checks"], got["routine.model"], got["routine.max_turns"], got["fallback.effort"]),
                         ("two", "claude-opus-5-5", "80", "medium"))
        self.assertEqual(got["deep.model"], gate.DEFAULTS["deep.model"])

    def test_the_shipped_file_holds_the_defaults(self):
        # Every value but this repo's own paths and checks.
        with open(os.path.join(ROOT, ".github", "review-gate.yml"), encoding="utf-8") as fh:
            got = gate.settings(fh.read())
        own = {"triage.always_review": "", "prescreen.dir": "", "escalate.paths": ""}
        self.assertEqual({**got, **own}, gate.DEFAULTS)

    def test_bad_settings_are_errors(self):
        for text in ["checks: three", "routine:\n  model: Bad Model", "routine:\n  effort: huge", "routine:\n  max_turns: 0",
                     "deep:\n  colour: red", "  model: x", "model claude", "checks:", "checks:  # one",
                     "colour:", "colour:\n  model: x",
                     "runner: self hosted", "runner: a,,b", "runner: $(id)", "routine:\n  fallback_effort: huge",
                     "prescreen:\n  dir: /etc", "prescreen:\n  dir: ../x", "prescreen:\n  dir: a/../b",
                     "prescreen:\n  dir: a b", "prescreen:\n  dir: -x", "prescreen:\n  dir: -", "escalate:\n  paths: a b", "escalate:\n  paths: $x",
                     "escalate:\n  patterns: (unclosed", "reviewer:\n  allowed_tools: Bash(rm -rf $HOME)",
                     "reviewer:\n  allowed_tools: Bash(a \"b\")", "reviewer:\n  allowed_tools: Write",
                     "reviewer:\n  allowed_tools: Bash(a), Edit", "reviewer:\n  allowed_tools: Bash(a(b))"]:
            with self.subTest(text=text):
                with self.assertRaises(gate.GateError):
                    gate.settings(text)

    def test_a_tier_backup_follows_the_shared_one_unless_set(self):
        got = gate.settings("fallback:\n  model: claude-opus-5-1\n  effort: medium\ndeep:\n  fallback_effort: max\n")
        self.assertEqual((got["routine.fallback_model"], got["routine.fallback_effort"]),
                         ("claude-opus-5-1", "medium"))
        self.assertEqual((got["deep.fallback_model"], got["deep.fallback_effort"]), ("claude-opus-5-1", "max"))

    def test_extension_settings_take_valid_values(self):
        text = ("runner: self-hosted, linux\nprescreen:\n  dir: .github/review-prescreen\n"
                "escalate:\n  paths: migrations/, src/**/auth*.py\n  patterns: \\b(eval|exec)\\(\n"
                "reviewer:\n  allowed_tools: Bash(npm run lint *), Read, Grep\n")
        got = gate.settings(text)
        self.assertEqual((got["runner"], got["prescreen.dir"], got["escalate.paths"], got["escalate.patterns"],
                          got["reviewer.allowed_tools"]),
                         ("self-hosted, linux", ".github/review-prescreen", "migrations/, src/**/auth*.py",
                          "\\b(eval|exec)\\(", "Bash(npm run lint *), Read, Grep"))
        self.assertEqual(gate.settings("prescreen:\n  dir:\n")["prescreen.dir"], "")


class Escalate(unittest.TestCase):
    VALUES = dict(gate.DEFAULTS, **{"escalate.paths": "migrations/, src/*/auth.py",
                                    "escalate.patterns": r"\beval\("})

    def test_paths_match_globs_and_folders_in_any_case(self):
        got = gate.escalate(["Migrations/001.sql", "src/api/AUTH.py", "src/auth.py", "docs/migrations.md"], [],
                            self.VALUES)
        self.assertEqual(got, {"escalate": True, "paths": ["Migrations/001.sql", "src/api/AUTH.py"], "lines": []})

    def test_added_lines_match_the_pattern(self):
        got = gate.escalate(["a.py"], ["x = 1", "y = eval(s)", "evaluate(s)"], self.VALUES)
        self.assertEqual(got, {"escalate": True, "paths": [], "lines": ["y = eval(s)"]})

    def test_added_lines_come_from_the_hunks_only(self):
        diff = ("diff --git a/a.c b/a.c\n--- a/a.c\n+++ b/a.c\n@@ -1,3 +1,4 @@\n ctx\n-old\n++i; eval(s);\n"
                "++++ b/x\n\\ No newline at end of file\n ctx\n"
                "diff --git a/b.c b/b.c\nnew file mode 100644\n--- /dev/null\n+++ b/b.c\n@@ -0,0 +1 @@\n+only\n")
        self.assertEqual(gate.added_lines(diff), ["+i; eval(s);", "+++ b/x", "only"])
        got = gate.escalate(["a.c"], gate.added_lines(diff), self.VALUES)
        self.assertEqual(got["lines"], ["+i; eval(s);"])

    def test_one_pair_of_outer_quotes_is_stripped_never_more(self):
        self.assertEqual(gate.settings("escalate:\n  patterns: '(?:\\\\.|[^'])*'\n")["escalate.patterns"],
                         "(?:\\\\.|[^'])*")
        self.assertEqual(gate.settings("escalate:\n  patterns: =\"\n")["escalate.patterns"], '="')
        self.assertEqual(gate.settings("escalate:\n  patterns: \"'x'\"\n")["escalate.patterns"], "'x'")
        for text in ("escalate:\n  patterns: \"a#b\"\n", "escalate:\n  patterns: 'x\n"):
            with self.subTest(text=text):
                with self.assertRaises(gate.GateError):
                    gate.settings(text)

    def test_command_keeps_a_carriage_return_inside_an_added_line(self):
        with tempfile.TemporaryDirectory() as d:
            files, diff, conf = (os.path.join(d, n) for n in ("files.txt", "pr.diff", "gate.yml"))
            for path, text in ((files, "a.py\n"), (diff, "--- /dev/null\n+++ b/a.py\n@@ -0,0 +1,2 @@\n+foo\reval(x)\n+bar\n"),
                               (conf, "escalate:\n  patterns: eval\n")):
                with open(path, "w", encoding="utf-8", newline="") as fh:
                    fh.write(text)
            r = subprocess.run([sys.executable, SCRIPT, "escalate", files, diff, "--file", conf], capture_output=True)
        self.assertEqual((r.returncode, json.loads(r.stdout)["lines"]), (0, ["foo\reval(x)"]))

    def test_a_crlf_ending_does_not_dodge_an_anchored_pattern(self):
        diff = "--- a/a.py\n+++ b/a.py\n@@ -0,0 +1,2 @@\n+eval(x)\r\n+a\rb\r\n"
        self.assertEqual(gate.added_lines(diff), ["eval(x)", "a\rb"])
        values = dict(gate.DEFAULTS, **{"escalate.patterns": r"eval\(x\)$"})
        self.assertTrue(gate.escalate(["a.py"], gate.added_lines(diff), values)["escalate"])

    def test_nothing_set_never_escalates(self):
        self.assertEqual(gate.escalate(["migrations/1.sql"], ["eval(x)"], gate.DEFAULTS),
                         {"escalate": False, "paths": [], "lines": []})

    def test_command_reads_the_diff_and_names_what_matched(self):
        with tempfile.TemporaryDirectory() as d:
            files, diff, conf = (os.path.join(d, n) for n in ("files.txt", "pr.diff", "gate.yml"))
            for path, text in ((files, "migrations/1.sql\nREADME.md\n"),
                               (diff, "--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n+y = eval(s)\n-z = eval(t)\n x = eval(u)\n"),
                               (conf, "escalate:\n  paths: migrations/\n  patterns: eval\n")):
                with open(path, "w", encoding="utf-8", newline="") as fh:
                    fh.write(text)
            r = subprocess.run([sys.executable, SCRIPT, "escalate", files, diff, "--file", conf], capture_output=True)
        self.assertEqual((r.returncode, json.loads(r.stdout)),
                         (0, {"escalate": True, "paths": ["migrations/1.sql"], "lines": ["y = eval(s)"]}))


class Command(unittest.TestCase):
    def run_cli(self, *args, stdin=""):
        r = subprocess.run([sys.executable, SCRIPT, *args], input=stdin.encode("utf-8"), capture_output=True)
        return r.returncode, r.stdout.decode("utf-8").strip()

    def test_verdict_reads_utf8_whatever_the_locale(self):
        stdin = json.dumps([comment("## Code Review — claude-code-templates\n🟢 LGTM")], ensure_ascii=False)
        code, out = self.run_cli("verdict", "--since", "2026-10-21T09:00:00Z", "--tier", "routine", "--marker", MARK,
                                 stdin=stdin)
        self.assertEqual((code, json.loads(out)), (0, {"verdict": "pass", "line": "🟢 LGTM"}))

    def test_commands_print_one_line(self):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
            fh.write("README.md\nengine/bind.js\n")
        try:
            self.assertEqual(self.run_cli("triage", fh.name), (0, '{"review": true}'))
        finally:
            os.remove(fh.name)
        code, out = self.run_cli("gate", "--state", "", "--routine", "pass", "--escalated")
        self.assertEqual((code, json.loads(out)["state"]), (0, "triage=reviewable;routine=pass;escalated=yes;deep=none;routine_by=0.0.0;deep_by=0.0.0"))
        code, out = self.run_cli("settings", "--file", os.path.join(ROOT, "no-such-file.yml"))
        self.assertEqual(code, 0)
        self.assertIn("routine_model=claude-fable-5-1", out.splitlines())

    def test_bad_arguments_are_refused(self):
        for args in [("gate", "--triage", "skip"), ("gate", "--state", "", "--triage", "maybe"),
                     ("gate", "--state", "", "--routine", "ok"), ("gate", "--state", "deep=later"),
                     ("verdict", "--since", "x", "--tier", "routine"),
                     ("verdict", "--since", "x", "--tier", "deep", "--marker", "y"), ("verdict", "--tier", "deep"),
                     ("nonsense",)]:
            with self.subTest(args=args):
                code, out = self.run_cli(*args)
                self.assertEqual(code, 1)
                self.assertIn("error", json.loads(out))


if __name__ == "__main__":
    unittest.main()
