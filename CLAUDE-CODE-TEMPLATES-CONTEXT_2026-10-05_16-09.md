# claude-code-templates — session handoff (2026-10-05 16:09)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show. Everything about the mods (design, decisions, per-machine files, test recipes) lives in `~/.claude/mods/NOTES.md`, not here.

---

## Headline: three days of mod work merged; nothing open

PRs #217 to #263 merged into `develop` (all `--merge`); #239 went to `main` as a hotfix and #240 cascaded it. No PR is open. `develop` is at the #263/#262 merges plus this hand-off.

- **Mods (the bulk):** rows above the prompt for session, CI, runners, budgets and tasks on CLI and Desktop; one settings file per mod (`mods-data/<mod>/settings.json`) with panes and `/<mod> set`; phone text views; usage-guard arms, auto-resume after a reset and missed-arm adoption; ci-watch mid-turn wakes, per-check icons and GitHub Actions incident notes (#262); the tasks keep-going prompt (#261); guards PR-body contract (#249) and banned names (#258); `/runners add` (#259); every mod hook waits for its module's one start after a hot reload (#263).
- **Review workflows:** failure classing reads only the result (#238 template, #239 live on `main`), the plan-cap wording is counted (#237).
- **Rules:** keep working through a compaction (#245).

## Definition of done

- ✅ Each mod PR passed its mod tests, `tsc` on a scratch copy with the live engine types, and a routine plus deep 🟢 on its merged head. Each was installed into `~/.claude/mods` with a three-way merge, and the live suites pass (ci-watch 84, tasks 67, runners 38, session-info 50, usage-guard 114).
- ✅ #263 checked live: reloading ci-watch and calling its `watch` tool at once failed 2/2 before the fix and answered 2/2 after.
- ✅ Desktop smoke tests were done by the maintainer across the last sessions (rows, panes, settings, cards, the pc queue); the context bar is the same on every surface (#260, confirmed visually).
- ⚠️ #261 (keep-going) and #262 (incident note) have no live run yet: the next unattended turn end and the next GitHub Actions outage are their first real tests.

## Decisions made this session

- **Merge rule:** routine 🟢 and deep 🟢 on the head commit (read the deep check run's `head_sha`), `CLEAN`, then `gh pr merge --merge --delete-branch --match-head-commit <sha>`. `develop` does not require branches to be up to date, so a sibling PR merging needs no re-review.
- **ci-watch incident note has its own pending flag** (`incidentPending`); `wakePending` means a settled watch only. Three review rounds of patches on a shared flag were replaced by this split (#262 round 5). Repeated findings of one class mean change the design, not patch again.
- **A mod's start is one shared promise** (`live.started ??= …`), awaited by every hook; an early-return boolean let calls act on half-started state after a reload (#263).
- **The `gh run watch` blocker script** (`~/.claude/hooks/block-gh-run-watch.py`, not in this repo) now matches the subcommand word only; it no longer blocks branch names containing "watch". Prose that names the command still trips it, by design.

## Code-research count

39%: 48 tokensave calls against 74 plain code searches (plus 19 marked bypasses), down from 86%. Most of the plain searches were `grep`/`sed` over the live mods in `~/.claude/mods`, which has no tokensave index, and over known files in the template mods. Next session starts by deciding between indexing `~/.claude/mods` (or reading its files with `tokensave_read` by path) and marking those searches as bypasses with a reason.

## Open work

- **#6 guards shadow trial: read `~/.claude/mods-data/guards/decisions.jsonl` around 2026-10-06 09:00.** Interim read at 15:2x: the guards mod made no false blocks; in all 7 rows where only the old scripts blocked, the scripts were wrong ("claude" inside a folder path five times, a branch named like the watch command, a shell variable in a loop). The maintainer then decides on enforce mode. If yes: switch guards to enforce, remove `no-ai-attribution.py` and `pr-body-contract.py` from the `settings.json` hooks, and keep the issue-body and run-watch scripts until decided (NOTES.md, the shadow-review entry).
- **Leftover to verify:** `research-adherence.py` blank-line folding (from the canonical-text list). Check it is still true before working on it. The architecture-graph item is settled: BIND.md says why this repo keeps its copy.

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`).
- **Work stays local; the cloud is retired.**
- **Attribution guard:** it blocks the word "Claude" in commit messages and PR body files, and any command that pairs it with a git write (a `claude plugin test` call, a scratchpad path containing it). Run those as separate calls, and keep multi-step installs in a script file.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches stay out of `TOGGLES.md`, the bundle files and the v1 page.**
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files.**
- **Run the engine tests with plain `node --test` from `engine/`.**
- **Track every session item in the task list**, including cleanup, review rounds and the handoff.
- **Mods are global:** template in `_core/global-template/mods`, live in `~/.claude/mods/<mod>/`, data in `~/.claude/mods-data/<mod>/`. Change the template first, then three-way merge into live, keeping the per-machine files (`~/.claude/mods/NOTES.md` lists them). Before pushing a mod, run `tsc` on a scratch copy with the live mod's `.claude-plugin/types`.
- **A feature branch's review workflow must match `main`'s.** After a workflow hotfix, merge `develop` into open branches, or the review action skips the review and the gate fails with no verdict.
- **Helper agents are banned** unless the maintainer asks for one in that conversation; workflow-only PRs still need the maintainer's OK for the two local reviews.
