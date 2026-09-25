#!/usr/bin/env python3
"""PreToolUse guard: nothing authored from a Claude session carries AI
attribution, through any route.

Rule (.claude/rules/git.md): commits, PR titles and bodies, issue bodies,
comments, reviews, releases and tags belong to the maintainer. No
Co-Authored-By, no "Generated with Claude", no session links, no Anthropic
addresses, no robot emoji sign-off. The harness can inject a note asking for
exactly those trailers; this hook is the mechanical answer so the note can
never win.

The repo registers this file through run-hook.sh, which skips it when
~/.claude/settings.json already registers a copy.

What is scanned
  * The full command text (inline -m / --body / --title / --notes /
    here-docs / here-strings / PowerShell -Body all live there).
  * Every file the command hands to git or gh as a message or body:
    -F / --file / --body-file / --notes-file / --template / --input,
    curl -d @file, PowerShell -InFile and Get-Content <file>.

What is denied outright (bypass routes the hook cannot see through)
  * --no-verify / -n on git commit, merge, push; core.hooksPath overrides;
    LEFTHOOK=0 / lefthook uninstall.
  * --trailer (the trailer text can come from anywhere).
  * Message reuse: -C / --reuse-message / --reedit-message / -c <commit>.
  * Message or body text built by command substitution `$(...)`, backticks,
    process substitution `<(...)`, or read from stdin `-F -` fed by
    anything other than a here-doc in the same command.
  * gh api writes (POST/PATCH/PUT) whose body comes from -f/-F fields the
    hook cannot resolve to a literal.

Exit contract: JSON permissionDecision=deny on stdout, exit 0. Silent
exit 0 otherwise. Never blocks read-only commands.
"""
import json
import os
import re
import sys

# Obfuscation-tolerant: optional zero-width / separator chars between letters.
_Z = r"[\u200b\u200c\u200d\u2060\ufeff\s\-_.*]*"


def _fuzzy(word):
    return _Z.join(re.escape(ch) for ch in word)


ATTRIBUTION = re.compile(
    "|".join([
        r"co" + _Z + r"-?" + _Z + r"authored" + _Z + r"-?" + _Z + r"by",
        _fuzzy("claude"),
        r"c[l1|]a[u\u00fc]de",              # c1aude / cl|ude style leet
        _fuzzy("anthropic"),
        r"noreply@",
        r"generated" + _Z + r"(with|by)" + _Z + r"(an?" + _Z + r")?(claude|ai|llm|anthropic|copilot|cursor|codex|gpt)\b",
        r"claude\.(ai|com)", r"anthropic\.com",
        r"claude" + _Z + r"-?" + _Z + r"session",
        r"session_[0-9a-z]{20,}",
        r"\U0001F916",                       # robot emoji
        r"ai" + _Z + r"-?" + _Z + r"(assisted|generated|written|authored)",
        r"(with|by|via)" + _Z + r"(an?" + _Z + r")?(ai|llm|assistant|copilot|cursor|codex|gpt)\b",
    ]),
    re.I,
)

HOOK_BYPASS = re.compile(
    r"--no-verify\b|(?<=\s)-n(?=\s|$)|core\.hooksPath|LEFTHOOK\s*=\s*0|lefthook\s+uninstall|"
    r"--no-hooks\b|hooks\.\w+\s*=|git\s+config[^|;&\n]*hooks",
    re.I,
)
TRAILER = re.compile(r"--trailer\b", re.I)
REUSE = re.compile(r"\bcommit\b[^|;&\n]*?(?:--reuse-message\b|--reedit-message\b|\s-[Cc]\s+\S)", re.I)
# A quoted here-doc (<<'EOF' / <<"EOF") is literal text: no expansion happens
# inside it, and the attribution scan already covered it verbatim.
QUOTED_HEREDOC = re.compile(r"<<-?\s*(['\"])(\w+)\1.*?^\2\s*$", re.S | re.M)
SUBST = re.compile(r"\$\(|`[^`]+`|<\(|\beval\b|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$env:", re.I)

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

