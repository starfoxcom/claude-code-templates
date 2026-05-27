---
name: session-start
description: Run the session-start ritual — project status, git status, plan the session, wait for approval before touching code.
---

# /session-start

Run this skill at the beginning of every work session, or whenever the user asks for "session start", "let's start", "ready to work", or equivalent.

## Steps

<!-- TOGGLE:context_refresh_files START -->
0. **Read the session handoff.** Glob `{{PROJECT_NAME_UPPER}}-CONTEXT_*.md` at the repo root. Exactly one should exist — the session-close ritual maintains this uniqueness rule (see `.claude/skills/session-close/SKILL.md` § "Update context"). Read it end-to-end before any other step; it's the previous session's hand-off and supersedes anything you'd otherwise re-derive from git or ROADMAP. If zero or multiple `*-CONTEXT_*.md` files exist, flag this as a problem before proceeding.
<!-- TOGGLE:context_refresh_files END -->

1. **Project status** — read `ROADMAP.md` (if it exists), summarize current milestone / focus, open epics, blockers. If multiple ROADMAPs (per-module), name them and ask which one is in focus.

2. **Git status** — run these in parallel:
   - `git status` (uncommitted changes)
   - `git log --oneline -10` (recent commits for context)
   - `git branch --show-current` + `git rev-list --count HEAD..origin/{{DEV_BRANCH}}` (commits behind dev)
   - `gh pr list --author @me --state open` (your open PRs)

3. **Branch decision** — based on the task and the Gitflow model:
   - Feature work → propose `feature/<short-name>` (kebab-case, scoped to one logical concern)
   - Hotfix → propose `hotfix/<short-name>` off `main`
   - Release prep → propose `release/<version>`
   - If a relevant branch already exists, suggest checking it out
   - If `{{DEV_BRANCH}}` has advanced since the last session, propose the cascade merge into open feature branches before resuming

4. **Modules touched this session** — which directories the planned work mutates. Flag any prerequisite branches (e.g., a frontend change that depends on a backend signal not yet merged → backend branch goes first).

5. **Session steps** — ordered list of work items with dependencies called out. Keep it tight (3–7 items typically); longer plans get split.

