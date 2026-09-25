"""Tests for receipts.py. Run: python -m unittest tools/test_receipts.py"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import receipts  # noqa: E402


def bot(body):
    return {"author": {"login": "claude"}, "body": body}


class VerdictTests(unittest.TestCase):
    def test_verdict_shapes(self):
        cases = [
            ("🟢 **LGTM!** — No blocking issues found.", "green"),
            ("🔴 **Blocking** — must fix before merge", "red"),
            ("## Code Review — x\n\n- 🔴 finding\n\n🟢 LGTM", "green"),
            ("## Code Review — x\n\n- note\n\n🔴 Blocking — must fix", "red"),
            ("🔴 **Blocking** - one seam-side gap\n\n- **🔴 A solid shore cell draws a water top", "red"),
            ("🟢 **LGTM** - all invariants hold\n\n- **🔴 an old finding, now fixed", "green"),
            ("**🟢 LGTM**", "green"),
            ("## 🟢 LGTM", "green"),
            ("**LGTM!** — No blocking issues found. ✅ Approved.", "green"),
            ("- Verdict first and once: the comment opens with a line that starts with the glyph 🔴 or 🟢 "
             "followed by Blocking or LGTM", None),
            ("@claude review this PR", None),
            ("1. 🔴 Blocking finding in a numbered list", None),
            # Verdict first: a later line that looks like a verdict does not flip it.
            ("🔴 **Blocking** - one seam-side gap.\n\n### Invariant 2 - carry clamp\n"
             "🟢 LGTM on this invariant: the clamp holds.", "red"),
            ("🟢 **LGTM** - all invariants hold.\n\n🔴 Blocking from round 1 is fixed.", "green"),
            ("**Claude finished @alex's task in 3m** —— [View job](x)\n\n---\n🔴 **Blocking** - a gap\n\n"
             "🟢 LGTM on the rest", "red"),
            # Verdict last: prose first, so the last verdict line wins.
            ("## Code Review — x\n\nReviewed the diff.\n\n### 🔴 Blocking findings\n- a real bug\n\n"
             "🔴 Blocking — must fix", "red"),
            ("## Code Review — x\n\nReviewed the diff.\n\n🟢 LGTM", "green"),
            ("Blocking issues: none found.", None),
        ]
        for body, want in cases:
            with self.subTest(body=body[:40]):
                self.assertEqual(receipts.verdict(body), want)

    def test_only_bot_comments_count(self):
        comments = [{"author": {"login": "alex"}, "body": "🔴 Blocking"}, bot("🟢 LGTM"), bot("🔴 Blocking")]
        self.assertEqual(receipts.verdicts(comments), ["green", "red"])

    def test_escalation_comments_are_not_verdicts(self):
        comments = [bot("🟢 LGTM"),
                    bot("@claude review this PR - depth pass on the water dial.\n\n"
                        "🟢 LGTM only when the diff is fully clean.\n🔴 Blocking when ANY real finding exists."),
                    bot("@claude review this PR\n\nLGTM only when clean.\n**Blocking** when any finding exists.")]
        self.assertEqual(receipts.verdicts(comments), ["green"])


def pr(number, hours, base="develop", head="feature/x", title="feat: x", comments=(), labels=()):
    return {"number": number, "title": title, "createdAt": "2026-09-01T00:00:00Z",
            "mergedAt": f"2026-09-01T{hours:02d}:00:00Z", "baseRefName": base, "headRefName": head,
            "labels": [{"name": l} for l in labels], "comments": list(comments)}


class PrStatsTests(unittest.TestCase):
    def stats(self, prs):
        # One window returns every PR; later windows return nothing.
        calls = iter([prs])
        with mock.patch.object(receipts, "gh_json", lambda args, cwd: next(calls, [])):
            return receipts.pr_stats(".", "2026-09-01")

    def test_median_even_count(self):
        s = self.stats([pr(1, 1), pr(2, 2), pr(3, 3), pr(4, 4)])
        self.assertEqual(s["median_hours_to_merge"], 2.5)

    def test_cascades_by_branch_not_title(self):
        s = self.stats([pr(1, 1, title="feat(sky): fix the cascade reach"),
                        pr(2, 1, head="chore/cascade-release-1.2"),
                        pr(3, 1, base="main", head="hotfix/x")])
        self.assertEqual((s["cascades"], s["to_main"]), (1, 1))

    def test_review_counts(self):
        s = self.stats([pr(1, 1, comments=[bot("🔴 Blocking"), bot("🟢 LGTM")], labels=["needs-deep-review"]),
                        pr(2, 3, comments=[bot("🟢 LGTM")]),
                        pr(3, 5)])
        self.assertEqual((s["prs_with_verdict"], s["first_verdict_green_pct"], s["prs_with_a_red_verdict"],
                          s["red_verdicts"], s["prs_escalated_to_deep"], s["median_hours_to_merge_reviewed"]),
                         (2, 50, 1, 1, 1, 2.0))

    def test_windows_cover_every_day_and_leave_the_last_open(self):
        queries = []

        def gh(args, cwd):
            queries.append(args[args.index("--search") + 1])
            return []

        since = datetime.now(timezone.utc).date() - timedelta(days=45)
        with mock.patch.object(receipts, "gh_json", gh):
            receipts.pr_stats(".", since.isoformat())
        self.assertEqual(queries, [f"merged:{since}..{since + timedelta(days=29)}",
                                   f"merged:>={since + timedelta(days=30)}"])

    def test_search_limit_fails_loudly(self):
        full = [pr(n, 1) for n in range(receipts.SEARCH_LIMIT)]
        with self.assertRaises(SystemExit):
            self.stats(full)


def line(uuid, stamp, kind="assistant", **message):
    return json.dumps({"uuid": uuid, "type": kind, "timestamp": stamp, "message": message})


def assistant(uuid, stamp, mid, tokens, *tools):
    content = [{"type": "tool_use", "id": f"t{uuid}{i}", "name": n, "input": a} for i, (n, a) in enumerate(tools)]
    return line(uuid, stamp, id=mid, usage={"output_tokens": tokens}, content=content)


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.logs = self.dir.name

    def tearDown(self):
        self.dir.cleanup()

    def write(self, rel, *lines, mtime=None):
        path = os.path.join(self.logs, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        if mtime:
            os.utime(path, (mtime, mtime))

    def test_subagents_fold_into_their_session(self):
        self.write("s1.jsonl", assistant("a", "2026-09-01T00:00:00Z", "m1", 100, ("Grep", {"pattern": "x"})))
        self.write("s1/subagents/agent-1.jsonl",
                   assistant("b", "2026-09-01T00:01:00Z", "m2", 50, ("mcp__tokensave__tokensave_search", {})))
        [s] = receipts.project_sessions(self.logs)
        self.assertEqual((s["output_tokens"], s["tool_calls"], s["research_calls"], s["search_fallbacks"]),
                         (150, 2, 1, 1))

    def test_forked_history_counts_once(self):
        shared = [assistant("a", "2026-09-01T00:00:00Z", "m1", 100, ("Bash", {"command": "ls"})),
                  assistant("b", "2026-09-01T00:01:00Z", "m2", 100)]
        self.write("old.jsonl", *shared, mtime=1_000_000)
        self.write("new.jsonl", *shared, assistant("c", "2026-09-02T00:00:00Z", "m3", 7), mtime=2_000_000)
        sessions = {s["session"]: s for s in receipts.project_sessions(self.logs)}
        self.assertEqual((sessions["old"]["output_tokens"], sessions["new"]["output_tokens"]), (200, 7))
        self.assertEqual(sum(s["tool_calls"] for s in sessions.values()), 1)

    def test_original_keeps_its_history_when_reopened_later(self):
        shared = [assistant("a", "2026-09-01T00:00:00Z", "m1", 100), assistant("b", "2026-09-01T00:01:00Z", "m2", 100)]
        self.write("original.jsonl", *shared, mtime=2_000_000)
        self.write("continued.jsonl", *shared, assistant("c", "2026-09-02T00:00:00Z", "m3", 7), mtime=1_000_000)
        sessions = {s["session"]: s["output_tokens"] for s in receipts.project_sessions(self.logs)}
        self.assertEqual(sessions, {"original": 200, "continued": 7})

    def test_copies_under_new_line_ids_count_once(self):
        self.write("a.jsonl", assistant("u1", "2026-09-01T00:00:00Z", "m1", 868, ("Bash", {"command": "ls"})))
        copy = json.loads(assistant("u9", "2026-09-03T00:00:00Z", "m1", 868, ("Bash", {"command": "ls"})))
        copy["message"]["content"][0]["id"] = "tu10"  # same tool call id as the original
        self.write("b.jsonl", json.dumps(copy), assistant("u10", "2026-09-03T00:01:00Z", "m9", 5))
        sessions = receipts.project_sessions(self.logs)
        self.assertEqual(sum(s["output_tokens"] for s in sessions), 873)
        self.assertEqual(sum(s["tool_calls"] for s in sessions), 1)

    def test_fork_subagent_copy_of_the_agent_call_counts_once(self):
        spawn = assistant("a", "2026-09-01T00:00:00Z", "m1", 10, ("Agent", {"subagent_type": "fork"}))
        copied = json.loads(spawn)
        copied["uuid"] = "z"
        self.write("s.jsonl", spawn)
        self.write("s/subagents/agent-1.jsonl", json.dumps(copied),
                   assistant("b", "2026-09-01T00:00:30Z", "m2", 5, ("Read", {"file_path": "x"})))
        [s] = receipts.project_sessions(self.logs)
        self.assertEqual((s["tool_calls"], s["output_tokens"]), (2, 15))

    def test_streamed_reply_counts_once(self):
        self.write("s.jsonl", assistant("a", "2026-09-01T00:00:00Z", "m1", 40),
                   assistant("b", "2026-09-01T00:00:01Z", "m1", 40))
        [s] = receipts.project_sessions(self.logs)
        self.assertEqual(s["output_tokens"], 40)

    def test_empty_session_is_left_out(self):
        self.write("s.jsonl", line("a", "2026-09-01T00:00:00Z", kind="system"),
                   line("b", "2026-09-01T12:00:00Z", kind="system"))
        self.assertEqual(receipts.project_sessions(self.logs), [])

    def test_activity_minutes_cap_idle_gaps(self):
        self.write("s.jsonl", assistant("a", "2026-09-01T00:00:00Z", "m1", 1),
                   assistant("b", "2026-09-01T00:02:00Z", "m2", 1),
                   assistant("c", "2026-09-01T10:00:00Z", "m3", 1))
        [s] = receipts.project_sessions(self.logs)
        self.assertEqual(s["activity_minutes"], 2 + receipts.IDLE_CAP_MINUTES)

    def test_notebook_edits_count(self):
        self.write("s.jsonl", assistant("a", "2026-09-01T00:00:00Z", "m1", 1,
                                        ("NotebookEdit", {"notebook_path": "a.ipynb"})))
        [s] = receipts.project_sessions(self.logs)
        self.assertEqual(s["files_edited"], 1)

    def test_tool_errors_count_once(self):
        result = line("r", "2026-09-01T00:00:05Z", kind="user",
                      content=[{"type": "tool_result", "tool_use_id": "t", "is_error": True}])
        first = assistant("a", "2026-09-01T00:00:00Z", "m1", 1)
        self.write("old.jsonl", first, result, mtime=1_000_000)
        self.write("new.jsonl", first, result, assistant("c", "2026-09-01T00:01:00Z", "m2", 1), mtime=2_000_000)
        self.assertEqual(sum(s["tool_errors"] for s in receipts.project_sessions(self.logs)), 1)


class MissingLogsTests(unittest.TestCase):
    def test_no_projects_folder(self):
        home = os.path.join(tempfile.gettempdir(), "no-such-home")
        with mock.patch("os.path.expanduser", lambda p: home):
            self.assertIsNone(receipts.log_dir("."))
        self.assertEqual(receipts.project_sessions(None), [])


class AdherenceTests(unittest.TestCase):
    def test_no_searches_prints_na(self):
        session = {"start": "2026-09-01", "output_tokens": 1, "research_calls": 0, "search_fallbacks": 0,
                   "tool_errors": 0, "task_tool_calls": 0, "activity_minutes": 1, "files_edited": 0}
        with mock.patch("builtins.print") as out:
            receipts.summarize("x", [session], None, {"rules": 0, "skills": 0, "memory_entries": 0})
        self.assertIn("adherence n/a", " ".join(str(c) for c in out.call_args_list))


if __name__ == "__main__":
    unittest.main()
