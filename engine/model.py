# Python twin of model.js: the answer model and everything derived from it.
# Keep the two in step; test/golden.test.js fails when their binds differ.
# Standard library only, Python 3.8+.

import datetime
import re

# The pins this repo's own review workflows run on. The routine and deep
# models must be ones the pinned claude-code-action accepts; the backup runs
# on the CLI_VERSION the workflow templates install, so it must be one that
# version accepts. Change them together with those pins, never on their own.
REVIEW_MODELS = {"routine": "claude-fable-5-1", "deep": "claude-fable-5-1", "backup": "claude-opus-5-5"}
REVIEW_EFFORTS = {"routine": "low", "deep": "low", "backup": "high"}

CODE_RESEARCH_TOOLS = {
    # match: regex over tool-call names, used by the session-close adherence count.
    "tokensave": {"name": "tokensave", "url": "https://github.com/aovestdipaperino/tokensave", "bypass": "TOKENSAVE_BYPASS:", "match": "tokensave"},
    "lsp-plugins": {"name": "Claude Code LSP plugins", "url": "https://code.claude.com/docs/en/discover-plugins", "bypass": None, "match": "^LSP$"},
    "codegraph": {"name": "CodeGraph", "url": "https://github.com/colbymchenry/codegraph", "bypass": None, "match": "codegraph"},
    "serena": {"name": "Serena", "url": "https://github.com/oraios/serena", "bypass": None, "match": "serena"},
    "codebase-memory": {"name": "codebase-memory-mcp", "url": "https://github.com/DeusData/codebase-memory-mcp", "bypass": None, "match": "codebase.memory"},
    "none": {"name": "none", "url": "(no homepage)", "bypass": None, "match": None},
}

PRECOMMIT_MANAGERS = ["lefthook", "husky", "pre-commit", "simple-git-hooks"]
# Merge commits by default: every branch stays visible in the history graph.
MERGE_STYLES = ["merge", "squash", "rebase"]
ARCHITECTURES = ["none", "clean", "ddd", "ecs", "feature-based", "hexagonal", "layered", "mvc"]
# Where the guard hooks live: shipped in the repo (teammates and cloud
# sessions get them), or only in each person's ~/.claude (global-template).
HOOK_LOCATIONS = ["repo", "home"]
# How much the committed deny list blocks. "standard" stops force pushes,
# direct pushes to the protected branches, interactive rebase and admin
# merges; "strict" also stops local history wipes and destructive gh calls.
DENY_PROFILES = ["standard", "strict"]
LICENSES = {"MIT": "MIT.txt", "Apache-2.0": "Apache-2.0.txt", "BSD-3-Clause": "BSD-3-Clause.txt", "Proprietary": "Proprietary.txt"}

# Filled later by the tailoring step, which reads the user's repo.
DEFERRED = {
    "ONE_LINE_DESCRIPTION", "LANGUAGE_AND_FRAMEWORK", "CONVERSATION_LANGUAGE", "CODE_LANGUAGE",
    "LINT_COMMAND", "TYPECHECK_COMMAND", "TEST_COMMAND", "STACK_COMMANDS_ALLOWLIST",
    "LEAD_USER", "TEAM_OR_USER",
}

# What JavaScript's trim() and trimEnd() remove. str.strip() alone differs
# (it keeps U+FEFF and removes U+0085 and U+001C-U+001F).
JS_WHITESPACE = (
    "\t\n\v\f\r           "
    "       　﻿"
)

# Stands in for JavaScript's undefined when an answer is missing.
UNDEFINED = object()


