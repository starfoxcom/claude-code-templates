#!/usr/bin/env python3
"""PreToolUse guard: every pull request created or edited from a Claude
session on the GameProject, AppProject or SiteProject repo carries a complete body in the PR format.

Contract (.claude/rules/git.md § PR format):
  * `## What` with at least one bullet, `## Why` with text, optional
    `## Notes` (never empty), and one issue line per board item the PR
    touches: `Resolves starfoxcom/board#N` or `Part of ...#N`.
    A `docs(...)` / `chore(...)` PR (context refresh, rules, CI, tooling) names no row.
  * The body must come from a file (`--body-file` / `-F`) so the hook can
    read it. Inline `--body "..."` is denied: 86 PR bodies were silently
    cut to a bare `## What` heading between 2026-07-26 and 2026-09-04 by
    inline bodies whose newlines the shell mangled (founder-found
    2026-09-07, all rebuilt the same night).

Scoped per repo (cwd or --repo). Matched on Bash|PowerShell.

AppProject (2026-09-07 audit, same defects): issues live in the same repo, so the
line is `Resolves #N` / `Part of #N`. Its default branch is `main` while work
PRs target `develop`, so the keyword never auto-links; the line is read by
humans and `tools/board_check.py`, and the link is added after the merge with
`tools/board_link_pr.py`. `hotfix:` PRs and `(ci)`-scoped fixes carry no row
(CI has no board row), and GitHub's own `Revert "..."` titles are exempt.
"""
import json
import os
import re
import sys

# repo keyword -> (issue-line shape, titles that carry no board row)
REPOS = {
    "gameproject": (
        re.compile(r"^(Resolves|Part of) starfoxcom/board#\d+\s*$", re.M),
        # docs / chore PRs (context refresh, rules, CI, tooling) carry no board row; every other type names its row.
        re.compile(r"^(docs|chore)\("),
    ),
    "appproject": (
        re.compile(r"^(Resolves|Part of) #\d+\s*$", re.M),
        re.compile(r"^(docs|chore|hotfix)(\(|:)|^(fix|perf|feat|refactor)\(ci\)|^Revert "),
    ),
    # SiteProject: issues in the same repo; release PRs (develop into main) carry no row either.
    "siteproject": (
        re.compile(r"^(Resolves|Part of) #\d+\s*$", re.M),
        re.compile(r"^(docs|chore|hotfix|release)(\(|:)|^\w+\(ci\)|^Revert "),
    ),
}
# Keys matched as a whole path segment or repo name rather than a substring ("siteproject" is too short).
SEGMENT_KEYS = {"siteproject"}


def deny(reason):
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "BLOCKED (PR-body contract): " + reason,
        }
    }))
    sys.exit(0)


def in_scope(cmd, cwd):
    """Return the matching REPOS entry, or None when the command is out of scope."""
    m = re.search(r"(?:--repo|-R)\s+([\w.-]+/[\w.-]+)", cmd)
    target = m.group(1).lower() if m else cwd.lower()
    if m and "board" in target:
        return None
    for name, spec in REPOS.items():
        if name in SEGMENT_KEYS:
            if re.search(r"(^|[\\/])" + name + r"([\\/]|$)", target):
                return spec
        elif name in target:
            return spec
    return None


def body_file_from(cmd):
    m = re.search(r"(?:--body-file|-F)\s+(?:\"([^\"]+)\"|'([^']+)'|(\S+))", cmd)
    if not m:
        return None
    return next(g for g in m.groups() if g)


def title_from(cmd):
    m = re.search(r"(?:--title|-t)\s+(?:\"([^\"]+)\"|'([^']+)'|(\S+))", cmd)
    return next((g for g in m.groups() if g), "") if m else ""


def check_body(text, title, spec):
    issue_line, exempt_title = spec
    what = re.search(r"^## What\s*\n((?:.*\n?)*?)(?=^## |\Z)", text, re.M)
    if not what or not re.search(r"^\s*[-*] \S", what.group(1), re.M):
        deny("`## What` is missing or has no bullet. The body must carry the full PR format.")
    why = re.search(r"^## Why\s*\n((?:.*\n?)*?)(?=^## |^(?:Resolves|Part of) |\Z)", text, re.M)
    if not why or not why.group(1).strip():
        deny("`## Why` is missing or empty.")
    notes = re.search(r"^## Notes\s*\n((?:.*\n?)*?)(?=^## |^(?:Resolves|Part of) |\Z)", text, re.M)
    if notes and not notes.group(1).strip():
        deny("`## Notes` is present but empty - drop the heading or fill it.")
    if not issue_line.search(text) and not exempt_title.search(title):
        deny("no `Resolves ...#N` / `Part of ...#N` board-row line (GameProject: `starfoxcom/board#N`; "
             "AppProject and SiteProject: `#N`). Every work PR names its board row; only docs / chore / hotfix / (ci) "
             "PRs (and SiteProject release PRs) name none.")


def main():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    except Exception:
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    cwd = data.get("cwd") or os.getcwd()
    if not cmd or not re.search(r"\bgh\s+pr\s+(create|edit)\b", cmd):
        sys.exit(0)
    spec = in_scope(cmd, cwd)
    if spec is None:
        sys.exit(0)
    if re.search(r"(?<=\s)(--body|-b)(?=\s|=)", cmd):
        deny("inline `--body` is not allowed for a PR - write the body to a file and pass "
             "`--body-file <literal absolute path>` (inline bodies were silently truncated in the past).")
    if re.search(r"--fill\b|--fill-first\b|--fill-verbose\b|--web\b", cmd):
        deny("`--fill*` / `--web` skip the PR format - write the body to a file and pass `--body-file`.")
    path = body_file_from(cmd)
    if path is None:
        if re.search(r"\bgh\s+pr\s+edit\b", cmd) and not re.search(r"(?<=\s)-F(?=\s|=)", cmd):
            sys.exit(0)  # an edit that touches no body (labels, title) is fine
        deny("`gh pr create` needs `--body-file <literal absolute path>` carrying the PR format.")
    if not os.path.isabs(path):
        path = os.path.join(cwd, path)
    try:
        text = open(path, encoding="utf-8-sig", errors="replace").read()
    except Exception as e:
        deny(f"could not read body file {path}: {e}.")
    check_body(text, title_from(cmd), spec)
    sys.exit(0)


if __name__ == "__main__":
    main()
