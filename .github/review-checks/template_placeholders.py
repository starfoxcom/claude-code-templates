"""Pre-screen check: every placeholder in a changed template is a known one.

An unknown `{{NAME}}` under _core/project-template/ would land literally in
the user's repo on bind. The known set is every placeholder the bind engine
fills (engine/model.js `valuesFor` and `DEFERRED`) plus the ones SETUP.md
resolves; add a new placeholder here in the same change that introduces it.

Run by the gate's Project pre-screen job from the base branch:
    template_placeholders.py FILES DIFF   (FILES: one changed path per line)
Prints each unknown placeholder and exits 1; exits 0 when all are known.
"""

import re
import sys

KNOWN = {
    "MAIN_BRANCH", "DEV_BRANCH", "DEFAULT_BRANCH",
    "PROJECT_NAME", "PROJECT_NAME_UPPER",
    "LANGUAGE_AND_FRAMEWORK",
    "CONVERSATION_LANGUAGE", "CODE_LANGUAGE",
    "REPO_URL", "ONE_LINE_DESCRIPTION",
    "GITFLOW_OR_TRUNK",
    # The code-research tool, from the tool profiles.
    "TOOLS_CODE_RESEARCH_NAME", "TOOLS_CODE_RESEARCH_URL",
    "TOOLS_CODE_RESEARCH_NAME_KEBAB", "TOOLS_CODE_RESEARCH_BYPASS_MARKER",
    "TOOLS_CODE_RESEARCH_MATCH",
    # The review tiers' models and efforts, and the backup both fall back to.
    "REVIEW_DEEP_MODEL", "REVIEW_ROUTINE_MODEL",
    "REVIEW_DEEP_EFFORT", "REVIEW_ROUTINE_EFFORT",
    "REVIEW_BACKUP_MODEL", "REVIEW_BACKUP_EFFORT",
    "STACK_COMMANDS_ALLOWLIST",
    # The pre-commit tool and the stack's commands.
    "TOOLS_PRECOMMIT_NAME", "TOOLS_PRECOMMIT_URL",
    "LINT_COMMAND", "TYPECHECK_COMMAND", "TEST_COMMAND",
    # CODEOWNERS owners and the rendered license text.
    "LEAD_USER", "TEAM_OR_USER", "LICENSE_BODY",
}
PLACEHOLDER = re.compile(r"\{\{([A-Z][A-Z_]+)\}\}")


def main(files_path):
    with open(files_path, encoding="utf-8") as fh:
        changed = [p for p in fh.read().split("\n") if p]
    found = []
    for name in changed:
        if not name.startswith("_core/project-template/"):
            continue
        try:
            with open(name, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        for m in PLACEHOLDER.finditer(text):
            if m.group(1) not in KNOWN:
                found.append("UNKNOWN_PLACEHOLDER: %s: {{%s}} not in the known set" % (name, m.group(1)))
    print("\n".join(found) if found else "Every placeholder in changed templates is known.")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
