# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- TOGGLE:tokensave_entry_point START -->
---

## 🚨 BEFORE ANY CODE RESEARCH — read this first

**Code research routes through the `/find` skill (`.claude/skills/find/SKILL.md`), NOT Grep / Glob / raw `grep`/`rg` in Bash.**

This project uses **{{TOOLS_CODE_RESEARCH_NAME}}** as its code-research tool. A PreToolUse hook at `~/.claude/hooks/{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}-first.py` (installed **globally**, never project-local — see `SETUP.md` § Phase 7a for the procedure) blocks Grep / Glob / raw-grep calls when {{TOOLS_CODE_RESEARCH_NAME}} is available. The `/find` skill documents the canonical sequence, the fallback conditions, and the bypass marker for genuinely-out-of-scope searches.

The session-close skill ends each session by reporting your code-research adherence ratio (calls through {{TOOLS_CODE_RESEARCH_NAME}} vs Grep/Glob fallbacks) — that metric is the score the discipline is graded on.
<!-- TOGGLE:tokensave_entry_point END -->

---

## CONVERSATION LANGUAGE

Always respond in **{{CONVERSATION_LANGUAGE}}**.

---

## PROJECT CONTEXT

**{{PROJECT_NAME}}** — {{ONE_LINE_DESCRIPTION}}

- **Stack:** {{LANGUAGE_AND_FRAMEWORK}}
- **Repo:** {{REPO_URL}}
- **Production branch:** `{{MAIN_BRANCH}}` (stable releases only — tagged)
- **Dev (integration) branch:** `{{DEV_BRANCH}}` (where day-to-day work targets; same as the production branch when branching model is trunk-based)
- **Branching model:** {{GITFLOW_OR_TRUNK}}

Before starting any task, skim the project-level `ROADMAP.md` (if it exists) and any sub-module ROADMAPs relevant to the work.

---

## CODE LANGUAGE

All code in the repo is in **{{CODE_LANGUAGE}}**: comments, variable/class/function names, intermediate UI strings, manifest descriptions, ROADMAPs, and technical text in code files.

**Exceptions** (if any) must be enumerated here. By default, user-visible strings go through a localization layer, not hardcoded.

---

<!-- TOGGLE:tokensave_entry_point START -->
## CODE-RESEARCH ENTRY POINT

Code-research entry point is **{{TOOLS_CODE_RESEARCH_NAME}}** ({{TOOLS_CODE_RESEARCH_URL}}), not Explore/Grep/Glob first. The `/find` skill (`.claude/skills/find/SKILL.md`) documents the canonical command sequence for this tool, the fallback conditions, and the bypass mechanism.

The full rule (and the rationale) lives in `~/.claude/CLAUDE.md`. If {{TOOLS_CODE_RESEARCH_NAME}} is unavailable for the scope you need, fall back to Grep/Read per the `/find` skill's fallback section.

---
<!-- TOGGLE:tokensave_entry_point END -->

## SESSION START

Every work session begins with this ritual. On prompt like "session start" or "ready to work":

1. **Project status** — current milestone / focus, open epics, blockers (read `ROADMAP.md` if it exists).
2. **Git status** — current branch + commits ahead/behind, existing branches, what's active. If Gitflow, create a branch if applicable:
   - Feature work → `feature/<short-name>`
   - Hotfix to `{{MAIN_BRANCH}}` → `hotfix/<short-name>`
   - Release prep → `release/<version>`
3. **Modules touched this session** — which directories the planned work mutates. Flag prerequisite branches.
4. **Session steps as a task list** — for any session with 3+ discrete work items, call `TaskCreate` once per step in the planned order. To express dependencies, capture each new task's ID from the `tool_result` and then call `TaskUpdate({ taskId, addBlockedBy: [<prereq-id>] })`. The task list is the source of truth for what's in scope this session — never let it go stale.

   > **Tool note:** `TaskCreate`, `TaskUpdate`, `TaskList`, and `TaskGet` are the modern Claude Code task tools (`addBlockedBy` is a `TaskUpdate` input parameter, not a separate tool). On builds that pre-date them, or when `CLAUDE_CODE_ENABLE_TASKS=0` is set, the legacy `TodoWrite` (single-call full-array rewrite, no dependency chaining) is the fallback — express order via array position instead.

   **For multi-PR workstreams** (hotfix + cascade chains, large refactors split for review), create one task per PR up-front and chain dependencies with `TaskUpdate({ taskId, addBlockedBy: [<prior-pr-task-id>] })` so the task list mirrors the merge order. A 10-PR chain treated as ad-hoc work burns hours on out-of-sequence routing — the upfront enumeration prevents that.

5. **Context budget audit** — before locking in model + effort, measure how much window the eager-load corpus already consumed (`.claude/rules/*.md`, `MEMORY.md`, project + global `CLAUDE.md`, the session handoff, auto-loaded skills). The matrix optimizes for *session shape*; this step folds in *session budget*. Ask the user to share `/context` output if uncertain. Apply the budget-adjustment table in `.claude/skills/session-start/SKILL.md` § "Context budget audit" — `≥75%` free → use matrix as-is; `60–75%` → flag tight buffer; `45–60%` → escalate to the 1M-context variant; `<45%` → **stop**, trim eager-loads or switch to 1M-context before starting work. The audit's free-% reading + adjustment decision become part of step 6's recommendation block.

