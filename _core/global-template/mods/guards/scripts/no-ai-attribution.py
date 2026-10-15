#!/usr/bin/env python3
"""PreToolUse guard: nothing authored from a Claude session carries AI
attribution, on any repo, through any route.

Founder rule (AppProject .claude/rules/git.md, GameProject equivalent): commits,
PR titles and bodies, issue bodies, comments, reviews, releases and tags
belong to the founder. No Co-Authored-By, no "Generated with Claude", no
session links, no Anthropic addresses, no robot emoji sign-off. The harness
injects a per-session note asking for exactly those trailers; this hook is
the mechanical answer so the note can never win.

What is scanned
  * The full command text (inline -m / --body / --title / --notes /
    here-docs / here-strings / PowerShell -Body all live there).
  * Every file the command hands to git or gh as a message or body:
    -F / --file / --body-file / --notes-file / --template (git only) /
    --input, curl -d @file, PowerShell -InFile and Get-Content <file>,
    spaced or `--flag=value`.

What is denied outright (bypass routes the hook cannot see through)
  * --no-verify, or -n on git commit / merge / push; core.hooksPath
    overrides; LEFTHOOK=0 / lefthook uninstall.
  * --trailer (the trailer text can come from anywhere).
  * Message reuse: -C / --reuse-message / --reedit-message / -c <commit>.
  * A message or body value built by command substitution `$(...)`,
    backticks (bash), process substitution `<(...)` or a variable, and
    `eval`; or read from stdin `-F -` fed by anything other than a here-doc
    in the same command.

What passes
  * Flags, variables and the word eval written INSIDE a quoted message, a
    here-doc or a here-string: that is text being described, not an
    argument. Single-quoted text and quoted here-docs never expand.
  * Shell plumbing outside message values: `2>$null`, `$sha` as a merge
    argument, `$LASTEXITCODE`.
  * `gh ... --template "Bug report"` (a template name), `-F key=@-` (stdin),
    lowercase -f (`git tag -f`, `gh pr create -f`).

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


# AI tool names that make a "made with / by" phrase a credit line.
_TOOLS = r"ai|llm|assistant|copilot|codex|chat" + _Z + r"gpt|gpt|gemini"

ATTRIBUTION = re.compile(
    "|".join([
        r"co" + _Z + r"-?" + _Z + r"authored" + _Z + r"-?" + _Z + r"by",
        _fuzzy("claude"),
        r"c[l1|]a[uü]de",              # c1aude / cl|ude style leet
        _fuzzy("anthropic"),
        r"noreply@",
        r"generated" + _Z + r"(with|by)" + _Z + r"(an?" + _Z + r")?(claude|ai|llm|anthropic|copilot|cursor|codex|gpt)\b",
        r"claude\.(ai|com)", r"anthropic\.com",
        r"claude" + _Z + r"-?" + _Z + r"session",
        r"session_[0-9a-z]{20,}",
        r"\U0001F916",                       # robot emoji
        r"ai" + _Z + r"-?" + _Z + r"(assisted|generated|written|authored)",
        # Authorship phrasing: "written by an AI". A bare "integration with
        # LLM providers" or "pointer with cursor" is a mention, not a credit.
        r"\b(?:written|created|made|authored|produced|assisted|co-?written)" + _Z + r"(?:with|by|using|via)"
        + _Z + r"(?:an?" + _Z + r")?(?:" + _TOOLS + r"|cursor" + _Z + r"(?:ai|ide|agent))\b",
        # Trailer forms with a colon: "Assisted-by: <AI>:<model>", "Made-with: Cursor".
        r"\b(?:generated|written|created|made|authored|produced|assisted|co-?written)" + _Z
        + r"(?:with|by|using|via)" + _Z + r":[ \t]*(?:an?" + _Z + r")?(?:" + _TOOLS + r"|cursor)\b",
    ]),
    re.I,
)

HOOK_BYPASS = re.compile(
    r"--no-verify\b|core\.hooksPath|LEFTHOOK\s*=\s*0|lefthook\s+uninstall|"
    r"--no-hooks\b|hooks\.\w+\s*=|git\s+config[^|;&\n]*hooks",
    re.I,
)
# -n means --no-verify only on these; `git tag -n` / `cherry-pick -n` differ.
NO_VERIFY_N = re.compile(r"\bgit\b[^|;&\n]*?\b(?:commit|merge|push)\b[^|;&\n]*?(?<=\s)-n(?=\s|$)", re.I)
TRAILER = re.compile(r"--trailer\b", re.I)
REUSE = re.compile(r"\bcommit\b[^|;&\n]*?(?:--reuse-message\b|--reedit-message\b|\s-[Cc]\s+\S)", re.I)
EVAL = re.compile(r"\beval\b", re.I)

GIT_WRITE = re.compile(
    r"\bgit\b[^|;&\n]*?\b(commit|merge|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace)\b",
    re.I)
GH_WRITE = re.compile(
    r"\bgh\b[^|;&\n]*?\b(pr|issue|release|gist|repo)\b[^|;&\n]*?\b(create|edit|comment|review|merge|close|reopen)\b",
    re.I)
GH_API_WRITE = re.compile(r"\bgh\b[^|;&\n]*?\bapi\b(?=[^|;&\n]*?(-X\s*(POST|PATCH|PUT)|--method\s*(POST|PATCH|PUT)|(?<=\s)-[fF]\s|--field|--raw-field|--input))", re.I)
CURL_GH = re.compile(r"\bcurl\b[^|;&\n]*api\.github\.com", re.I)
PS_GH = re.compile(r"Invoke-(RestMethod|WebRequest)\b[^|;&\n]*api\.github\.com", re.I)
FILTER_REPO = re.compile(r"\bgit\s+filter-repo\b|\bgit\s+filter-branch\b", re.I)

# Flags whose next token is a file the hook must read. `-F` is case-sensitive:
# a lowercase `-f` is `git tag -f` (force) or `gh pr create -f` (fill). Long
# flags match whole (`--filename` is not `--file`). The value may follow a
# space or the long-option `=` (`--body-file=body.md`).
FILE_FLAGS = re.compile(
    r"(?:(?<=\s)-F"
    r"|(?P<long>(?i:--file|--body-file|--notes-file|--template|--input|--message-file|-InFile))(?![\w-])"
    r"|(?i:Get-Content)(?:\s+(?i:-Raw|-Path|-LiteralPath)(?![\w-]))*"
    r"|(?<=\s)-d\s*@|(?i:--data(?:-binary|-raw)?)\s*@)"
    r"\s*=?\s*(?:\"(?P<dq>[^\"]+)\"|'(?P<sq>[^']+)'|(?P<bare>\S+))"
)
SEGMENT_START = re.compile(r"[;&|\n][^;&|\n]*$")

# Message flags and their value: a double-quoted string, a single-quoted
# string (literal, never expands) or a bare token, optionally behind a gh
# field name (`-f body="..."`). Long forms first so `-b` never claims the
# front of `-Body`. Inside double quotes the escape character is `\` in bash
# and a backtick in PowerShell.
def _msg_value(esc):
    e = re.escape(esc)
    return re.compile(
        r"(?<=\s)(?:--message|--body|--title|--notes|--field|--raw-field|-Body|-m|-b|-t|-f|-F)(?=[\s=\"'])"
        r"\s*=?\s*(?:[A-Za-z_][\w\[\].-]*=)?"
        r"(?:\"(?P<dq>(?:[^\"" + e + r"]|" + e + r".)*)\"|'[^']*'|(?P<bare>[^\s'\"]+))",
        re.I | re.S,
    )


MSG_VALUE = {"\\": _msg_value("\\"), "`": _msg_value("`")}
BASH_SUBST = re.compile(r"\$\(|`[^`]+`|<\(|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?")
PS_SUBST = re.compile(r"\$\(|\$\{?[A-Za-z_][A-Za-z0-9_:]*\}?")

# Here-docs: quoted ones (<<'EOF') are literal, unquoted ones expand.
HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)([A-Za-z_]\w*)\1[^\n]*\n(.*?)\n[ \t]*\2[ \t]*(?=\n|$)", re.S)
# PowerShell here-strings: @'...'@ is literal, @"..."@ expands.
HERESTRING = re.compile(r"@(['\"])[ \t]*\n(.*?)\n\1@", re.S)


def deny(reason):
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "BLOCKED (no AI attribution): " + reason
                + " Commits, PRs, issues, comments and releases belong to the founder; no Co-Authored-By, "
                  "no Claude / Anthropic mention, no session link, no robot emoji.",
        }
    }))
    sys.exit(0)


PATH_TOKEN = re.compile(r"(?<!:/)(?<![\w])(?:[A-Za-z]:|~)?(?:[\\/][\w.\-]+)+")
# Repo identifiers that legitimately carry the word: the instructions file,
# the config directory, the two review workflow files, their check name, the
# action they run and the templates repo's own name. Exact tokens only;
# anything else stays denied.
ALLOWED_NAMES = re.compile(
    r"\bCLAUDE\.md\b|\.claude(?:[\\/][\w.\-]*)*|`?claude(?:-code-review)?\*?\.yml`?|"
    r"`?Claude On-Demand`?|`?claude-code-action`?|`?Claude Code Review`?|\bclaude-code-templates\b"
)


def strip_paths(cmd):
    """Mask file-system paths and the repo's own CLAUDE.md / .claude references.

    URLs survive (the lookbehind skips the `//` after a scheme), so session
    links are still caught; a scratch directory or hook path that happens to
    contain "claude" is not.
    """
    cmd = PATH_TOKEN.sub("<path>", cmd)
    return ALLOWED_NAMES.sub("<repo-file>", cmd)


def text_spans(cmd, esc):
    """Spans of quoted strings, here-doc bodies and here-strings: text a
    message carries, where a flag name is a mention, not an argument. `esc`
    is the shell's escape character inside double quotes."""
    spans = [m.span() for m in HEREDOC.finditer(cmd)] + [m.span() for m in HERESTRING.finditer(cmd)]
    i, n = 0, len(cmd)
    while i < n:
        inside = next((e for s, e in spans if s <= i < e), None)
        if inside is not None:
            i = inside
            continue
        q = cmd[i]
        if q in "'\"":
            j = i + 1
            while j < n and cmd[j] != q:
                j += 2 if q == '"' and cmd[j] == esc else 1
            spans.append((i, j + 1))
            i = j + 1
        else:
            i += 1
    return spans


