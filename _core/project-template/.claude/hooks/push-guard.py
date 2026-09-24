"""PreToolUse hook: block force pushes that permission rules cannot see.

Permission rules match command text, so `-f` bundled with other short flags
(`-qf`, `-vf`, `-uqf`) escapes them. This hook reads the arguments of every
`git push` in a Bash or PowerShell command and blocks:

- `--force` and `-f`, alone or inside a short-flag bundle;
- a refspec starting with `+` (a force push of that one ref).

`--force-with-lease` and `--force-if-includes` stay allowed: they refuse to
overwrite work the local repo has not seen.

Exit 2 blocks the call and shows the reason to Claude. Any other outcome,
including a parse error, lets the call through, and the deny rules in
`settings.local.json` still apply.
"""
import json
import re
import shlex
import sys

# git options that take their value as the next argument.
GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
PUSH_VALUE_OPTIONS = {"--repo", "--push-option", "--receive-pack", "--exec", "-o"}
WRAPPERS = {"sudo", "env", "command", "builtin", "nice", "nohup", "time", "timeout", "stdbuf", "noglob"}


def segments(command):
    """Split a command line at unquoted `&&`, `||`, `;`, `|` and newlines."""
    parts, current, quote, i = [], [], None, 0
    while i < len(command):
        ch = command[i]
        if quote:
            current.append(ch)
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
            current.append(ch)
        elif command.startswith(("&&", "||"), i):
            parts.append("".join(current))
            current = []
            i += 1
        elif ch in ";|\n":
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
        i += 1
    parts.append("".join(current))
    return parts


def words(segment):
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return segment.split()


def push_args(tokens):
    """The arguments after `push` when the tokens run `git push`, else None."""
    i = 0
    while i < len(tokens) and (tokens[i] in WRAPPERS or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tokens[i])):
        i += 1
    if i >= len(tokens) or re.sub(r"\.exe$", "", tokens[i].replace("\\", "/").split("/")[-1]) != "git":
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
    for ref in positional[1:]:
        if ref.startswith("+"):
            return f"`{ref}` (a leading + forces that ref)"
    return None


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    if data.get("tool_name") not in ("Bash", "PowerShell"):
        return 0
    command = (data.get("tool_input") or {}).get("command") or ""
    for segment in segments(command):
        args = push_args(words(segment))
        if args is None:
            continue
        reason = force_reason(args)
        if reason:
            print(f"Blocked a force push: {reason}. Use `--force-with-lease` instead, "
                  "which refuses to overwrite commits you have not fetched.", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
