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

7. **Context budget audit** — before locking in model + effort, inventory the eager-loaded context this session is already paying for. The matrix below optimizes for *session shape* (what you're writing); this step folds in *session budget* (how much window the eager-load corpus consumes before your first user turn). Without the audit, a Sonnet recommendation can land on a session where the rule corpus + memory index + handoff already burned ~45% of the 200k window at `/session-start` — leaving too little for real work.

   **Inventory the eager-loads:**
   - Project rules under `.claude/rules/` (this repo: `collaboration.md`, `git.md`, `review-tiers.md`, `token-efficiency.md`, `visual.md`)
   - `MEMORY.md` + any auto-loaded memory body files
   - Project `CLAUDE.md` + global `~/.claude/CLAUDE.md`
   - The `CLAUDE-CODE-TEMPLATES-CONTEXT_*.md` handoff read in Step 1
   - Any auto-loaded skill (eager-loaded by the harness, NOT lazy `/<name>` invocations)

   **Get the number.** Preferred: ask the user to share `/context` output from the harness — that's authoritative. Otherwise estimate from the inventory above (a `<system-reminder>` block dumping all five rule files into context alone is a strong signal you're already deep into the budget).

   **Apply the budget adjustment** on top of the matrix archetype:

   | Post-eager-load free context | Adjustment |
   |---|---|
   | ≥75% (slim corpus) | Use matrix as-is. |
   | 60–75% | Use matrix; flag the tight buffer in the recommendation block. |
   | 45–60% | Escalate one tier — prefer `claude-opus-4-6[1m]` over base 200k Sonnet/Opus. |
   | <45% | **Stop.** Recommend either: (a) switch to 1M-context immediately, OR (b) trim eager-loads first — move stale rules to `docs/lazy/`, archive prior `*-CONTEXT_*.md` to `docs/sessions/`, prune `MEMORY.md` to active-only entries. Don't start work until free ≥60%. |

   Include the measured free-context % + the adjustment decision in the recommendation block emitted by Step 8.

8. **Model + effort recommendation** — match the planned steps against this project's session-shape matrix, then apply the Step 7 budget adjustment, and emit the recommendation block before the approval gate.

   | Session archetype | Model | Effort |
   |---|---|---|
   | Workflow YAML state-machine surgery (`claude.yml`, `claude-code-review.yml`, Checks API lifecycle) | `claude-opus-4-6[1m]` | high |
   | Canonical + live-mirror lockstep edit (`_core/project-template/` ↔ `.claude/`) | `claude-opus-4-6[1m]` | high |
   | Bind resolution / new bundle / `BIND.md` update | `claude-opus-4-6[1m]` | high |
   | Multi-PR workstream (hotfix + cascade chain, large split refactor) | `claude-opus-4-6[1m]` | high |
   | Tightly-scoped single-bug fix from CI failure with clear repro | `claude-opus-4-7` | high |
   | `index.html` or `redesign/*.jsx` visual slice (≤150 LOC per `visual.md`) | `claude-sonnet-4-6` + `/fast` | medium |
   | Single-file rule edit (no canonical/live split) | `claude-sonnet-4-6` | medium |
   | Pure docs / ROADMAP / CHANGELOG / context-refresh | `claude-sonnet-4-6` | low |
   | Mechanical refactor (rename, file moves, mass replace) | `claude-sonnet-4-6` | medium |

   **Note:** `[1m]` is the documented Claude Code suffix for the 1M-context variant — see [Claude Code model config — Extended context](https://code.claude.com/docs/en/model-config#extended-context). Auto-included for Opus on this repo's Max plan; downstream forks on other tiers should re-tune the matrix per the canonical's "Tuning for your plan tier" section.

   Emit:

   ```
   ## Recommended setup for this session

   - Model: <id>
   - Effort: <level>
   - Archetype: <row name>
   - Budget: <measured free %> after eager-load — <as-is | tight-buffer | escalated-to-1M | trim-first>
   - Rationale: <one line — plan → archetype; cite project memory or 4.6-vs-4.7 evidence when picking 4.6 over the default; note the budget adjustment if it changed the model pick>
   - Switch before code work: `/model <id>`; set effort via the harness's effort selector. Switching after context loads pays a full re-read.
   - Drift trigger: re-evaluate if a mid-session `TaskCreate` shifts scope into a higher-risk archetype (e.g., docs PR that grows into a workflow YAML edit), OR if eager-load corpus grows mid-session (new rule file, lazy-loaded skill that doesn't unload).
   ```

   **Why the default is 4.6, not 4.7:** independent measurements show Opus 4.7 regressed against 4.6 on multi-step instruction following (chains fail by step 3–4), long-context retrieval (MRCR v2: 91.9% → 59.2%), and code/structured-data cost (+32–34% tokenizer inflation). 4.7 still wins on tightly-scoped SWE-Bench-shaped fixes — that's why one matrix row picks it. Source: [anthropics/claude-code#58369](https://github.com/anthropics/claude-code/issues/58369).

## Stop here — wait for approval

Do NOT start code work until the user approves or corrects the plan **and the model + effort setup**. The plan is the contract for the session.

## After approval

Use `TaskCreate` to materialize the session steps as tracked tasks. Mark each task `in_progress` when starting it, `completed` immediately when done. Don't batch completions.
