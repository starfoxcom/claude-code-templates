"""Tests for .github/scripts/review_gate.py, the review gate's shared logic."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, ".github", "scripts"))
import review_gate as gate  # noqa: E402

SCRIPT = os.path.join(ROOT, ".github", "scripts", "review_gate.py")
MARK = r"Code Review[^a-zA-Z]+claude-code-templates"


def comment(body, at="2026-10-21T10:00:00Z", login="claude[bot]"):
    return {"user": {"login": login}, "created_at": at, "body": body}


class Triage(unittest.TestCase):
    def test_reviewable_and_not(self):
        self.assertTrue(gate.triage(["engine/bind.js"]))
        self.assertTrue(gate.triage(["_core/project-template/CLAUDE.md"]))
        self.assertTrue(gate.triage(["bundles/2-multi-dev-oss/bundle.toggles.md"]))
        self.assertFalse(gate.triage(["README.md", "docs/v2/PLAN.md"]))
        self.assertFalse(gate.triage([]))

    def test_workflows_never_count_whatever_their_extension(self):
        self.assertFalse(gate.triage([".github/workflows/claude-code-review.yml", "CHANGELOG.md"]))
        self.assertTrue(gate.triage([".github/workflows/x.yml", ".github/scripts/review_gate.py"]))

    def test_an_incomplete_listing_is_reviewed(self):
        self.assertTrue(gate.triage(["README.md"], incomplete=True))
        self.assertTrue(gate.triage(["docs/%d.md" % i for i in range(gate.LISTING_CAP)]))
        self.assertFalse(gate.triage(["docs/%d.md" % i for i in range(gate.LISTING_CAP - 1)]))


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
        bare = self.pages([comment("## Code Review — claude-code-templates\nLGTM")])
        self.assertEqual(gate.verdict(bare, "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")
        self.assertEqual(gate.verdict("", "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")

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
                         ("in_progress", "triage=reviewable;routine=pending;escalated=no;deep=none"))
        # A deep review started by hand before the routine one finished...
        deep_started = gate.gate(start["state"], escalated=True, deep="none")
        deep_done = gate.gate(deep_started["state"], deep="block")
        self.assertEqual(deep_done["conclusion"], "failure")
        # ...still blocks once the routine review passes afterwards.
        routine_done = gate.gate(deep_done["state"], triage="reviewable", routine="pass")
        self.assertEqual((routine_done["conclusion"], routine_done["state"]),
                         ("failure", "triage=reviewable;routine=pass;escalated=yes;deep=block"))

    def test_escalation_only_turns_on(self):
        asked = gate.gate("", routine="pass", escalated=True)
        self.assertEqual(asked["status"], "in_progress")
        self.assertEqual(gate.gate(asked["state"], routine="pass")["status"], "in_progress")

    def test_a_bad_state_or_fact_is_an_error(self):
        for state, facts in [("routine=maybe", {}), ("colour=red", {}), ("routine", {}), ("", {"deep": "pending"}),
                             ("", {"routine": "none"})]:
            with self.subTest(state=state, facts=facts):
                with self.assertRaises(gate.GateError):
                    gate.gate(state, **facts)


class Settings(unittest.TestCase):
    def test_defaults_and_overrides(self):
        self.assertEqual(gate.settings(""), gate.DEFAULTS)
        text = "checks: two  # both checks\nroutine:\n  model: claude-opus-5-5\n  max_turns: 80\nfallback:\n  effort: \"medium\"\n"
        got = gate.settings(text)
        self.assertEqual((got["checks"], got["routine.model"], got["routine.max_turns"], got["fallback.effort"]),
                         ("two", "claude-opus-5-5", "80", "medium"))
        self.assertEqual(got["deep.model"], gate.DEFAULTS["deep.model"])

    def test_the_shipped_file_holds_the_defaults_but_checks(self):
        with open(os.path.join(ROOT, ".github", "review-gate.yml"), encoding="utf-8") as fh:
            got = gate.settings(fh.read())
        self.assertEqual(got.pop("checks"), "two")
        self.assertEqual(got, {k: v for k, v in gate.DEFAULTS.items() if k != "checks"})

    def test_bad_settings_are_errors(self):
        for text in ["checks: three", "routine:\n  model: Bad Model", "routine:\n  effort: huge", "routine:\n  max_turns: 0",
                     "deep:\n  colour: red", "  model: x", "model claude"]:
            with self.subTest(text=text):
                with self.assertRaises(gate.GateError):
                    gate.settings(text)


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
        self.assertEqual((code, json.loads(out)["state"]), (0, "triage=reviewable;routine=pass;escalated=yes;deep=none"))
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
