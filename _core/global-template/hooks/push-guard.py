"""PreToolUse hook: block force pushes that permission rules cannot see.

Permission rules match command text, so `-f` bundled with other short flags
(`-qf`, `-vf`, `-uqf`) escapes them. This hook reads the arguments of every
`git push` in a Bash or PowerShell command and blocks:

- `--force` and `-f`, alone or inside a short-flag bundle;
- `--mirror`, which force-updates and deletes every remote ref;
- a refspec starting with `+` (a force push of that one ref).

`--force-with-lease` and `--force-if-includes` stay allowed: they refuse to
overwrite work the local repo has not seen.

Decisions, in order, for a command that mentions a push, a mirror or git
config from the environment:

1. Block (exit 2) when a plain command certainly force-pushes: a `git push`
   anywhere in a statement, also after wrappers such as `sudo -u me` or
   `timeout 5`, with a force flag among its own words. Plain means words,
   quotes, escapes and the `&&`, `||`, `;`, `|`, `&` and newline separators,
   nothing else.
2. Pass silently only when every segment that mentions a push is on an
   allow-list: `git push` followed by known-safe flags and plain ref names,
   written with letters, digits and `._/:=-` only (an optional trailing `2>&1`
   is fine), and every other segment is on a short list known to leave git's
   push behavior alone (`cd`, printing, `git add`, `git commit`, `git fetch`
   and similar), since anything else, like `readonly HOME=...`, could point
   git at other config. Segments that only print or commit (`echo`, `printf`,
   `git commit`, without a redirect or a pipe into another command) never
   push, so their text does not
   count, and neither does a `push` that is not git's (`git stash push`,
   `docker push`, `Push-Location`).
3. Ask for approval in every other case.

Out of reach for any command guard: git config that already holds a forcing
`remote.<name>.push` or `mirror` setting when a plain `git push` runs, however
it got there (a file edit, an earlier command). A push word built at run time
(`git p$(echo u)sh`) is not matched by a `git push` allow rule either, so it
reaches the prompt without this hook. Code inside an interpreter one-liner
that an allow rule approves (`python -c`, `node -e`) can build a push the
command text never names; only removing those allow rules closes that.

Silence has to be earned by matching the list, so a spelling the hook does not
know (a variable, a substitution, a redirect glued to a word, a quote inside
`push`, a config setting that forces later) ends in a prompt, never in a
silent pass. That is what makes a global `git push` allow rule safe next to
it. In `bypassPermissions` mode Claude Code turns an ask into an allow, so
there only the blocks in step 1 apply. Input that is not JSON lets the call
through (the project's deny rules still apply); an error while reading a Bash
or PowerShell command asks.

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

# Longer commands that mention a push ask without being parsed; no plain push
# needs more, and parsing must never approach the hook timeout.
MAX_COMMAND = 20000
# git options that take their value as the next argument.
GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
                     "--config-env", "--attr-source"}
# git options that take no value. Any other option before the subcommand might
# take one, which would make the next word its value rather than the subcommand.
GIT_FLAG_OPTIONS = {"-p", "--paginate", "-P", "--no-pager", "--bare", "--no-replace-objects",
                    "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs",
                    "--no-optional-locks", "--no-advice", "--no-lazy-fetch"}
PUSH_VALUE_OPTIONS = {"--repo", "--push-option", "--receive-pack", "--exec"}
# Flags a push on the allow-list may carry: none of them forces, mirrors or
# reads a value from the next word.
SAFE_FLAGS = {"-u", "--set-upstream", "--tags", "--follow-tags", "--force-with-lease", "--force-if-includes",
              "--delete", "-d", "-q", "--quiet", "-v", "--verbose", "-n", "--dry-run", "--no-verify",
              "--atomic", "--porcelain", "--progress", "--no-progress"}
DATA_COMMANDS = {"echo", "printf", "write-output", "write-host"}
INERT_GIT = {"add", "commit", "status", "log", "diff", "show", "fetch", "pull", "branch", "checkout", "switch",
             "merge", "rev-parse", "stash", "tag"}


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
    """Split a command at unquoted separators. Returns the segments, whether
    the command is plain, meaning it uses no syntax that can run or produce
    words this hook does not see, and the indexes of segments whose output is
    piped into the next one."""
    escape = "`" if tool == "PowerShell" else "\\"
    parts, current, quote, plain, i, n = [], [], None, True, 0, len(command)
    piped = set()
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
        # A lone `&` ends a statement in both shells (in PowerShell 7 it starts a
        # background job), except inside a redirect like `2>&1` and, in
        # PowerShell, as the call operator at the start of a statement. A lone
        # carriage return also ends a PowerShell statement.
        elif (ch in ";|\n" or (ch == "\r" and tool == "PowerShell")
              or (ch == "&" and command[i - 1:i] not in "<>" and command[i + 1:i + 2] != ">"
                  and (tool != "PowerShell" or "".join(current).strip()))):
            if ch == "|":
                piped.add(len(parts))
            parts.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    parts.append("".join(current))
    # PowerShell also reads curly quotes as quotes and Unicode spaces, vertical
    # tab and form feed as whitespace; shlex does not, so such a command is not plain.
    if tool == "PowerShell" and re.search(r"[^\x00-\x7f]|[\v\f]", command):
        plain = False
    # After `--%` PowerShell passes the rest of the line to the program as is,
    # separators included, so its words cannot be read here.
    if tool == "PowerShell" and "--%" in command:
        plain = False
    return parts, plain and quote is None, piped


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
    """The program a word names: `/usr/bin/git`, `(git`, `GIT.EXE` and, after
    PowerShell's call operator, `&git` and `("git")` are all git. A redirect glued
    to the name ends it, as in the shell: `git>/dev/null` is git."""
    name = re.split(r"[<>&]", token.lstrip("(&"), 1)[0].rstrip(")")
    name = name.replace("\\", "/").split("/")[-1].lower()
    return re.sub(r"\.exe$", "", name)


def push_args(tokens):
    """The arguments after `push` for the first `git push` in the tokens, else
    None. Every git word is checked, not only the first word, so wrappers with
    their own options (`sudo -u me`, `timeout 5`, `nice -n 5`, `command -p`)
    and shell keywords (`case x in a)`) cannot hide a push. `xargs` appends
    words from its input (`echo -qf | xargs git push`), so a push after it is
    not certain here; it fails the allow-list and asks."""
    for k, token in enumerate(tokens):
        # `git-push` (git's libexec program) is push itself.
        if program(token) == "git-push":
            return tokens[k + 1:]
        if program(token) != "git":
            continue
        i = k + 1
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


def relevant(text):
    """Whether text, with quote and escape characters removed, mentions a push,
    a mirror, git config from the environment, or `git remote ... --mi[rror]`."""
    bare = re.sub(r"[\"'`\\]", "", text)
    if re.search(r"push\b|mirror|git_config", bare, re.I):
        return True
    # Linear on purpose: a backtracking `remote.*--mi` pattern could run past
    # the hook timeout on a long command, and a timed-out hook lets it through.
    remote = re.search(r"\bremote\b", bare, re.I)
    return bool(remote and "--mi" in bare[remote.end():].lower())


def only_data(segment, tokens):
    """Commands that print or commit without writing a file: their arguments
    are text, never a push. A redirect makes them write, for example into
    `.git/config`, so a redirected one does not count. So does one that stores
    its output in a variable (`printf -v`, PowerShell `-OutVariable` or
    `-PipelineVariable`), or one with a `(`, which PowerShell runs as a command
    in argument position (`Write-Output (git push -qf)`)."""
    if re.search(r"[>(]", segment):
        return False
    if tokens[0].lower() in DATA_COMMANDS:
        return not any(re.match(r"(?i)-(v|o|pv|pipelinev)", t) for t in tokens[1:])
    return tokens[:2] == ["git", "commit"]


def subcommand(tokens, k):
    """The git subcommand for the `git` word at index k, skipping git's own options."""
    i = k + 1
    while i < len(tokens) and tokens[i].startswith("-"):
        i += 2 if tokens[i] in GIT_VALUE_OPTIONS else 1
    return tokens[i] if i < len(tokens) else ""


