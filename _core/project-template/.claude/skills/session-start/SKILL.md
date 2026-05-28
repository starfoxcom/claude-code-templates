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

6. **Context budget audit** — before locking in model + effort, inventory the eager-loaded context this session is already paying for. The matrix below optimizes for *session shape* (what kind of code you're writing); this step folds in *session budget* (how much window the eager-load corpus consumes before your first user turn). Without the audit, a Frugal-tier (base-context) recommendation can land on a project where the rule corpus + memory index + handoff already burned ~45% of the 200k window at `/session-start` alone — leaving too little for any real work session.

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
   | 45–60% | Escalate one tier — use the Deep tier's 1M-context variant (append your plan's 1M-context suffix to the resolved Deep model id) over base 200k. |
   | <45% | **Stop.** Recommend either: (a) switch to 1M-context immediately, OR (b) trim eager-loads first — move stale rules to `docs/lazy/`, archive prior `*-CONTEXT_*.md` to `docs/sessions/`, prune `MEMORY.md` to active-only entries. Don't start work until free ≥60%. |

   The thresholds are starting points, not absolutes — tune them in your project-local copy of this skill if a downstream maintainer measures different real-world session burn rates.

7. **Model + effort recommendation** — match the planned steps against the session-shape matrix below, **resolve the chosen tier to a concrete model id** (the resolution sub-step), apply the Step 6 budget adjustment, and emit the recommendation block before the approval gate. **Edit the rows to match your project's actual session shapes** — this is a starting point, not a permanent answer.

   The matrix names **capability tiers**, not model versions — so it never goes stale when a new model ships. The tier is the durable part; you resolve it to a concrete model id at session-start (next sub-step).

   | Tier | What it is | Typical use |
   |---|---|---|
   | **Deep** | The strongest reasoning model your plan offers (with its 1M-context variant when the budget audit calls for it). | High-judgment, high-blast-radius, multi-step, or long-context work. |
   | **Standard** | A full-capability model at base context — strong, but you don't need the Deep tier's long-context reach. | Focused high-effort work: a tightly-scoped fix, a vision/screenshot pass. |
   | **Frugal** | The lowest-cost capable model your plan offers. | Mechanical, docs, single-file, low-risk work. |

   | Session archetype | Tier | Effort |
   |---|---|---|
   | Architectural / design lock / threading or state-machine review | Deep | high |
   | High-blast-radius surface (supply-chain, public API, auth, parsers, migrations) | Deep | high |
   | Multi-module refactor or cross-cutting public API change | Deep | high |
   | Multi-PR workstream (hotfix + cascade, large split refactor) | Deep | high |
   | Tightly-scoped single-bug fix with clear repro | Standard | high |
   | Vision-heavy / screenshot-driven verify session | Standard | high |
   | UI / single-file feature code / visual iteration | Frugal | medium |
   | CI / workflow YAML / `settings.json` (single-file, no state machine) | Frugal | medium |
   | Pure docs / ROADMAP / devlog / context-refresh | Frugal | low |
   | Mass mechanical refactor (rename, file moves, header splits) | Frugal | medium |

   **Resolve the tier to a concrete `/model <id>` — every session, before the emit block:**

   1. **Pinned incumbent wins — the newest model does not.** A tier resolves to the *specific* model your project's `## Session model setup` log (written by `/session-close`) has **proven** for that tier's work, not to whatever shipped most recently. Until a project has logged enough sessions to have a proven choice, use the maintainer-chosen default recorded in this skill's project-local copy. See **"Why a tier resolves to a proven model, not the newest one"** below.
   2. **Confirm it's still offered.** Check the resolved id against what this session's environment names as the current model(s), or against `/model`. If the pinned model is still available, use it.
   3. **Visible fallback when the id isn't legible.** If you cannot confirm the pinned model is offered (the environment doesn't name it and you have no `/model` output to read), emit the pinned-incumbent id flagged `<unverified — confirm current id via /model>` and **stop at the approval gate** for the user to confirm. Never silently substitute a model guessed from training knowledge — that re-introduces the staleness this design removes.
   4. **Emit a fully-qualified, versioned id.** Name the exact `/model` string, never a bare family/alias (an alias can resolve server-side to "newest," silently defeating the pin). When the budget audit calls for extended context, append your plan's 1M-context variant suffix to the resolved **Deep** id if your plan offers one — see [Claude Code model config — Extended context](https://code.claude.com/docs/en/model-config#extended-context).

   Emit:

   ```
   ## Recommended setup for this session

   - Tier → Model: <Deep | Standard | Frugal> → <fully-qualified /model id>  [<unverified — confirm via /model> if step 3 applied]
   - Effort: <level>
   - Archetype: <row name>
   - Budget: <measured free %> after eager-load — <as-is | tight-buffer | escalated-to-1M | trim-first>
   - Rationale: <one line — plan → archetype → tier; cite project memory or the outcome log when picking a non-default tier; note the budget adjustment if it changed the pick>
   - Switch before code work: `/model <id>`; set effort via the harness's effort selector. Switching after context loads pays a full re-read.
   - Drift trigger: re-evaluate if a mid-session `TaskCreate` shifts scope into a higher-risk archetype, OR if the eager-load corpus grows mid-session (new rule file, lazy-loaded skill that doesn't unload).
   ```

   **Tuning for your plan tier.** Every Claude Code subscription tier — Pro / Max / Team / Enterprise — has a strongest-model option, but cost and 1M-context availability vary:

   - **Pro:** the Deep tier consumes subscription quota faster than Frugal. Consider mapping Deep → Standard (or Standard → Frugal) on cost-sensitive sessions, or reserving Deep for the highest-risk archetypes. A 1M-context variant may require usage credits.
   - **Max / Team / Enterprise:** the ladder works as-is; a 1M-context variant for the Deep tier is typically auto-included.
   - **API / pay-as-you-go:** the Deep tier is the most expensive. Monitor cost per session via the outcome log written by `/session-close`.

   Full plan-capability table: [Claude Code model config docs](https://code.claude.com/docs/en/model-config). A bind-time `plan_tier` selector that filters / annotates the ladder by tier is a tracked follow-up — see the project's open issues.

   **Why a tier resolves to a proven model, not the newest one.** The newest model is not automatically the best model for a given session shape. A new frontier release can regress on the exact axes high-judgment work depends on — multi-step instruction following, long-context retrieval, structured-data tokenizer cost — even while winning headline benchmarks. So a tier resolves to the model your own `## Session model setup` outcome log has *proven* for that tier's work, not to whatever shipped most recently. A new model does not inherit a tier by existing: trial it on lower-blast-radius (Frugal / Standard) rows first, compare retries / cleanup-PRs / wrong-branch edits against the incumbent across a few real sessions, and promote it only once it has earned that on **your** workload. The harness tells you what *exists*; your outcome log tells you what *works*. This rule names no version, so it never ages — record version-specific evidence (which release regressed where) only in your project-local copy of this skill, never here.

## Stop here — wait for approval

Do NOT start code work until the user approves or corrects the plan **and the model + effort setup**. The plan is the contract for the session.

## After approval

Use `TaskCreate` to materialize the session steps as tracked tasks. Mark each task `in_progress` when starting it, `completed` immediately when done. Don't batch completions.
