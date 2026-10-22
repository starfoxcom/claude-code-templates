"""The review gate's logic, shared by the routine and deep review workflows so
the workflow files stay the same for every project. The workflows make the
GitHub API calls; this script only decides. Standard library, Python 3.8+.

    review_gate.py triage FILES [--incomplete]      -> {"review": true|false}
    review_gate.py verdict --since TS --marker RE   -> {"verdict": "pass"|"block"|"missing", "line": ...}
        (reads the PR's comments as `gh api --paginate` prints them, on stdin)
    review_gate.py decide --triage reviewable|skip --routine R [--escalated] [--deep D]
        -> {"status", "conclusion", "title", "summary"} for the "Review gate" check
    review_gate.py settings [--file .github/review-gate.yml] -> KEY=value lines

Every command prints one line; a bad argument prints {"error": ...} and exits 1.
"""

import json
import re
import sys

# Never reviewed: the review action refuses to run on a PR whose copy of the
# review workflow differs from the default branch's, so a workflow-only PR has
# to pass as non-reviewable. Excluded by path on purpose, never by extension.
NEVER = re.compile(r"^\.github/workflows/")
# Source, data and contract files, plus everything under _core/, which lands
# verbatim in users' repos (and CLAUDE.md.additions in their ~/.claude).
REVIEWABLE = re.compile(r"\.(html|jsx|js|json|yml|yaml|py|template)$|^_core/|\.additions$|/bundle\.toggles\.md$")
# The files API stops at 3,000 entries: a listing that long may be cut short.
LISTING_CAP = 3000

BOT = "claude[bot]"
TIER_RESULTS = ("pass", "block", "missing", "error")

DEFAULTS = {
    "checks": "one",
    "routine.model": "claude-fable-5-1", "routine.effort": "low", "routine.max_turns": "120",
    "deep.model": "claude-fable-5-1", "deep.effort": "low", "deep.max_turns": "120",
    "fallback.model": "claude-opus-5-5", "fallback.effort": "high",
}
CHECKS = {
    "checks": re.compile(r"one|two"),
    "model": re.compile(r"[a-z0-9][a-z0-9.-]{0,63}"),
    "effort": re.compile(r"low|medium|high|xhigh|max"),
    "max_turns": re.compile(r"[1-9][0-9]{0,2}"),
}


class GateError(Exception):
    pass


def triage(paths, incomplete=False):
    """Whether a diff with these changed paths gets an AI review."""
    if incomplete or len(paths) >= LISTING_CAP:
        return True
    return any(REVIEWABLE.search(p) and not NEVER.search(p) for p in paths)


def _comments(text):
    """Every comment in `gh api --paginate` output, which prints one JSON array per page."""
    decoder, out, i = json.JSONDecoder(), [], 0
    while True:
        while i < len(text) and text[i].isspace():
            i += 1
        if i == len(text):
            return out
        page, i = decoder.raw_decode(text, i)
        if not isinstance(page, list):
            raise GateError("the comments are not a JSON list")
        out.extend(page)


def verdict(text, since, marker):
    """The verdict in the bot's newest comment that matches `marker` and was
    posted at or after `since`: the last line holding 🔴 or 🟢."""
    pattern = re.compile(marker)
    bodies = [c.get("body") or "" for c in _comments(text)
              if isinstance(c, dict) and (c.get("user") or {}).get("login") == BOT
              and (c.get("created_at") or "") >= since and pattern.search(c.get("body") or "")]
    if not bodies:
        return {"verdict": "missing", "line": ""}
    lines = [l for l in bodies[-1].splitlines() if "🔴" in l or "🟢" in l]
    if not lines:
        return {"verdict": "missing", "line": ""}
    return {"verdict": "block" if "🔴" in lines[-1] else "pass", "line": lines[-1].strip()}


def _check(status, conclusion, title, summary):
    return {"status": status, "conclusion": conclusion, "title": title, "summary": summary}


