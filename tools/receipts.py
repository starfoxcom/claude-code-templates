"""Collect the evidence numbers behind Bindwright from real projects.

Two sources:
- Claude Code session logs under ~/.claude/projects/ (recent only: Claude Code
  deletes logs older than its cleanup period, 30 days by default).
- GitHub PR history through `gh` (durable).

Usage:
    python tools/receipts.py --project ../Emberholm --project ../Stockra
    python tools/receipts.py --project ../Stockra --since 2026-05-13 --json out.json

Prints a summary per project; --json also writes the raw numbers.
Standard library only. Needs `gh` logged in for the GitHub part.

How the session numbers are counted:
- A session is one main transcript plus the transcripts of the subagents it ran.
- A resumed or forked session, or a forked subagent, copies earlier history into
  a new file, sometimes under new log-line ids. Anything already counted anywhere
  in the project (log line, model reply, tool call, tool result) is never counted
  again. Main transcripts are read in the order their sessions ran (first log
  line, then last), so shared history stays with the session that made it.
- A session with no model output (only mode or bridge entries) is left out.
- Activity minutes add up the gaps between log lines, each gap capped at
  IDLE_CAP_MINUTES. An idle terminal adds little, but a wait that keeps waking
  the model (a CI monitor, a background task) still counts.
"""
import argparse
import glob
import json
import os
import re
import statistics
import subprocess
import sys
import types
from datetime import date, datetime, timedelta, timezone

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
IDLE_CAP_MINUTES = 5
SEARCH_LIMIT = 1000  # GitHub search returns at most this many results per query
ADHERENCE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                                "_core", "project-template", ".claude", "scripts", "research-adherence.py")


def load_classifier():
    """classify() from the shipped adherence script, filled in to accept every supported research tool."""
    with open(ADHERENCE_SCRIPT, encoding="utf-8") as f:
        text = f.read()
    fills = {
        "TOOLS_CODE_RESEARCH_MATCH": r"tokensave|codegraph|serena|codebase.memory|^LSP$",
        "TOOLS_CODE_RESEARCH_BYPASS_MARKER": "BYPASS",
        "TOOLS_CODE_RESEARCH_NAME": "code-research tools",
    }
    for name, value in fills.items():
        text = text.replace("{{" + name + "}}", value)
    module = types.ModuleType("research_adherence")
    exec(compile(text, ADHERENCE_SCRIPT, "exec"), module.__dict__)
    return module.classify


classify = load_classifier()


def log_dir(project_path):
    """The ~/.claude/projects folder for a repo path (matched case-insensitively)."""
    slug = re.sub(r"[^A-Za-z0-9]", "-", os.path.abspath(project_path)).lower()
    root = os.path.join(os.path.expanduser("~"), ".claude", "projects")
    if not os.path.isdir(root):
        return None
    for name in os.listdir(root):
        if name.lower() == slug:
            return os.path.join(root, name)
    return None


def parse_time(stamp):
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")) if stamp else None


def span(path):
    """(first, last) log-line time in a transcript; file times change when a session is merely reopened."""
    first = last = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            match = re.search(r'"timestamp":\s*"([^"]+)"', line)
            if match:
                first = first or match.group(1)
                last = match.group(1)
    return (first or "~", last or "~")


def transcripts(logs):
    """(session id, path) for every main and subagent transcript, main files in the order their sessions ran."""
    for path in sorted(glob.glob(os.path.join(logs, "*.jsonl")), key=span):
        yield os.path.splitext(os.path.basename(path))[0], path
    for path in sorted(glob.glob(os.path.join(logs, "*", "subagents", "**", "*.jsonl"), recursive=True)):
        yield os.path.relpath(path, logs).split(os.sep)[0], path


def new_session(session_id):
    return {"id": session_id, "usage": {}, "tools": {}, "errors": 0, "research": 0, "fallback": 0,
            "edited": set(), "times": []}


def first_time(seen, key):
    """True the first time the project sees this id; a missing id always counts."""
    if key[1] is None:
        return True
    if key in seen:
        return False
    seen.add(key)
    return True


def read_transcript(path, session, seen, replies):
    """Add one transcript's log lines to its session, skipping anything the project already counted.

    `seen` holds every log line, tool call and tool result id counted so far.
    `replies` maps each model reply id to the session that owns it: a streamed
    reply spans several lines of one session, and a copy in another session is
    skipped whole.
    """
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict) or not first_time(seen, ("line", entry.get("uuid"))):
                continue
            message = entry.get("message")
            reply_id = message.get("id") if isinstance(message, dict) and entry.get("type") == "assistant" else None
            if reply_id and replies.setdefault(reply_id, session["id"]) != session["id"]:
                continue
            stamp = parse_time(entry.get("timestamp"))
            if stamp:
                session["times"].append(stamp)
            if not isinstance(message, dict) or not isinstance(message.get("content"), list):
                continue
            if entry.get("type") == "assistant":
                # Streamed replies repeat a message id with the same final usage; keep one.
                if reply_id and message.get("usage"):
                    session["usage"][reply_id] = message["usage"]
                for part in message["content"]:
                    if not isinstance(part, dict) or part.get("type") != "tool_use":
                        continue
                    if not first_time(seen, ("tool", part.get("id"))):
                        continue
                    name, args = part.get("name", ""), part.get("input") or {}
                    session["tools"][name] = session["tools"].get(name, 0) + 1
                    target = args.get("file_path") or args.get("notebook_path")
                    if name in EDIT_TOOLS and target:
                        session["edited"].add(target)
                    kind = classify(name, args)
                    session["research"] += kind == "research"
                    session["fallback"] += kind == "fallback"
            elif entry.get("type") == "user":
                for part in message["content"]:
                    if (isinstance(part, dict) and part.get("type") == "tool_result" and part.get("is_error")
                            and first_time(seen, ("result", part.get("tool_use_id")))):
                        session["errors"] += 1


