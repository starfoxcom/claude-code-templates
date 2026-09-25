#!/usr/bin/env python3
"""PreToolUse guard: nothing authored from a Claude session carries AI
attribution when it is written the ordinary way.

Rule (.claude/rules/git.md): commits, PR titles and bodies, issue bodies,
comments, reviews, releases and tags belong to the maintainer. The harness
can inject a note asking for attribution trailers; this hook is the
mechanical answer so the note can never win.

The contract is "no attribution", not "no mention". Denied: a Co-Authored-By
naming an AI, an Anthropic noreply address, "Generated with / written by
<AI>", a line ending "via Claude Code" or "by Claude", a Claude Code session
link or Claude-Session trailer, a session id, "AI-assisted / AI-generated",
"with / by an AI or assistant", and the robot emoji. Plain mentions pass:
"fix the Claude Code hook config", CLAUDE.md, the repo's own name, a human
Co-Authored-By.

What is scanned, for any git write, gh write or GitHub API call:
  * The full command text: inline -m / --body / --title / --notes values,
    here-docs, here-strings and PowerShell -Body all live there.
  * Every file the command names as a message or body: -F / --file /
    --body-file / --notes-file / --template / --input / --message-file,
    curl -d @file, PowerShell -InFile and Get-Content <file>. A file it
    cannot read is denied, so a typo cannot slip a body through unread.

It is a safety net for attribution written the ordinary way, not a sandbox
against a command built to slip past it. No text check can be one. These
pass unread: text the shell builds at run time ($VAR, $(...), backticks,
eval), a body piped in on stdin, a message reused from another commit
(-C / --reuse-message), flags that skip git's own hooks, and text a program
started by the command writes on its own. The repo's `attribution` settings
switch off the harness's own trailers; this hook catches the ones written
by hand.

The repo registers this file through run-hook.sh, which skips it when
~/.claude/hooks/no-ai-attribution.py exists and ~/.claude/settings.json
names it outside a permission rule.

Exit contract: JSON permissionDecision=deny on stdout, exit 0. Silent
exit 0 otherwise. Never blocks read-only commands.
"""
import json
import os
import re
import sys

# Obfuscation-tolerant: optional zero-width / separator chars between letters.
_Z = r"[​‌‍⁠﻿\s\-_.*]*"


def _fuzzy(word):
    return _Z.join(re.escape(ch) for ch in word)


CLAUDE = _fuzzy("claude")
ANTHROPIC = _fuzzy("anthropic")
# Tool names that make a phrase attribution. `cursor` alone is an ordinary UI
# word ("pointer with cursor"), so only "Cursor AI / IDE / agent" counts.
AI = (r"(?:" + CLAUDE + "|" + ANTHROPIC + r"|ai|llm|assistant|copilot|codex|chat" + _Z + r"gpt|gpt|gemini|"
      r"cursor" + _Z + r"(?:ai|ide|agent))")
AN = r"(?:an?" + _Z + r")?"

ATTRIBUTION = re.compile(
    "|".join([
        # Co-Authored-By naming an AI; a human co-author passes.
        r"co" + _Z + r"-?" + _Z + r"authored" + _Z + r"-?" + _Z + r"by\s*:?[^\n]*?\b" + AI + r"\b",
        r"noreply@" + ANTHROPIC,
        r"\b(?:generated|written|created|made|authored|produced|assisted|co-?written)" + _Z
        + r"(?:with|by|using|via)" + _Z + AN + AI + r"\b",
        # A line or quoted message that ends "via Claude Code" / "by Claude".
        r"\b(?:with|by|via|using)" + _Z + CLAUDE + r"(?:" + _Z + r"code)?(?=[\s.!)\]]*(?:$|['\"`]))",
        r"claude\.(?:ai|com)/(?:code|claude-code)\b",
        r"\b" + CLAUDE + r"[-_]session\s*:",
        r"session_[0-9a-z]{20,}",
        r"\U0001F916",                       # robot emoji
        r"\bai" + _Z + r"-?" + _Z + r"(?:assisted|generated|written|authored)",
        r"\b(?:with|by|via)" + _Z + AN + r"(?:ai|llm|assistant|copilot|codex|gpt|cursor" + _Z
        + r"(?:ai|ide|agent))\b",
    ]),
    re.I | re.M,
)