6. **Context budget audit** — before locking in model + effort, inventory the eager-loaded context this session is already paying for. The matrix below optimizes for *session shape* (what kind of code you're writing); this step folds in *session budget* (how much window the eager-load corpus consumes before your first user turn). Without the audit, a Sonnet recommendation can land on a project where the rule corpus + memory index + handoff already burned ~45% of the 200k window at `/session-start` alone — leaving too little for any real work session.

   **Inventory the eager-loads:**
   - Project rules (`.claude/rules/*.md`) — count files × ~avg LOC
   - `MEMORY.md` + any auto-loaded memory body files
   - Project `CLAUDE.md` + global `~/.claude/CLAUDE.md`
   - The session handoff read in Step 0 (if `context_refresh_files` is enabled)
   - Auto-loaded skills (eager-loaded by the harness, NOT lazy `/<name>` invocations)

   **Get the number.** Preferred: ask the user to share the harness's `/context` output — that's the authoritative reading. Otherwise estimate from the inventory above (a `<system-reminder>` block dumping the entire rules corpus into context alone is a strong signal you're already deep into the budget).

   **Apply the budget adjustment** on top of the matrix archetype Step 7 will choose:

   | Post-eager-load free context | Adjustment |
   |---|---|
   | ≥75% (slim corpus) | Use matrix as-is. |
   | 60–75% | Use matrix; flag the tight buffer in the recommendation block. |
   | 45–60% | Escalate one tier — prefer the 1M-context variant (`claude-opus-4-6[1m]`) over base 200k. |
   | <45% | **Stop.** Recommend either: (a) switch to 1M-context immediately, OR (b) trim eager-loads first — move stale rules to `docs/lazy/`, archive prior `*-CONTEXT_*.md` to `docs/sessions/`, prune `MEMORY.md` to active-only entries. Don't start work until free ≥60%. |

   The thresholds are starting points, not absolutes — tune them in your project-local copy of this skill if a downstream maintainer measures different real-world session burn rates.

7. **Model + effort recommendation** — match the planned steps against the session-shape matrix below, then apply the Step 6 budget adjustment, and emit the recommendation block before the approval gate. **Edit the rows to match your project's actual session shapes** — this is a starting point, not a permanent answer.

   | Session archetype | Model | Effort |
   |---|---|---|
   | Architectural / design lock / threading or state-machine review | `claude-opus-4-6` | high |
   | High-blast-radius surface (supply-chain, public API, auth, parsers, migrations) | `claude-opus-4-6` | high |
   | Multi-module refactor or cross-cutting public API change | `claude-opus-4-6` | high |
   | Multi-PR workstream (hotfix + cascade, large split refactor) | `claude-opus-4-6` | high |
   | Tightly-scoped single-bug fix from CI failure with clear repro | `claude-opus-4-7` | high |
   | Vision-heavy / screenshot-driven verify session | `claude-opus-4-7` | high |
   | UI / single-file feature code / visual iteration | `claude-sonnet-4-6` + `/fast` | medium |
   | CI / workflow YAML / `settings.json` (single-file, no state machine) | `claude-sonnet-4-6` | medium |
   | Pure docs / ROADMAP / devlog / context-refresh | `claude-sonnet-4-6` | low |
   | Mass mechanical refactor (rename, file moves, header splits) | `claude-sonnet-4-6` | medium |

   Emit:

   ```
   ## Recommended setup for this session

   - Model: <id>
   - Effort: <level>
   - Archetype: <row name>
   - Budget: <measured free %> after eager-load — <as-is | tight-buffer | escalated-to-1M | trim-first>
   - Rationale: <one line — plan → archetype; cite project memory or matrix rationale when picking from a less-default row; note the budget adjustment if it changed the model pick>
   - Switch before code work: `/model <id>`; set effort via the harness's effort selector. Switching after context loads pays a full re-read.
   - Drift trigger: re-evaluate if a mid-session `TaskCreate` shifts scope into a higher-risk archetype, OR if the eager-load corpus grows mid-session (new rule file, lazy-loaded skill that doesn't unload).
   ```

   **Note on extended context.** Rows that prefer Opus 4.6 also benefit from the 1M-context variant on plans that include it — pass `/model claude-opus-4-6[1m]` instead of bare `claude-opus-4-6` when available. The `[1m]` suffix is the documented Claude Code notation for the 1M-context variant (alias or full-name form both accepted) — see [Claude Code model config — Extended context](https://code.claude.com/docs/en/model-config#extended-context).

   **Tuning for your plan tier.** The seeded matrix assumes Opus access (every Claude Code subscription tier — Pro / Max / Team / Enterprise — has it), but cost and 1M-context availability vary:

   - **Pro:** Opus rows consume your subscription quota faster than Sonnet rows. Consider swapping Opus → Sonnet on cost-sensitive sessions, or restrict Opus to the highest-risk archetypes. The `[1m]` variant requires usage credits on Pro.
   - **Max / Team / Enterprise:** matrix works as-is. Opus 1M-context is auto-included.
   - **API / pay-as-you-go:** Opus rows are the most expensive. Monitor cost per session via the outcome log written by `/session-close`.

   Full plan-capability table: [Claude Code model config docs](https://code.claude.com/docs/en/model-config). A bind-time `plan_tier` selector that filters / annotates the matrix automatically is a tracked follow-up — see the project's open issues.

   **Why the seeded default prefers 4.6 over 4.7:** community evidence (evolving) suggests version-specific tradeoffs on multi-step instruction following, long-context retrieval, and structured-data tokenizer cost — but the picture moves with each model update. **Defaults here are a starting point, not a permanent answer.** Tune the matrix from your own `## Session model setup` log (written by `/session-close`) after ~10 sessions rather than inheriting these defaults indefinitely. If a downstream maintainer wants version-specific evidence in their project-local copy of this skill, they can add it there — the canonical template stays evidence-neutral so it ages well across model updates.

## Stop here — wait for approval

Do NOT start code work until the user approves or corrects the plan **and the model + effort setup**. The plan is the contract for the session.

## After approval

Use `TaskCreate` to materialize the session steps as tracked tasks. Mark each task `in_progress` when starting it, `completed` immediately when done. Don't batch completions.
