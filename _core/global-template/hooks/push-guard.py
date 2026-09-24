"""PreToolUse hook: block force pushes that permission rules cannot see.

Permission rules match command text, so `-f` bundled with other short flags
(`-qf`, `-vf`, `-uqf`) escapes them. This hook reads the arguments of every
`git push` in a Bash or PowerShell command and blocks:

- `--force` and `-f`, alone or inside a short-flag bundle;
- `--mirror`, which force-updates and deletes every remote ref;
- a refspec starting with `+` (a force push of that one ref).

`--force-with-lease` and `--force-if-includes` stay allowed: they refuse to
overwrite work the local repo has not seen.

The hook only reads plain commands: words, quotes, escapes and the `&&`, `||`,
`;`, `|`, `&` and newline separators. A command that mentions a push and uses
anything else (variables, command or process substitution, here-documents,
braces, globs, comments, PowerShell splatting and here-strings) gets an
approval prompt instead of a guess, and so does a plain command whose push it
cannot place. It blocks with exit 2 only when it is certain. Every doubt ends
in a prompt, never in a silent pass, which is what makes a global `git push`
allow rule safe next to it. An internal error lets the call through, and the
project's deny rules still apply.

Setup installs this file as `~/.claude/hooks/push-guard.py` and registers it
in `~/.claude/settings.json`, never in a project's settings: some tools copy
the launcher of existing project hooks into their own hook entries. Setup
registers it only after finding a Python 3.8+ interpreter outside any virtual
environment, naming both the interpreter and this file by absolute path, in
exec form (`command` plus `args`), so no shell and no `python3`/`python`/`py`
guess is involved. It runs through a `runpy` one-liner instead of
`python <path>` because Python exits 2 when it cannot open a script, which
would block every call; through `runpy` a missing file is an ordinary error
and the call proceeds.
"""
import json
import re
import shlex
import sys

# git options that take their value as the next argument.
GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
                     "--config-env", "--attr-source"}
PUSH_VALUE_OPTIONS = {"--repo", "--push-option", "--receive-pack", "--exec"}
# Words that can stand before a command without changing which program runs.
PREFIXES = {"sudo", "env", "command", "builtin", "nice", "nohup", "time", "timeout", "stdbuf", "noglob",
            "exec", "xargs", "do", "then", "else", "elif", "!", "&"}


def join_lines(command, tool):
    """Drop line continuations (the escape character before a newline, outside
    single quotes), as the shell does before it reads the words."""
    escape = "`" if tool == "PowerShell" else "\\"
    out, quote, i, n = [], None, 0, len(command)
    while i < n:
        ch = command[i]
        if ch == escape and quote != "'" and i + 1 < n:
            rest = command[i + 1:i + 3]
            if rest.startswith("\n") or rest == "\r\n":
                i += 2 if rest.startswith("\n") else 3
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
    """Split a command at unquoted separators. Returns the segments and whether
    the command is plain, meaning it uses no syntax that can run or produce
    words this hook does not see."""
    escape = "`" if tool == "PowerShell" else "\\"
    parts, current, quote, plain, i, n = [], [], None, True, 0, len(command)
    while i < n:
        ch = command[i]
        if ch == escape and quote != "'" and i + 1 < n:
            current.append(command[i:i + 2])
            i += 2
            continue
        # Expansion and substitution work inside double quotes too.
        if quote != "'" and (ch == "$" or (ch == "`" and tool != "PowerShell")):
            plain = False
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch in "{}*?[#" or (ch == "@" and tool == "PowerShell") or command.startswith(("<<", "<(", ">("), i):
            plain = False
        elif command.startswith(("&&", "||"), i):
            parts.append("".join(current))
            current = []
            i += 2
            continue
        elif ch in ";|\n" or (ch == "&" and tool != "PowerShell" and command[i - 1:i] not in "<>"
                               and command[i + 1:i + 2] != ">"):
            parts.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    parts.append("".join(current))
    return parts, plain and quote is None


def words(segment, tool):
    """Shell words of one segment, or None when its quotes do not balance."""
    lexer = shlex.shlex(segment, posix=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    if tool == "PowerShell":
        lexer.escape = "`"
    try:
        return list(lexer)
    except ValueError:
        return None


def program(token):
    """The program a word names: `/usr/bin/git`, `(git` and `GIT.EXE` are all git."""
    name = token.lstrip("(").replace("\\", "/").split("/")[-1].lower()
    return re.sub(r"\.exe$", "", name)


def push_args(tokens):
    """The arguments after `push` when the tokens run `git push`, else None."""
    i = 0
    while i < len(tokens) and (tokens[i] in PREFIXES or tokens[i] == "(" or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tokens[i])):
        i += 1
    if i >= len(tokens) or program(tokens[i]) != "git":
        return None
    i += 1
    while i < len(tokens) and tokens[i].startswith("-"):
        i += 2 if tokens[i] in GIT_VALUE_OPTIONS else 1
    if i < len(tokens) and tokens[i] == "push":
        return tokens[i + 1:]
    return None


def force_reason(args):
    positional, i, only_refs = [], 0, False
    while i < len(args):
        arg = args[i]
        if only_refs or not arg.startswith("-") or arg == "-":
            positional.append(arg)
        elif arg == "--":
            only_refs = True
        elif arg.startswith("--"):
            name = arg.split("=", 1)[0]
            if name == "--force":
                return "`--force`"
            # git accepts any unambiguous prefix of a long option, and no other
            # push option starts with `--m`. (Every prefix of `--force` is
            # ambiguous with `--force-with-lease`, so only the full name counts.)
            if len(name) >= 3 and "--mirror".startswith(name):
                return f"`{arg}` (mirror force-updates and deletes remote refs)"
            if name in PUSH_VALUE_OPTIONS and "=" not in arg:
                i += 1
        else:
            for pos, letter in enumerate(arg[1:]):
                if letter == "f":
                    return f"`{arg}` (includes -f)"
                if letter == "o":
                    if pos == len(arg) - 2:
                        i += 1
                    break
        i += 1
    # The first positional is the repository even after `--` (git push
    # [<options>] [<repository> [<refspec>...]]), so refspecs start at [1].
    for ref in positional[1:]:
        if ref.startswith("+"):
            return f"`{ref}` (a leading + forces that ref)"
    return None


def mentions_push(text):
    return bool(re.search(r"\bgit", text, re.I) and re.search(r"\bpush\b", text, re.I))


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    tool = data.get("tool_name")
    if tool not in ("Bash", "PowerShell"):
        return 0
    command = join_lines((data.get("tool_input") or {}).get("command") or "", tool)
    if not re.search(r"\bpush\b", command, re.I):
        return 0
    parts, plain = scan(command, tool)
    unsure = not plain
    if plain:
        for segment in parts:
            tokens = words(segment, tool)
            args = push_args(tokens) if tokens is not None else None
            if args is not None:
                reason = force_reason(args)
                if reason:
                    print(f"Blocked a force push: {reason}. Use `--force-with-lease` instead, "
                          "which refuses to overwrite commits you have not fetched.", file=sys.stderr)
                    return 2
            elif tokens is None or any(t.lower() == "push" or mentions_push(t) for t in tokens):
                unsure = True
    if unsure:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": "This command mentions a git push the push guard could not read with certainty, so it needs approval.",
        }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
