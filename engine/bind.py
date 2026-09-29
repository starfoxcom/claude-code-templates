# Python twin of bind.js: turns answers into the finished file set for the
# user's repo root, byte for byte what the JS engine produces.
# `read_file(path)` returns the text of a repo-relative path.
#
# As a command, it binds from the repo this file sits in:
#   python engine/bind.py [--year N] < answers.json      -> {"files": [[dest, text], ...]}
#   python engine/bind.py --batch < jobs.json            -> one result per {"answers", "year"} job
# A failed bind gives {"error": message} and, alone, exit status 1.

import json
import os
import re
import sys

from model import validate, flags_for, choices_for, values_for, CHOICE_OPTIONS, DEFERRED, LICENSES, JS_WHITESPACE
from render import render_template

CORE = "_core/project-template/"

# Files a repo often already has. They land in STAGING and the tailoring
# step merges them instead of the zip overwriting the user's copy.
MERGE_TARGETS = {
    "CLAUDE.md", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE", ".gitattributes", ".claude/settings.json",
}
STAGING = ".bindwright/incoming/"

# Guard hooks ship byte for byte: they are code, not templates, and the
# render step's blank-line folding would still change them.
VERBATIM = ".claude/hooks/"


def _included(path, a, flags):
    adv = a["advanced"]
    if path.startswith("precommit/"):
        return False
    if path.startswith(".claude/rules/architecture/"):
        return False
    if path.startswith(".claude/skills/architecture-graph/"):
        return False
    by_file = {
        "CONTRIBUTING.md": a["team"],
        ".github/CODEOWNERS.template": a["team"],
        ".github/PULL_REQUEST_TEMPLATE.md": a["team"] or a["client"],
        ".claude/rules/collaboration.md": a["team"],
        ".claude/rules/confidentiality.md": adv["confidentiality"],
        ".claude/rules/clean-room.md": adv["cleanRoom"],
        ".claude/rules/shipped-text.md": adv["plainWriting"],
        ".claude/rules/visual.md": adv["uiRule"],
        ".claude/rules/review-tiers.md": adv["aiReview"],
        ".claude/scripts/research-adherence.py": flags["code_research_first"],
        ".github/workflows/claude-code-review.yml.template": flags["github_actions_routine_review"],
        ".github/workflows/claude.yml.template": flags["github_actions_deep_review"],
        ".claude/hooks/run-hook.sh": flags["guard_hooks_repo"],
        ".claude/hooks/push-guard.py": flags["guard_hooks_repo"],
        ".claude/hooks/no-ai-attribution.py": flags["guard_hooks_repo"] and flags["attribution_guard"],
        ".gitattributes": flags["guard_hooks_repo"],
    }
    return by_file.get(path, True)


# The writing rule keeps its default globs in its own frontmatter, so setups
# that never set `shippedTextPaths` render it untouched. A project list
# replaces that `paths:` block; a template whose header lost that shape
# fails the bind instead of shipping the defaults silently.
SHIPPED_TEXT_RULE = ".claude/rules/shipped-text.md"
# JavaScript's `.` stops at these four characters, Python's only at \n.
PATHS_BLOCK = re.compile("---\npaths:\n(?: {2}- [^\n\r  ]*\n)+---\n")


def _with_paths(text, globs, file):
    m = PATHS_BLOCK.match(text)
    if not m:
        raise ValueError("%s: no paths frontmatter to replace" % file)
    return "---\npaths:\n" + "".join('  - "%s"\n' % g for g in globs) + "---\n" + text[m.end():]


def _destination(path):
    dest = path[: -len(".template")] if path.endswith(".template") else path
    return STAGING + dest if dest in MERGE_TARGETS else dest


def _code_units(s):
    # JavaScript compares strings by UTF-16 code unit.
    return s.encode("utf-16-be", "surrogatepass")


def plan_files(answers, core_files, precommit_profiles):
    """Returns [{"src", "dest"}] with repo-relative src paths."""
    a = validate(answers)
    flags = flags_for(a)
    adv = a["advanced"]
    plan = [{"src": CORE + p, "dest": _destination(p)} for p in core_files if _included(p, a, flags)]
    if adv["architecture"] != "none":
        plan.append({"src": "%s.claude/rules/architecture/%s.md" % (CORE, adv["architecture"]), "dest": ".claude/rules/architecture.md"})
    if adv["precommit"] != "none":
        profile = precommit_profiles[adv["precommit"]]
        plan.append({"src": CORE + profile["template_ref"], "dest": profile["config_filename"]})
    return sorted(plan, key=lambda f: _code_units(f["dest"]))


def bind(answers, read_file, core_files, year=None):
    """Returns a dict of dest path -> rendered text, in the JS engine's order."""
    a = validate(answers)
    adv = a["advanced"]
    precommit_profiles = json.loads(read_file(CORE + "precommit/precommit-profiles.json"))
    values = values_for(a, year)
    if adv["precommit"] != "none":
        p = precommit_profiles[adv["precommit"]]
        values["TOOLS_PRECOMMIT_NAME"] = adv["precommit"]
        values["TOOLS_PRECOMMIT_URL"] = p["url"]
    license_text = read_file("_core/licenses/" + LICENSES[a["project"]["license"]])
    ctx = {"flags": flags_for(a), "choices": choices_for(a), "options": CHOICE_OPTIONS, "values": values, "deferred": DEFERRED}
    values["LICENSE_BODY"] = render_template(license_text, ctx, "license").rstrip(JS_WHITESPACE)

    out = {}
    for f in plan_files(a, core_files, precommit_profiles):
        text = read_file(f["src"])
        dest = f["dest"]
        out[dest] = text.replace("\r\n", "\n") if dest.startswith(VERBATIM) else render_template(text, ctx, f["src"])
    if SHIPPED_TEXT_RULE in out and adv["shippedTextPaths"]:
        out[SHIPPED_TEXT_RULE] = _with_paths(out[SHIPPED_TEXT_RULE], adv["shippedTextPaths"], SHIPPED_TEXT_RULE)
    return out


def _main(argv):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache = {}

    def read_file(path):
        if path not in cache:
            # newline="" keeps \r\n, as Node's readFileSync does; the render
            # step normalises line endings itself.
            with open(os.path.join(root, path), encoding="utf-8", newline="") as fh:
                cache[path] = fh.read()
        return cache[path]

    core_files = json.loads(read_file("engine/core-files.json"))

    def run(answers, year):
        try:
            return {"files": [[k, v] for k, v in bind(answers, read_file, core_files, year).items()]}
        except Exception as e:  # every failure is reported, as the JS engine throws it
            return {"error": str(e)}

    # Bytes, decoded as UTF-8: sys.stdin uses the console code page on Windows.
    job = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if "--batch" in argv:
        result = [run(j["answers"], j.get("year")) for j in job]
    else:
        year = int(argv[argv.index("--year") + 1]) if "--year" in argv else None
        result = run(job, year)
    # ASCII output, so no console code page can mangle it.
    sys.stdout.write(json.dumps(result, ensure_ascii=True))
    return 1 if isinstance(result, dict) and "error" in result else 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
