"""PreToolUse hook: block force pushes that permission rules cannot see.

Permission rules match command text, so `-f` bundled with other short flags
(`-qf`, `-vf`, `-uqf`) escapes them. This hook reads the arguments of every
`git push` in a Bash or PowerShell command and blocks:

- `--force` and `-f`, alone or inside a short-flag bundle;
- `--mirror`, which force-updates and deletes every remote ref;
- a refspec starting with `+` (a force push of that one ref);
- `-c remote.<name>.push=+...` or `-c remote.<name>.mirror=...` on the push itself;
- a one-off alias that forces (`git -c alias.p='push -f' p`);
- a push of a branch the same command deleted (`git push origin --delete
  main && git push origin main`), which drops remote commits like a force push.

`--force-with-lease` and `--force-if-includes` stay allowed: they refuse to
overwrite work the local repo has not seen. The same checks cover git's push
plumbing, `send-pack` and `http-push`.

The hook only ever blocks or stays silent; it never asks. Every other command
runs exactly as it would without the hook, so it adds no prompts to normal
work. It blocks only what it can read for certain: a `git push` anywhere in a
statement, also after wrappers such as `sudo -u me` or `timeout 5`, inside a
`(...)`, `$(...)` or `{ ...; }` group, after an assignment, or inside a
literal command string (`sh -c '...'`, `pwsh -Command '...'`, `eval '...'`),
with a force flag among its own words. Text that only prints or commits
(`echo`, `printf`, `git commit`, without a redirect) is never read as a push,
and neither are comments.

Out of reach, so these run without a block:

- a command this hook cannot split into statements for certain: one with a
  heredoc (`<<`), a PowerShell here-string, block comment or `--%`,
  unbalanced quotes, or, in PowerShell, characters outside ASCII;
- a force flag the shell builds at run time (`git push $FLAGS`, `xargs`,
  brace expansion, text piped into a shell or `iex`);
- git config or aliases that force a later plain `git push` (`git config
  alias.p 'push -f'`, a `remote.<name>.push` or `mirror` setting, `GIT_CONFIG_*`
  variables, a shell alias for git);
- a branch deleted in one command and pushed again in another;
- a push run by another program (`python -c`, `node -e`, `make`, `gh api`).

Project deny rules cover some of these by text (`git remote *--mi*`, `gh repo
sync *--force*`). Input that is not JSON, a command over MAX_COMMAND
characters and any error while reading a command all let the call through,
the same as a hook that timed out.

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
import shlex
import sys

# Longer commands pass without being parsed, so parsing never approaches the
# hook timeout; no plain push needs more.
MAX_COMMAND = 20000
# git subcommands and programs that push. `send-pack` and `http-push` are the
# plumbing under `git push`, with their own `--force`.
PUSH_SUBCOMMANDS = {"push", "send-pack", "http-push"}
PUSH_PROGRAMS = {"git-push", "git-send-pack", "git-http-push"}
# git options that take their value as the next argument.
GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
                     "--config-env", "--attr-source"}
PUSH_VALUE_OPTIONS = {"--repo", "--push-option", "--receive-pack", "--exec"}
DATA_COMMANDS = {"echo", "printf", "write-output", "write-host"}
# Programs that run a literal command string, read again as a nested command.
SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
POWERSHELLS = {"pwsh", "powershell"}
EVAL_COMMANDS = {"eval", "invoke-expression", "iex"}
MAX_DEPTH = 3


def join_lines(command, tool):
    """Drop line continuations (the escape character before a newline, outside
    single quotes), as the shell does before it reads the words."""
    escape = "`" if tool == "PowerShell" else "\\"
    out, quote, i, n = [], None, 0, len(command)
    while i < n:
        ch = command[i]
        if ch == escape and quote != "'" and i + 1 < n:
            rest = command[i + 1:i + 3]
            # Bash joins only backslash + LF: backslash + CR is an escaped CR, so the
            # LF after it still ends the command. PowerShell joins a backtick
            # before LF, CRLF or a lone CR.
            if rest.startswith("\n") or (tool == "PowerShell" and rest.startswith("\r")):
                i += 3 if rest == "\r\n" else 2
                continue
            out.append(command[i:i + 2])
            i += 2
            continue
        if quote and ch == quote:
            quote = None
        elif not quote and ch in "'\"":
            quote = ch
        out.append(ch)
        i += 1
    return "".join(out)


def scan(command, tool):
    """Split a command at unquoted separators and drop comments. Returns the
    segments and whether the split is certain: a heredoc, a PowerShell
    here-string or `--%`, or quotes that never close make it uncertain."""
    escape = "`" if tool == "PowerShell" else "\\"
    parts, current, quote, readable, i, n = [], [], None, True, 0, len(command)
    while i < n:
        ch = command[i]
        if ch == escape and quote != "'" and i + 1 < n:
            current.append(command[i:i + 2])
            i += 2
            continue
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            if tool == "PowerShell" and command[i - 1:i] == "@":
                readable = False
            quote = ch
        elif command.startswith("<<", i) or (tool == "PowerShell" and command.startswith("<#", i)):
            readable = False
        # A `#` that starts a word starts a comment, which runs to the end of the line.
        elif ch == "#" and (i == 0 or command[i - 1] in " \t\r\n;|&("):
            while i < n and command[i] != "\n":
                i += 1
            continue
        elif command.startswith(("&&", "||"), i):
            parts.append("".join(current))
            current = []
            i += 2
            continue
        # A lone `&` ends a statement in both shells (in PowerShell 7 it starts a
        # background job), except inside a redirect like `2>&1` and, in
        # PowerShell, as the call operator at the start of a statement. A lone
        # carriage return also ends a PowerShell statement.
        elif (ch in ";|\n" or (ch == "\r" and tool == "PowerShell")
              or (ch == "&" and command[i - 1:i] not in "<>" and command[i + 1:i + 2] != ">"
                  and (tool != "PowerShell" or "".join(current).strip()))):
            parts.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    parts.append("".join(current))
    # PowerShell also reads curly quotes as quotes and Unicode spaces, vertical
    # tab and form feed as whitespace; shlex does not.
    if tool == "PowerShell" and re.search(r"[^\x00-\x7f]|[\v\f]", command):
        readable = False
    # After `--%` PowerShell passes the rest of the line to the program as is,
    # separators included.
    if tool == "PowerShell" and "--%" in command:
        readable = False
    return parts, readable and quote is None


def words(segment, tool):
    """Shell words of one segment, or None when its quotes do not balance."""
    if tool == "PowerShell":
        segment = powershell_quotes(segment)
    lexer = shlex.shlex(segment, posix=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    if tool == "PowerShell":
        lexer.escape = "`"
        # An unquoted comma builds an array, and PowerShell passes each element
        # to a native program as its own argument: `main,-qf` is `main -qf`.
        lexer.whitespace += ","
    try:
        return list(lexer)
    except ValueError:
        return None


def powershell_quotes(text):
    """Inside PowerShell double quotes a backtick before anything but an escape
    code (`0 a b e f n r t v`, a quote, a backtick or `$`) is dropped, so
    "`-qf" reaches git as -qf. shlex would keep that backtick; drop it first."""
    out, quote, i = [], None, 0
    while i < len(text):
        ch = text[i]
        if quote == '"' and ch == "`" and i + 1 < len(text) and text[i + 1] not in '0abefnrtv"`$':
            i += 1
            continue
        if quote == '"' and ch == "`" and i + 1 < len(text):
            out.append(text[i:i + 2])
            i += 2
            continue
        if quote is None and ch == "`" and i + 1 < len(text):
            out.append(text[i:i + 2])
            i += 2
            continue
        if quote and ch == quote:
            quote = None
        elif not quote and ch in "'\"":
            quote = ch
        out.append(ch)
        i += 1
    return "".join(out)


def program(token):
    """The program a word names: `/usr/bin/git`, `(git`, `GIT.EXE`, `$(git`,
    `x=$(git`, `<(git` and, after PowerShell's call operator, `&git` and
    `("git")` are all git. A redirect glued to the name ends it, as in the
    shell: `git>/dev/null` is git."""
    token = re.sub(r"^(?:[A-Za-z_][A-Za-z0-9_]*=)?[$`(&<>]+", "", token)
    name = re.split(r"[<>&]", token, 1)[0].rstrip(")")
    name = name.replace("\\", "/").split("/")[-1].lower()
    return re.sub(r"\.exe$", "", name)


def push_reason(tokens, deleted):
    """Why the first push in the tokens forces, or None. Every git word is
    checked, not only the first word, so wrappers with their own options
    (`sudo -u me`, `timeout 5`, `nice -n 5`, `command -p`) and shell keywords
    (`case x in a)`) cannot hide a push. `deleted` collects the branches
    deleted so far in the command."""
    for k, token in enumerate(tokens):
        # `git-push` (git's libexec program) is push itself.
        if program(token) in PUSH_PROGRAMS:
            return check_push(tokens[k + 1:], deleted)
        if program(token) != "git":
            continue
        i, config = k + 1, []
        while i < len(tokens) and tokens[i].startswith("-"):
            if tokens[i] == "-c" and i + 1 < len(tokens):
                config.append(tokens[i + 1])
            i += 2 if tokens[i] in GIT_VALUE_OPTIONS else 1
        if i >= len(tokens):
            continue
        # A redirect glued to the subcommand ends it: `push>/dev/null` is push.
        name, args = re.split(r"[<>&]", tokens[i], 1)[0], tokens[i + 1:]
        # A one-off alias (`-c alias.p='push -f'`, or `'!git push -f'`) runs
        # its words in place of the alias name.
        for setting in config:
            alias = re.match(r"(?i)alias\.([^=]+)=!?\s*(?:git\s+)?(.*)", setting, re.S)
            if alias and alias.group(1) == name and alias.group(2).split():
                expanded = alias.group(2).split()
                name, args = expanded[0], expanded[1:] + args
        if name in PUSH_SUBCOMMANDS:
            for setting in config:
                if re.match(r"(?i)remote\.[^=]+\.(push=\s*\+|mirror(=|$))", setting):
                    return f"`-c {setting}` (a forcing push setting)"
            return check_push(args, deleted)
    return None


def check_push(args, deleted):
    reason, refs, delete = force_reason(args)
    if reason:
        return reason
    # The first positional is the repository even after `--` (git push
    # [<options>] [<repository> [<refspec>...]]), so refspecs start at [1].
    for ref in refs[1:]:
        target = re.sub(r"^refs/heads/", "", ref.split(":")[-1])
        if delete or ref.startswith(":"):
            deleted.add(target)
        elif target in deleted:
            # Deleting a branch and pushing it again drops the remote's commits
            # the same way a force push does.
            return f"`{ref}` (pushes again a branch this command deleted)"
    return None


def force_reason(args):
    """The force flag or `+` refspec in a push's arguments, or None; plus the
    positional arguments and whether the push deletes (`--delete`, `-d`)."""
    positional, i, only_refs, delete = [], 0, False, False
    while i < len(args):
        arg = args[i]
        # A redirect (`2>&1`, `>out.txt`, or `>` before a file name) is no argument.
        if re.search(r"[<>]", arg):
            i += 2 if re.fullmatch(r"\d*[<>]+[&|]?", arg) else 1
            continue
        if only_refs or not arg.startswith("-") or arg == "-":
            positional.append(arg)
        elif arg == "--":
            only_refs = True
        elif arg.startswith("--"):
            name = arg.split("=", 1)[0]
            if name == "--force":
                return "`--force`", positional, delete
            # git accepts any unambiguous prefix of a long option, and no other
            # push option starts with `--m`. (Every prefix of `--force` is
            # ambiguous with `--force-with-lease`, so only the full name counts.)
            if len(name) >= 3 and "--mirror".startswith(name):
                return f"`{arg}` (mirror force-updates and deletes remote refs)", positional, delete
            if len(name) >= 4 and "--delete".startswith(name):
                delete = True
            if name in PUSH_VALUE_OPTIONS and "=" not in arg:
                i += 1
        else:
            for pos, letter in enumerate(arg[1:]):
                if letter == "f":
                    return f"`{arg}` (includes -f)", positional, delete
                if letter == "d":
                    delete = True
                if letter == "o":
                    if pos == len(arg) - 2:
                        i += 1
                    break
        i += 1
    for ref in positional[1:]:
        if ref.startswith("+"):
            return f"`{ref}` (a leading + forces that ref)", positional, delete
    return None, positional, delete


def only_data(segment, tokens):
    """Commands that print or commit without writing a file: their arguments
    are text, never a push. A redirect makes them write, and in PowerShell a
    `(...)` argument runs as a command (`Write-Output (git push -qf)`), so
    neither counts."""
    if re.search(r"[>(]", segment):
        return False
    if tokens[0].lower() in DATA_COMMANDS:
        return True
    return tokens[:2] == ["git", "commit"]


def nested_reason(tokens, tool, depth):
    """A literal command string that another shell or `eval` runs:
    `sh -c '...'`, `bash -lc '...'`, `pwsh -Command '...'`, `eval '...'`,
    `Invoke-Expression '...'`, also after wrappers (`bundle exec sh -c`)."""
    for k, token in enumerate(tokens):
        name, rest = program(token), tokens[k + 1:]
        inner = None
        if name in EVAL_COMMANDS and rest:
            inner, inner_tool = " ".join(rest), tool
        elif name in SHELLS and len(rest) > 1 and re.fullmatch(r"-[a-z]*c", rest[0]):
            inner, inner_tool = rest[1], "Bash"
        elif name in POWERSHELLS:
            flag = next((j for j, t in enumerate(rest) if re.fullmatch(r"(?i)-c(o(m(m(a(nd?)?)?)?)?)?", t)), None)
            if flag is not None and flag + 1 < len(rest):
                inner, inner_tool = " ".join(rest[flag + 1:]), "PowerShell"
        if inner is not None:
            reason = check(inner, inner_tool, depth + 1)
            if reason:
                return reason
    return None


def check(command, tool, depth=0):
    """Why a command certainly force-pushes, or None."""
    command = join_lines(command, tool)
    # Quotes and escapes inside a word (`pu''sh`) are removed by the shell.
    if not re.search(r"push|send-pack", re.sub(r"[\"'`\\]", "", command), re.I) or len(command) > MAX_COMMAND:
        return None
    parts, readable = scan(command, tool)
    if not readable:
        return None
    deleted = set()
    for part in parts:
        tokens = words(part, tool)
        # A print or commit only carries push text; it never runs it.
        if not tokens or only_data(part, tokens):
            continue
        reason = push_reason(tokens, deleted) or (depth < MAX_DEPTH and nested_reason(tokens, tool, depth))
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
        # The guard only blocks what it reads for certain; an error is not certain.
        return 0
    if reason:
        print(f"Blocked a force push: {reason}. Use `--force-with-lease` instead, "
              "which refuses to overwrite commits you have not fetched.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