def js_str(v):
    """String(v) as JavaScript writes it, for error messages that match model.js."""
    if v is UNDEFINED:
        return "undefined"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)
    if isinstance(v, list):
        return ",".join("" if e is None or e is UNDEFINED else js_str(e) for e in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def utf16_len(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def defaults(team=False, client=False):
    return {
        "team": team, "client": client,
        "project": {"name": "my-project", "repoUrl": "", "licenseHolder": "", "license": "Proprietary" if client else "MIT"},
        "advanced": {
            "aiReview": True,
            "deepEscalation": team,
            "precommit": "lefthook" if team else "none",
            "uiRule": False,
            "confidentiality": client,
            "cleanRoom": False,
            "plainWriting": False,
            "codeResearch": "none",
            "branching": "gitflow",
            "devIsDefault": False,
            "mergeStyle": "merge",
            "architecture": "none",
            "hookLocation": "repo",
            "attributionGuard": True,
            "denyProfile": "standard",
            # Files the writing rule checks. None keeps the rule's own list.
            "shippedTextPaths": None,
        },
    }


class AnswerError(ValueError):
    pass


def _check(cond, msg):
    if not cond:
        raise AnswerError("Invalid answers: " + msg)


def _is_bool(v):
    return type(v) is bool


def _own(obj, key):
    return isinstance(key, str) and key in obj


def _glob_ok(g):
    return (isinstance(g, str) and 1 <= utf16_len(g) <= 200
            and not any(c in '"\\' or ord(c) <= 0x1F or ord(c) == 0x7F for c in g)
            and g.strip(JS_WHITESPACE) == g)


def validate(a):
    adv = a["advanced"]
    project = a["project"]
    get = lambda d, k: d.get(k, UNDEFINED)
    _check(_is_bool(get(a, "team")) and _is_bool(get(a, "client")), "team and client must be true or false")
    for key in ["aiReview", "deepEscalation", "uiRule", "confidentiality", "cleanRoom", "plainWriting"]:
        _check(_is_bool(get(adv, key)), key + " must be true or false")
    name = get(project, "name")
    _check(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", name) is not None,
           "project name must be 1-64 letters, digits, dot, dash or underscore")
    _check(isinstance(get(project, "repoUrl"), str) and isinstance(get(project, "licenseHolder"), str),
           "repoUrl and licenseHolder must be text")
    _check(_own(LICENSES, get(project, "license")), 'unknown license "%s"' % js_str(get(project, "license")))
    _check(_own(CODE_RESEARCH_TOOLS, get(adv, "codeResearch")), 'unknown code-research tool "%s"' % js_str(get(adv, "codeResearch")))
    precommit = get(adv, "precommit")
    _check(precommit == "none" or (isinstance(precommit, str) and precommit in PRECOMMIT_MANAGERS),
           'unknown pre-commit manager "%s"' % js_str(precommit))
    _check(isinstance(get(adv, "architecture"), str) and adv["architecture"] in ARCHITECTURES,
           'unknown architecture "%s"' % js_str(get(adv, "architecture")))
    _check(isinstance(get(adv, "branching"), str) and adv["branching"] in ["gitflow", "trunk"],
           'unknown branching model "%s"' % js_str(get(adv, "branching")))
    _check(isinstance(get(adv, "mergeStyle"), str) and adv["mergeStyle"] in MERGE_STYLES,
           'unknown merge style "%s"' % js_str(get(adv, "mergeStyle")))
    _check(_is_bool(get(adv, "devIsDefault")), "devIsDefault must be true or false")
    _check(isinstance(get(adv, "hookLocation"), str) and adv["hookLocation"] in HOOK_LOCATIONS,
           'unknown hook location "%s"' % js_str(get(adv, "hookLocation")))
    _check(_is_bool(get(adv, "attributionGuard")), "attributionGuard must be true or false")
    _check(isinstance(get(adv, "denyProfile"), str) and adv["denyProfile"] in DENY_PROFILES,
           'unknown deny profile "%s"' % js_str(get(adv, "denyProfile")))
    # Each glob lands in a double-quoted YAML string, so quotes, backslashes
    # and control characters are refused rather than escaped.
    paths = get(adv, "shippedTextPaths")
    _check(paths is None or (isinstance(paths, list) and len(paths) > 0 and all(_glob_ok(g) for g in paths)),
           "shippedTextPaths must be null or a non-empty list of globs without quotes, backslashes, line breaks or outer spaces")
    return a


# Every toggle name the templates use must resolve here to True or False.
def flags_for(a):
    adv = a["advanced"]
    solo_own = not a["team"] and not a["client"]
    return {
        "github_actions_routine_review": adv["aiReview"],
        "github_actions_deep_review": adv["aiReview"],
        "github_actions_deep_review_auto_fire": adv["aiReview"] and adv["deepEscalation"],
        "github_actions_paths_ignore_auto_merge": adv["aiReview"] and solo_own,
        "code_research_first": adv["codeResearch"] != "none",
        "precommit_hooks_scaffold": adv["precommit"] != "none",
        "branching_model_gitflow": adv["branching"] == "gitflow",
        "branching_model_trunk": adv["branching"] == "trunk",
        "default_branch_is_dev": adv["branching"] == "gitflow" and adv["devIsDefault"],
        "guard_hooks_repo": adv["hookLocation"] == "repo",
        "attribution_guard": adv["attributionGuard"],
        "deny_list_strict": adv["denyProfile"] == "strict",
        "contributing_md": a["team"],
        "audit_trail_commits": a["client"],
        "definition_of_done_verification": True,
        "context_refresh_files": True,
        "lazy_rules_folder": True,
        "memory_system": True,
    }


# Every value a template may name in a choice block. An unlisted value fails
# the render, so retired options cannot linger as dead blocks.
CHOICE_OPTIONS = {
    "code_research": list(CODE_RESEARCH_TOOLS),
    "precommit": ["none"] + PRECOMMIT_MANAGERS,
    "merge_style": MERGE_STYLES,
}


def choices_for(a):
    adv = a["advanced"]
    return {"code_research": adv["codeResearch"], "precommit": adv["precommit"], "merge_style": adv["mergeStyle"]}


def _upper_snake(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").upper()


def values_for(a, year=None):
    if year is None:
        year = datetime.date.today().year
    adv = a["advanced"]
    tool = CODE_RESEARCH_TOOLS[adv["codeResearch"]]
    gitflow = adv["branching"] == "gitflow"
    return {
        "PROJECT_NAME": a["project"]["name"],
        "PROJECT_NAME_UPPER": _upper_snake(a["project"]["name"]),
        "REPO_URL": a["project"]["repoUrl"] or "(repository URL)",
        "LICENSE_HOLDER": a["project"]["licenseHolder"] or a["project"]["name"],
        "YEAR": year,
        "MAIN_BRANCH": "main",
        "DEV_BRANCH": "develop" if gitflow else "main",
        "DEFAULT_BRANCH": "develop" if gitflow and adv["devIsDefault"] else "main",
        "GITFLOW_OR_TRUNK": "gitflow" if gitflow else "trunk",
        "REVIEW_ROUTINE_MODEL": REVIEW_MODELS["routine"],
        "REVIEW_DEEP_MODEL": REVIEW_MODELS["deep"],
        "REVIEW_BACKUP_MODEL": REVIEW_MODELS["backup"],
        "REVIEW_ROUTINE_EFFORT": REVIEW_EFFORTS["routine"],
        "REVIEW_DEEP_EFFORT": REVIEW_EFFORTS["deep"],
        "REVIEW_BACKUP_EFFORT": REVIEW_EFFORTS["backup"],
        "TOOLS_CODE_RESEARCH_NAME": tool["name"],
        "TOOLS_CODE_RESEARCH_URL": tool["url"],
        "TOOLS_CODE_RESEARCH_NAME_KEBAB": adv["codeResearch"],
        "TOOLS_CODE_RESEARCH_NAME_UPPER_SNAKE": _upper_snake(adv["codeResearch"]),
        "TOOLS_CODE_RESEARCH_BYPASS_MARKER": tool["bypass"] or "RESEARCH_BYPASS:",
        "TOOLS_CODE_RESEARCH_MATCH": tool["match"] or "(?!)",
    }
