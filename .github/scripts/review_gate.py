"""The review gate's logic, shared by the routine and deep review workflows so
the workflow files stay the same for every project. Standard library and the
runner's `gh`, Python 3.8+. The workflows run the copy from the base branch.

    review_gate.py triage FILES [--incomplete]      -> {"review": true|false}
    review_gate.py verdict --since TS (--tier routine --marker RE | --tier deep)
        -> {"verdict": "pass"|"block"|"missing", "line": ...}
        (reads the PR's comments as `gh api --paginate` prints them, on stdin)
    review_gate.py gate --state STATE [--triage T] [--routine R] [--escalated] [--deep D]
        -> {"status", "conclusion", "title", "summary", "state"} for the "Review gate" check
    review_gate.py upsert --repo OWNER/NAME --sha HEAD [facts as for gate] [--note TEXT]
        -> the same, after creating or updating the check on that commit (GH_TOKEN
           needs checks: write); --note is appended to the check's summary
    review_gate.py settings [--file .github/review-gate.yml] -> KEY=value lines

The "Review gate" check carries its own state in its external_id, e.g.
"triage=reviewable;routine=pass;escalated=yes;deep=none" (an empty one is
the start state). Each review workflow reads it, sets the facts it knows
and writes back the result, so whichever finishes last has every fact.
T: reviewable|skip; R: pending|pass|block|missing|error; D: none|pass|block|missing|error.
--escalated only ever turns on: once a deep review was asked for, it stays asked.
A workflow that cannot tell a fact leaves its option out, keeping the stored value.

Every command prints one line; a bad argument prints {"error": ...} and exits 1.
"""

import json
import re
import subprocess
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

GATE = "Review gate"
BOT = "claude[bot]"
# A deep verdict comment: the review action's finished tracking comment, or
# the comment the CLI run on the API credits posts under this heading.
DEEP_MARKER = re.compile(r"\A(\*\*Claude finished|## Deep review)")
VERDICTS = ("pass", "block", "missing", "error")
STATE_VALUES = {
    "triage": ("reviewable", "skip"),
    "routine": ("pending",) + VERDICTS,
    "escalated": ("no", "yes"),
    "deep": ("none",) + VERDICTS,
}
START_STATE = {"triage": "reviewable", "routine": "pending", "escalated": "no", "deep": "none"}

DEFAULTS = {
    "checks": "one",
    "routine.model": "claude-fable-5-1", "routine.effort": "low", "routine.max_turns": "120",
    "deep.model": "claude-fable-5-1", "deep.effort": "low", "deep.max_turns": "120",
    "fallback.model": "claude-opus-5-5", "fallback.effort": "high",
}
SECTIONS = {k.split(".")[0] for k in DEFAULTS if "." in k}
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


def _is_tier(body, tier, marker):
    if DEEP_MARKER.search(body):
        return tier == "deep"
    return tier == "routine" and marker.search(body) is not None


def verdict(text, since, tier, marker=None):
    """The verdict in the bot's newest comment of `tier` posted at or after
    `since`: the last line holding 🔴 or 🟢. A routine comment matches
    `marker` and is never a deep one, even when a deep review quotes it."""
    pattern = re.compile(marker) if marker else None
    bodies = [c.get("body") or "" for c in _comments(text)
              if isinstance(c, dict) and (c.get("user") or {}).get("login") == BOT
              and (c.get("created_at") or "") >= since and _is_tier(c.get("body") or "", tier, pattern)]
    if not bodies:
        return {"verdict": "missing", "line": ""}
    lines = [l for l in bodies[-1].splitlines() if "🔴" in l or "🟢" in l]
    if not lines:
        return {"verdict": "missing", "line": ""}
    return {"verdict": "block" if "🔴" in lines[-1] else "pass", "line": lines[-1].strip()}


def _check(status, conclusion, title, summary):
    return {"status": status, "conclusion": conclusion, "title": title, "summary": summary}


FAILED = {
    "block": ("Blocked by the {} review", "The {} review found something to fix. Fix it on the PR branch and push."),
    "missing": ("No {} verdict", "The {} review finished without a 🟢 or 🔴 line. Re-run it."),
    "error": ("The {} review errored", "No {} review attempt ran to the end. Re-run it."),
}


def _failed(result, tier):
    title, summary = FAILED[result]
    return _check("completed", "failure", title.format(tier), summary.format(tier))


