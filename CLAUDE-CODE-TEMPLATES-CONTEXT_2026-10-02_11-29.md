# claude-code-templates — session handoff (2026-10-02 11:29)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show.

---

## Headline: mods are planned as opt-in `~/.claude` extras

- **Claude Code 2.1.287 added mods** (plugins of function hooks). `docs/v2/PLAN.md` now records the decision (Decisions row "Claude Code mods") and a Phase 2b item: session facts pre-checked; compaction hand-off, shared-PC, usage guard and status line pieces opt-in. Guard hooks stay settings hooks.
- **Four global mods are live on the maintainer's PC** (outside this repo), loaded through `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`: `session-facts`, `compact-handoff`, `usage-guard` (built by the Emberholm session) and `shared-pc` (built here). A fifth, `ci-watch` (Emberholm session), watches a pushed PR's checks and wakes the session once they settle; the global CLAUDE.md CI rule now says ci-watch first, Monitor as fallback. Status line: `~/.claude/statusline.js` with `statusline.config.json`.
- **`~/.claude/mods/shared-pc/TEMPLATES-NOTES.md` is the porting brief**: what each mod does, defaults, the disk/token constraints, and the mod-API lessons (test kit quirks, validator rules, the 10 s hook budget, why the request card lives inside the band). Read it before porting any mod into `_core/global-template/mods/`. `DESIGN.md` beside it is the shared-PC design.

## Mod tests run 2026-10-02 (after 11:15)

- **compact-handoff, first live shadow run (manual /compact, 11:23):** hand-off file written; it covers goal, next step, decisions, dead ends and live state; recall reaches pre-compaction rows. One bug: messages typed mid-turn (stored as `queued_command` attachments) were missing from the verbatim block. The Emberholm session fixed it, and a replay on this transcript confirmed all three now appear once. Cost: the shadow pass roughly doubles the compaction step itself (cache-priced fork plus ~5k tokens of output), under 1% across a session. Plan: 1-2 more shadow compactions (Emberholm runs the next), then switch to `on`.
- **usage-guard wrap-up and wake (in progress at this hand-off):** a hand-written `~/.claude/mods-data/usage-guard/pause.json` (5-hour at 91%, `triggeredBy: live-test`, the Emberholm session pre-marked handled) fired this automatic /session-close at 11:29. The wake is due at 11:37:19 and should run /session-start. A hand-written pause never runs the stop commands; only the session that creates the pause from its own readings does. After the wake: confirm the file says `done`, then delete it, and ask the maintainer whether the Emberholm status line showed "PAUSED → <time>" until the wake.

## Shared-PC mod (done, installed 2026-10-02)

- One session at a time holds "the seat" for heavy work; heavy Bash/PowerShell commands wait in line inside the call (Esc leaves the line). A one-line band above the prompt shows the seat and your place in line; skip-the-line requests are shared across sessions as a bordered yellow card with Approve/Decline that stays until answered, and the answer wakes an idle asker. Refuses new heavy work during a usage-guard pause.
- Tests: 9 mod tests (`claude plugin test`), 15 lock tests (`node --test test-helper/pcctl.spec.cjs`), validate and `tsc` clean. Data in `~/.claude/mods-data/shared-pc/`.
- Verified live: in-line wait past the hook budget, background jobs holding the seat, Esc leaving the line, approve and decline wake-ups. Cross-session card: one approval arrived from the second session right after the restart; confirm with the maintainer that the card drew there.
- The written turn-taking rule in `~/.claude/CLAUDE.md` stays as the fallback. Once the mod has run a few days, propose a shorter rule that points to it (maintainer's call).

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`).
- **Work stays local; the cloud is retired.**
- **Attribution guard:** it blocks the word "Claude" in commit messages, even as the product name; say "function-hook mods" or "the CLI". Write any PR body file in its own step first.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches stay out of `TOGGLES.md`, the bundle files and the v1 page.**
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files.**
- **Run the engine tests with plain `node --test` from `engine/`.** In tests, never start Python through the `python` alias and then by full path in the same Node process.
- **Workflow-only PRs from our sessions:** two fresh local subagent reviews on the head SHA, a PR comment with both verdicts, merge with `--match-head-commit`.
- **Track every session item in the task list**, including cleanup, review rounds and the handoff.
- **Mods are global** (maintainer, 2026-10-02): mods live in `~/.claude/mods/<mod>/`, data in `~/.claude/mods-data/<mod>/`; a mod checks the working directory itself when something is project-specific. A new `CLAUDE_CODE_PLUGIN_DIRS` entry needs a full restart (`claude --resume`); `/reload-plugins` does not re-read it. Delete a mod's dev-mods copy once installed, or a restarted session loads it twice.

---

## Open work

Next in Phase 1 (`docs/v2/PLAN.md`):

- Code-research tool profiles (data file) replacing the SETUP.md hook-install prose.
- Plugin skeleton with `/bindwright:setup`.

Other items:

- Port the mods into `_core/global-template/mods/` (Phase 2b item), after the three checks listed there.
- At v2.0.0: decide whether `Engine and hook tests` becomes required on `main` too.
- Receipts "session stories" for the Phase 3 evidence section.
- Phase 2 notes: `setup-review-gate.sh` merge-commit title/body settings; develop and main rulesets `[merge]`.
- The maintainer retires the Emberholm-only workflow-off-main hook (maintainer-owned).