def activity_minutes(times):
    times = sorted(times)
    cap = IDLE_CAP_MINUTES * 60
    return round(sum(min((b - a).total_seconds(), cap) for a, b in zip(times, times[1:])) / 60)


def finish(session):
    """The published numbers for one session, or None when the model never replied in it."""
    usage = session["usage"].values()
    output = sum(u.get("output_tokens", 0) for u in usage)
    if not output or not session["times"]:
        return None
    tools = session["tools"]
    return {
        "session": session["id"],
        "start": min(session["times"]).isoformat(),
        "activity_minutes": activity_minutes(session["times"]),
        "output_tokens": output,
        "tool_calls": sum(tools.values()),
        "tool_errors": session["errors"],
        "research_calls": session["research"],
        "search_fallbacks": session["fallback"],
        "task_tool_calls": sum(tools.get(t, 0) for t in ("TaskCreate", "TaskUpdate", "TodoWrite")),
        "files_edited": len(session["edited"]),
    }


def project_sessions(logs):
    if not logs:
        return []
    seen, replies, sessions = set(), {}, {}
    for session_id, path in transcripts(logs):
        read_transcript(path, sessions.setdefault(session_id, new_session(session_id)), seen, replies)
    return sorted(filter(None, map(finish, sessions.values())), key=lambda s: s["start"])


