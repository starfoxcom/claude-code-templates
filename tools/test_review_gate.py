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

    def test_deep_review_folders_count_whatever_the_file_type(self):
        for path in (".github/scripts/json.pyc", ".github/scripts/run.sh", "redesign/notes.md",
                     "_core/project-template/README.md", ".github/review-gate.yml"):
            with self.subTest(path=path):
                self.assertTrue(gate.triage([path]))
        self.assertFalse(gate.triage([".github/notes.md", "docs/redesign/x.md"]))

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
        none = self.pages([comment("## Code Review — claude-code-templates\nLooks fine overall.")])
        self.assertEqual(gate.verdict(none, "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")
        self.assertEqual(gate.verdict("", "2026-10-21T09:00:00Z", "routine", MARK)["verdict"], "missing")

    def test_the_last_glyph_line_decides_and_a_glyphless_blocking_blocks(self):
        head = "## Code Review — claude-code-templates\n"
        cases = [
            # (routine comment body, verdict, line, recovered)
            (head + "**Blocking** — hook is not POSIX-portable", "block",
             "**Blocking** — hook is not POSIX-portable", True),
            (head + "The 🔴 from the last pass is fixed.\n🟢 LGTM", "pass", "🟢 LGTM", False),
            (head + "The format is \"🟢 LGTM\".\n🔴 Must fix: hook is not portable", "block",
             "🔴 Must fix: hook is not portable", False),
            (head + "Post a binary 🔴/🟢 verdict", "block", "Post a binary 🔴/🟢 verdict", False),
            ("**Code Review - claude-code-templates**\n🟢 LGTM", "pass", "🟢 LGTM", False),
            # A bare LGTM never passes: prose opens the same way.
            (head + "LGTM", "missing", "", False),
            (head + "LGTM otherwise, but the END marker must be fixed", "missing", "", False),
            (head + "no blocking issues found", "missing", "", False),
            # Without its heading a comment is never the routine verdict.
            ("Review done.\n🟢 LGTM", "missing", "", False),
            ("Review done.\n🔴 Blocking — race in the writer", "missing", "", False),
        ]
        for body, result, line, recovered in cases:
            with self.subTest(body=body):
                got = gate.verdict(self.pages([comment(body)]), "2026-10-21T09:00:00Z", "routine", MARK)
                want = {"verdict": result, "line": line}
                if recovered:
                    want["recovered"] = "no 🔴/🟢 line; a line opening with Blocking"
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
        with open(os.path.join(ROOT, ".github", "review-gate.yml"), encoding="utf-8") as fh:
            got = gate.settings(fh.read())
        self.assertEqual(got, gate.DEFAULTS)

    def test_bad_settings_are_errors(self):
        for text in ["checks: three", "routine:\n  model: Bad Model", "routine:\n  effort: huge", "routine:\n  max_turns: 0",
                     "deep:\n  colour: red", "  model: x", "model claude", "checks:", "checks:  # one",
                     "colour:", "colour:\n  model: x"]:
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


# A stand-in for the gh CLI that keeps a pretend repository in a JSON file,
# logs every call, and runs --jq filters through the real jq.
FAKE_GH = r'''
import json, os, subprocess, sys

STATE, LOG = os.environ["FAKE_GH_STATE"], os.environ["FAKE_GH_LOG"]
VALUED = {"-X", "--jq", "--input", "-F", "-f", "-H", "-R", "--json", "--color",
          "--description", "--body"}


def parse(argv):
    pos, opts = [], {}
    it = iter(argv)
    for arg in it:
        if arg in VALUED:
            opts.setdefault(arg, []).append(next(it))
        elif arg.startswith("-"):
            opts[arg] = [True]
        else:
            pos.append(arg)
    return pos, opts


def out(data, opts):
    if "--silent" in opts:
        return 0
    if isinstance(data, str) and "--jq" not in opts:
        sys.stdout.write(data)
        return 0
    if "--jq" in opts:
        run = subprocess.run(["jq", "-r", "-c", opts["--jq"][0]], input=json.dumps(data),
                             capture_output=True, text=True)
        sys.stdout.write(run.stdout)
        sys.stderr.write(run.stderr)
        return run.returncode
    sys.stdout.write(json.dumps(data))
    return 0


def not_found():
    sys.stderr.write("gh: Not Found (HTTP 404)\n")
    return 1


def api(path, opts, st):
    method = opts.get("-X", ["GET"])[0]
    path = path.split("?")[0]
    repo = "repos/" + st["name"]
    sets = st["rulesets"]
    if method == "PATCH" and path == repo:
        for field in opts.get("-F", []):
            key, value = field.split("=", 1)
            st["repo"][key] = {"true": True, "false": False}.get(value, value)
        return None
    if method == "POST" and path == repo + "/rulesets":
        body = json.load(sys.stdin)
        body["id"] = 100 + len(sets)
        body["source_type"] = "Repository"
        sets.append(body)
        return None
    if method == "PUT" and path.startswith(repo + "/rulesets/"):
        rid = int(path.rsplit("/", 1)[1])
        body = json.load(sys.stdin)
        body.update(id=rid, source_type="Repository")
        sets[:] = [body if r["id"] == rid else r for r in sets]
        return None
    if path == repo:
        return dict(st["repo"], full_name=st["name"])
    if path == repo + "/rulesets":
        return [{k: r[k] for k in ("id", "name", "target", "source_type")} for r in sets]
    if path.startswith(repo + "/rulesets/"):
        return next((r for r in sets if str(r["id"]) == path.rsplit("/", 1)[1]), KeyError)
    if path.startswith(repo + "/labels/"):
        name = path.rsplit("/", 1)[1]
        return {"name": name} if name in st["labels"] else KeyError
    if path.startswith(repo + "/branches/"):
        name = path.split("/branches/", 1)[1]
        return {"name": name} if name in st["branches"] else KeyError
    if path == repo + "/issues/comments":
        return st.get("comments", [])
    if path == repo + "/contents/.github/review-gate.yml":
        return st["gate_yml"] if "gate_yml" in st else KeyError
    if path.startswith("orgs/"):
        return {"installations": st.get("installations", [])}
    return KeyError


def main():
    sys.stdout.reconfigure(newline="\n")  # Windows would end lines with CRLF
    pos, opts = parse(sys.argv[1:])
    with open(STATE) as f:
        st = json.load(f)
    with open(LOG, "a") as f:
        f.write(json.dumps(sys.argv[1:]) + "\n")
    cmd = pos[:2]
    data = None
    if pos[0] == "api":
        data = api(pos[1], opts, st)
    elif cmd == ["repo", "view"]:
        data = {"nameWithOwner": st["name"]}
    elif cmd == ["label", "create"]:
        st["labels"].append(pos[2])
    elif cmd == ["secret", "list"]:
        data = [{"name": n} for n in st["secrets"]]
    elif cmd == ["secret", "set"]:
        st["secrets"].append(pos[2])
    if data is KeyError:
        return not_found()
    with open(STATE, "w") as f:
        json.dump(st, f)
    return out(data, opts) if data is not None else 0


sys.exit(main())
'''

SETUP = os.path.join(ROOT, ".github", "scripts", "setup-review-gate.sh")
WRITES = (["label", "create"], ["secret", "set"])


def fresh_repo(**changes):
    state = {
        "name": "acme/game",
        "repo": {"permissions": {"admin": True}, "default_branch": "main",
                 "owner": {"type": "User"}, "allow_merge_commit": True,
                 "allow_squash_merge": True, "allow_rebase_merge": True,
                 "delete_branch_on_merge": False},
        "branches": ["main", "develop"], "labels": [], "secrets": [], "rulesets": [],
    }
    state.update(changes)
    return state


def old_ruleset(rid=7, include="refs/heads/main"):
    """A ruleset from the two-check setup, with an admin bypass."""
    return {
        "id": rid, "name": "protect", "target": "branch", "enforcement": "active",
        "source_type": "Repository",
        "conditions": {"ref_name": {"include": [include], "exclude": []}},
        "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole",
                           "bypass_mode": "always"}],
        "rules": [{"type": "non_fast_forward"}, {"type": "required_status_checks", "parameters": {
            "strict_required_status_checks_policy": False, "required_status_checks": [
                {"context": "Evaluate review outcome", "integration_id": 15368},
                {"context": "Claude On-Demand", "integration_id": 15368},
                {"context": "Lint"}]}}],
    }


