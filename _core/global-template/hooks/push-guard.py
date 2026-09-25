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
`${...}`, `<(...)`, a Bash backtick pair, a PowerShell `(...)`) is read on
its own. The rest is cut into statements at every newline, and at every
`;`, `|` and `&` outside a quoted string that closes on its own line;
redirects and their targets are dropped. After a `git` word, a later push
word in the same statement starts the push, and the words after it are its
arguments. Text inside `eval`, `sh -c`, `pwsh -Command`, a heredoc or a
comment is read the same way, so a force push anywhere in the command's
text is found. Every step is linear in the command's length.

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
- a push after a spaced git option value whose later word is exactly a git
  subcommand in OTHER_SUBCOMMANDS (`git -C "My notes" push -f`): the search
  for the push word stops there;
- a push split from its `git` word by a `;`, `|` or `&` inside a quoted
  string that spans lines;
- a command over MAX_COMMAND characters.

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

# Longer commands pass unread. Every step below is linear in the command's
# length, so this only bounds the work; no real push command comes near it.
MAX_COMMAND = 100000
# Innermost substitutions are cut out one nesting level per pass.
MAX_PASSES = 64

PUSH_SUBCOMMANDS = {"push", "send-pack", "http-push"}
PUSH_PROGRAMS = {"git-push", "git-send-pack", "git-http-push"}
# git subcommands that never push; after one, a later push word is its text.
OTHER_SUBCOMMANDS = {
    "add", "am", "apply", "archive", "bisect", "blame", "branch", "bundle", "cat-file", "checkout",
    "cherry-pick", "clean", "clone", "commit", "config", "describe", "diff", "fetch", "for-each-ref",
    "format-patch", "gc", "grep", "help", "init", "log", "ls-files", "ls-remote", "merge", "mv",
    "notes", "pull", "rebase", "reflog", "remote", "reset", "restore", "rev-list", "rev-parse",
    "revert", "rm", "shortlog", "show", "stash", "status", "submodule", "switch", "tag", "worktree"}
# git's own options that take the next word as their value; that word is
# never the subcommand (`git -C ../notes push -f`).
GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
                     "--super-prefix", "--config-env", "--attr-source"}

ANSI_QUOTE = re.compile(r"\$'((?:[^'\\]|\\.)*)'", re.S)
POWERSHELL_CHAR = re.compile(r"`u\{([0-9A-Fa-f]{1,6})\}")
CASE_WORD = re.compile(r"\b(?:case|esac)\b")
# PowerShell runs any `(...)` as its own expression (`("v{0}" -f $n)`).
INNERMOST = {"Bash": re.compile(r"[$<>]\(([^()]*)\)|\$\{([^{}]*)\}"),
             "PowerShell": re.compile(r"[$@]?\(([^()]*)\)|\$\{([^{}]*)\}")}
BACKTICK_GROUP = re.compile(r"`([^`]*)`")
# A quoted string that closes on the line it opens on.
QUOTED = {"Bash": re.compile(r"\"(?:[^\"\\\n]|\\.)*\"|'[^'\n]*'"),
          "PowerShell": re.compile(r"\"(?:[^\"`\n]|`.)*\"|'[^'\n]*'")}
# A lone carriage return ends a statement only in PowerShell.
STATEMENT_END = {"Bash": re.compile(r"[\n;|&]"), "PowerShell": re.compile(r"[\n\r;|&]")}
WORD_SPLIT = re.compile(r"[\s<>,]+")
# A redirect operator and its target, read once quotes are gone. A target
# never starts with `-`, so `--repo=">" -qf` keeps its flag.
REDIRECT = re.compile(r"(?<![0-9])[0-9]*(?:&>>?|>&|<&|>>?\|?|<)[ \t]*(?:[^\s;|&<>\-][^\s;|&<>]*)?")
EDGE = "(){}[]$&!@"
SHORT_OPTIONS = re.compile(r"-[A-Za-z0-9]+")
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


def neutral_cases(text):
    """The text with the parentheses between each Bash `case` and the `esac`
    that closes it turned into spaces, so a pattern's `)` never closes a
    substitution around it. What sat inside stays in the text around it and
    is read there. A `case` with no `esac` (the word in a message) changes
    nothing."""
    spans, opened = [], []
    for match in CASE_WORD.finditer(text):
        if match.group(0) == "case":
            opened.append(match.start())
        elif opened:
            start = opened.pop()
            if not opened:
                spans.append((start, match.end()))
    out, last = [], 0
    for start, end in spans:
        out += [text[last:start], text[start:end].replace("(", " ").replace(")", " ")]
        last = end
    out.append(text[last:])
    return "".join(out)


