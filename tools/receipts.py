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
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import types
from datetime import datetime, timezone

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
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
    for name in os.listdir(root):
        if name.lower() == slug:
            return os.path.join(root, name)
    return None


def parse_time(stamp):
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")) if stamp else None


def session_stats(path):
    """Numbers for one transcript. Streamed replies repeat a message id; count each once."""
    usage = {}
    tools = {}
    errors = 0
    research = fallback = 0
    edited = set()
    first = last = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            stamp = parse_time(entry.get("timestamp"))
            if stamp:
                first = first or stamp
                last = stamp
            message = entry.get("message")
            if not isinstance(message, dict) or not isinstance(message.get("content"), list):
                continue
            if entry.get("type") == "assistant":
                if message.get("id") and message.get("usage"):
                    usage[message["id"]] = message["usage"]
                for part in message["content"]:
                    if not isinstance(part, dict) or part.get("type") != "tool_use":
                        continue
                    name, args = part.get("name", ""), part.get("input") or {}
                    tools[name] = tools.get(name, 0) + 1
                    if name in EDIT_TOOLS and args.get("file_path"):
                        edited.add(args["file_path"])
                    kind = classify(name, args)
                    research += kind == "research"
                    fallback += kind == "fallback"
            elif entry.get("type") == "user":
                for part in message["content"]:
                    if isinstance(part, dict) and part.get("type") == "tool_result" and part.get("is_error"):
                        errors += 1
    if not first:
        return None
    return {
        "file": os.path.basename(path),
        "start": first.isoformat(),
        "minutes": round((last - first).total_seconds() / 60),
        "output_tokens": sum(u.get("output_tokens", 0) for u in usage.values()),
        "tool_calls": sum(tools.values()),
        "tool_errors": errors,
        "research_calls": research,
        "search_fallbacks": fallback,
        "task_tool_calls": sum(tools.get(t, 0) for t in ("TaskCreate", "TaskUpdate", "TodoWrite")),
        "files_edited": len(edited),
    }


def gh_json(args, cwd):
    out = subprocess.run(["gh", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if out.returncode != 0:
        print(f"  gh {' '.join(args[:3])} failed: {out.stderr.strip()[:200]}", file=sys.stderr)
        return None
    return json.loads(out.stdout or "null")


VERDICT_LINE = re.compile(r"^\s*(🟢|🔴)\W*(LGTM|Blocking)", re.I)


def verdicts(comments):
    """Ordered verdicts from the review bot's comments, oldest first.

    A verdict is the first line that opens with the glyph and LGTM or Blocking.
    Finding bullets that carry a glyph, and escalation comments that quote the
    verdict format, are not verdicts.
    """
    found = []
    for c in comments:
        if (c.get("author") or {}).get("login") not in ("claude", "claude[bot]"):
            continue
        for line in (c.get("body") or "").splitlines():
            match = VERDICT_LINE.match(line)
            if match:
                found.append("green" if match.group(1) == "🟢" else "red")
                break
    return found


def pr_stats(project_path, since):
    prs = gh_json(["pr", "list", "--state", "merged", "--limit", "2000", "--search", f"merged:>={since}",
                   "--json", "number,title,createdAt,mergedAt,baseRefName,labels,comments"], project_path)
    if prs is None:
        return None
    hours, reviewed_hours, first_green, any_red, reds, deep = [], [], 0, 0, 0, 0
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
            deep += 1
    median = lambda values: round(sorted(values)[len(values) // 2], 1) if values else None
    reviewed = len(reviewed_hours)
    kinds = {}
    for pr in prs:
        head = pr["title"].split(":")[0].split("(")[0].strip().lower()
        kinds[head] = kinds.get(head, 0) + 1
    return {
        "merged_prs": len(prs),
        "by_type": dict(sorted(kinds.items(), key=lambda kv: -kv[1])[:8]),
        "to_main_or_cascade": sum(1 for p in prs if p["baseRefName"] == "main" or "cascade" in p["title"].lower()),
        "median_hours_to_merge": median(hours),
        "prs_with_verdict": reviewed,
        "median_hours_to_merge_reviewed": median(reviewed_hours),
        "first_verdict_green_pct": round(100 * first_green / reviewed) if reviewed else None,
        "prs_with_a_red_verdict": any_red,
        "red_verdicts": reds,
        "deep_reviews": deep,
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
        fallback = sum(s["search_fallbacks"] for s in sessions)
        biggest = max(sessions, key=lambda s: s["output_tokens"])
        print(f"  sessions {n} ({sessions[0]['start'][:10]} to {sessions[-1]['start'][:10]}), "
              f"output tokens {tokens / 1e6:.2f}M (avg {tokens // n // 1000}K)")
        print(f"  tool errors per session {sum(s['tool_errors'] for s in sessions) / n:.1f}, "
              f"code-research adherence {100 * research // max(research + fallback, 1)}%, "
              f"sessions using task lists {sum(1 for s in sessions if s['task_tool_calls'])}/{n}")
        print(f"  largest session {biggest['output_tokens'] / 1e6:.2f}M tokens, {biggest['minutes']} min, "
              f"{biggest['files_edited']} files ({biggest['start'][:10]})")
    if prs:
        print(f"  merged PRs {prs['merged_prs']} {prs['by_type']}, to main or cascade {prs['to_main_or_cascade']}, "
              f"median {prs['median_hours_to_merge']} h to merge")
        print(f"  reviewed PRs {prs['prs_with_verdict']} (median {prs['median_hours_to_merge_reviewed']} h to merge): "
              f"first verdict green {prs['first_verdict_green_pct']}%, {prs['prs_with_a_red_verdict']} had a red verdict, "
              f"red verdicts {prs['red_verdicts']} across both tiers, deep reviews {prs['deep_reviews']}")
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
        files = sorted(glob.glob(os.path.join(logs, "*.jsonl"))) if logs else []
        sessions = sorted(filter(None, map(session_stats, files)), key=lambda s: s["start"])
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
