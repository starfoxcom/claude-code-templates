"""PreToolUse hook: block force pushes that permission rules cannot see.

Permission rules match command text, so `-f` bundled with other short flags
(`-qf`, `-vf`, `-uqf`) escapes them. This hook reads the text of every Bash
and PowerShell command and blocks a git push that carries:

- `--force` or `-f`, alone or inside a short-flag bundle;
- `--mirror` (or a prefix of it), which force-updates and deletes every
  remote ref;
- a refspec starting with `+`, a force push of that one ref;
- `-c remote.<name>.push=+...` or a true `-c remote.<name>.mirror`;
- a one-off alias for push (`git -c alias.p='push -f' p`).

`--force-with-lease` and `--force-if-includes` stay allowed: they refuse to
overwrite work the local repo has not seen. The same checks cover git's push
plumbing, `send-pack` and `http-push`, and the dashed `git-push` programs.

The hook reads text, not shell grammar, so no quoting trick changes what it
sees. First it removes what the shell would remove: line continuations,
quotes, backslashes and backticks, decoding Bash's `$'...'` escapes and
PowerShell's `` `u{...} `` on the way. Each command substitution (`$(...)`,
`${...}`, `<(...)`, a Bash backtick pair) is read on its own. The rest is cut
into statements at every newline, `;`, `|` and `&`, quoted or not; the words
of a git command up to the end of its statement are its arguments. Text
inside `eval`, `sh -c`, `pwsh -Command`, a heredoc or a comment is read the
same way, so a force push anywhere in the command's text is found.

That includes text that only mentions a force push: a commit message, a
script or a search pattern with `git push -f` in it is blocked too. The
block message says to put such text in a file and pass the file instead.

The hook only ever blocks or stays silent; it never asks. Out of reach, so
these run without a block:

- a force flag the shell builds at run time (`git push $FLAGS`, `xargs`,
  brace expansion, text piped into a shell or `iex`, `('-q'+'f')`);
- git config or aliases that force a later plain `git push` (`git config
  alias.p 'push -f'`, a `remote.<name>.push` or `mirror` setting,
  `GIT_CONFIG_*` variables, `--config-env`, a shell alias for git);
- remote branch and tag deletions, and a branch deleted and then pushed
  again;
- a push run by another program (`python -c`, `node -e`, `make`, `gh api`);
- a command over MAX_COMMAND characters, and substitutions nested more than
  MAX_PASSES levels deep, whose separators then cut the text around them.

Project deny rules cover some of these by text (`git remote *--mi*`, `gh repo
sync *--force*`). Input that is not JSON and any error while reading a
command let the call through, the same as a hook that timed out.

Setup installs this file as `~/.claude/hooks/push-guard.py` and registers it
in `~/.claude/settings.json`, never in a project's settings: some tools copy
the launcher of existing project hooks into their own hook entries. Setup
registers it only after finding a Python 3.8+ interpreter outside any virtual
environment, naming both the interpreter and this file by absolute path, in
exec form (`command` plus `args`), so no shell and no `python3`/`python`/`py`
guess is involved. It runs through a `runpy` one-liner instead of
`python <path>` because Python exits 2 when it cannot open a script, which
would block every call; through `runpy` a missing file is an ordinary error
and the call proceeds. The interpreter runs with `-I`, so the project
directory (the hook's working directory) is not on the import path and a
repo's own `json.py` cannot replace the modules this file imports.
"""
import json
import re
import sys

# Longer commands pass unread. Reading is linear, so this only bounds the
# work; no real push command comes near it.
MAX_COMMAND = 100000
# Innermost substitutions are cut out one nesting level per pass.
MAX_PASSES = 64

PUSH_SUBCOMMANDS = {"push", "send-pack", "http-push"}
PUSH_PROGRAMS = {"git-push", "git-send-pack", "git-http-push"}
# git options before the subcommand that take their value as the next word.
GIT_VALUE_OPTIONS = {"-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path",
                     "--config-env", "--attr-source", "--super-prefix", "--list-cmds"}

ANSI_QUOTE = re.compile(r"\$'((?:[^'\\]|\\.)*)'", re.S)
POWERSHELL_CHAR = re.compile(r"`u\{([0-9A-Fa-f]{1,6})\}")
# PowerShell runs any `(...)` as its own expression (`("v{0}" -f $n)`).
INNERMOST = {"Bash": re.compile(r"[$<>]\(([^()]*)\)|\$\{([^{}]*)\}"),
             "PowerShell": re.compile(r"[$@]?\(([^()]*)\)|\$\{([^{}]*)\}")}
BACKTICK_GROUP = re.compile(r"`([^`]*)`")
# A lone carriage return ends a statement only in PowerShell.
STATEMENT_END = {"Bash": re.compile(r"[\n;|&]"), "PowerShell": re.compile(r"[\n\r;|&]")}
WORD_SPLIT = re.compile(r"[\s<>,]+")
# A redirect operator not right after a quote, and its target.
REDIRECT = re.compile(r"""(?<!["'])[0-9]*(?:&>>?|>&|<&|>>?\|?|<)\s*(?:"[^"]*"|'[^']*'|[^\s;|&<>"']+)?""")
EDGE = "(){}[]$&!@"
SHORT_FORCE = re.compile(r"-[A-Za-z]*f[A-Za-z]*")
LONG_FORCE = re.compile(r"--force(?:=.*)?|--m(?:i(?:r(?:r(?:o(?:r)?)?)?)?)?")
FORCING_CONFIG = re.compile(r"remote\..+\.push=\+.*|remote\..+\.mirror(?:=(?:true|yes|on|1))?", re.I)
PUSH_ALIAS = re.compile(r"alias\.[^=]+=!?(?:push|send-pack|http-push)", re.I)


