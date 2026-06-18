---
name: session-start
description: Run the session-start ritual — read context handoff + ROADMAP, project status, git status, plan the session, wait for approval before touching code.
---

# /session-start

Run this skill at the beginning of every work session, or whenever the user asks for "session start", "let's start", "ready to work", or equivalent.

## Steps

1. **Read the session handoff.** Glob `CLAUDE-CODE-TEMPLATES-CONTEXT_*.md` at the repo root. Exactly one should exist — the session-close ritual maintains this uniqueness rule (see `.claude/skills/session-close/SKILL.md` § "Update context"). Read it end-to-end before any other step; it's the previous session's hand-off and supersedes anything you'd otherwise re-derive from git or ROADMAP. If zero or multiple `*-CONTEXT_*.md` files exist, flag this as a problem before proceeding.

2. **Project status** — read `ROADMAP.md` (if it exists), summarize current milestone / focus, open epics, blockers. This project doesn't currently maintain a ROADMAP.md — the CONTEXT handoff plus open GitHub issues are the source of truth for in-flight work.

3. **Git status** — run these in parallel:
   - `git status` (uncommitted changes)
   - `git log --oneline -10` (recent commits for context)
   - `git branch --show-current` + `git rev-list --count HEAD..origin/develop` (commits behind dev)
   - `gh pr list --author @me --state open` (your open PRs)

4. **Branch decision** — based on the task and the Gitflow model:
   - Feature work → propose `feature/<short-name>` (kebab-case, scoped to one logical concern) off `develop`
   - Hotfix → propose `hotfix/<short-name>` off `main`
   - Release prep → propose `release/<version>` off `develop`
   - Chore (docs, ci, tooling) → propose `chore/<short-name>` off `develop`
   - If a relevant branch already exists, suggest checking it out
   - If `develop` has advanced since the last session, propose the cascade merge into open feature branches before resuming

5. **Modules touched this session** — which directories the planned work mutates. Flag any prerequisite branches (e.g., a `_core/`-touching change that the docs reference depends on → land `_core/` first, docs second).

6. **Session steps** — ordered list of work items with dependencies called out. Keep it tight (3–7 items typically); longer plans get split.

## Stop here — wait for approval

Do NOT start code work until the user approves or corrects the plan. The plan is the contract for the session.

## After approval

Use `TaskCreate` to materialize the session steps as tracked tasks. Mark each task `in_progress` when starting it, `completed` immediately when done. Don't batch completions.
