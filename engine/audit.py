# Python twin of audit.js: the same checks over the same session logs, with
# the same counts and examples. Standard library only.

import json
import os
import re

from layers import _read_layer_file, run_settings
from model import _research_tool
from setupcode import MAX_DEPTH, _depth, _not_json
from update import ANSWERS, _code_units

SESSIONS = 50
EXAMPLES = 3
CUT = 100
EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
TASK_TOOLS = ("TaskCreate", "TodoWrite")
EDITS_FOR_TASKS = 3

COMMIT = re.compile(r"(?:^|[\n;&|(][ \t]*)git[ \t]+(?:-C[ \t]+[^ \t\r\n]+[ \t]+)?commit(?![A-Za-z0-9_-])")
MESSAGE = re.compile(r"[ \t](?:-[A-Za-z]*m|--message)(?:[ \t]+|=)([\"'])")
FORMAT = re.compile(r"(feat|fix|refactor|perf|test|docs|chore|data|style)(\([^() \t]+\))?!?: [^ \t]")
WRITES = re.compile(r"(?:^|[\n;&|(][ \t]*)(?:git[ \t]+(?:-C[ \t]+[^ \t\r\n]+[ \t]+)?commit"
                    r"|gh[ \t]+(?:pr|issue)[ \t]+(?:create|edit|comment))(?![A-Za-z0-9_-])")
ATTRIBUTION_BLOCK = "BLOCKED (no AI attribution)"
CI = re.compile(r"(?:^|[\n;&|(][ \t]*)gh[ \t]+(?:run[ \t]+(?:watch|list|view)|pr[ \t]+checks)(?![A-Za-z0-9_-])")
RUN_WATCH = re.compile(r"(?:^|[\n;&|(][ \t]*)gh[ \t]+run[ \t]+watch(?![A-Za-z0-9_-])")
NON_CODE = re.compile(r"\.(md|mdx|txt|log|json|jsonl|ya?ml|csv)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(md|json|yaml|txt)\Z",
                      re.I | re.A)
STAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}")


def _text(x):
    return x if isinstance(x, str) else ""


def _cut(s):
    line = s.split("\n")[0]
    return (line[:-1] if line.endswith("\r") else line)[:CUT]


def log_folder(root, config):
    """See logFolder in audit.js."""
    try:
        names = sorted(os.listdir(os.path.join(config, "projects")), key=_code_units)
    except OSError:
        return None
    # The CLI replaces each UTF-16 unit, so a character past U+FFFF becomes two dashes.
    want = "".join(c if c.isascii() and c.isalnum() else "-" * (2 if ord(c) > 0xFFFF else 1)
                   for c in os.path.abspath(root)).lower()
    exact = next((n for n in names if n.lower() == want), None)
    if exact is not None or len(want) <= 200:
        return exact
    return next((n for n in names if n.lower().startswith(want[:200] + "-")), None)


def _sessions(folder):
    mains = [n for n in os.listdir(folder) if n.endswith(".jsonl")]
    mains.sort(key=lambda n: (-os.stat(os.path.join(folder, n)).st_mtime_ns, _code_units(n)))
    out = []
    for n in mains[:SESSIONS]:
        sid = n[:-len(".jsonl")]
        sub = os.path.join(folder, sid, "subagents")
        try:
            agents = [os.path.join(sub, x) for x in sorted(os.listdir(sub), key=_code_units) if x.endswith(".jsonl")]
        except OSError:
            agents = []
        out.append((sid, [os.path.join(folder, n)] + agents))
    return out


def _entries(path):
    out = []
    with open(path, encoding="utf-8", errors="replace", newline="") as f:
        lines = f.read().split("\n")
    for line in lines:
        if _depth(line) > MAX_DEPTH:
            continue
        try:
            # parse_int=float reads a number of any length, as JSON.parse does.
            entry = json.loads(line, parse_constant=_not_json, parse_int=float)
        except (ValueError, RecursionError):
            continue
        message = entry.get("message") if isinstance(entry, dict) else None
        if isinstance(message, dict) and isinstance(message.get("content"), list):
            out.append(entry)
    return out


def _stamp(t):
    t = _text(t)
    return "%s %s" % (t[:10], t[11:16]) if STAMP.match(t) else ""


