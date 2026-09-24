---
name: session-start
description: Start a work session. Reads the project state and git state, then proposes a plan and waits for approval. Use at the start of every session, or when the user says "session start", "let's start" or "ready to work".
---

# /session-start

Planning only. Change no files and create no branches in this turn.

## 1. Read

<!-- TOGGLE:context_refresh_files START -->
- The single `{{PROJECT_NAME_UPPER}}-CONTEXT_*.md` at the repo root: the last session's hand-off. It outranks anything re-derived from git. If there are none or several, say so first.
<!-- TOGGLE:context_refresh_files END -->
- `ROADMAP.md` if it exists (or the module ROADMAP for the area in focus). If the focus is unclear from the user's message or the current branch, ask before reading further.

## 2. Check git

Run these as separate calls, in parallel:

- `git status`
- `git branch --show-current`
- `git log --oneline -10`
- `git fetch origin`, then `git rev-list --count HEAD..origin/{{DEV_BRANCH}}` (how far behind the current branch is)
- `gh pr list --author @me --state open`

## 3. Report, in this order

1. **Project status:** current focus, open work, blockers.
2. **Git status:** current branch, uncommitted changes, how far behind `{{DEV_BRANCH}}` it is, open PRs. If `{{DEV_BRANCH}}` has moved ahead, propose merging it in before resuming (`git.md` § Keep branches current).
3. **Branch:** if the work needs a new branch, propose its name per `git.md` and ask before creating it.
4. **Areas touched:** the directories the plan will change. Anything outside the branch's scope becomes a prerequisite branch that lands first; name it.
5. **Plan:** the ordered steps, with dependencies. Three to seven steps; split anything larger into another session.

## 4. Stop

End the turn after the report. Once the user approves or corrects the plan, create the tasks per `.claude/rules/task-tracking.md` and start.

Produce every section even when a branch with work in progress is already checked out.