GIT_WRITE = re.compile(
    r"\bgit\b[^|;&\n]*?\b(commit|merge|push|tag|notes|am|cherry-pick|revert|rebase|replace)\b", re.I)
GH_WRITE = re.compile(
    r"\bgh\b[^|;&\n]*?\b(pr|issue|release|gist|repo)\b[^|;&\n]*?\b(create|edit|comment|review|merge|close|reopen)\b",
    re.I)
GH_API = re.compile(r"\bgh\b[^|;&\n]*?\bapi\b", re.I)
HTTP_GH = re.compile(r"\b(?:curl|Invoke-(?:RestMethod|WebRequest))\b[^|;&\n]*api\.github\.com", re.I)

# Flags whose next token is a file the hook must read. `-F` is case-sensitive:
# a lowercase `-f` is `git tag -f` (force) or `gh pr create -f` (fill).
FILE_FLAGS = re.compile(
    r"(?:(?<=\s)-F|(?i:--file|--body-file|--notes-file|--template|--input|--message-file|-InFile|Get-Content)|"
    r"(?<=\s)-d\s*@|(?i:--data(?:-binary|-raw)?)\s*@)\s*(?:\"([^\"]+)\"|'([^']+)'|(\S+))"
)
PATH_TOKEN = re.compile(r"(?<!:/)(?<![\w])(?:[A-Za-z]:|~)?(?:[\\/][\w.\-]+)+")


def deny(reason):
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "BLOCKED (no AI attribution): " + reason
                + " Commits, PRs, issues, comments and releases belong to the maintainer; no AI "
                  "Co-Authored-By, no generated-with line, no session link, no robot emoji.",
        }
    }))
    sys.exit(0)


def strip_paths(text):
    """Mask file-system paths so a scratch directory named after a session
    cannot trip the scan. URLs survive (the lookbehind skips the `//` after a
    scheme), so session links are still caught."""
    return PATH_TOKEN.sub("<path>", text)


def find_files(cmd, cwd):
    for m in FILE_FLAGS.finditer(cmd):
        path = next((g for g in m.groups() if g), None)
        if not path or path == "-":
            continue
        if "=" in path:            # gh -F key=value / key=@file
            if "=@" not in path:
                continue
            path = path.split("=@", 1)[1]
        path = os.path.expanduser(path.strip("\"'"))
        if not os.path.isabs(path):
            cd = re.search(r"(?:^|&&|;)\s*cd\s+(?:\"([^\"]+)\"|'([^']+)'|(\S+))", cmd)
            base = next((g for g in cd.groups() if g), cwd) if cd else cwd
            path = os.path.join(base.strip("\"'"), path)
        yield path


def scan_text(text, where):
    hit = ATTRIBUTION.search(strip_paths(text))
    if hit:
        deny(f"attribution marker '{hit.group(0).strip()}' found in {where}.")


def main():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    except Exception:
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    cwd = data.get("cwd") or os.getcwd()
    if not cmd or not (GIT_WRITE.search(cmd) or GH_WRITE.search(cmd) or GH_API.search(cmd)
                       or HTTP_GH.search(cmd)):
        sys.exit(0)

    scan_text(cmd, "the command text")
    for path in find_files(cmd, cwd):
        try:
            text = open(path, encoding="utf-8-sig", errors="replace").read()
        except Exception as e:
            deny(f"could not read message/body file {path}: {e}. Use a literal absolute path.")
        scan_text(text, f"file {path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
