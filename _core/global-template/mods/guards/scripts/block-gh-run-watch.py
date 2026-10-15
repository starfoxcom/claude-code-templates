#!/usr/bin/env python3
"""PreToolUse guard: deny `gh run watch` in Bash and PowerShell.

Why: `gh run watch` holds the tool call on a live log stream and spends
tokens re-reading it. The toolkit's rule (.claude/rules/token-efficiency.md
§ "Watching CI") watches a PR's checks with the ci-watch mod, the Monitor
tool, or a bounded background loop over `gh pr checks`.

Matched on Bash|PowerShell, since a rule kept only in memory gets walked
past in the other shell. No repo scoping: `gh run watch` is the wrong tool
in any repo.
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
                "BLOCKED: `gh run watch` streams logs into the tool call. Watch the PR's checks "
                "as .claude/rules/token-efficiency.md § \"Watching CI\" says: the ci-watch mod "
                "(it starts on its own after a push), the Monitor tool, or a bounded background "
                "loop over `gh pr checks <pr> --json name,bucket`."
            ),
        }
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
