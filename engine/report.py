# Python twin of report.js: the same draft, scrubbed the same way.
# Standard library only.

import re
from urllib.parse import quote

from doctor import run_doctor
from update import _code_units

ISSUES = "https://github.com/starfoxcom/claude-code-templates/issues/new"

EDGE = "(?<![A-Za-z0-9_])"
TOKENS = [
    re.compile(EDGE + r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    re.compile(EDGE + r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(EDGE + r"(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9_])"),
    re.compile(EDGE + r"[A-Za-z0-9+/_-]{40,}={0,2}"),
]
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def _spellings(path):
    if not path or not re.sub(r"[\\/]", "", re.sub(r"^[A-Za-z]:", "", path)):
        return []
    forward = path.replace("\\", "/")
    back = path.replace("/", "\\")
    every = [path, forward, back, back.replace("\\", "\\\\")]
    drive = re.match(r"([A-Za-z]):/", forward)
    if drive:
        every += ["/%s/%s" % (drive.group(1), forward[3:]), "/mnt/%s/%s" % (drive.group(1), forward[3:])]
    unique = list(dict.fromkeys(every))
    return sorted(unique, key=lambda s: (-len(s.encode("utf-16-le", "surrogatepass")) // 2, _code_units(s)))


EYES = "Iiİı"


def _any_case(s):
    # See anyCase in report.js.
    out = []
    for c in s:
        if c in EYES:
            out.append("[%s]" % EYES)
            continue
        forms = sorted(f for f in {c, c.lower(), c.upper()} if len(f) == 1)
        out.append("[%s]" % "".join(forms) if len(forms) > 1 else re.escape(c))
    return "".join(out)


def scrub(text, repo=None, home=None, user=None):
    out = str(text)
    for path, mark in ((repo, "<repo>"), (home, "~")):
        for spelled in _spellings(path):
            out = re.sub(_any_case(spelled), lambda _m, mark=mark: mark, out)
    out = EMAIL.sub("<email>", out)
    if user and len(user) >= 3:
        out = re.sub(EDGE + _any_case(user) + "(?![A-Za-z0-9_])", lambda _m: "<user>", out)
    for pattern in TOKENS:
        out = pattern.sub("<token>", out)
    return out


def _quote(s):
    # encodeURIComponent's set of characters left as they are.
    return quote(s, safe="-_.!~*'()")


def draft_report(root, config, what, facts, who):
    """See draftReport in report.js."""
    doctor = run_doctor(root, config, facts["pluginVersion"], facts.get("cliVersion"))
    found = ["- %s (%s)" % (c["say"], c["id"]) for c in doctor["checks"] if not c["ok"]]
    command = what.get("command")
    if what.get("error"):
        happened = "`%s` failed:\n\n```\n%s\n```" % ("?" if command is None else command, what["error"])
    else:
        happened = "(not given)" if command is None else command
    cli = facts.get("cliVersion")
    lines = [
        "## What happened", happened, "",
        "## What I expected", "(not given)" if what.get("expected") is None else what["expected"], "",
        "## Doctor", "\n".join(found) if found else "No problems found.", "",
        "## Versions",
        "- Bindwright: %s" % facts["pluginVersion"],
        "- CLI: %s" % (".".join(map(str, cli)) if cli else "unknown"),
        "- OS: %s" % facts["os"],
        "- Engine: %s" % facts["engine"],
    ]
    body = scrub("\n".join(lines), **who)
    first = what.get("title")
    if first is None:
        error = what.get("error")
        first = ("report" if error is None else error).split("\n")[0]
    title = scrub("bug: " + first, **who)[:100]
    url = "%s?title=%s&body=%s" % (ISSUES, _quote(title), _quote(body[:6000]))
    return {"title": title, "body": body, "url": url}
