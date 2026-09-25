# claude-code-templates — session handoff (2026-09-25 15:45)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues and the CHANGELOG don't already show.

---

## Headline: guard hooks ship, the deep-review trigger must lead

- **Guard hooks are canonical** (PR #177). Binds ship `.claude/hooks/` (launcher, push guard, attribution guard) registered in a committed `.claude/settings.json`. Engine switches: `hookLocation` (`repo` default / `home`) and `attributionGuard` (default on; off also drops the `attribution` settings, the git.md line and the review template's attribution scan). The repo copies, the project-template copies and the global-template copies must stay byte-identical; an engine test enforces it.
- **The deep review starts only on a comment that STARTS with the trigger phrase** (PR #174 on `main`, cascade #175, templates and docs #176). Before, a routine verdict that merely quoted the phrase fired a bogus deep run that failed `Claude On-Demand`. Verified live on #176 and #177: the Step 4.B escalation still fires.
- **Never write the whole trigger phrase into a PR's files.** Tests and fixtures build it from pieces (`DEEP_TRIGGER` in `tools/test_guard_hooks.py`). The filter fix makes a quote harmless, but keep the habit.

---

## Decisions made this session

- **Work stays local; the cloud is retired** (earlier today). The cloud connector appends an attribution footer to PR bodies that survives in GitHub's edit history.
- **Attribution guard is opt-out, and its rule is "no attribution", not "no mention".** Attribution is a personal preference; mentions of a tool pass. The maintainer's own home-folder guard stays stricter (no Claude/Anthropic mention at all) by choice.
- **Maintainer's home-folder guard was replaced** (2026-09-25 14:29) with the false-positive fixes ported and the strict rules kept. Backup: `~/.claude/hooks/no-ai-attribution.py.bak-20260925-142908`. Replayed against 11,406 real commands from 40 sessions: 0 newly blocked, 71 newly allowed (all false alarms). Emberholm and Stockra sessions were notified.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands: changes to `index.html`, `index.legacy.html` and `redesign/*.jsx` push without the maintainer's visual check.
- **Engine-only switches are not added to `TOGGLES.md` or the bundle files** (precedent: `devIsDefault`); those belong to the UI being replaced.
- **No interim release.** `main` stays on v1.4.0 until v2.0.0. #34 stays parked until v2.0.0 release prep.

---

## Open work

- #11 remainder: deny-list profiles (standard and strict) for the committed `.claude/settings.json` (PLAN.md Phase 1). Allow `push --force-with-lease`, deny plain `--force`, deny interactive rebase only, deny direct pushes to `develop` and `main`, no squash deny. The deny list still lives in `settings.local.json.template`.
- #22: receipts "session stories" (combine metrics with Emberholm/Stockra session receipts for the Phase 3 evidence section). Session logs exist only on the maintainer's PC.
- #10/#15: P1c: tool profiles, plugin skeleton, `/bindwright:setup`; drop retired tool blocks from the global template.
- #20: Phase 2 notes (`setup-review-gate.sh` squash title/body settings; develop ruleset `[squash, merge]`, main `[merge]`).
- #19: the maintainer retires the Emberholm-only workflow-off-main hook (maintainer-owned).
- #32: motion design pass for the configurator page (later; likely superseded by the overhaul).
- #34: parked until v2.0.0.
- Local branch `wip/attribution-guard` was deleted; nothing else is pending locally.
