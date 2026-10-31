# Python twin of bind.js: turns answers into the finished file set for the
# user's repo root, byte for byte what the JS engine produces.
# `read_file(path)` returns the text of a repo-relative path.
#
# As a command, it binds from the repo this file sits in:
#   python engine/bind.py [--year N] < answers.json      -> {"files": [[dest, text], ...]}
#   python engine/bind.py --batch < jobs.json            -> one result per {"answers", "year", "version"} job
#   python engine/bind.py --code bw1-...                 -> the answers come from a setup code
#   python engine/bind.py --code bw1-... --write DIR     -> {"written": [...], "staged": [...], "skipped": [...]}
#   ... --write DIR --adopt                              -> the same, with every file outside .bindwright/ staged
#   python engine/bind.py --update DIR                   -> the saved answers rebound and merged (update.py)
#   python engine/bind.py --settings DIR                 -> the settings layers resolved for that repo (layers.py)
#   python engine/bind.py --doctor DIR                   -> a health check of that repo and this machine (doctor.py)
# A failed bind gives {"error": message} and, alone, exit status 1.

import json
import os
import re
import sys

# The twins sit beside this file. Isolated mode (python -I) leaves the
# script's own folder off the import path, so it is added here.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from model import validate, flags_for, choices_for, values_for, CHOICE_OPTIONS, DEFERRED, LICENSES, JS_WHITESPACE
from render import render_template, fill_placeholders
from setupcode import decode_setup_code, SetupCodeError
from apply import apply_files, ApplyError
from update import run_update
from layers import run_settings
from doctor import cli_version_from, run_doctor

CORE = "_core/project-template/"

# Files a repo often already has. They land in STAGING and the tailoring
# step merges them instead of the zip overwriting the user's copy.
MERGE_TARGETS = {
    "CLAUDE.md", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE", ".gitattributes", ".claude/settings.json",
}
STAGING = ".bindwright/incoming/"
# Setup's own folder; GLOBAL and the state files below live in it too.
OWN = ".bindwright/"

# Files for the user's ~/.claude, under the same paths there. Setup installs
# each one only with consent; the zip fallback leaves them to the reader.
GLOBAL = ".bindwright/global/"
GLOBAL_CORE = "_core/global-template/"

# Setup's own state, which the repo keeps for /bindwright:update: the answers
# as given, and the render they produced (the base of a three-way merge, so
# an update never overwrites hand edits silently) with the template version
# and the year it used. One file each, never a mirror folder: a copy of
# .claude/ or CLAUDE.md inside the repo would load as rules and skills.
ANSWERS = ".bindwright/project.json"
PRISTINE = ".bindwright/pristine.json"

# Guard hooks and the review gate's scripts ship byte for byte: they are
# code, not templates, and the render step's blank-line folding would still
# change them.
VERBATIM = (".claude/hooks/", ".github/scripts/")


def _included(path, a, flags):
    adv = a["advanced"]
    # The review gate's scripts, settings, guide and pin check serve both tiers.
    gate = flags["github_actions_routine_review"] or flags["github_actions_deep_review"]
    github = adv["tracker"] == "github"
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
        ".claude/rules/tracker.md": github,
        ".github/ISSUE_TEMPLATE/work-item.md": github,
        ".claude/scripts/research-adherence.py": flags["code_research_first"],
        ".github/scripts/size_check.py": flags["code_size_check"],
        ".github/workflows/size-check.yml": flags["code_size_check"],
        ".github/size-check/exceptions.txt": flags["code_size_check"],
        ".github/workflows/claude-code-review.yml.template": flags["github_actions_routine_review"],
        ".github/workflows/claude.yml.template": flags["github_actions_deep_review"],
        ".github/scripts/review_gate.py": gate,
        ".github/scripts/setup-review-gate.sh": gate,
        ".github/scripts/pin_check.py": gate,
        ".github/workflows/pin-check.yml": gate,
        ".github/review-gate.yml.template": gate,
        ".github/review-guide.md.template": gate,
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


def _global_files(a, ctx, read_file):
    """The ~/.claude files, as [dest, text] under GLOBAL: the global CLAUDE.md
    additions, the memory index, the push guard, the attribution guard when the
    guards live in ~/.claude, and the research hook for a tool without its own."""
    def verbatim(p):
        return read_file(GLOBAL_CORE + p).replace("\r\n", "\n")

    def render(p):
        return render_template(read_file(GLOBAL_CORE + p), ctx, GLOBAL_CORE + p)

    out = [
        ["CLAUDE.md.additions", render("CLAUDE.md.additions")],
        ["memory/MEMORY.md", render("memory-template/MEMORY.md")],
        ["hooks/push-guard.py", verbatim("hooks/push-guard.py")],
    ]
    if not ctx["flags"]["guard_hooks_repo"] and ctx["flags"]["attribution_guard"]:
        out.append(["hooks/no-ai-attribution.py", verbatim("hooks/no-ai-attribution.py")])
    profiles = json.loads(read_file(GLOBAL_CORE + "hooks/code-research-profiles.json"))
    hook = profiles[a["advanced"]["codeResearch"]]["hook"]
    if hook["source"] == "bindwright":
        # The custom profile's fields name the tool through placeholders of their own.
        def field(k):
            return fill_placeholders(hook[k], ctx["values"], ctx["deferred"], "profile hook " + k)

        values = dict(ctx["values"])
        values["TOOLS_CODE_RESEARCH_DETECTION_MODE"] = field("detection_mode")
        values["TOOLS_CODE_RESEARCH_DETECTION_TARGET"] = field("detection_target")
        values["TOOLS_CODE_RESEARCH_SEQUENCE_BULLETS"] = field("sequence_bullets")
        src = GLOBAL_CORE + "hooks/code-research-first.py.template"
        text = render_template(read_file(src), dict(ctx, values=values), src)
        out.append(["hooks/%s.py" % field("filename_basename"), text])
    return [[GLOBAL + dest, text] for dest, text in out]