def push_related(tokens):
    """Whether a plain segment pushes or changes how a push behaves: a git
    whose subcommand is `push` or not a plain word, a git with `--upload-pack`
    (it runs a shell command), a `remote.<name>.push` or
    `.mirror` setting, `GIT_CONFIG_*`, a path into `.git/` or a gitconfig
    file, `git remote ... --mi[rror]`, or a word
    that holds both git and push (`eval "git push -qf"`). `git stash push`,
    `docker push` and `Push-Location` are not."""
    # Checked once per segment, not once per git word, so the time stays linear.
    upload_pack = any(t.startswith("--upl") for t in tokens)
    has_push = "push" in tokens
    for k, token in enumerate(tokens):
        if program(token) == "git-push":
            return True
        if program(token) == "git":
            name = subcommand(tokens, k)
            if name == "push" or not re.fullmatch(r"[a-z][a-z0-9-]*", name):
                return True
            # `fetch`/`pull --upload-pack=<cmd>` (any abbreviation) runs <cmd>
            # through a shell, which can write push config or push itself.
            if upload_pack:
                return True
            # An option the guard does not know could take the next word as its
            # value, so the real subcommand might be a later `push`.
            options = tokens[k + 1:tokens.index(name, k + 1)]
            if has_push and any(
                    t.startswith("-") and "=" not in t and t not in GIT_VALUE_OPTIONS | GIT_FLAG_OPTIONS
                    for t in options):
                return True
    if any(re.search(r"(?i)remote\.[^=\s]+\.(push|mirror)(=|$)|git_config", t) for t in tokens):
        return True
    # A path into `.git/`, a gitconfig file or `~/.config/git/`, such as a
    # redirect into `.git/config` or `--output=.git/config`.
    if any(re.search(r"(?i)(^|[/\\=])\.git([/\\]|$)|gitconfig|[/\\]git[/\\]config", t) for t in tokens):
        return True
    if "remote" in tokens and any(t.startswith("--mi") for t in tokens):
        return True
    return any(mentions_push(t) for t in tokens)