def tool(name):
    from shutil import which
    return which(name)


@unittest.skipUnless(tool("bash") and tool("jq"), "needs bash and jq")
class SetupScript(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.state = os.path.join(self.dir, "state.json")
        self.log = os.path.join(self.dir, "log.jsonl")
        stub = os.path.join(self.dir, "fake_gh.py")
        with open(stub, "w") as f:
            f.write(FAKE_GH)
        gh = os.path.join(self.dir, "gh")
        with open(gh, "w", newline="\n") as f:
            f.write('#!/usr/bin/env bash\nexec "%s" "%s" "$@"\n'
                    % (sys.executable.replace("\\", "/"), stub.replace("\\", "/")))
        os.chmod(gh, 0o755)

    def run_setup(self, state, *args):
        with open(self.state, "w") as f:
            json.dump(state, f)
        open(self.log, "w").close()
        env = dict(os.environ, FAKE_GH_STATE=self.state, FAKE_GH_LOG=self.log,
                   PATH=self.dir + os.pathsep + os.environ["PATH"])
        # The full path: on Windows a bare "bash" can start WSL's instead.
        run = subprocess.run([tool("bash"), SETUP, "--repo", "acme/game", *args], env=env,
                             stdin=subprocess.DEVNULL, capture_output=True, text=True)
        with open(self.state) as f:
            after = json.load(f)
        with open(self.log) as f:
            calls = [json.loads(line) for line in f]
        return run, after, calls

    def writes(self, calls):
        return [c for c in calls if "-X" in c or c[:2] in WRITES]

    def checks(self, ruleset):
        rule = next(r for r in ruleset["rules"] if r["type"] == "required_status_checks")
        return [c["context"] for c in rule["parameters"]["required_status_checks"]]

    def test_check_mode_reports_every_gap_and_changes_nothing(self):
        run, after, calls = self.run_setup(fresh_repo(), "--check")
        self.assertEqual(run.returncode, 1, run.stdout + run.stderr)
        for gap in ("label needs-deep-review", "merge settings", "secret CLAUDE_CODE_OAUTH_TOKEN",
                    "ruleset on main: no active ruleset", "ruleset on develop: no active ruleset"):
            self.assertIn("MISSING  " + gap, run.stdout)
        self.assertIn("5 missing.", run.stdout)
        self.assertEqual(self.writes(calls), [])
        self.assertEqual(after, fresh_repo())

    def test_setup_brings_a_fresh_repo_to_a_clean_check(self):
        state = fresh_repo(secrets=["CLAUDE_CODE_OAUTH_TOKEN"])
        run, after, _ = self.run_setup(state, "--require", "Mod tests")
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(after["labels"], ["needs-deep-review"])
        repo = after["repo"]
        self.assertEqual([repo["allow_merge_commit"], repo["allow_squash_merge"],
                          repo["allow_rebase_merge"], repo["delete_branch_on_merge"]],
                         [True, False, False, True])
        self.assertEqual(sorted(r["name"] for r in after["rulesets"]),
                         ["develop-protection", "main-protection"])
        for ruleset in after["rulesets"]:
            self.assertEqual(ruleset["bypass_actors"], [])
            self.assertEqual(self.checks(ruleset), ["Review gate", "Mod tests"])
            rule = ruleset["rules"][-1]["parameters"]["required_status_checks"][0]
            self.assertEqual(rule["integration_id"], 15368)
        run, _, calls = self.run_setup(after, "--check", "--require", "Mod tests")
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn("All set.", run.stdout)
        self.assertEqual(self.writes(calls), [])

    def test_setup_repairs_an_old_ruleset_and_keeps_its_own_checks(self):
        extra = dict(old_ruleset(rid=8, include="~DEFAULT_BRANCH"), name="extra",
                     rules=[{"type": "required_linear_history"}])
        state = fresh_repo(rulesets=[extra, old_ruleset()], branches=["main"])
        run, after, _ = self.run_setup(state, "--check")
        self.assertIn('MISSING  ruleset on main: drop required check "Claude On-Demand"',
                      run.stdout)
        self.assertIn("MISSING  ruleset on main: no bypass actors (has 2)", run.stdout)
        run, after, _ = self.run_setup(state)
        self.assertIn("set up   ruleset on main", run.stdout)
        extra_after, main = after["rulesets"]
        self.assertEqual(self.checks(main), ["Evaluate review outcome", "Lint", "Review gate"])
        self.assertIn("deletion", [r["type"] for r in main["rules"]])
        self.assertEqual(extra_after["rules"], [{"type": "required_linear_history"}])
        self.assertEqual(extra_after["bypass_actors"] + main["bypass_actors"], [])

    def test_checks_two_keeps_the_old_deep_check(self):
        ruleset = old_ruleset()
        ruleset["rules"][1]["parameters"]["required_status_checks"].append(
            {"context": "Review gate", "integration_id": 15368})
        ruleset["rules"] += [{"type": "deletion"}, {"type": "pull_request"}]
        ruleset["bypass_actors"] = []
        state = fresh_repo(rulesets=[ruleset], branches=["main"], gate_yml="checks: two\n")
        run, _, _ = self.run_setup(state, "--check")
        self.assertIn("ok       ruleset on main", run.stdout)
        run, _, _ = self.run_setup(dict(state, gate_yml="checks: one  # one check\n"), "--check")
        self.assertIn('drop required check "Claude On-Demand"', run.stdout)

    def test_a_missing_token_without_a_terminal_is_reported_not_prompted(self):
        run, after, calls = self.run_setup(fresh_repo())
        self.assertEqual(run.returncode, 1)
        self.assertIn("MISSING  secret CLAUDE_CODE_OAUTH_TOKEN", run.stdout)
        self.assertEqual(after["secrets"], [])
        self.assertFalse([c for c in calls if c[:2] == ["secret", "set"]])

    def test_names_that_could_break_out_of_a_string_are_refused(self):
        for args in (["--branch", 'ma"in'], ["--require", "a\\b"], ["--approvals", "11"],
                     ["--merge-style", "fast"]):
            run, _, calls = self.run_setup(fresh_repo(), *args)
            self.assertEqual(run.returncode, 2, args)
            self.assertEqual(calls, [], args)

    def test_the_app_counts_as_seen_once_it_has_commented(self):
        bot = comment("review", login="claude[bot]")
        run, _, _ = self.run_setup(fresh_repo(comments=[bot]), "--check")
        self.assertIn("ok       Claude GitHub App", run.stdout)
        run, _, _ = self.run_setup(fresh_repo(), "--check")
        self.assertIn("note     Claude GitHub App not confirmed", run.stdout)


if __name__ == "__main__":
    unittest.main()