def mask(cmd, spans):
    """The command with every quoted span blanked, same length: arguments only."""
    chars = list(cmd)
    for s, e in spans:
        for k in range(s, min(e, len(chars))):
            if chars[k] != "\n":
                chars[k] = " "
    return "".join(chars)


def find_files(cmd, cwd, spans):
    for m in FILE_FLAGS.finditer(cmd):
        if any(s <= m.start() < e for s, e in spans):
            continue
        path = m.group("dq") or m.group("sq") or m.group("bare")
        if not path or path == "-":
            continue
        if (m.group("long") or "").lower() == "--template":
            # A file for `git commit`; a template name or repository for gh.
            before = cmd[:m.start()]
            seg = SEGMENT_START.search(before)
            if not re.search(r"\bgit\b", before[seg.start():] if seg else before, re.I):
                continue
        if "=" in path:            # gh -F key=value / key=@file
            if "=@" not in path:
                continue
            path = path.split("=@", 1)[1]
            if path == "-":        # key=@- reads stdin
                continue
        path = os.path.expanduser(path.strip("\"'"))
        if not os.path.isabs(path):
            cd = re.search(r"(?:^|&&|;)\s*cd\s+(?:\"([^\"]+)\"|'([^']+)'|(\S+))", cmd)
            base = next((g for g in cd.groups() if g), cwd) if cd else cwd
            path = os.path.join(base.strip("\"'"), path)
        yield path