def mentions_push(text):
    return bool(re.search(r"\bgit", text, re.I) and re.search(r"\bpush\b", text, re.I))


def inert(segment, tokens):
    """Segments known to leave git's push behavior alone: changing directory,
    printing, and git subcommands that do not touch config or remotes."""
    if only_data(segment, tokens) or tokens[0] in ("cd", "pwd", "true", "Set-Location", "sl"):
        return True
    # `--output=<file>` (or any abbreviation of it) makes `git log`, `diff` and
    # `show` write a file without a redirect, for example git's own config.
    return (tokens[0] == "git" and len(tokens) > 1 and tokens[1] in INERT_GIT and ">" not in segment
            and not any(t.startswith("--o") for t in tokens))


def safe_push(segment):
    """Whether a segment is a `git push` on the allow-list: known-safe flags and
    plain ref names, written with letters, digits and `._/:=-` only."""
    text = re.sub(r"\s+2>&1$", "", segment.strip())
    if not re.fullmatch(r"[A-Za-z0-9 ._/:=-]+", text):
        return False
    tokens = text.split()
    if tokens[:2] != ["git", "push"]:
        return False
    for token in tokens[2:]:
        if token.startswith("-"):
            if token not in SAFE_FLAGS and not token.startswith("--force-with-lease="):
                return False
        elif not re.fullmatch(r"[A-Za-z0-9._/][A-Za-z0-9._/:-]*", token):
            return False
    return True


def ask():
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": "This command mentions a git push that is not on the push guard's list of plain, safe forms, so it needs approval.",
    }}))
    return 0


def main():
    try:
        # Claude Code writes UTF-8. Decode it as UTF-8 instead of the platform's
        # default encoding, and never let a bad byte turn into a silent pass.
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
    except ValueError:
        return 0
    if not isinstance(data, dict) or data.get("tool_name") not in ("Bash", "PowerShell"):
        return 0
    try:
        return decide(data)
    except Exception:
        # A shell command the guard could not finish reading is never a silent pass.
        return ask()


def decide(data):
    tool = data.get("tool_name")
    if tool not in ("Bash", "PowerShell"):
        return 0
    command = join_lines((data.get("tool_input") or {}).get("command") or "", tool)
    if not relevant(command):
        return 0
    # A timed-out hook lets the call through, so a command too long to read
    # well inside the timeout asks instead of being parsed.
    if len(command) > MAX_COMMAND:
        return ask()
    parts, plain, piped = scan(command, tool)
    if not plain:
        return ask()
    segments = [(part, words(part, tool)) for part in parts]
    if any(tokens is None for _, tokens in segments):
        return ask()
    for part, tokens in segments:
        # A print or commit only carries push text; it never runs it.
        if tokens and only_data(part, tokens):
            continue
        args = push_args(tokens)
        reason = force_reason(args) if args is not None else None
        if reason:
            print(f"Blocked a force push: {reason}. Use `--force-with-lease` instead, "
                  "which refuses to overwrite commits you have not fetched.", file=sys.stderr)
            return 2
    pushes = False
    for index, (part, tokens) in enumerate(segments):
        # Printed text piped into the next command can become a command
        # (`echo 'git push -qf' | sh`), so only unpiped prints are skipped.
        if not tokens or (only_data(part, tokens) and index not in piped):
            continue
        if push_related(tokens):
            if not safe_push(part):
                return ask()
            pushes = True
        elif relevant(part) and not re.fullmatch(r"[A-Za-z][A-Za-z0-9._-]*", tokens[0]):
            # Push text passes silently only in a segment that plainly starts with
            # a program name (`docker push`, `git stash push`); a first word such
            # as `&('gi'+'t')` could still run git.
            return ask()
    # Next to a push, every other segment must be known to leave git's behavior
    # alone; anything else (`readonly HOME=...`, `Set-Item Env:...`) could point
    # the push at other config.
    if pushes and any(tokens and not safe_push(part) and not inert(part, tokens) for part, tokens in segments):
        return ask()
    return 0


if __name__ == "__main__":
    sys.exit(main())