def decide(triage_result, routine=None, escalated=False, deep=None):
    """The "Review gate" check from everything known so far. Both review
    workflows call this with the same facts, so whichever finishes last
    writes the full answer. Fails closed: anything but a clean pass from
    every tier that ran, or was asked for, blocks the merge."""
    if deep not in (None, "pass"):
        return _failed(deep, "deep")
    if triage_result == "skip":
        if deep == "pass":
            return _check("completed", "success", "Deep review 🟢", "The diff has no reviewable files and the deep review passed.")
        if escalated:
            return _check("in_progress", None, "Deep review in progress", "A deep review was asked for on a diff with no reviewable files.")
        return _check("completed", "success", "No review needed", "The diff has no reviewable files.")
    if routine == "pending":
        return _check("in_progress", None, "Routine review in progress", "Waiting for the routine review's verdict.")
    if routine != "pass":
        return _failed(routine, "routine")
    if deep == "pass":
        return _check("completed", "success", "Routine and deep reviews 🟢", "Both review tiers passed.")
    if escalated:
        return _check("in_progress", None, "Deep review in progress", "The routine review passed and asked for a deep review.")
    return _check("completed", "success", "Routine review 🟢", "The routine review passed and asked for no deep review.")


def parse_state(text):
    """The gate state stored in the check's external_id; empty is the start state."""
    state = dict(START_STATE)
    for part in filter(None, text.split(";")):
        key, _, value = part.partition("=")
        if value not in STATE_VALUES.get(key, ()):
            raise GateError("bad gate state: " + part)
        state[key] = value
    return state


def gate(state_text, triage=None, routine=None, escalated=False, deep=None):
    """Set the facts this workflow knows on the stored state, then decide."""
    state = parse_state(state_text)
    for key, value in (("triage", triage), ("routine", routine), ("deep", deep)):
        if value is not None:
            state[key] = _choice(value, STATE_VALUES[key], "--" + key)
    if escalated:
        state["escalated"] = "yes"
    check = decide(state["triage"], state["routine"], state["escalated"] == "yes",
                   None if state["deep"] == "none" else state["deep"])
    check["state"] = ";".join("%s=%s" % (k, state[k]) for k in START_STATE)
    return check


def _gh(path, method="GET", body=None):
    cmd = ["gh", "api", path, "-X", method] + (["--input", "-"] if body is not None else [])
    r = subprocess.run(cmd, input=json.dumps(body).encode("utf-8") if body is not None else None,
                       capture_output=True)
    if r.returncode:
        raise GateError("gh api %s %s failed: %s" % (method, path, r.stderr.decode("utf-8", "replace").strip()))
    return json.loads(r.stdout.decode("utf-8") or "null")


def check_body(check, note=""):
    """The Checks API body for a gate decision."""
    body = {"status": check["status"], "external_id": check["state"],
            "output": {"title": check["title"], "summary": (check["summary"] + " " + note).strip()}}
    if check["conclusion"]:
        body["conclusion"] = check["conclusion"]
    return body


def upsert(repo, sha, note="", **facts):
    """Decide from the gate check's stored state plus `facts`, then write the
    result back to the check on `sha`, creating it on the first call."""
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise GateError("upsert needs --repo OWNER/NAME and a 40-character --sha")
    runs = _gh("repos/%s/commits/%s/check-runs?check_name=Review%%20gate&per_page=100" % (repo, sha))
    mine = [r for r in runs.get("check_runs", []) if r.get("name") == GATE]
    current = max(mine, key=lambda r: r["id"]) if mine else None
    check = gate((current or {}).get("external_id") or "", **facts)
    body = check_body(check, note)
    if current:
        _gh("repos/%s/check-runs/%d" % (repo, current["id"]), "PATCH", body)
    else:
        _gh("repos/%s/check-runs" % repo, "POST", dict(body, name=GATE, head_sha=sha))
    return check


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
            if key not in SECTIONS:
                raise GateError("review-gate.yml line %d: %s needs a value" % (n, key) if key in DEFAULTS
                                else "review-gate.yml line %d: unknown section %s" % (n, key))
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
        since = _option(args, "--since")
        tier = _choice(_option(args, "--tier"), ("routine", "deep"), "--tier")
        marker = _option(args, "--marker")
        if not since or (tier == "routine") != bool(marker):
            raise GateError("verdict needs --since, and --marker exactly when --tier is routine")
        # Bytes, not text: the verdict emoji must not depend on the runner's locale.
        return verdict(sys.stdin.buffer.read().decode("utf-8"), since, tier, marker)
    if cmd in ("gate", "upsert"):
        facts = {"triage": _option(args, "--triage"), "routine": _option(args, "--routine"),
                 "escalated": "--escalated" in args, "deep": _option(args, "--deep")}
        if cmd == "upsert":
            return upsert(_option(args, "--repo", ""), _option(args, "--sha", ""), _option(args, "--note", ""), **facts)
        if "--state" not in args:
            raise GateError("gate needs --state (an empty one is the start state)")
        return gate(_option(args, "--state"), **facts)
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