def expanded_values(cmd, spans, powershell):
    """Message text the shell expands before git or gh sees it: double-quoted
    or bare message values, unquoted here-doc bodies, @"..."@ here-strings."""
    for m in MSG_VALUE["`" if powershell else "\\"].finditer(cmd):
        if any(s <= m.start() < e for s, e in spans):
            continue
        if m.group("dq") is not None:
            yield m.group("dq")
        elif m.group("bare") and not m.group("bare").startswith("@"):
            yield m.group("bare")
    for m in HEREDOC.finditer(cmd):
        if not m.group(1):
            yield m.group(3)
    if powershell:
        for m in HERESTRING.finditer(cmd):
            if m.group(1) == '"':
                yield m.group(2)


def scan_text(text, where):
    hit = ATTRIBUTION.search(strip_paths(text))
    if hit:
        deny(f"attribution marker '{hit.group(0)}' found in {where}.")


def main():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    except Exception:
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    cwd = data.get("cwd") or os.getcwd()
    powershell = (data.get("tool_name") or "") == "PowerShell"
    if not cmd:
        sys.exit(0)

    spans = text_spans(cmd, "`" if powershell else "\\")
    args = mask(cmd, spans)

    is_git = GIT_WRITE.search(args)
    is_gh = GH_WRITE.search(args) or GH_API_WRITE.search(args)
    is_http = CURL_GH.search(args) or PS_GH.search(args)
    if not (is_git or is_gh or is_http):
        # Still refuse to weaken the git-side guard from any command.
        if re.search(r"lefthook\s+uninstall|LEFTHOOK\s*=\s*0", args, re.I):
            deny("disabling lefthook removes the commit-msg attribution check.")
        sys.exit(0)

    if FILTER_REPO.search(args):
        deny("history rewriting tools are not allowed from a session.")
    if is_git and (HOOK_BYPASS.search(args) or NO_VERIFY_N.search(args)):
        deny("git hook bypass (--no-verify / -n / hooksPath) is not allowed.")
    if is_git and TRAILER.search(args):
        deny("--trailer is not allowed; write the message body directly.")
    if is_git and REUSE.search(args):
        deny("reusing another commit's message (-C / -c / --reuse-message) cannot be scanned.")
    if EVAL.search(args):
        deny("eval builds the command at run time, so the hook cannot read the message.")

    scan_text(cmd, "the command text")

    # Message text must be literal. Any expansion hides content from the hook.
    subst = PS_SUBST if powershell else BASH_SUBST
    for value in expanded_values(cmd, spans, powershell):
        if subst.search(re.sub(r"`." if powershell else r"\\.", "", value)):
            deny("message/body text uses shell expansion ($VAR, $(...), backticks, <(...)) that the hook "
                 "cannot read. Use a literal string, a here-doc, or --body-file <literal absolute path>.")

    for path in find_files(cmd, cwd, spans):
        try:
            text = open(path, encoding="utf-8-sig", errors="replace").read()
        except Exception as e:
            deny(f"could not read message/body file {path}: {e}. Use a literal absolute path.")
        scan_text(text, f"file {path}")

    if is_git and re.search(r"(?<=\s)-F\s+-(?=\s|$)|--file[= ]-(?=\s|$)", args) and "<<" not in cmd:
        deny("`-F -` reads the message from a pipe the hook cannot see. Use a here-doc in the same command.")

    sys.exit(0)


if __name__ == "__main__":
    main()
