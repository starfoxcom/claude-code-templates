"""PreToolUse hook: block force pushes that permission rules cannot see.

Permission rules match command text, so `-f` bundled with other short flags
(`-qf`, `-vf`, `-uqf`) escapes them. This hook reads the arguments of every
`git push` in a Bash or PowerShell command and blocks:

- `--force` and `-f`, alone or inside a short-flag bundle;
- `--mirror`, which force-updates and deletes every remote ref;
- a refspec starting with `+` (a force push of that one ref);
- `-c remote.<name>.push=+...` or a true `-c remote.<name>.mirror` on the push itself;
- a one-off alias that forces (`git -c alias.p='push -f' p`, also through
  another alias or a `!` shell alias);
- a push of a branch the same command deleted on the same remote (`git push
  origin --delete main && git push origin main`), which drops remote commits
  like a force push.

`--force-with-lease` and `--force-if-includes` stay allowed: they refuse to
overwrite work the local repo has not seen. The same checks cover git's push
plumbing, `send-pack` and `http-push`.

The hook only ever blocks or stays silent; it never asks. Every other command
runs exactly as it would without the hook, so it adds no prompts to normal
work. It blocks only what it can read for certain: a `git push` anywhere in a
statement, also after wrappers such as `sudo -u me` or `timeout 5`, inside a
`(...)`, `$(...)`, backtick or `{ ...; }` group, after an assignment, or
inside a literal command string (`sh -c '...'`, `bash -l -c '...'`, `pwsh
-Command '...'`, `eval '...'`), with a force flag among its own words, also
when written in Bash's `$'...'` quoting or with a redirect glued to it
(`-qf>/dev/null`). A separator inside a substitution does not end the
statement around it, and a heredoc body is text, not commands. Text that
only prints or commits (`echo`, `printf`, `git commit`, without a redirect)
is never read as a push, and neither are
comments.

Out of reach, so these run without a block:

- a command this hook cannot split into statements for certain: one with a
  heredoc that never reaches its closing line, a `<<` it cannot place, a
  PowerShell here-string, block comment or `--%`,
  unbalanced quotes or groups, or, in PowerShell, characters outside ASCII,
  a vertical tab or a form feed;
- a push nested more than MAX_DEPTH levels deep in substitutions, shell
  strings or `eval`;
- a push inside a nested string, alias or inner substitution of a command
  that takes more than READ_BUDGET seconds to read in full (plain statements
  and top-level substitutions are read first, so a plain force push is
  still blocked);
- remote branch and tag deletions (`--delete`, `:branch`, `--prune`);
- a force flag the shell builds at run time (`git push $FLAGS`, `xargs`,
  brace expansion, text piped into a shell or `iex`);
- git config or aliases that force a later plain `git push` (`git config
  alias.p 'push -f'`, a `remote.<name>.push` or `mirror` setting, `GIT_CONFIG_*`
  variables, a shell alias for git);
- a branch deleted and then pushed again in another command, or in the same
  command by `HEAD`, a bare `git push` or another name for the same ref;
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
import time

# Longer commands pass without being parsed; no plain push needs more.
MAX_COMMAND = 20000
# Seconds the quick and the full reading may each take; together they stay
# inside the hook's 10 s timeout with Python's start-up on a busy machine.
QUICK_BUDGET = 4
READ_BUDGET = 3
# git subcommands and programs that push. `send-pack` and `http-push` are the
# plumbing under `git push`, with their own `--force`.
PUSH_SUBCOMMANDS = {"push", "send-pack", "http-push"}
PUSH_PROGRAMS = {"git-push", "git-send-pack", "git-http-push"}
# git options that take their value as the next argument.
GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
                     "--config-env", "--attr-source"}
PUSH_VALUE_OPTIONS = {"--repo", "--push-option", "--receive-pack", "--exec"}
DATA_COMMANDS = {"echo", "printf", "write-output", "write-host"}
# Searches whose patterns are text, never run: `grep -e 'git push -f'`.
# `rg --pre` runs a program, so it is left out.
SEARCH_COMMANDS = {"grep", "egrep", "fgrep", "rg", "findstr", "select-string", "sls"}
# The reason for a branch deleted and pushed again, which a lease does not fix.
DELETED_AGAIN = "pushes again a branch this command deleted"
# Programs that run a literal command string, read again as a nested command.
SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
POWERSHELLS = {"pwsh", "powershell"}
EVAL_COMMANDS = {"eval", "invoke-expression", "iex"}
MAX_DEPTH = 8
# `scan` writes unquoted `<`, `>` and `&` as these private-use characters, so a
# redirect is told apart from the same character inside quotes.
REDIRECT_MARK = str.maketrans("<>&", "\ue000\ue001\ue002")
UNMARK = str.maketrans("\ue000\ue001\ue002", "<>&")


def comment_start(prev, at, closed_at, tool):
    """Whether a `#` at index `at`, after the character `prev`, starts a word
    and so a comment. A `)` that closed a substitution (`$(a)#b`) is part of
    the same word."""
    return (prev == "" or prev in " \t\n;|&"
            or (tool == "PowerShell" and prev == "\r")
            or (tool != "PowerShell" and prev in "()" and closed_at != at))


def scan(command, tool, text=False, keywords=True):
    """Split a command at unquoted separators and drop comments. A separator
    inside a substitution (`$(...)`, backticks, `${...}`, `<(...)`, PowerShell
    `$(...)` and `@(...)`) does not end the statement around it, and a Bash
    heredoc body is text, not commands. A substitution comes out as one empty
    word (`$()`), so the words of the command inside it are never read as the
    outer command's own. Unquoted redirect characters come out as REDIRECT
    marks, so a quoted `>` is never read as a redirect. Returns
    the statements, the text of each outermost command substitution (checked
    as a command of its own, including those in an unquoted heredoc body), and
    whether the split is certain: a PowerShell here-string, block comment or
    `--%`, a heredoc without its closing line, or quotes or groups that never
    close make it uncertain."""
    if deadline is not None and time.monotonic() > deadline:
        raise OverBudget
    escape = "`" if tool == "PowerShell" else "\\"
    openers = ("$(", "@(") if tool == "PowerShell" else ("$(", "<(", ">(", "${")
    parts, current, groups, stack, heredocs = [], [], [], [], []
    quote, readable, escaped_end, closed_at, i, n = None, True, -1, -1, 0, len(command)
    joined_to, joined_from, joined_before, joined_escaped = -1, -1, "", False

    def mark(text):
        return text.translate(REDIRECT_MARK)

    while i < n:
        ch = command[i]
        if ch == escape and quote != "'" and i + 1 < n:
            # A line continuation joins the lines, as the shell does before it
            # reads the words. Bash joins only backslash + LF (backslash + CR
            # is an escaped CR); PowerShell joins a backtick before LF, CRLF or
            # a lone CR.
            # Inside `$'...'` the pair is an escape, never a join.
            rest = command[i + 1:i + 3]
            if quote != "$'" and (rest.startswith("\n") or (tool == "PowerShell" and rest.startswith("\r"))):
                # Bash joins the lines before it splits words, so the next word's
                # start is decided by what came before the join (across several
                # joins in a row). In PowerShell a continuation is whitespace, so
                # the newline itself still ends the word.
                if tool != "PowerShell" and joined_to != i:
                    joined_from, joined_before, joined_escaped = i, command[i - 1:i], escaped_end == i
                i += 3 if rest == "\r\n" else 2
                if tool != "PowerShell":
                    joined_to = i
                continue
            if not stack:
                current.append(command[i:i + 2])
            i += 2
            escaped_end = i
            continue
        # Heredoc bodies start after the line that opened them.
        if ch == "\n" and quote is None and heredocs:
            j = i + 1
            for delimiter, strip_tabs, literal in heredocs:
                start = j
                while True:
                    end = command.find("\n", j)
                    line = command[j:n if end < 0 else end]
                    if (line.lstrip("\t") if strip_tabs else line) == delimiter:
                        # Inside a substitution the body is part of that
                        # group's text and is read with it; adding its groups
                        # here too would read nested levels many times over.
                        if not literal and not stack:
                            groups.extend(scan(command[start:j], tool, text=True)[1])
                        j = n if end < 0 else end + 1
                        break
                    if end < 0:
                        return parts + ["".join(current)], groups, False
                    j = end + 1
            heredocs = []
            if not stack:
                parts.append("".join(current))
                current = []
            i = j
            continue
        # Substitutions open outside single quotes, inside double quotes too,
        # and start a fresh quoting context.
        opener = next((o for o in openers if command.startswith(o, i)), None)
        # A PowerShell `(...)` in argument position is one value. At the start
        # of a statement or after the call operator it names the program, so
        # it stays in the statement there.
        if (tool == "PowerShell" and not opener and quote is None and not stack and ch == "("
                and command[i - 1] in " \t,="):
            so_far = "".join(current).rstrip()
            if so_far and so_far[-1] not in "\ue002.":
                opener = "("
        if quote not in ("'", "$'") and (opener or (ch == "`" and tool != "PowerShell"
                                                  and not (stack and stack[-1][0] == "`"))):
            opener = opener or "`"
            if not stack:
                current.append(mark(opener))
            stack.append([opener, i + len(opener), quote, 0, 0])
            quote = None
            i += len(opener)
            continue
        if stack and quote is None:
            kind, start, outer, depth, cases = stack[-1]
            closer = {"`": "`", "${": "}"}.get(kind, ")")
            nested = {"`": None, "${": "{"}.get(kind, "(")
            # A `case` statement's patterns end in `)`, which must not close
            # the group; count `case` and `esac` in command position.
            keyword = re.match(r"(case|esac)(?=[\s;)]|$)", command[i:i + 5]) if keywords and ch in "ce" else None
            # `^` may only match at the group's own start, so a cut-off window
            # gets a leading word character. A reserved word before it (`then`,
            # `do`, `if`, `!`, ...) counts only when it is itself in command
            # position. Counting too much is undone by the second reading in
            # `check`; counting too little is not, so the list errs wide.
            window = command[start:i] if i - start <= 40 else "x" + command[i - 40:i]
            if keyword and re.search(r"(^|[;&|({!\n])[ \t]*((then|do|else|elif|if|while|until|time|!)[ \t]+)*$",
                                     window):
                stack[-1][4] = cases + 1 if keyword.group(1) == "case" else max(cases - 1, 0)
                i += 4
                continue
            if ch == nested:
                stack[-1][3] += 1
            elif ch == closer and depth:
                stack[-1][3] -= 1
            elif ch == closer and cases and closer == ")":
                pass
            elif ch == closer:
                stack.pop()
                # Only the outermost substitutions are kept; a nested one is
                # found again when its group is checked, so the time stays linear.
                if kind != "${" and all(s[0] == "${" for s in stack):
                    groups.append(command[start:i])
                closed_at = i + 1
                quote = outer
                if not stack:
                    current.append(ch)
                i += 1
                continue
        # In an unquoted heredoc body (`text`), only escapes and substitutions
        # are special: quotes and `#` are plain characters there.
        if text and not stack:
            i += 1
            continue
        if quote:
            if ch == quote[-1]:
                quote = None
        # Bash's `$'...'` quoting, where a backslash escapes the next character.
        elif tool != "PowerShell" and command.startswith("$'", i):
            if not stack:
                current.append("$'")
            quote = "$'"
            i += 2
            continue
        elif ch in "'\"":
            if tool == "PowerShell" and command[i - 1:i] == "@":
                readable = False
            quote = ch
        elif tool == "PowerShell" and command.startswith(("<<", "<#"), i):
            readable = False
        elif command.startswith("<<<", i):
            current.append(mark("<<<"))
            i += 3
            continue
        # A `<<` inside `$((...))` or before a number is an arithmetic shift.
        elif command.startswith("<<", i) and (
                re.match(r"<<-?[ \t]*[0-9]", command[i:])
                or any(s[0] == "$(" and command[s[1]:s[1] + 1] == "(" for s in stack)):
            if not stack:
                current.append(mark("<<"))
            i += 2
            continue
        elif command.startswith("<<", i):
            here = re.match(r"<<(-?)[ \t]*(?:'([^'\n]*)'|\"([^\"\n]*)\"|(\\?)([A-Za-z0-9_.-]+))", command[i:])
            if not here:
                readable = False
            else:
                delimiter = next(g for g in (here.group(2), here.group(3), here.group(5)) if g is not None)
                literal = here.group(5) is None or bool(here.group(4))
                heredocs.append((delimiter, bool(here.group(1)), literal))
                if not stack:
                    current.append(mark(here.group(0)))
                i += here.end()
                continue
        # A `#` that starts a word starts a comment, which runs to the end of the
        # line. The character before it must be an unescaped delimiter; only
        # PowerShell ends words at a carriage return, and inside `${...}` Bash
        # reads `#` as text. After a line continuation the character before the
        # join counts: `a\<LF>#b` is the word `a#b`.
        elif (ch == "#" and not (stack and stack[-1][0] == "${")
              and not (joined_escaped if joined_to == i else escaped_end == i)
              and comment_start(joined_before if joined_to == i else command[i - 1:i],
                                joined_from if joined_to == i else i, closed_at, tool)):
            while i < n and command[i] != "\n":
                i += 1
            continue
        elif stack:
            pass
        # Bash's clobber redirect `>|` is no pipe: its `|` stays with the redirect.
        elif ch == "|" and tool != "PowerShell" and command[i - 1:i] == ">" and escaped_end != i:
            pass
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
        if not stack:
            current.append(mark(ch) if quote is None else ch)
        i += 1
    parts.append("".join(current))
    if stack or heredocs:
        readable = False
    # PowerShell also reads curly quotes as quotes and Unicode spaces, vertical
    # tab and form feed as whitespace; shlex does not.
    if tool == "PowerShell" and re.search(r"[^\x00-\x7f]|[\v\f]", command):
        readable = False
    # After `--%` PowerShell passes the rest of the line to the program as is,
    # separators included.
    if tool == "PowerShell" and "--%" in command:
        readable = False
    return parts, groups, readable and quote is None


ANSI_ESCAPES = {"a": "\a", "b": "\b", "e": "\x1b", "E": "\x1b", "f": "\f", "n": "\n", "r": "\r",
                "t": "\t", "v": "\v", "\\": "\\", "'": "'", '"': '"', "?": "?"}


def ansi_escape(text, j):
    """Decode the backslash escape at text[j] inside Bash's `$'...'`; returns
    the characters and the index after the escape."""
    rest = text[j + 1:]
    if rest[:1] in ANSI_ESCAPES:
        return ANSI_ESCAPES[rest[0]], j + 2
    for pattern, base in ((r"[0-7]{1,3}", 8), (r"x([0-9A-Fa-f]{1,2})", 16),
                          (r"u([0-9A-Fa-f]{1,4})", 16), (r"U([0-9A-Fa-f]{1,8})", 16)):
        m = re.match(pattern, rest)
        if m:
            code = int(m.group(m.lastindex or 0), base)
            return (chr(code & 0xFF) if base == 8 else chr(min(code, 0x10FFFF))), j + 1 + m.end()
    if rest[:1] == "c" and len(rest) > 1:
        return chr(ord(rest[1]) & 0x1F), j + 3
    return "\\" + rest[:1], j + 2


def bash_quotes(command):
    """Rewrite Bash's `$'...'` as a plain single-quoted word with its escapes
    decoded, and `$"..."` as `"..."`, so shlex reads them as Bash does:
    `$'-qf'` and `$'\\x2dqf'` are `-qf`."""
    out, quote, i, n = [], None, 0, len(command)
    while i < n:
        ch = command[i]
        if ch == "\\" and quote != "'" and i + 1 < n:
            out.append(command[i:i + 2])
            i += 2
            continue
        if quote is None and command.startswith("$'", i):
            j, text = i + 2, []
            while j < n and command[j] != "'":
                if command[j] == "\\" and j + 1 < n:
                    decoded, j = ansi_escape(command, j)
                    text.append(decoded)
                    continue
                text.append(command[j])
                j += 1
            if j >= n:
                return command
            out.append("'" + "".join(text).replace("'", "'\\''") + "'")
            i = j + 1
            continue
        if quote is None and command.startswith('$"', i):
            i += 1
            continue
        if quote and ch == quote:
            quote = None
        elif not quote and ch in "'\"":
            quote = ch
        out.append(ch)
        i += 1
    return "".join(out)


def words(segment, tool):
    """Shell words of one segment, or None when its quotes do not balance."""
    segment = powershell_quotes(segment) if tool == "PowerShell" else bash_quotes(segment)
    lexer = shlex.shlex(segment, posix=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    # Bash does not split words at a carriage return.
    lexer.whitespace = " \t\n" if tool == "Bash" else " \t\r\n"
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
    token = re.sub(r"^(?:[A-Za-z_][A-Za-z0-9_]*=)?[$`(&<>\ue000-\ue002]+", "", token)
    name = re.split(r"[\ue000-\ue002]", token, maxsplit=1)[0].rstrip(")")
    name = name.replace("\\", "/").split("/")[-1].lower()
    return re.sub(r"\.exe$", "", name)


def push_reason(tokens, deleted, depth):
    """Why the first push in the tokens forces, or None. Every git word is
    checked, not only the first word, so wrappers with their own options
    (`sudo -u me`, `timeout 5`, `nice -n 5`, `command -p`) and shell keywords
    (`case x in a)`) cannot hide a push. `deleted` collects the branches
    deleted so far in the command, by remote."""
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
        name, args = re.split(r"[\ue000-\ue002]", tokens[i], maxsplit=1)[0], tokens[i + 1:]
        # A one-off alias (`-c alias.p='push -f'`) runs its words in place of
        # the alias name; a `!` alias runs its text in a shell with the
        # arguments appended. Config keys ignore case, and an alias can name
        # another alias.
        aliases = {}
        for setting in config:
            alias = re.match(r"(?i)alias\.([^=]+)=(.*)", setting, re.S)
            if alias:
                aliases[alias.group(1).lower()] = alias.group(2).strip()
        seen = set()
        while name.lower() in aliases and name not in PUSH_SUBCOMMANDS and name.lower() not in seen:
            seen.add(name.lower())
            value = aliases[name.lower()]
            if value.startswith("!"):
                inner = value[1:] + "".join(" " + shlex.quote(a) for a in args)
                if depth < MAX_DEPTH:
                    # The text holds every later word, so one check covers them.
                    return check(inner, "Bash", depth + 1)
                name = ""
                break
            try:
                expanded = shlex.split(value)
            except ValueError:
                expanded = value.split()
            if not expanded:
                break
            name, args = expanded[0], expanded[1:] + args
        if name in PUSH_SUBCOMMANDS:
            for setting in config:
                # `remote.<name>.mirror` with no value is true.
                if re.match(r"(?i)remote\.[^=]+\.(push=\s*\+|mirror(=\s*(true|yes|on|1)\s*$|$))", setting):
                    return f"`-c {setting}` (a forcing push setting)"
            return check_push(args, deleted)
    return None


def check_push(args, deleted):
    reason, refs, delete = force_reason(args)
    if reason:
        return reason
    # The first positional is the repository even after `--` (git push
    # [<options>] [<repository> [<refspec>...]]), so refspecs start at [1].
    remote = refs[0] if refs else ""
    for ref in refs[1:]:
        target = (remote, re.sub(r"^refs/heads/", "", ref.split(":")[-1]))
        if delete or ref.startswith(":"):
            deleted.add(target)
        elif target in deleted:
            # Deleting a branch and pushing it again drops the remote's commits
            # the same way a force push does.
            return f"`{ref}` ({DELETED_AGAIN})"
    return None


def force_reason(args):
    """The force flag or `+` refspec in a push's arguments, or None; plus the
    positional arguments and whether the push deletes (`--delete`, `-d`)."""
    positional, i, only_refs, delete = [], 0, False, False
    while i < len(args):
        arg, extra = args[i], 0
        # A redirect glued to an argument ends it, as in the shell: `-qf>/dev/null`
        # passes `-qf`. A word that starts with a redirect (`2>&1`, `>out.txt`) is
        # no argument. A bare operator (`>`, `2>`, `-qf>`) takes the next word
        # as its file.
        cut = re.search(r"[\ue000-\ue002]", arg)
        if cut:
            head, operator = arg[:cut.start()], arg[cut.start():]
            extra = 1 if re.fullmatch(r"[\ue000-\ue002|]+", operator) else 0
            if not head or head.isdigit():
                i += 1 + extra
                continue
            arg = head
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
        i += 1 + extra
    for ref in positional[1:]:
        if ref.startswith("+"):
            return f"`{ref}` (a leading + forces that ref)", positional, delete
    return None, positional, delete


def only_data(segment, tokens):
    """Commands that print, search or commit without writing a file: their
    arguments are text, never a push. A redirect makes them write, and in PowerShell a
    `(...)` argument runs as a command (`Write-Output (git push -qf)`), so
    neither counts."""
    if re.search(r"[>(\ue001]", segment):
        return False
    name = tokens[0].lower()
    if name in DATA_COMMANDS:
        return True
    if name in SEARCH_COMMANDS:
        return name != "rg" or not any(re.match(r"--pre(=|$)", t) for t in tokens)
    return tokens[:2] == ["git", "commit"]


def nested_reason(tokens, tool, depth):
    """A literal command string that another shell or `eval` runs:
    `sh -c '...'`, `bash -lc '...'`, `pwsh -Command '...'`, `eval '...'`,
    `Invoke-Expression '...'`, also after wrappers (`bundle exec sh -c`)."""
    for k, token in enumerate(tokens):
        name, rest = program(token), tokens[k + 1:]
        inner = None
        if name in EVAL_COMMANDS and rest:
            # Its string already holds every later word of the statement, so one
            # check covers them; checking each later `eval` too would multiply.
            return check(" ".join(rest), tool, depth + 1)
        elif name in SHELLS:
            inner, inner_tool = shell_command_string(rest), "Bash"
        elif name in POWERSHELLS:
            flag = next((j for j, t in enumerate(rest) if re.fullmatch(r"(?i)-c(o(m(m(a(nd?)?)?)?)?)?", t)), None)
            if flag is not None and flag + 1 < len(rest):
                # Like `eval`, the string holds every later word, so one check
                # covers them.
                return check(" ".join(rest[flag + 1:]), "PowerShell", depth + 1)
        if inner is not None:
            reason = check(inner, inner_tool, depth + 1)
            if reason:
                return reason
    return None


def shell_command_string(args):
    """The command string a shell runs with `-c`, after its other options:
    `sh -c '...'`, `bash -l -c '...'`, `bash --login -c '...'`, `bash -cx '...'`,
    `bash -euo pipefail -c '...'`, `bash -c -- '...'`; None without `-c`."""
    has_c, j = False, 0
    while j < len(args):
        arg = args[j]
        if arg == "--":
            j += 1
            break
        if arg in ("--rcfile", "--init-file"):
            j += 2
        elif arg.startswith("--"):
            j += 1
        elif re.fullmatch(r"[-+][A-Za-z]+", arg):
            has_c = has_c or (arg[0] == "-" and "c" in arg)
            # `-o` and `-O` (also at the end of a bundle) take the next word.
            j += 2 if arg[-1] in "oO" else 1
        else:
            break
    return args[j] if has_c and j < len(args) else None


class OverBudget(Exception):
    """The reading ran past READ_BUDGET."""


deadline = None


def guard(command, tool):
    """Why a command certainly force-pushes, or None, always well inside the
    hook timeout. A quick first reading checks every statement and top-level
    substitution without reading nested strings, aliases or deeper
    substitutions; it takes time in step with the command's length, so a later
    plain force push is always found. The full reading then runs under a time
    budget. Past the budget the call goes through, as it would on a timeout."""
    global deadline
    # The quick reading has its own clock, so a slow full reading never costs it
    # time; it only runs out on a machine too slow to run the hook at all.
    deadline = time.monotonic() + QUICK_BUDGET
    try:
        parts, groups, readable = scan(command, tool)
        if not readable:
            parts, groups, readable = scan(command, tool, keywords=False)
        if readable:
            for text in [command] + groups:
                reason = check(text, tool, MAX_DEPTH)
                if reason:
                    return reason
        deadline = time.monotonic() + READ_BUDGET
        return check(command, tool)
    except OverBudget:
        return None
    finally:
        deadline = None


def check(command, tool, depth=0):
    """Why a command certainly force-pushes, or None."""
    if deadline is not None and time.monotonic() > deadline:
        raise OverBudget
    if len(command) > MAX_COMMAND:
        return None
    # Quotes, escapes and line continuations inside a word (`pu''sh`) are
    # removed by the shell, and Bash decodes `$'\x70'` to `p`.
    bare = bash_quotes(command) if tool == "Bash" else command
    bare = re.sub(r"[\"'`\\$]", "", re.sub(r"[\\`]\r?\n|`\r", "", bare))
    if not re.search(r"push|send-pack", bare, re.I):
        return None
    parts, groups, readable = scan(command, tool)
    # A miscounted `case` keeps a group open; a second reading without `case`
    # counting closes each group at its first `)`.
    if not readable:
        parts, groups, readable = scan(command, tool, keywords=False)
    if not readable:
        return None
    deleted = set()
    for part in parts:
        tokens = words(part, tool)
        # A print, search or commit only carries push text; it never runs it.
        if not tokens or only_data(part, tokens):
            continue
        reason = push_reason(tokens, deleted, depth) or (depth < MAX_DEPTH and nested_reason(tokens, tool, depth))
        if reason:
            return reason
    # A command substitution runs as a command of its own.
    for group in groups:
        reason = check(group, tool, depth + 1) if depth < MAX_DEPTH else None
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
        reason = guard((data.get("tool_input") or {}).get("command") or "", tool)
    except Exception:
        # The guard only blocks what it reads for certain; an error is not certain.
        return 0
    if reason:
        reason = reason.translate(UNMARK)
        if DELETED_AGAIN in reason:
            advice = ("Push without deleting the branch first; add `--force-with-lease` "
                      "if the push must replace the remote's commits.")
        else:
            advice = ("Use `--force-with-lease` instead, which refuses to overwrite "
                      "commits you have not fetched.")
        print(f"Blocked a force push: {reason}. {advice}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