def ansi_decode(match):
    """The text of Bash's `$'...'`, with its backslash escapes decoded."""
    body = match.group(1)
    try:
        return body.encode("latin-1", "backslashreplace").decode("unicode_escape")
    except UnicodeDecodeError:
        return body


def stand_in(match):
    """The word a substitution leaves in the text around it: `git` when it
    names git (`& ("git") push`, `$(which git) push`), otherwise a plain word."""
    inner = unquote(next(g for g in match.groups() if g is not None), "path")
    return " git " if re.search(r"(?i)\bgit(?:\.exe)?\s*$", inner) else " x "


def texts(command, tool):
    """The command's pieces with quoting removed: each command substitution
    on its own, then the rest with each substitution replaced by a word."""
    s = re.sub(r"\\\r?\n|`\r?\n|`\r", "", command)
    if tool != "PowerShell":
        s = ANSI_QUOTE.sub(ansi_decode, s)
    s = POWERSHELL_CHAR.sub(lambda m: chr(min(int(m.group(1), 16), 0x10FFFF)), s)
    pieces = []
    if tool != "PowerShell":
        pieces += BACKTICK_GROUP.findall(s)
        s = BACKTICK_GROUP.sub(stand_in, s)
    for _ in range(MAX_PASSES):
        found = INNERMOST[tool].findall(s)
        if not found:
            break
        pieces += [a or b for a, b in found]
        s = INNERMOST[tool].sub(stand_in, s)
    pieces.append(s)
    return pieces


def unquote(text, backslash):
    """The text without quote characters, backticks and `$` before a quote;
    a backslash is dropped (an escape) or read as a path separator."""
    text = re.sub(r"\$(?=[\"'])", "", text)
    text = re.sub("[\"'`‘’“”]", "", text)
    return text.replace("\\", "/" if backslash == "path" else "")


def name(word):
    """The program a word names: its last path part, lowercased, without
    `.exe`."""
    return re.sub(r"\.exe$", "", word.strip(EDGE).split("/")[-1].lower())


def force_in(words):
    """Why the words of one statement force-push, or None."""
    pushing, forcing, i = False, None, 0
    while i < len(words):
        word = words[i].strip(EDGE)
        if pushing:
            if SHORT_FORCE.fullmatch(word) or LONG_FORCE.fullmatch(word):
                return f"`{word}`"
            if word.startswith("+") and len(word) > 1:
                return f"`{word}` (a leading + forces that ref)"
            i += 1
            continue
        program = name(word)
        if program in PUSH_PROGRAMS:
            pushing = True
        elif program == "git":
            # Walk git's own options to its subcommand.
            i += 1
            while i < len(words) and words[i].startswith("-"):
                option = words[i]
                value = words[i + 1] if i + 1 < len(words) else ""
                i += 2 if option in GIT_VALUE_OPTIONS else 1
                if option == "-c" and FORCING_CONFIG.fullmatch(value):
                    forcing = f"`-c {value}`"
                if option == "-c" and PUSH_ALIAS.fullmatch(value):
                    # A one-off alias for push: every later word may be its
                    # argument (`-c alias.p='push -f' p`).
                    pushing = True
                    break
            if pushing or (i < len(words) and name(words[i]) in PUSH_SUBCOMMANDS):
                pushing = True
                if forcing:
                    return forcing
            continue
        i += 1
    return None


def check(command, tool):
    """Why a command's text force-pushes, or None."""
    if len(command) > MAX_COMMAND:
        return None
    for piece in texts(command, tool):
        # A redirect and its target go first, so `git>/dev/null push` and
        # `push&>/dev/null` read as `git push`; a quoted `>` is text.
        piece = REDIRECT.sub(" ", piece)
        # A substitution the passes could not cut out (a `case` pattern's `)`
        # inside it, or nesting past MAX_PASSES) may hide separators, so its
        # piece is also read as one statement.
        opener = r"\(|\$\{" if tool == "PowerShell" else r"[$<>]\(|\$\{"
        whole = re.search(opener, piece) is not None or piece.count(")") > piece.count("(")
        for backslash in ("escape", "path"):
            text = unquote(piece, backslash)
            for statement in STATEMENT_END[tool].split(text) + ([text] if whole else []):
                reason = force_in([w for w in WORD_SPLIT.split(statement) if w])
                if reason:
                    return reason
    return None


def main():
    try:
        # Claude Code writes UTF-8. Decode it as UTF-8 instead of the platform's
        # default encoding.
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
    except ValueError:
        return 0
    tool = data.get("tool_name") if isinstance(data, dict) else None
    if tool not in ("Bash", "PowerShell"):
        return 0
    try:
        reason = check((data.get("tool_input") or {}).get("command") or "", tool)
    except Exception:
        # An error is not a certain force push.
        return 0
    if reason:
        print(f"Blocked a force push: {reason}. Use `--force-with-lease` instead, which refuses "
              "to overwrite commits you have not fetched. If the command only mentions a force "
              "push (a message, a script, a search), put that text in a file and pass the file.",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
