# CLAUDE.md

Guidance for Claude Code in this repository. Rules in `.claude/rules/` load on their own; this file holds what they do not.

## Project

**{{PROJECT_NAME}}**: {{ONE_LINE_DESCRIPTION}}

- **Stack:** {{LANGUAGE_AND_FRAMEWORK}}
- **Repo:** {{REPO_URL}}
<!-- TOGGLE:branching_model_gitflow START -->
- **Branches:** `{{MAIN_BRANCH}}` holds tagged releases; `{{DEV_BRANCH}}` is where work lands. See `.claude/rules/git.md`.
<!-- TOGGLE:branching_model_gitflow END -->
<!-- TOGGLE:branching_model_trunk START -->
- **Branches:** short-lived branches merge into `{{MAIN_BRANCH}}`; release commits are tagged. See `.claude/rules/git.md`.
<!-- TOGGLE:branching_model_trunk END -->
- **Commands:** lint `{{LINT_COMMAND}}`, type check `{{TYPECHECK_COMMAND}}`, test `{{TEST_COMMAND}}`.

Skim `ROADMAP.md`, if it exists, before starting a task.

## Language

- Talk to me in **{{CONVERSATION_LANGUAGE}}**.
- Code, comments, identifiers and technical docs are in **{{CODE_LANGUAGE}}**. User-visible strings go through the localization layer when the project has one.

<!-- TOGGLE:code_research_first START -->
## Code research

Find code with `/find` before reading files. This project uses **{{TOOLS_CODE_RESEARCH_NAME}}**; `/find` has the lookup sequence and the only cases where Grep and Glob are allowed. `/session-close` reports how often each was used.

<!-- TOGGLE:code_research_first END -->
## Sessions

- **Start:** `/session-start` reads the current state, proposes a plan and waits for approval before changing code.
- **During:** track multi-step work per `.claude/rules/task-tracking.md`.
- **End:** `/session-close` checks what is really finished, commits, and opens or merges the PR.

<!-- TOGGLE:lazy_rules_folder START -->
## Rules loaded on demand

Rules that matter only at certain milestones live in `docs/lazy/` and do not load automatically. `docs/lazy/README.md` lists them and when to read each.

<!-- TOGGLE:lazy_rules_folder END -->
<!-- TOGGLE:memory_system START -->
## Memory

Project memory lives in `~/.claude/projects/<project-slug>/memory/`, indexed by `MEMORY.md`. Save what the repo cannot tell a future session (decisions, preferences, pointers to outside resources), never what the code or git history already records.
<!-- TOGGLE:memory_system END -->