def decide(triage_result, routine=None, escalated=False, deep=None):
    """The "Review gate" check for the tiers' results so far. Fails closed:
    anything but a clean pass from every tier that ran blocks the merge."""
    if triage_result == "skip":
        return _check("completed", "success", "No review needed", "The diff has no reviewable files.")
    failed = {
        "block": ("Blocked by the {} review", "The {} review found something to fix. Fix it on the PR branch and push."),
        "missing": ("No {} verdict", "The {} review finished without a 🟢 or 🔴 line. Re-run it."),
        "error": ("The {} review errored", "No {} review attempt ran to the end. Re-run it."),
    }
    if routine != "pass":
        title, summary = failed[routine]
        return _check("completed", "failure", title.format("routine"), summary.format("routine"))
    if not escalated:
        return _check("completed", "success", "Routine review 🟢", "The routine review passed and asked for no deep review.")
    if deep is None:
        return _check("in_progress", None, "Deep review in progress", "The routine review passed and asked for a deep review.")
    if deep != "pass":
        title, summary = failed[deep]
        return _check("completed", "failure", title.format("deep"), summary.format("deep"))
    return _check("completed", "success", "Routine and deep reviews 🟢", "Both review tiers passed.")


def settings(text):
    """KEY=value pairs from review-gate.yml: top-level keys and one level of
    nesting, `#` comments. Unknown keys and bad values are errors, never ignored."""
    values, section = dict(DEFAULTS), None
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        m = re.fullmatch(r"( *)([a-z_]+):\s*(.*)", line)
        if not m:
            raise GateError("review-gate.yml line %d: expected `key: value`" % n)
        indent, key, value = m.groups()
        if not indent and not value:
            section = key
            continue
        name = "%s.%s" % (section, key) if indent else key
        if indent and section is None:
            raise GateError("review-gate.yml line %d: indented key outside a section" % n)
        if name not in DEFAULTS:
            raise GateError("review-gate.yml line %d: unknown setting %s" % (n, name))
        value = value.strip().strip("\"'")
        if not CHECKS[name.split(".")[-1]].fullmatch(value):
            raise GateError("review-gate.yml line %d: bad value for %s: %s" % (n, name, value))
        values[name] = value
        section = section if indent else None
    return values


def _option(args, name, default=None):
    if name not in args:
        return default
    i = args.index(name) + 1
    if i == len(args):
        raise GateError(name + " needs a value")
    return args[i]


def _choice(value, allowed, name):
    if value not in allowed:
        raise GateError("%s must be one of %s" % (name, ", ".join(allowed)))
    return value


def run(argv):
    cmd, args = (argv[0], argv[1:]) if argv else ("", [])
    if cmd == "triage" and args:
        with open(args[0], encoding="utf-8") as fh:
            paths = [l.strip() for l in fh if l.strip()]
        return {"review": triage(paths, "--incomplete" in args)}
    if cmd == "verdict":
        since, marker = _option(args, "--since"), _option(args, "--marker")
        if not since or not marker:
            raise GateError("verdict needs --since and --marker")
        # Bytes, not text: the verdict emoji must not depend on the runner's locale.
        return verdict(sys.stdin.buffer.read().decode("utf-8"), since, marker)
    if cmd == "decide":
        tri = _choice(_option(args, "--triage"), ("reviewable", "skip"), "--triage")
        routine = _option(args, "--routine")
        deep = _option(args, "--deep")
        if tri == "reviewable":
            _choice(routine, TIER_RESULTS, "--routine")
        if deep is not None:
            _choice(deep, TIER_RESULTS, "--deep")
        return decide(tri, routine, "--escalated" in args, deep)
    if cmd == "settings":
        path = _option(args, "--file", ".github/review-gate.yml")
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except FileNotFoundError:
            text = ""
        return settings(text)
    raise GateError("Usage: see the top of .github/scripts/review_gate.py")


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        result = run(argv)
    except (GateError, OSError, ValueError) as e:
        print(json.dumps({"error": str(e)}))
        return 1
    if argv and argv[0] == "settings":
        print("\n".join("%s=%s" % (k.replace(".", "_"), v) for k, v in result.items()))
    else:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
