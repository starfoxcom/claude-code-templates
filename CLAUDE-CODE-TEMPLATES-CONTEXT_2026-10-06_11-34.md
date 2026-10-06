# claude-code-templates — session handoff (2026-10-06 11:34)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show. Everything about the mods (design, decisions, per-machine files, test recipes) lives in `~/.claude/mods/NOTES.md`, not here.

---

## Headline: engine 2.1.290/291 follow-ups merged; nothing open

PRs #265 to #270 merged into `develop` (all `--merge`) and are installed live in `~/.claude/mods`. No PR is open.

- **guards:** a `.catch` on both shell hooks, so a crashed check refuses in enforce mode and runs in shadow (#265); `prbody.ts` type-checks under the 2.1.290 typings (#266); PR bodies are judged after `cd`s to literal folders, and a missing body file passes as unread only after literal inline script code (#269, three deep-review rounds).
- **usage-guard:** `/usage-guard arm HH:MM` (24-hour only), a double-quoted reason on every arm form, the full date and time-until in the answer, and the `arm` tool (#268).
- **tasks:** the keep-going prompt counts background work and session crons from the Stop event as pending wakes (#270).
- **Bind:** this repo's `research-adherence.py` re-rendered with its blank lines (#267).
- **Outside the repo:** `~/.claude/skill-contracts.json` GameProject board-read match widened (GraphQL `items(` and `board_check fetch(` count); `~/.claude/mods/NOTES.md` updated for all of the above.

## Definition of done

- ✅ Every PR: mod tests, `tsc`, routine plus deep 🟢 on the merged head, three-way install into live with the live suites passing (guards 116, usage-guard 166, tasks 69).
- ✅ Time arm seen live: the `arm` tool set 09:43 with reason "test" at 09:42 and the wake fired with that reason.
- ⚠️ guards' fail-closed `.catch` has no live run yet: it only acts in enforce mode, and guards is still shadow.

## Decisions made this session

- **Guards stays shadow until the maintainer judges it 100%** (2026-10-06 09:42). Then: mode enforce, and remove both `no-ai-attribution.py` and `pr-body-contract.py` from the `settings.json` hooks; keep the issue-body and run-watch scripts.
- **Only literal inline script code earns the missing-body-file pass.** A script file on disk, a run-time-built `-c "$(...)"` or an unquoted here-doc does not; inline code that loads another file is documented as checked only as typed.
- **No second tokensave index for `~/.claude/mods`:** the template copies are indexed here; live files are read by path.
- **Mods fail open on purpose** except guards (NOTES.md, "Fail-open vs `.catch`").

## Code-research count

64%: 11 tokensave calls against 6 plain code searches (plus 1 marked bypass). Below 70%: most plain searches were `grep` over known mod files and test strings. Next session starts by marking such searches with a bypass reason, or reading known files with `tokensave_read`.

## Open work

- **First: design doc for hand-offs in the tracker, global-first** (approved by the maintainer 2026-10-06; memory `project_handoff_to_tracker`). Write the design, get the sign-off in chat, then template PRs with deep review:
  - Replace this hand-off file with one system for every bundle: open work as a comment on the worked issue or the Status section of its PR, project state as a tracker status update (a private project is allowed for a public repo), durable decisions in rules and `CLAUDE.md`. Merge `context_refresh_files` and `team_handoff_notes` (documented in `TOGGLES.md`, implemented nowhere) into one tracker setting. Cover the popular trackers: GitHub Issues + Projects, GitLab, Jira, Linear, Azure Boards.
  - Global-first: `/session-start` and `/session-close` become one global standard in `~/.claude`, and the templates move global wherever they can, with per-project settings layered on top.
  - Rollout reaches every existing repo (GameProject, Stockra, voiceapp) when it goes live, plus a migration for older binds.
  - Rejected designs: a personal layer next to the shared one (the same job twice), a hand-off file per branch (branch and commit churn).
- **#6 guards enforce decision:** read `~/.claude/mods-data/guards/decisions.jsonl` again after a day of use with the #269 fixes; if the maintainer calls it 100%, switch and drop both scripts (see Decisions).
- **Offered, not decided:** run the mod test suites (`claude plugin test` per mod) in CI. The deep reviewer noted the green `Engine and hook tests` check covers only the engine and Python tests. Ask before building it (it is a workflow change, so a hotfix to `main`).

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`).
- **Work stays local; the cloud is retired.**
- **Attribution guard:** the old script blocks the word "Claude" in commit messages and PR body files, and any command that pairs it with a git write (a `claude plugin test` call, a scratchpad path containing it). Run those as separate calls.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches stay out of `TOGGLES.md`, the bundle files and the v1 page.**
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files.**
- **Run the engine tests with plain `node --test` from `engine/`.**
- **Track every session item in the task list**, including cleanup, review rounds and the handoff.
- **Mods are global:** template in `_core/global-template/mods`, live in `~/.claude/mods/<mod>/`, data in `~/.claude/mods-data/<mod>/`. Change the template first, then three-way merge into live, keeping the per-machine files. `git fetch` before copying merged files into live. Before pushing a mod, run `tsc` with the live mod's `.claude-plugin/types`.
- **A feature branch's review workflow must match `main`'s.**
- **Helper agents are banned** unless the maintainer asks for one in that conversation.
