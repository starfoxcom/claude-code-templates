#!/usr/bin/env python3
"""PreToolUse guard: nothing authored from a Claude session carries AI
attribution, through any route.

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

The repo registers this file through run-hook.sh, which skips it when
~/.claude/hooks/no-ai-attribution.py exists and ~/.claude/settings.json
names it outside a permission rule.

What is scanned
  * The full command text (inline -m / --body / --title / --notes /
    here-docs / here-strings / PowerShell -Body all live there).
  * Every file the command hands to git or gh as a message or body:
    -F / --file / --body-file / --notes-file / --template / --input,
    curl -d @file, PowerShell -InFile and Get-Content <file>.

What is denied outright (bypass routes the hook cannot see through)
  * Skipping git's own hooks: --no-verify on git commit, merge, push, am,
    cherry-pick, revert or rebase; -n on git commit (the only command where
    it means --no-verify); setting core.hooksPath; LEFTHOOK=0 or lefthook
    uninstall. Quoted text and here-doc bodies are not read for these, so a
    message that mentions a flag passes.
  * --trailer (the trailer text can come from anywhere).
  * Message reuse: -C / --reuse-message / --reedit-message / -c <commit>.
  * Message or body text built by command substitution `$(...)`, backticks,
    process substitution `<(...)` or a variable, including inside an
    unquoted here-doc.
  * A message or body file of `-` (git -F -, gh --body-file / --notes-file /
    --input -, curl -d @-) unless a here-doc is the command's only input:
    a pipe or a `<` redirect anywhere outside quotes and here-doc bodies
    denies it.
  * gh api writes (POST/PATCH/PUT) whose body comes from -f/-F fields the
    hook cannot resolve to a literal.

Out of reach: text a program started by the command writes on its own
(`python -c`, a script, an alias), and any route outside Bash and
PowerShell tool calls.

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

# Here-doc bodies, quoted or not. A quoted one is literal text; an unquoted
# one expands $VAR and $(...), which the SUBST check below reads.
HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1.*?^\2\s*$", re.S | re.M)
QUOTED = re.compile(r"'[^']*'|\"(?:[^\"\\]|\\.)*\"", re.S)
SUBST = re.compile(r"\$\(|`[^`]+`|<\(|\beval\b|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$env:", re.I)

# Read against the command with quoted text and here-doc bodies removed.
HOOK_BYPASS = re.compile(
    r"\bgit\b[^|;&\n]*?\b(?:commit|merge|push|am|cherry-pick|revert|rebase)\b[^|;&\n]*?--no-verify\b|"
    r"\bgit\b[^|;&\n]*?\bcommit\b[^|;&\n]*?(?<=\s)-[a-zA-Z]*n[a-zA-Z]*(?=\s|$)|"
    r"core\.hooksPath\s*=|"
    r"\bgit\b[^|;&\n]*?\bconfig\b(?![^|;&\n]*?--(?:get|get-all|get-regexp|list|unset)\b)"
    r"[^|;&\n]*?core\.hooksPath\s+\S|"
    r"LEFTHOOK\s*=\s*0|lefthook\s+uninstall",
    re.I,
)
TRAILER = re.compile(r"--trailer\b", re.I)
REUSE = re.compile(r"\bcommit\b[^|;&\n]*?(?:--reuse-message\b|--reedit-message\b|\s-[Cc]\s+\S)", re.I)

GIT_WRITE = re.compile(
    r"\bgit\b[^|;&\n]*?\b(commit|merge|push|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace)\b",
    re.I)
GH_WRITE = re.compile(
    r"\bgh\b[^|;&\n]*?\b(pr|issue|release|gist|repo)\b[^|;&\n]*?\b(create|edit|comment|review|merge|close|reopen)\b",
    re.I)
GH_API_WRITE = re.compile(r"\bgh\b[^|;&\n]*?\bapi\b(?=[^|;&\n]*?(-X\s*(POST|PATCH|PUT)|--method\s*(POST|PATCH|PUT)|(?<=\s)-[fF]\s|--field|--raw-field|--input))", re.I)
CURL_GH = re.compile(r"\bcurl\b[^|;&\n]*api\.github\.com", re.I)
PS_GH = re.compile(r"Invoke-(RestMethod|WebRequest)\b[^|;&\n]*api\.github\.com", re.I)
FILTER_REPO = re.compile(r"\bgit\s+filter-repo\b|\bgit\s+filter-branch\b", re.I)

# Flags whose next token is a file the hook must read. `-F` is case-sensitive:
# a lowercase `-f` is `git tag -f` (force) or `gh pr create -f` (fill).
FILE_FLAGS = re.compile(
    r"(?:(?<=\s)-F|(?i:--file|--body-file|--notes-file|--template|--input|--message-file|-InFile|Get-Content)|"
    r"(?<=\s)-d\s*@|(?i:--data(?:-binary|-raw)?)\s*@)\s*(?:\"([^\"]+)\"|'([^']+)'|(\S+))"
)
# A message or body file of `-` is stdin, for git and gh alike; curl's `@-` too.
STDIN_FILE = re.compile(
    r"(?:(?<=\s)-F|(?i:--file|--body-file|--notes-file|--input|--message-file|-InFile))(?:\s+|=)-(?=\s|$)|"
    r"(?:(?<=\s)-d|(?i:--data(?:-binary|-raw)?))\s*@-(?=\s|$)"
)
# Another stdin source next to a here-doc: a pipe, or a `<` redirect that is
# not a here-doc, here-string or process substitution.
OTHER_INPUT = re.compile(r"\||(?<![<\d])<(?![<(&])")
# A message flag and its value: a PowerShell here-string, a quoted string or a
# bare word. gh api's -f / -F / --field / --raw-field count only on gh api.
_VALUE = r"(?:\s+|=)(@\"[\s\S]*?\"@|@'[\s\S]*?'@|\"(?:[^\"\\]|\\.)*\"|'[^']*'|\S+)"
MSG_ARG = re.compile(r"(?<=\s)(?:-m|--message|-b|--body|-t|--title|--notes|(?i:-Body))" + _VALUE)
FIELD_ARG = re.compile(r"(?<=\s)(?:-f|-F|--field|--raw-field)" + _VALUE)


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


PATH_TOKEN = re.compile(r"(?<!:/)(?<![\w])(?:[A-Za-z]:|~)?(?:[\\/][\w.\-]+)+")


def strip_paths(cmd):
    """Mask file-system paths so a scratch directory named after a session
    cannot trip the scan. URLs survive (the lookbehind skips the `//` after a
    scheme), so session links are still caught."""
    return PATH_TOKEN.sub("<path>", cmd)


def bare(cmd):
    """The command with here-doc bodies and quoted strings removed: the text
    the shell reads as flags and operators."""
    return QUOTED.sub("''", HEREDOC.sub("HEREDOC", cmd))


def expansion_in_message(cmd, api):
    """True when message or body text is built by the shell at run time: a
    message value outside single quotes (and outside a PowerShell @'...'@)
    holding $VAR, $(...), backticks or <(...), or an unquoted here-doc
    holding one. Text elsewhere in the command (a `git -C "$REPO"`) does not
    count."""
    for pattern in (MSG_ARG, FIELD_ARG) if api else (MSG_ARG,):
        for m in pattern.finditer(cmd):
            value = m.group(1)
            if not value.startswith(("'", "@'")) and SUBST.search(value):
                return True
    return any(not m.group(1) and SUBST.search(m.group(0)) for m in HEREDOC.finditer(cmd))


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
    if not cmd:
        sys.exit(0)

    is_git = GIT_WRITE.search(cmd)
    is_gh = GH_WRITE.search(cmd) or GH_API_WRITE.search(cmd)
    is_http = CURL_GH.search(cmd) or PS_GH.search(cmd)
    flags = bare(cmd)
    if not (is_git or is_gh or is_http):
        # Still refuse to weaken the git-side guard from any command.
        if re.search(r"lefthook\s+uninstall|LEFTHOOK\s*=\s*0", flags, re.I):
            deny("disabling lefthook removes the commit-msg attribution check.")
        sys.exit(0)

    if FILTER_REPO.search(cmd):
        deny("history rewriting tools are not allowed from a session.")
    if is_git and HOOK_BYPASS.search(flags):
        deny("skipping git hooks (--no-verify, commit -n, core.hooksPath, lefthook off) is not allowed.")
    if is_git and TRAILER.search(flags):
        deny("--trailer is not allowed; write the message body directly.")
    if is_git and REUSE.search(flags):
        deny("reusing another commit's message (-C / -c / --reuse-message) cannot be scanned.")

    scan_text(cmd, "the command text")

    # Message text must be literal (the scan above already read it). Any
    # expansion hides content from the hook.
    if expansion_in_message(cmd, api=bool(GH_API_WRITE.search(cmd))):
        deny("message/body text uses shell expansion ($VAR, $(...), backticks, <(...)) that the hook "
             "cannot read. Use a literal string, a quoted here-doc, or --body-file <literal absolute path>.")

    for path in find_files(cmd, cwd):
        try:
            text = open(path, encoding="utf-8-sig", errors="replace").read()
        except Exception as e:
            deny(f"could not read message/body file {path}: {e}. Use a literal absolute path.")
        scan_text(text, f"file {path}")

    if STDIN_FILE.search(cmd) and not (HEREDOC.search(cmd) and not OTHER_INPUT.search(flags)):
        deny("a message/body file of `-` reads text the hook cannot see. Feed it only from a here-doc "
             "in the same command, or use --body-file <literal absolute path>.")

    sys.exit(0)


if __name__ == "__main__":
    main()
