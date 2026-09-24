"""PreToolUse hook: block force pushes that permission rules cannot see.

Permission rules match command text, so `-f` bundled with other short flags
(`-qf`, `-vf`, `-uqf`) escapes them. This hook reads the arguments of every
`git push` in a Bash or PowerShell command and blocks:

- `--force` and `-f`, alone or inside a short-flag bundle;
- `--mirror`, which force-updates and deletes every remote ref;
- a refspec starting with `+` (a force push of that one ref).

`--force-with-lease` and `--force-if-includes` stay allowed: they refuse to
overwrite work the local repo has not seen.

Exit 2 blocks the call and shows the reason to Claude. When a command holds a
`git push` the hook cannot read with confidence (inside a loop body it does not
parse, after an unknown prefix, or with unbalanced quotes), it asks for
approval instead of guessing, so a missed force push reaches the permission
prompt rather than a global `git push` allow rule. Any other outcome,
including an internal error, lets the call through, and the project's deny
rules still apply.

Setup installs this file as `~/.claude/hooks/push-guard.py` and registers it
in `~/.claude/settings.json`, never in a project's settings: some tools copy
the launcher of existing project hooks into their own hook entries. Setup
registers it only after finding a Python 3.8+ interpreter, naming both the
interpreter and this file by absolute path, in exec form (`command` plus
`args`), so no shell and no `python3`/`python`/`py` guess is involved. It runs
through a `runpy` one-liner instead of `python <path>` because Python exits 2
when it cannot open a script, which would block every call; through `runpy` a
missing file is an ordinary error and the call proceeds.
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
            "exec", "xargs", "do", "then", "else", "elif", "!", "{", "&"}
HEREDOC = re.compile(r"<<(-?)[ \t]*(['\"]?)([A-Za-z0-9_.-]+)\2")


def segments(command, tool):
    """Split a command where the shell would: at unquoted `&&`, `||`, `;`, `|`
    and newlines. Escapes and comments are honored, and here-document and
    PowerShell here-string bodies are skipped, since they are text, not
    commands."""
    escape = "`" if tool == "PowerShell" else "\\"
    parts, current, quote, pending, i, n = [], [], None, [], 0, len(command)
    while i < n:
        ch = command[i]
        if ch == escape and quote != "'" and i + 1 < n:
            current.append(command[i:i + 2])
            i += 2
            continue
        if quote:
            current.append(ch)
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
            current.append(ch)
        elif ch == "#" and (not current or current[-1][-1:].isspace()):
            while i < n and command[i] != "\n":
                i += 1
            continue
        elif tool == "PowerShell" and command.startswith(("@'", '@"'), i):
            end = command.find("\n" + command[i + 1] + "@", i)
            current.append(" ''")
            i = n if end < 0 else end + 3
            continue
        elif tool != "PowerShell" and command.startswith("<<", i) and not command.startswith("<<<", i):
            match = HEREDOC.match(command, i)
            if match:
                pending.append((match.group(3), match.group(1) == "-"))
                current.append(match.group(0))
                i = match.end()
                continue
            current.append(ch)
        elif command.startswith(("&&", "||"), i):
            parts.append("".join(current))
            current = []
            i += 1
        elif ch in ";|\n":
            parts.append("".join(current))
            current = []
            if ch == "\n":
                i = skip_bodies(command, i + 1, pending) - 1
                pending = []
        else:
            current.append(ch)
        i += 1
    parts.append("".join(current))
    return parts


def skip_bodies(command, i, pending):
    """Skip the here-document bodies opened on the line that just ended."""
    for delimiter, strip_tabs in pending:
        while i < len(command):
            end = command.find("\n", i)
            end = len(command) if end < 0 else end
            line = command[i:end]
            i = end + 1
            if (line.lstrip("\t") if strip_tabs else line).rstrip("\r") == delimiter:
                break
    return i


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
    name = token.lstrip("($`{").replace("\\", "/").split("/")[-1].lower()
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


def unread_push(segment, tokens):
    """True when a segment mentions git and push but was not read as `git push`."""
    if tokens is None:
        return bool(re.search(r"\bgit", segment) and re.search(r"\bpush\b", segment))
    gits = [k for k, token in enumerate(tokens) if program(token) == "git"]
    return any("push" in tokens[k + 1:] for k in gits)


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    tool = data.get("tool_name")
    if tool not in ("Bash", "PowerShell"):
        return 0
    command = (data.get("tool_input") or {}).get("command") or ""
    unsure = False
    for segment in segments(command, tool):
        tokens = words(segment, tool)
        args = push_args(tokens) if tokens is not None else None
        if args is None:
            unsure = unsure or unread_push(segment, tokens)
            continue
        reason = force_reason(args)
        if reason:
            print(f"Blocked a force push: {reason}. Use `--force-with-lease` instead, "
                  "which refuses to overwrite commits you have not fetched.", file=sys.stderr)
            return 2
    if unsure:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": "This command contains a git push the push guard could not read, so it needs approval.",
        }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