# Flags whose next token is a file the hook must read.
FILE_FLAGS = re.compile(
    r"(?:(?<=\s)-F|--file|--body-file|--notes-file|--template|--input|--message-file|-InFile|Get-Content|"
    r"(?<=\s)-d\s*@|--data(?:-binary|-raw)?\s*@)\s*(?:\"([^\"]+)\"|'([^']+)'|(\S+))",
    re.I,
)
MSG_FLAGS = re.compile(r"(?<=\s)(-m|--message|-b|--body|-t|--title|--notes|-Body|-f|-F|--field|--raw-field)(?=\s|=)", re.I)


def deny(reason):
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "BLOCKED (no AI attribution): " + reason
                + " Commits, PRs, issues, comments and releases belong to the maintainer; no Co-Authored-By, "
                  "no Claude / Anthropic mention, no session link, no robot emoji.",
        }
    }))
    sys.exit(0)


PATH_TOKEN = re.compile(r"(?<!:/)(?<![\w])(?:[A-Za-z]:|~)?(?:[\\/][\w.\-]+)+")
# Repo identifiers that legitimately carry the word: the instructions file,
# the config directory, the two review workflow files, their check name and
# the action they run. Exact tokens only; anything else stays denied.
ALLOWED_NAMES = re.compile(
    r"\bCLAUDE\.md\b|\.claude(?:[\\/][\w.\-]*)*|`?claude(?:-code-review)?\*?\.yml`?|"
    r"`?Claude On-Demand`?|`?claude-code-action`?|`?Claude Code Review`?"
)


def strip_paths(cmd):
    """Mask file-system paths and the repo's own CLAUDE.md / .claude references.

    URLs survive (the lookbehind skips the `//` after a scheme), so session
    links are still caught; a scratch directory or hook path that happens to
    contain "claude" is not.
    """
    cmd = PATH_TOKEN.sub("<path>", cmd)
    return ALLOWED_NAMES.sub("<repo-file>", cmd)


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
        deny(f"attribution marker '{hit.group(0)}' found in {where}.")


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
    if not (is_git or is_gh or is_http):
        # Still refuse to weaken the git-side guard from any command.
        if re.search(r"lefthook\s+uninstall|LEFTHOOK\s*=\s*0", cmd, re.I):
            deny("disabling lefthook removes the commit-msg attribution check.")
        sys.exit(0)

    if FILTER_REPO.search(cmd):
        deny("history rewriting tools are not allowed from a session.")
    if is_git and HOOK_BYPASS.search(cmd):
        deny("git hook bypass (--no-verify / -n / hooksPath) is not allowed.")
    if is_git and TRAILER.search(cmd):
        deny("--trailer is not allowed; write the message body directly.")
    if is_git and REUSE.search(cmd):
        deny("reusing another commit's message (-C / -c / --reuse-message) cannot be scanned.")

    clean = strip_paths(cmd)
    scan_text(clean, "the command text")

    # Message text must be literal (or a here-doc in the same command, which the
    # scan above already covered). Any expansion hides content from the hook.
    if MSG_FLAGS.search(cmd) and SUBST.search(QUOTED_HEREDOC.sub("<heredoc>", clean)):
        deny("message/body text uses shell expansion ($VAR, $(...), backticks, <(...)) that the hook "
             "cannot read. Use a literal string, a here-doc, or --body-file <literal absolute path>.")

    for path in find_files(cmd, cwd):
        try:
            text = open(path, encoding="utf-8-sig", errors="replace").read()
        except Exception as e:
            deny(f"could not read message/body file {path}: {e}. Use a literal absolute path.")
        scan_text(text, f"file {path}")

    if is_git and re.search(r"(?<=\s)-F\s+-(?=\s|$)|--file[= ]-(?=\s|$)", cmd) and "<<" not in cmd:
        deny("`-F -` reads the message from a pipe the hook cannot see. Use a here-doc in the same command.")

    sys.exit(0)


if __name__ == "__main__":
    main()
