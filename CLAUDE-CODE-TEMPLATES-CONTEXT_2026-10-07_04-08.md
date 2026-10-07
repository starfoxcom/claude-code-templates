# claude-code-templates — session handoff (2026-10-07 04:08)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show. Everything about the mods lives in `~/.claude/mods/NOTES.md`.

---

## Headline: name scrub done, tracker design signed off, mod tests required on develop

- **Private project names scrubbed.** The maintainer's private projects had been named in this public repo. History was rewritten (stand-ins `GameProject`, `BusinessApp`, `VoiceApp`), force-pushed to every branch and tag, 40 PR/issue texts edited, 1,281 Actions runs of old commits deleted, and the current files use the stand-ins (#280). A GitHub Support ticket asks them to purge the old PR refs, unreachable commits, cached views and edit histories.
- **#277 merged:** `docs/v2/HANDOFF.md`, the tracker hand-off design, signed off by the maintainer. It now includes the status-update rule.
- **Status updates, all four of the maintainer's projects:** posted only when a milestone completes, the health colour changes or the plan changes. The rule lives in `~/.claude/rules/status-updates.md`; each project points at it and cleaned its feed (archive first, then delete). The every-close status-update entry in `~/.claude/skill-contracts.json` is gone.
- **#275 + cascade #278 merged:** the `Mod tests` workflow (Windows runner, pinned CLI on PRs, weekly newest-CLI run against develop that opens an issue on any non-success). Six local review rounds before merge. Its first real run caught 10 usage-guard tests at the 5 s default on the slower runner (#279 gave them `LONG`).
- **`Mod tests` is now a required check on develop** (ruleset changed 2026-10-07, documented in `CLAUDE.md` by #281).

## Open work, in order

1. **GitHub Support reply** (ticket sent 2026-10-07 ~03:20, replies go to the maintainer's account email). Once they confirm the purge, delete the local backup `Repos/claude-code-templates-backup-2026-10-07.git` and the kit `Repos/scrub-2026-10-07/`. Both still hold the real names: never push either.
2. **Guards enforce decision.** The maintainer's rule: after all four sessions closed cleanly (done 2026-10-07 04:08), read `~/.claude/mods-data/guards/decisions.jsonl`; switch to enforce only if every shadow row matches the current guards exactly (100%, not 99.99%). Then remove `no-ai-attribution.py` and `pr-body-contract.py` from the `settings.json` hooks.
3. **Tracker hand-off build**, step 1 of `docs/v2/HANDOFF.md` (canonical tracker profile, the status-update rule as a canonical rule, the `tracker` setting, session skills reading `.bindwright/`). Deep review.

## Decisions made this session

- **No private project names in this repo, ever.** Use the stand-ins in files, commits, PR and issue text. Local memory and cross-session messages may use real names.
- **Status updates are not a session log** (see the global rule). The design doc's project-status row follows it.
- **A workflow comment states only what the workflow does.** Procedures that depend on branch state (how to raise the pinned CLI) stay out of comments; the comment names the precondition.
- **Browser automation uses Edge**, the maintainer's default browser. It connects in a session started after the extension is installed there.

## Code-research count

66%: 2 tokensave calls against 1 plain code search (plus 6 marked bypasses). Below 70% on a small sample: almost all work was git history, CI logs, GitHub API and workflow files, which sit outside the index. The one unmarked search was a Grep for status-update text in `_core` markdown. Next session marks such searches with a bypass reason or uses `tokensave_search` with `literal: true`.

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`).
- **Work stays local; the cloud is retired.**
- **Attribution guard:** the old script blocks the product name in commit messages and PR body files. Reword, or run those as separate calls. It also rejects `$TMP`-style paths in `--input`/`--body-file`; use literal absolute paths.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches stay out of `TOGGLES.md`, the bundle files and the v1 page.**
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files.**
- **Run the engine tests with plain `node --test` from `engine/`.**
- **Track every session item in the task list**, including cleanup, review rounds and the handoff.
- **Mods are global:** template in `_core/global-template/mods`, live in `~/.claude/mods/<mod>/`, data in `~/.claude/mods-data/<mod>/`. Change the template first, then three-way merge into live, keeping the per-machine files.
- **A feature branch's review workflow must match `main`'s.**
- **Helper agents are banned** unless the maintainer asks for one in that conversation.
