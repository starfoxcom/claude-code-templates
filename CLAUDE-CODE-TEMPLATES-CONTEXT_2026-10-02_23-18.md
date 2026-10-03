# claude-code-templates — session handoff (2026-10-02 23:18)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show.

---

## Headline: the eight mods are canonical in `_core/global-template/mods/`

- **PR #199 merged** (da40e4e, after 26 review rounds). The canonical copies of all eight mods now live in `_core/global-template/mods/`: ci-watch, compact-handoff, guards, session-facts, shared-pc, skill-check, tasks, usage-guard. Each has its tests (`claude plugin test <mod>`, plus `node --test` for the compact-handoff and shared-pc helpers) and passes `tsc`. The PLAN item "Mods as `~/.claude` extras" is half done: the canonical copies landed; `/bindwright:setup` writing the `CLAUDE_CODE_PLUGIN_DIRS` entry and the version check are still open.
- **The template is now the single source.** Change a mod in `_core/global-template/mods/` first (on a branch, with its tests), then copy it to `~/.claude/mods/`. `~/.claude/mods/NOTES.md` (kept by the GameProject session) lists the per-machine files to keep when copying:
  - `guards/.claude-plugin/plugin.json`: `mentionRepos` default `claude-code-templates` (the template ships `*`).
  - `shared-pc/hooks/rules.ts`: the GameProject heavy/light lists (the template ships an empty `projects`).
  - `usage-guard/hooks/rules.ts`: the GameProject stop commands; the live usage-guard test expects `['gameproject']`.
  - Live-only files: `guards/tests/corpus.ts`, `shared-pc/DESIGN.md`, `shared-pc/TEMPLATES-NOTES.md`.
- **Live mods were reinstalled from the merged template** and both sessions restarted at 23:17. The stale ci-watch instance that sent false "failed" wakes during the review rounds is retired (each session's new instance claimed its owner file).
- **The two cards were checked on screen:** the usage-guard card stacks above the shared-PC card, both right-aligned, no overlap (maintainer confirmed).

## Decisions made this session

- **compact-handoff carries a message twice rather than lose it.** After four review findings on the fold, the rule is: fold only an exact repeat of the carried block's end at the very start of the list; anything unsure is carried again. The transcript reader folds a repeat only when a queued prompt is recorded again straight after.
- **Workflow-only PRs keep the two-subagent local review, approved case by case.** Helper agents are otherwise off in this repo; when a workflow-only PR is ready, ask the maintainer to allow the two reviews for that PR. The rule text stays as it is.

## Code-research count: 9% (start here)

`research-adherence.py` reported 2 tokensave calls against 20 plain code searches (plus 5 marked bypasses). Most were `awk`/`grep` line lookups in mod files already known by path while fixing review findings. The next session first checks why: either those lookups should go through `tokensave_search`/`tokensave_body`, or the mods folder is not in the tokensave index (check `tokensave_status`), or such known-file lookups need the bypass marker.

## Open work (maintainer picks the order)

- **#29** shared-pc `release` should also clear this session's next-up reservation (found in the card test: approving a request on an idle PC reserves it for ~3 minutes even if nothing runs). Small: fix `OPS.release` in `pcctl.cjs`, add a spec case, copy to live.
- **#28** opt-in per-project banned-names list for guards (GameProject: its clean-room names). Check first how GameProject enforces those names today.
- **#23** canonical-text fixes the re-bind found: session-close docs-only pointer gated on the wrong toggle; the token-efficiency timeout sentence contradicts itself; stale `REVIEW_MODELS` pins in `engine/model.js`; `research-adherence.py` blank-line folding; the review-tiers model cell can't show the backup; architecture-graph excluded by the engine but listed in BIND.md; stale precommit toggle reason.
- **#12** guards shadow comparison: due in a few days (logs in `~/.claude/mods-data/guards/`), then the maintainer decides enforce mode and retiring the two scripts.
- Maintainer's calls: the global CLAUDE.md still names an old 600-second Bash limit; a shorter shared-PC rule now that the mod runs the seat.
- Still open from before: code-research tool profiles and the plugin skeleton (Phase 1); not yet tested live, a true `claude --resume` during a usage pause; at v2.0.0, whether `Engine and hook tests` becomes required on `main`.

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`).
- **Work stays local; the cloud is retired.**
- **Attribution guard:** it blocks the word "Claude" in commit messages, even as the product name; say "function-hook mods" or "the CLI". Write any PR body file in its own step first. A command that both commits and runs `claude plugin test` is blocked too: run them as separate calls.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches stay out of `TOGGLES.md`, the bundle files and the v1 page.**
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files.**
- **Run the engine tests with plain `node --test` from `engine/`.**
- **Track every session item in the task list**, including cleanup, review rounds and the handoff.
- **Mods are global:** mods in `~/.claude/mods/<mod>/`, data in `~/.claude/mods-data/<mod>/`. A new `CLAUDE_CODE_PLUGIN_DIRS` entry needs a full restart (`claude --resume`).