6. **Recommended model + effort** — match the planned step list (from step 4) against the session-shape matrix in `.claude/skills/session-start/SKILL.md`, apply the step 5 budget adjustment, and emit a `## Recommended setup for this session` block. Switch BEFORE code work — switching after context loads pays a full re-read. The matrix is a starting point, not a permanent answer; tune the rows from your own `## Session model setup` log (written by `/session-close`) rather than treating the seeded defaults as fixed.

Do not start code work until I approve or correct the plan.

**During the session:**
- `TaskUpdate({ taskId, status: 'in_progress' })` BEFORE starting a task.
- `TaskUpdate({ taskId, status: 'completed' })` immediately when the task is fully done — don't batch.
- `TaskCreate` for follow-ups discovered mid-session; don't leave them in conversation memory only.
- Sessions with one or two trivial steps can skip task tracking; the threshold is 3+ discrete work items.

---

## SESSION CLOSE

At the end of each session where project work was done, or when the conversation is near saturation:

<!-- TOGGLE:definition_of_done_verification START -->
### Definition-of-done verification (mandatory before any "feature complete" claim)

Before claiming a feature / milestone / task complete, verify the DoD against observable behavior — not just CI green. For each DoD bullet:

- ✅ **verified** — reproduced in running app, with commit SHA + scene/route/page + (where applicable) screenshot or log evidence
- ⚠️ **partial** — works in some scenarios, not others — list the gaps
- ❌ **unmet** — does not work — open a follow-up branch, do not mark complete

The "compiles + CI green" bar is **not** the feature-complete bar. The bar is **observable behavior in a running app**. If a DoD bullet has become out-of-scope mid-feature, revise the DoD on its own commit before claiming complete — never silently rationalize a gap as deferred.
<!-- TOGGLE:definition_of_done_verification END -->

### Commit / PR — decision tree

Evaluate in order — apply the first row that matches:

| Condition | Action |
|---|---|
| No code changes (context refresh only) | Generate context file + commit + PR + paths-ignore fast-path auto-merge + branch cleanup. |
| Changes exist, branch objective **incomplete** | Commit with work done. No PR. |
| Changes exist, branch objective **complete** | Commit + PR to `{{DEV_BRANCH}}` + standard polling-loop merge + branch cleanup. |
| Branch is `hotfix/*` and complete | Commit + PR to `{{MAIN_BRANCH}}`. After merge: **open a cascade PR `chore/cascade-<hotfix-name>` from `{{DEV_BRANCH}}` merging `{{MAIN_BRANCH}}` in** — Gitflow's "merges to `{{MAIN_BRANCH}}` AND `{{DEV_BRANCH}}`" is a discipline, not a platform feature. Hotfix is not "done" until the cascade PR is merged. See `git.md` § "Cascade after every merge to `{{MAIN_BRANCH}}`". |
| Branch is `release/*` and complete | Commit + PR to `{{MAIN_BRANCH}}`. After merge: cascade `{{MAIN_BRANCH}}` → `{{DEV_BRANCH}}` via `chore/cascade-<release-name>` PR. Same discipline as hotfix. |

Commit and PR format per `.claude/rules/git.md`. Use **atomic Bash calls** — never `&&`-chain post-merge cleanup steps.

<!-- TOGGLE:context_refresh_files START -->
### Update context

Generate or refresh `{{PROJECT_NAME_UPPER}}-CONTEXT_YYYY-MM-DD_HH-MM.md` at the repo root. **Current state only** — decisions and implementation details not derivable from the code. Conventions and rules already live in `.claude/rules/` — do not duplicate.

**Uniqueness rule:** exactly **one** context file in the root at all times. When creating a new one, delete the previous with `git rm`. Never leave two context files coexisting.
<!-- TOGGLE:context_refresh_files END -->

### Update derived docs

If applicable, update `CLAUDE.md`, `README.md`, and the touched module's `ROADMAP.md` with relevant changes. Clearly indicate which sections changed.

---

## Skills

Invokable via `/<skill-name>`:

- `/session-start` — runs the session-start ritual end-to-end.
- `/session-close` — runs the session-close ritual end-to-end (DoD verification → commit → PR → polling → merge → cleanup).

See `.claude/skills/` for definitions.

---

<!-- TOGGLE:lazy_rules_folder START -->
## Lazy-loaded rules

Rules that only matter at specific milestones live under `docs/lazy/` and are NOT eager-loaded. Pull them in when the milestone goes active. See `docs/lazy/README.md` for the list.

---
<!-- TOGGLE:lazy_rules_folder END -->

<!-- TOGGLE:memory_system START -->
## Memory system

Per-project memory is at `~/.claude/projects/<project-slug>/memory/`. Four memory types: **user**, **feedback**, **project**, **reference**. `MEMORY.md` is the index, always loaded into the session context; per-memory files live alongside it. See your home `~/.claude/CLAUDE.md` for the canonical body structure of each memory type.
<!-- TOGGLE:memory_system END -->
