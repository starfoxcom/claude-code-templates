#!/usr/bin/env python3
"""PreToolUse guard: deny `gh run watch` in Bash AND PowerShell.

Why: .claude/rules/token-efficiency.md says NEVER use streaming log
watchers - `gh run watch` freezes the tool call on a live stream and
burns tokens re-rendering it. The sanctioned pattern is the 7-minute
background polling loop (same rules file, § CI monitoring + auto-merge).

This was a recall-only rule; like the workflow-routing guard, it is now
deterministic. Matched on Bash|PowerShell in ~/.claude/settings.json -
the workflow-routing guard was Bash-only and a PowerShell commit walked
straight past it on 2026-08-02 (fourth recurrence of the drift it
guards), so command guards cover both shells from now on.

No repo scoping: `gh run watch` is the wrong tool in any repo.
"""
import json
import re
import sys


# `watch` must be the subcommand word itself: `gh run watch`, with only repo
# flags allowed around `run` (`gh -R o/r run watch 123`, `gh run --repo o/r
# watch`). 2026-10-05: the old pattern took any later "watch" (a branch named
# feature/ci-watch-incident, a file named *-run-watch*) as the subcommand.
_REPO = r"(?:\s+(?:-R|--repo)(?:\s+|=)\S+)*"
_RUN_WATCH = re.compile(
    r"(?:^|[\s;&|(])gh" + _REPO + r"\s+run" + _REPO + r"\s+watch(?=\s|$|[;&|)])")


def is_run_watch(cmd):
    return bool(_RUN_WATCH.search(cmd))


def main():
    try:
        # utf-8-sig: tolerate a BOM (PowerShell pipes prepend one, and a
        # BOM'd payload must not silently fail this guard open).
        data = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    except Exception:
        sys.exit(0)

    cmd = ((data.get("tool_input") or {}).get("command") or "")
    if not is_run_watch(cmd):
        sys.exit(0)

    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "BLOCKED: `gh run watch` streams logs into the tool call - banned by "
                ".claude/rules/token-efficiency.md (§ CI monitoring). Use the background "
                "polling loop instead: `gh run list --branch <b> --json status,conclusion,headSha` "
                "every 420s with run_in_background, then act on the completed result."
            ),
        }
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
