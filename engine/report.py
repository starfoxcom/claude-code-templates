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
    if not path:
        return []
    forward = path.replace("\\", "/")
    back = path.replace("/", "\\")
    every = [path, forward, back, back.replace("\\", "\\\\")]
    unique = list(dict.fromkeys(every + [s.lower() for s in every]))
    return sorted(unique, key=lambda s: (-len(s.encode("utf-16-le", "surrogatepass")) // 2, _code_units(s)))


def scrub(text, repo=None, home=None, user=None):
    out = str(text)
    for path, mark in ((repo, "<repo>"), (home, "~")):
        for spelled in _spellings(path):
            out = out.replace(spelled, mark)
    out = EMAIL.sub("<email>", out)
    if user and len(user) >= 3:
        out = re.sub(EDGE + re.escape(user) + "(?![A-Za-z0-9_])", "<user>", out)
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
    title = scrub(("bug: " + first)[:100], **who)
    url = "%s?title=%s&body=%s" % (ISSUES, _quote(title), _quote(body[:6000]))
    return {"title": title, "body": body, "url": url}