def stand_in(match):
    """The word a substitution leaves in the text around it: `git` when it
    names git (`& ("git") push`, `$(which git) push`), otherwise a plain word."""
    inner = unquote(next(g for g in match.groups() if g is not None), "path")
    return " git " if re.search(r"(?i)\bgit(?:\.exe)?\s*$", inner) else " x "


def texts(command, tool):
    """The command's pieces: each command substitution on its own, then the
    rest with each substitution replaced by a word; and whether substitutions
    are nested past MAX_PASSES."""
    s = re.sub(r"\\\r?\n|`\r?\n|`\r", "", command)
    if tool != "PowerShell":
        s = neutral_cases(ANSI_QUOTE.sub(ansi_decode, s))
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
    return pieces, INNERMOST[tool].search(s) is not None


def mask_quoted(text, tool):
    """The text with `;`, `|` and `&` inside quotes turned into spaces, so a
    quoted value (`-C "C:/R&D"`) stays in its statement. Only a quote that
    closes on its own line counts, so neither an apostrophe in a heredoc
    body or comment nor the closing quote of a string that spans lines can
    join statements."""
    return QUOTED[tool].sub(lambda m: re.sub(r"[;|&]", " ", m.group(0)), text)


def unquote(text, backslash):
    """The text without quote characters, backticks and `$` before a quote;
    a backslash is dropped (an escape) or read as a path separator."""
    text = re.sub(r"\$(?=[\"'])", "", text)
    text = re.sub("[\"'`\u2018\u2019\u201c\u201d]", "", text)
    return text.replace("\\", "/" if backslash == "path" else "")


def name(word):
    """The program a word names: its last path part, lowercased, without
    `.exe`."""
    return re.sub(r"\.exe$", "", word.strip(EDGE).split("/")[-1].lower())


def forces(word):
    """Whether one push argument forces: `--force`, a `--mirror` prefix, or a
    short-option bundle with `f` in it (`-qf`, `-4f`)."""
    if word.startswith("--"):
        return LONG_FORCE.fullmatch(word) is not None
    return "f" in word and SHORT_OPTIONS.fullmatch(word) is not None


def force_in(words):
    """Why the words of one statement force-push, or None. After a `git`
    word, a later push word starts the push, whatever sits between them: an
    option value split at its spaces (`-C "/c/My Repo"`) or a substitution's
    stand-in word. So does a one-off alias for push (`-c alias.p='push -f'
    p`), whose arguments follow its name. A word that is exactly a git
    subcommand in OTHER_SUBCOMMANDS, and is not the value of a git option,
    ends the search."""
    git, pushing, forcing, value = False, False, None, False
    for raw in words:
        word = raw.strip(EDGE)
        if pushing:
            if forces(word):
                return f"`{word}`"
            if word.startswith("+") and len(word) > 1:
                return f"`{word}` (a leading + forces that ref)"
            continue
        if value:
            value = False
            if FORCING_CONFIG.fullmatch(word):
                forcing = f"`-c {word}`"
            elif PUSH_ALIAS.fullmatch(word):
                pushing = True
            continue
        program = name(word)
        if program in PUSH_PROGRAMS:
            pushing = True
        elif program == "git":
            git = True
        elif not git:
            continue
        elif word in GIT_VALUE_OPTIONS:
            value = True
        elif FORCING_CONFIG.fullmatch(word):
            forcing = f"`-c {word}`"
        elif program in PUSH_SUBCOMMANDS or PUSH_ALIAS.fullmatch(word):
            if forcing:
                return forcing
            pushing = True
        elif word in OTHER_SUBCOMMANDS:
            # Another git command: its arguments are its own (`git commit -m
            # "push -f later"`).
            git, forcing = False, None
    return None


def check(command, tool):
    """Why a command's text force-pushes, or None."""
    if len(command) > MAX_COMMAND:
        return None
    pieces, deep = texts(command, tool)
    for piece in pieces:
        masked = mask_quoted(piece, tool)
        for backslash in ("escape", "path"):
            # Redirects go once quotes are gone, so `git>/dev/null push` and
            # `push&>/dev/null` read as `git push`.
            text = REDIRECT.sub(" ", unquote(masked, backslash))
            # Substitutions nested past MAX_PASSES may hide separators, so such
            # a command is also read as one statement.
            for statement in STATEMENT_END[tool].split(text) + ([text] if deep else []):
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