def _result_text(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(_text(c.get("text")) for c in content if isinstance(c, dict) and c.get("type") == "text")


def _tool_calls(files, counted):
    calls, results = [], {}
    for entry in (e for path in files for e in _entries(path)):
        for item in (i for i in entry["message"]["content"] if isinstance(i, dict)):
            if item.get("type") == "tool_use" and isinstance(item.get("id"), str):
                copied = item["id"] in counted
                counted.add(item["id"])
                tool_input = item.get("input") if isinstance(item.get("input"), dict) else {}
                calls.append({"id": item["id"], "name": _text(item.get("name")), "input": tool_input,
                              "when": _stamp(entry.get("timestamp")), "copied": copied})
            elif item.get("type") == "tool_result" and isinstance(item.get("tool_use_id"), str):
                results[item["tool_use_id"]] = _result_text(item.get("content"))
    for c in calls:
        c["result"] = results.get(c["id"], "")
    return calls


def _quoted(s, start, q, esc="\\"):
    out, i = [], start
    while i < len(s):
        if s[i] == q:
            return "".join(out)
        if s[i] == esc and q == '"' and i + 1 < len(s):
            i += 1
        out.append(s[i])
        i += 1
    return None


SEPARATORS = "|;&\n("
HEREDOC = re.compile(r"<<(-?)[ \t]*(?:'([A-Za-z_][A-Za-z0-9_]*)'|\"([A-Za-z_][A-Za-z0-9_]*)\""
                     r"|([A-Za-z_][A-Za-z0-9_]*))")


def _blank(s):
    return re.sub(r"[|;&(]", " ", s)


def _word_start(line, i):
    return i == 0 or line[i - 1] in " \t;&|("


def _escape_of(call):
    return "`" if call["name"] == "PowerShell" else "\\"


def _heredoc_at(line, i, state):
    """See heredocAt in audit.js."""
    if not state["bash"] or line[i] != "<" or not _word_start(line, i):
        return None
    if state["quote"] == "'" or (state["quote"] == '"' and not state["subst"]):
        return None
    return HEREDOC.match(line, i)


def _unquote_line(line, state):
    """See unquoteLine in audit.js."""
    out, i = [], 0
    while i < len(line):
        ch = line[i]
        if state["escaped"]:
            state["escaped"] = False
            out.append(" " if ch in SEPARATORS else ch)
            i += 1
            continue
        if state["quote"] is None and ch == "#" and _word_start(line, i):
            return "".join(out) + _blank(line[i:])
        heredoc = _heredoc_at(line, i, state)
        if heredoc:
            word = heredoc.group(2) or heredoc.group(3) or heredoc.group(4)
            state["heredocs"].append((word, heredoc.group(1) == "-"))
            out.append(heredoc.group(0))
            i = heredoc.end()
            continue
        if ch == state["esc"] and state["quote"] != "'":
            state["escaped"] = True
        elif state["quote"] is None and ch in "'\"":
            state["quote"] = ch
        elif ch == state["quote"]:
            state["quote"], state["subst"] = None, False
        elif state["quote"] == '"' and ch == "$" and line[i + 1:i + 2] == "(":
            state["subst"] = True
        out.append(" " if state["quote"] is not None and ch != state["quote"] and ch in SEPARATORS else ch)
        i += 1
    return "".join(out)


def _unquote(command, esc="\\"):
    """See unquote in audit.js."""
    state = {"quote": None, "escaped": False, "heredocs": [], "subst": False, "esc": esc, "bash": esc == "\\"}
    lines = command.split("\n")
    out = []
    for k, line in enumerate(lines):
        if state["heredocs"]:
            out.append(_blank(line))
            word, tabs = state["heredocs"][0]
            body = line.lstrip("\t") if tabs else line
            if (body[:-1] if body.endswith("\r") else body) == word:
                state["heredocs"].pop(0)
        else:
            out.append(_unquote_line(line, state))
        if k < len(lines) - 1:
            inside = bool(state["heredocs"]) or state["quote"] is not None or state["escaped"]
            state["escaped"] = False
            out.append(" " if inside else "\n")
    return "".join(out)


def commit_message(command, esc="\\"):
    """See commitMessage in audit.js."""
    plain = _unquote(command, esc)
    found = COMMIT.search(plain)
    if found is None:
        return None
    at = found.start()
    end = re.search(r"[;&|\n]", plain[found.end():])
    m = MESSAGE.search(command[at:found.end() + end.start()] if end else command[at:])
    if m is None:
        return None
    start = at + m.end()
    if esc == "\\" and m.group(1) == '"' and command.startswith("$(cat <<", start):
        lines = command[start:].split("\n")
        first = lines[1] if len(lines) > 1 else ""
        return first[:-1] if first.endswith("\r") else first
    message = _quoted(command, start, m.group(1), esc)
    if message is None:
        return None
    first = message.split("\n")[0]
    return first[:-1] if first.endswith("\r") else first


def _good_commit(m):
    return m.startswith("Merge ") or (FORMAT.match(m) is not None and len(m) <= 72)


def _guard_blocked(result):
    first = result.split("\n")[0]
    return "hook" in first and ATTRIBUTION_BLOCK in first


def _shell(call):
    return _text(call["input"].get("command")) if call["name"] in ("Bash", "PowerShell") else ""


def _commit_format(call, _tool):
    m = commit_message(_shell(call), _escape_of(call))
    return None if m is None else (not _good_commit(m), m)


def _attribution(call, _tool):
    command = _shell(call)
    return (_guard_blocked(call["result"]), command) if WRITES.search(_unquote(command, _escape_of(call))) else None


def _ci_watch(call, _tool):
    command = _shell(call)
    plain = _unquote(command, _escape_of(call))
    return (RUN_WATCH.search(plain) is not None, command) if CI.search(plain) else None


def _code_research(call, tool):
    name = call["name"]
    if tool.search(name):
        return (False, name)
    if name not in ("Grep", "Glob"):
        return None
    keys = ("pattern", "path") if name == "Glob" else ("path", "glob", "type")
    if NON_CODE.search(" ".join(_text(call["input"].get(k)) for k in keys)):
        return None
    return (True, "%s %s" % (name, _text(call["input"].get("pattern"))))


PER_CALL = {"commit-format": _commit_format, "attribution": _attribution, "ci-watch": _ci_watch,
            "code-research": _code_research}


def _count(tally, broke, example):
    tally["seen"] += 1
    if not broke:
        return
    tally["broken"] += 1
    if len(tally["examples"]) < EXAMPLES:
        tally["examples"].append(dict(example, text=_cut(example["text"])))


def _research_pattern(root, config):
    value = (run_settings(root, config)["settings"].get("codeResearch") or {}).get("value")
    if value is None or value == "none":
        return None
    custom = None
    if value == "custom":
        answers = _read_layer_file(os.path.join(root, *ANSWERS.split("/")), ANSWERS)
        adv = answers.get("advanced") if isinstance(answers, dict) else None
        custom = adv.get("codeResearchCustom") if isinstance(adv, dict) else None
        named = isinstance(custom, dict) and isinstance(custom.get("name"), str)
        if not (named and isinstance(custom.get("url"), str)):
            return None
    return re.compile(_research_tool({"codeResearch": value, "codeResearchCustom": custom})["match"])


RULES = [
    ("commit-format", ".claude/rules/git.md"), ("attribution", ".claude/rules/git.md"),
    ("code-research", ".claude/skills/find/SKILL.md"), ("task-tracking", ".claude/rules/task-tracking.md"),
    ("ci-watch", ".claude/rules/token-efficiency.md"),
]


def _applicable(root, research):
    out = []
    for check, rule in RULES:
        if not os.path.isfile(os.path.join(root, *rule.split("/"))):
            out.append((check, rule, "%s is missing" % rule))
        elif check == "code-research" and research is None:
            out.append((check, rule, "no code-research tool is chosen"))
        else:
            out.append((check, rule, None))
    return out


def run_audit(root, config):
    """See runAudit in audit.js."""
    research = _research_pattern(root, config)
    checks = _applicable(root, research)
    skipped = [{"id": c, "why": why} for c, _, why in checks if why is not None]
    tallies = {c: {"id": c, "rule": rule, "seen": 0, "broken": 0, "examples": []}
               for c, rule, why in checks if why is None}
    folder = log_folder(root, config)
    found = [] if folder is None else _sessions(os.path.join(config, "projects", folder))
    counted, days = set(), []
    for sid, files in found:
        calls = _tool_calls(files, counted)
        days += [c["when"][:10] for c in calls if c["when"] and not c["copied"]]
        _tally_session(sid[:8], calls, tallies, research)
    days.sort(key=_code_units)
    logs = {"folder": folder, "sessions": len(found), "from": days[0] if days else None,
            "to": days[-1] if days else None}
    return {"logs": logs, "checks": list(tallies.values()), "skipped": skipped}


def _tally_session(session, every, tallies, research):
    """See tallySession in audit.js."""
    calls = [c for c in every if not c["copied"]]
    for call in calls:
        for check, measure in PER_CALL.items():
            hit = measure(call, research) if check in tallies else None
            if hit is not None:
                _count(tallies[check], hit[0], {"session": session, "when": call["when"], "text": hit[1]})
    edits = [c for c in calls if c["name"] in EDIT_TOOLS]
    if "task-tracking" in tallies and len(edits) >= EDITS_FOR_TASKS:
        tracked = any(c["name"] in TASK_TOOLS for c in every)
        _count(tallies["task-tracking"], not tracked,
               {"session": session, "when": edits[0]["when"], "text": "%d edits, no task list" % len(edits)})
