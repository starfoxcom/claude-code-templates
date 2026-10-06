# claude-code-templates — session handoff (2026-10-06 16:31)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show. Everything about the mods lives in `~/.claude/mods/NOTES.md`.

---

## Headline: CLI 2.1.292 follow-ups merged; three items wait on the maintainer

- **#273 merged:** shared-pc test fakes answer in the shapes 2.1.292's test kit accepts (the new kit fails a test on a refused stub answer). Installed live; every template mod type-checks clean on 2.1.292.
- **#274 merged:** guards `helpers` setting (template default `allow`). At `block`, Agent and Workflow calls are logged in shadow and refused in enforce; `/guards helpers allow|block` per session. One deep round (3 findings, all fixed). Installed live; this machine's `mods-data/guards/settings.json` has `helpers: block`.
- **#275 open, into `main`:** `Mod tests` workflow (Windows runner, pinned CLI 2.1.292 on PRs, weekly run on the newest CLI against `develop`, opens an issue when red). All checks green, `CLEAN`. Not merged: workflow-only, so it needs the two local subagent reviews, which need the maintainer's okay.
- **Design doc committed on `feature/tracker-handoff-design`** (pushed, no PR): `docs/v2/HANDOFF.md` plus two `docs/v2/PLAN.md` rows. Waits on the maintainer's sign-off in chat.

## Open work, in order

1. **Guards enforce decision (tomorrow, 2026-10-07):** the maintainer asked for one more full day of shadow use. Read `~/.claude/mods-data/guards/decisions.jsonl` (helper-agent rows now appear there too); if the maintainer calls it 100%, switch mode to `enforce`, then remove `no-ai-attribution.py` and `pr-body-contract.py` from the `settings.json` hooks.
2. **Tracker hand-off sign-off.** The chat summary to re-present: hand-off state moves to issue bodies (`### Current state` + full-history block) and one project status update per session; three settings layers (personal, committed `.bindwright/project.json`, git-ignored `.bindwright/local.json`); `/bindwright:export` and `/bindwright:join` for teams. Workflow-impact check found one real risk (global skills silently override every repo's project skills, GameProject's 139-line close included), handled by installing the global skills last; GameProject's two `skill-contracts.json` context-file entries change in its migration PR. On sign-off: open the PR from `feature/tracker-handoff-design` (docs-only).
3. **PR #275:** on the maintainer's okay, run the two local reviews on head `1cfc061` (routine prompt from `main`'s `claude-code-review.yml`, plus an adversarial deep pass), record both verdict lines and the SHA in a PR comment, merge with `--match-head-commit`, then cascade into `develop` — the cascade is the workflow's first real run. Adding `Mod tests` as a required check is a separate manual ruleset step.

## Decisions made this session

- **Helper-agent block is an opt-in guards setting**, not a hard rule in the template: default `allow` for everyone, `block` on this machine. It follows guards' shadow/enforce mode.
- **Mod autocomplete rows and model prompt caching (2.1.292): not adopted.** No mod calls the model, and slash commands already autocomplete.
- **Mod tests run on Windows in CI.** The mod tests fake Windows paths; a clean Linux run failed 165 of 677 tests for that reason alone.
- **Hand-off state goes in the issue body, not comments** (changed from the morning's approval of comments; part of the pending sign-off).

## Code-research count

55%: 5 tokensave calls against 4 plain code searches (plus 5 marked bypasses). Below 70%: most work was in `~/.claude/mods` and the engine typings, which sit outside the index, and in other repos read for the impact check. Next session marks such searches with a bypass reason or reads known files with `tokensave_read`.

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`).
- **Work stays local; the cloud is retired.**
- **Attribution guard:** the old script blocks the product name in commit messages and PR body files (including a CLI command name like `<name> plugin validate`). Reword, or run those as separate calls.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches stay out of `TOGGLES.md`, the bundle files and the v1 page.**
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files.**
- **Run the engine tests with plain `node --test` from `engine/`.**
- **Track every session item in the task list**, including cleanup, review rounds and the handoff.
- **Mods are global:** template in `_core/global-template/mods`, live in `~/.claude/mods/<mod>/`, data in `~/.claude/mods-data/<mod>/`. Change the template first, then three-way merge into live, keeping the per-machine files. `git fetch` before copying merged files into live. After an engine upgrade, copy live typings over the template mods and tsc them all.
- **A feature branch's review workflow must match `main`'s.**
- **Helper agents are banned** unless the maintainer asks for one in that conversation.