def gh_json(args, cwd):
    out = subprocess.run(["gh", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if out.returncode != 0:
        print(f"  gh {' '.join(args[:3])} failed: {out.stderr.strip()[:200]}", file=sys.stderr)
        return None
    return json.loads(out.stdout or "null")


GLYPH_VERDICT = re.compile(r"^[\s*_#>]*(🟢|🔴)[\s*_]*(LGTM|Blocking)", re.I)
BOLD_VERDICT = re.compile(r"^\s*\*\*\s*(LGTM|Blocking)\b", re.I)
LIST_ITEM = re.compile(r"^\s*([-+]|\*\s|\d+[.)])")
PREAMBLE = re.compile(r"^\s*($|#|\*\*Claude (finished|is working))", re.I)
ESCALATION = re.compile(r"@claude review", re.I)


def verdict_word(line):
    match = GLYPH_VERDICT.match(line) or BOLD_VERDICT.match(line)
    return match and ("green" if match.group(match.lastindex).lower() == "lgtm" else "red")


def verdict(body):
    """'green', 'red' or None for one review-bot comment.

    Emberholm and Stockra reviewers write the verdict first, this repo's last,
    and each project's gate reads its own end. So: the first real line when it
    is a verdict (after blank lines, headings and the job-status header),
    otherwise the last verdict line. List items are never verdicts, because
    finding bullets carry a glyph. A line without the glyph counts only as bold
    `**LGTM` / `**Blocking`, and only when no line has the glyph.
    """
    lines = [l for l in body.splitlines() if not LIST_ITEM.match(l)]
    head = next((l for l in lines if verdict_word(l) or not PREAMBLE.match(l)), "")
    if verdict_word(head):
        return verdict_word(head)
    for pattern in (GLYPH_VERDICT, BOLD_VERDICT):
        found = [l for l in lines if pattern.match(l)]
        if found:
            return verdict_word(found[-1])
    return None


def verdicts(comments):
    """Ordered verdicts from the review bot's comments, oldest first.

    Escalation comments (`@claude review this PR ...`) quote the verdict rules
    and are skipped, as the gates skip them.
    """
    found = []
    for c in comments:
        body = c.get("body") or ""
        if (c.get("author") or {}).get("login") in ("claude", "claude[bot]") and not ESCALATION.search(body):
            v = verdict(body)
            if v:
                found.append(v)
    return found


def merged_prs(project_path, since):
    """Every PR merged since the date, queried in 30-day windows to stay under the search limit.

    GitHub reads the dates as UTC; the last window is open-ended so merges late
    in the local day are not cut off.
    """
    prs, start, today = {}, date.fromisoformat(since), datetime.now(timezone.utc).date()
    while True:
        end = start + timedelta(days=29)
        query = f"merged:>={start}" if end >= today else f"merged:{start}..{end}"
        window = gh_json(["pr", "list", "--state", "merged", "--limit", str(SEARCH_LIMIT), "--search", query,
                          "--json", "number,title,createdAt,mergedAt,baseRefName,headRefName,labels,comments"],
                         project_path)
        if window is None:
            return None
        if len(window) >= SEARCH_LIMIT:
            sys.exit(f"  {query} hit the {SEARCH_LIMIT}-result search limit; shorten the window.")
        prs.update((pr["number"], pr) for pr in window)
        if end >= today:
            return list(prs.values())
        start = end + timedelta(days=1)


def median(values):
    return round(statistics.median(values), 1) if values else None


def pr_stats(project_path, since):
    prs = merged_prs(project_path, since)
    if prs is None:
        return None
    hours, reviewed_hours, first_green, any_red, reds, escalated = [], [], 0, 0, 0, 0
    for pr in prs:
        opened, merged = parse_time(pr["createdAt"]), parse_time(pr["mergedAt"])
        hours.append((merged - opened).total_seconds() / 3600)
        v = verdicts(pr.get("comments") or [])
        if v:
            reviewed_hours.append(hours[-1])
            first_green += v[0] == "green"
            any_red += "red" in v
            reds += v.count("red")
        if any(l.get("name") == "needs-deep-review" for l in pr.get("labels") or []):
            escalated += 1
    kinds = {}
    for pr in prs:
        head = pr["title"].split(":")[0].split("(")[0].strip().lower()
        kinds[head] = kinds.get(head, 0) + 1
    reviewed = len(reviewed_hours)
    return {
        "merged_prs": len(prs),
        "by_type": dict(sorted(kinds.items(), key=lambda kv: -kv[1])[:8]),
        "to_main": sum(1 for p in prs if p["baseRefName"] == "main"),
        "cascades": sum(1 for p in prs if re.search(r"(^|/)cascade[-/_]", p.get("headRefName") or "")),
        "median_hours_to_merge": median(hours),
        "prs_with_verdict": reviewed,
        "median_hours_to_merge_reviewed": median(reviewed_hours),
        "first_verdict_green_pct": round(100 * first_green / reviewed) if reviewed else None,
        "prs_with_a_red_verdict": any_red,
        "red_verdicts": reds,
        "prs_escalated_to_deep": escalated,
    }


def config_stats(project_path, logs):
    count = lambda pattern: len(glob.glob(os.path.join(project_path, pattern), recursive=True))
    memory = glob.glob(os.path.join(logs, "memory", "*.md")) if logs else []
    return {
        "rules": count(".claude/rules/**/*.md"),
        "skills": count(".claude/skills/*/SKILL.md"),
        "memory_entries": len([m for m in memory if not m.endswith("MEMORY.md")]),
    }


def summarize(name, sessions, prs, config):
    print(f"\n== {name}")
    if sessions:
        n = len(sessions)
        tokens = sum(s["output_tokens"] for s in sessions)
        research = sum(s["research_calls"] for s in sessions)
        searches = research + sum(s["search_fallbacks"] for s in sessions)
        adherence = f"{100 * research // searches}%" if searches else "n/a"
        biggest = max(sessions, key=lambda s: s["output_tokens"])
        print(f"  sessions {n} ({sessions[0]['start'][:10]} to {sessions[-1]['start'][:10]}), "
              f"output tokens {tokens / 1e6:.2f}M (avg {tokens // n // 1000}K), subagents included")
        print(f"  tool errors per session {sum(s['tool_errors'] for s in sessions) / n:.1f}, "
              f"code-research adherence {adherence}, "
              f"sessions using task lists {sum(1 for s in sessions if s['task_tool_calls'])}/{n}")
        print(f"  largest session {biggest['output_tokens'] / 1e6:.2f}M tokens, {biggest['activity_minutes']} min with activity,"
              f"{biggest['files_edited']} files ({biggest['start'][:10]})")
    if prs:
        print(f"  merged PRs {prs['merged_prs']} {prs['by_type']}, to main {prs['to_main']}, "
              f"cascades {prs['cascades']}, median {prs['median_hours_to_merge']} h to merge")
        print(f"  reviewed PRs {prs['prs_with_verdict']} (median {prs['median_hours_to_merge_reviewed']} h to merge): "
              f"first verdict green {prs['first_verdict_green_pct']}%, {prs['prs_with_a_red_verdict']} had a red verdict, "
              f"red verdicts {prs['red_verdicts']} across both tiers, "
              f"escalated to deep review {prs['prs_escalated_to_deep']}")
    print(f"  rules {config['rules']}, skills {config['skills']}, memory entries {config['memory_entries']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", action="append", required=True, help="path to a local repo (repeatable)")
    parser.add_argument("--since", default="2026-05-13", help="first merge date for the PR history (YYYY-MM-DD)")
    parser.add_argument("--json", help="also write all numbers to this file")
    args = parser.parse_args()
    report = {"generated": datetime.now(timezone.utc).isoformat(), "since": args.since, "projects": {}}
    for path in args.project:
        name = os.path.basename(os.path.abspath(path))
        logs = log_dir(path)
        sessions = project_sessions(logs)
        prs = pr_stats(path, args.since)
        config = config_stats(path, logs)
        summarize(name, sessions, prs, config)
        report["projects"][name] = {"sessions": sessions, "prs": prs, "config": config}
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
