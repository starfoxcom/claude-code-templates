#!/usr/bin/env python3
"""
PreToolUse hook — tokensave-first enforcement.

Runs before Grep / Glob / raw grep|rg|ag|ack Bash calls. If a tokensave
index is detected by walking up from CWD, the hook prints a structured
reason to stderr and exits 2 (block). Claude reads the reason and routes
the next call through tokensave_search / tokensave_context / etc.

Bypass paths:
  - Tokensave not installed → hook exits 0 (allows the tool).
  - Searching non-code content (markdown, binaries, .gitignored, etc.) →
    add `# TOKENSAVE_BYPASS: <reason>` inside the Bash command. The hook
    lets it through (Grep/Glob tools have no inline-comment escape — for
    those, briefly explain the bypass in chat and re-issue).

Install (canonical procedure in SETUP.md § Phase 7a):
  Install GLOBALLY at ~/.claude/hooks/tokensave-first.py and register in
  ~/.claude/settings.json under hooks.PreToolUse:
    {
      "matcher": "Grep|Glob|Bash",
      "hooks": [
        { "type": "command",
          "command": "py \"~/.claude/hooks/tokensave-first.py\"" }
      ]
    }
  On Windows, expand ~ to the absolute path. On macOS/Linux, swap `py`
  for `python3`. NEVER install project-local — it triggers a tokensave
  template-inheritance bug that corrupts settings on every Stop event.
"""
import json
import os
import pathlib
import sys
from typing import Optional


def find_tokensave_index(start_path: str) -> Optional[pathlib.Path]:
    """Walk up looking for `.tokensave/tokensave.db` (tokensave v4.1+ behaviour)."""
    try:
        p = pathlib.Path(start_path).resolve()
    except (OSError, ValueError):
        return None
    while True:
        db = p / ".tokensave" / "tokensave.db"
        if db.is_file():
            return p / ".tokensave"
        if p == p.parent:
            return None
        p = p.parent


def has_bypass_marker(cmd: str) -> bool:
    return "TOKENSAVE_BYPASS:" in (cmd or "")


def is_grep_like_bash(cmd: str) -> bool:
    if not cmd:
        return False
    lowered = cmd.lstrip()
    # match raw grep / rg / ag / ack / ripgrep at command start OR after a pipe
    for prefix in ("grep ", "rg ", "ag ", "ack ", "ripgrep "):
        if lowered.startswith(prefix):
            return True
        if f"| {prefix}" in cmd or f"|{prefix}" in cmd:
            return True
        if f"&& {prefix}" in cmd:
            return True
    return False


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}
    cwd = payload.get("cwd") or os.getcwd()

    intercept = False
    if tool_name in ("Grep", "Glob"):
        intercept = True
    elif tool_name == "Bash":
        cmd = tool_input.get("command", "") or ""
        if has_bypass_marker(cmd):
            sys.exit(0)
        if is_grep_like_bash(cmd):
            intercept = True

    if not intercept:
        sys.exit(0)

    ts_dir = find_tokensave_index(cwd)
    if ts_dir is None:
        sys.exit(0)  # tokensave not installed — allow

    msg = (
        f"Tokensave index detected at {ts_dir}.\n\n"
        "Code research must route through tokensave first, not Grep / Glob / raw grep / rg:\n"
        "  • Symbol lookup                → tokensave_search <name>\n"
        "  • 'Where is X / what calls Y'  → tokensave_context <query>\n"
        "  • Call-graph traversal         → tokensave_callers / tokensave_callees / tokensave_impact\n"
        "  • File search / locate         → tokensave_files <pattern>\n"
        "  • Function/class body          → tokensave_body <symbol>\n\n"
        "Fall back to Grep/Glob/raw grep ONLY when:\n"
        "  1. You've tried tokensave with 2+ keyword variants and got nothing usable.\n"
        "  2. You're searching non-code content (markdown, binaries, .gitignored).\n"
        "  3. tokensave_status returns 'unavailable' for the scope you need.\n\n"
        "Bypass (Bash only): include `# TOKENSAVE_BYPASS: <reason>` in the command.\n"
        "Bypass (Grep/Glob tools): briefly explain in chat why tokensave doesn't fit, then re-issue."
    )
    print(msg, file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