def _state_json(value):
    # The bytes of bind.js's stateJson: JSON.stringify(value, null, 2) plus a newline.
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def _state_files(answers, files, version, year):
    """The state files for a bind's repo files: each under the path it belongs
    at, staged or not. The ~/.claude files are not the repo's, and setup's own
    files (session-steps.md) are the project's from the start, never merged."""
    pristine = [
        (dest[len(STAGING):] if dest.startswith(STAGING) else dest, text)
        for dest, text in files
        if dest.startswith(STAGING) or not dest.startswith(OWN)
    ]
    pristine.sort(key=lambda f: _code_units(f[0]))
    return [
        (ANSWERS, _state_json(answers)),
        (PRISTINE, _state_json({"version": version, "year": year, "files": dict(pristine)})),
    ]


def bind(answers, read_file, core_files, year=None, version=None):
    """Returns a dict of dest path -> rendered text, in the JS engine's order.
    `version` is the template version recorded in the pristine render."""
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
    files = list(out.items()) + [tuple(f) for f in _global_files(a, ctx, read_file)]
    files += _state_files(answers, files, version, values["YEAR"])
    return dict(sorted(files, key=lambda f: _code_units(f[0])))


# A command bind records the version in the VERSION file beside the engine
# folder (the repo's, or the pack's copy); a --batch job names its own.
_FROM_FILE = object()


def _stdin_json():
    # Bytes, decoded as UTF-8: sys.stdin uses the console code page on Windows.
    return json.loads(sys.stdin.buffer.read().decode("utf-8"))


def _option(argv, name):
    """The value after `name`, or None when the flag is absent."""
    if name not in argv:
        return None
    i = argv.index(name) + 1
    if i == len(argv) or argv[i].startswith("--"):
        raise ValueError(name + " needs a value")
    return argv[i]


def _single(argv, run):
    """One bind, from stdin or a setup code, optionally written to a folder."""
    try:
        code, year, folder = (_option(argv, n) for n in ("--code", "--year", "--write"))
        adopt = "--adopt" in argv
        if adopt and folder is None:
            raise ValueError("--adopt needs --write")
        answers = _stdin_json() if code is None else decode_setup_code(code)
        if year is not None and not re.fullmatch("[0-9]+", year):
            raise ValueError("--year needs a whole number")
        year = None if year is None else int(year)
    except ValueError as e:  # bad flags, a bad setup code or unreadable JSON
        return {"error": str(e)}
    result = run(answers, year)
    if folder is None or "error" in result:
        return result
    try:
        return apply_files(result["files"], folder, adopt)
    except (ApplyError, OSError) as e:
        return {"error": str(e)}


def _update(argv, read_file, core_files):
    """The saved answers rebound with today's templates and merged into the repo."""
    try:
        folder = _option(argv, "--update")
        version = read_file("VERSION").strip(JS_WHITESPACE).lstrip("v")
        bind_with = lambda answers, year: bind(answers, read_file, core_files, year, version)
        return run_update(folder, bind_with, version, _state_json)
    except Exception as e:  # every failure is reported, as the JS engine throws it
        return {"error": str(e)}


def _settings(argv):
    """The settings layers of the repo at --settings DIR, for this machine's config folder."""
    try:
        folder = _option(argv, "--settings")
        config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
        return run_settings(folder, config)
    except Exception as e:  # every failure is reported, as the JS engine throws it
        return {"error": str(e)}


def _doctor(argv, read_file):
    """The doctor, for the CLI this session runs (its AI_AGENT) and this plugin's VERSION."""
    try:
        folder = _option(argv, "--doctor")
        version = read_file("VERSION").strip(JS_WHITESPACE).lstrip("v")
        config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
        return run_doctor(folder, config, version, cli_version_from(os.environ.get("AI_AGENT")))
    except Exception as e:  # every failure is reported, as the JS engine throws it
        return {"error": str(e)}


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

    def run(answers, year, version=_FROM_FILE):
        try:
            if version is _FROM_FILE:
                version = read_file("VERSION").strip(JS_WHITESPACE).lstrip("v")
            return {"files": [[k, v] for k, v in bind(answers, read_file, core_files, year, version).items()]}
        except Exception as e:  # every failure is reported, as the JS engine throws it
            return {"error": str(e)}

    if "--batch" in argv:
        result = [run(j["answers"], j.get("year"), j.get("version")) for j in _stdin_json()]
    elif "--update" in argv:
        result = _update(argv, read_file, core_files)
    elif "--settings" in argv:
        result = _settings(argv)
    elif "--doctor" in argv:
        result = _doctor(argv, read_file)
    else:
        result = _single(argv, run)
    # ASCII output, so no console code page can mangle it; compact, as cli.js prints it.
    sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
    return 1 if isinstance(result, dict) and "error" in result else 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
