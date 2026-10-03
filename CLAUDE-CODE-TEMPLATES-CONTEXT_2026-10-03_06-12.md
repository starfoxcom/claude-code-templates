# claude-code-templates — session handoff (2026-10-03 06:12)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show.

---

## Headline: the mods run in Desktop, two new mods landed, and the review templates match the live setup

Merged overnight (all with `--merge`):

- **Mods:** #202 (shared-pc `release` clears this session's reservation), #203 (Desktop support: bands and panes tested on both surfaces, tasks starts on `session.attach`), #206 + #208 (usage-guard settings pane), #207 (usage-guard `/usage-guard arm 5h|week`, `disarm`), #210 (new `runners` mod: a band row per local CI runner set, with Start/Stop), #216 (runners passes `tsc`).
- **Canonical text and engine:** #204, #205 (the renderer folds blank lines only in templates with toggle markers), #209 (BIND.md says why pre-commit stays off).
- **Review workflows:** #211 (hotfix on `main`: four new placeholders `REVIEW_DEEP_EFFORT`, `REVIEW_ROUTINE_EFFORT`, `REVIEW_BACKUP_MODEL`, `REVIEW_BACKUP_EFFORT` on the scan's allowlist plus SETUP.md), #212 (its cascade), #213 (both workflow templates now carry an effort per tier, an Opus 5.5 backup, the deep tier's same-model retry, action pin v1.0.213; bind defaults move to Fable 5.1 low in the engine and SETUP.md; page and docs stop naming a model).
- **The GameProject session's PRs, merged in this folder:** #214 (session-info mod, ci-watch row, session-facts budgets row) and #215 (status line retired from the template: `statusline.js`, the bash one-liner and SETUP.md step 7b removed).

## Definition of done: partial

All of the above pass their tests, `tsc` and validate, but none has been seen running live yet:

- ⚠️ **Live mods load at the next full restart.** `CLAUDE_CODE_PLUGIN_DIRS` now lists session-info, ci-watch, runners, session-facts, tasks, shared-pc, usage-guard, compact-handoff, skill-check, guards. The `statusLine` setting is gone. Nothing is verified on screen until the maintainer restarts.
- ⚠️ **Desktop smoke test (task #16, maintainer):** bands, panes, settings panes, the wake after a usage pause, and the runners row (Start/Stop against the real runners) in the Desktop app's Code tab.

## Decisions made this session

- **Arm design:** the arm is per-session, nothing shared. It moves to a live pause's wake when one is on, resumes through the pause path for its own reset (the claims keep one resume), and a module instance whose arm another instance moved takes the moved one up. The two-instance order can't be staged in the test kit (one module instance, no state writes), so that last case has no test.
- **Runners lists live per machine** in `~/.claude/mods-data/runners/runners.json` (same entries as `rules.ts`, as JSON), so a template copy never overwrites them. That file is also how the tests draw a real row. The live GameProject entry is there.
- **Review model defaults change only with the pin that accepts them.** #211 kept `main`'s SETUP.md on Sonnet 4.6 / Opus 4.8, because `main`'s templates still pin an action whose CLI refuses Fable 5.1. The move to Fable happened in #213 together with the pin. The next release carries both to `main`.
- **Mods UI/UX brief approved** (in `~/.claude/mods/NOTES.md`): one row grammar, a fixed row order (session, CI, runners, budgets, tasks, PC), color only for state, short verb buttons, no band hotkeys, one codebase for every surface. The runners row reads `next HH:MM (scheduled)` (maintainer's pick).
- **Workflow-only PRs merge on two local subagent reviews.** The maintainer allowed them for the review-template work. Ask again for the next such PR.

## Code-research count

86%: 40 tokensave calls against 6 plain code searches (plus 3 marked bypasses). Up from 9% after the tokensave index gained the hidden folders and known-file lookups moved to `tokensave_read`/`tokensave_body`.

## Open work (maintainer picks the order)

- **#17 Fix this repo's live review workflows (hotfix to `main`):** `claude.yml`'s "Detect failure class" greps the whole execution file, the PR's own text included, for bare words (credit, billing, allowance). A PR mentioning them skips the Fable retry. Port #213's fix: read only the final `result` message (`jq`), and match the CLI/API error wording. Also drop the "Sonnet"/"Opus" wording in `claude-code-review.yml` (comments and the Init deep-tier check summary), and the routine prompt line that says `git diff` will be denied (the allowlist grants it). Needs the two local reviews; ask the maintainer first. GameProject already shipped its copy of the classifier fix (GameProject PR 1282).
- **#16 Desktop smoke test:** maintainer, after the restart.
- **#6 guards shadow comparison:** due in a few days (logs in `~/.claude/mods-data/guards/`), then the maintainer decides enforce mode and retiring the two scripts.
- **#7 opt-in per-project banned-names list for guards** (GameProject's clean-room names). First check how GameProject enforces them today.
- **Leftovers from the canonical-text list:** architecture-graph is excluded by the engine but listed in BIND.md; `research-adherence.py` blank-line folding. Check whether either is still true before working on it.
- **Before the next push of any mod:** run `npx -y -p typescript@5 tsc --noEmit -p .` on it. The template folder has no engine types, so copy the folder to scratch with the live mod's `.claude-plugin/types` and check that copy. Runners shipped with 21 type errors because this step was skipped.

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`).
- **Work stays local; the cloud is retired.**
- **Attribution guard:** it blocks the word "Claude" in commit messages and PR body files, even as the product name or inside a model ID. Write any PR body file in its own step first. A command that both commits and runs `claude plugin test` is blocked too: run them as separate calls.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches stay out of `TOGGLES.md`, the bundle files and the v1 page.**
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files.**
- **Run the engine tests with plain `node --test` from `engine/`.**
- **Track every session item in the task list**, including cleanup, review rounds and the handoff.
- **Mods are global:** mods in `~/.claude/mods/<mod>/`, data in `~/.claude/mods-data/<mod>/`. Change the template first, then copy to live, keeping the per-machine files (`~/.claude/mods/NOTES.md` lists them). A new `CLAUDE_CODE_PLUGIN_DIRS` entry needs a full restart.
- **A feature branch's review workflow must match `main`'s.** After a workflow hotfix, merge `develop` into open branches, or the review action skips the review and the gate fails with no verdict.
