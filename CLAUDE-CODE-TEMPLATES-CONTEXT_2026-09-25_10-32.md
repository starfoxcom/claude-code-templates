# claude-code-templates — session handoff (2026-09-25 10:32)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues and the CHANGELOG don't already show.

---

## Headline: next session runs in the cloud

The maintainer is moving this repo's work to a cloud session. What does and does not carry over:

- **Carries over:** everything in the repo. That includes `.claude/settings.json` (attribution trailers off, from PR #148), the rules, the skills and the GitHub rulesets (no direct pushes to `main` or `develop`, no bypass actors).
- **Does not carry over:** the maintainer's global hooks under `~/.claude/hooks/`. That covers the no-attribution scanner, the push guard and the tokensave-first router. A cloud session has no mechanical guard against attribution text in PR bodies or comments, so keep the rule by discipline until P1d ships repo-level hooks.
- **Also missing:** there is no tokensave index in the cloud unless it is installed there. Code research falls back to Grep, Glob and Read.
- **First cloud task (#4):** prove the setup with a throwaway commit and PR. Check that the commit and the PR carry no attribution lines, then close the PR and delete the branch.

---

## Decisions made this session

- **No interim release.** `main` stays on v1.4.0 until v2.0.0. `docs/v2/PLAN.md` says `main` and the live page change only with v2.0.0, and `develop` holds partial v2 template rewrites. A v1.5.0 cut would ship them early.
- **#34 is parked until the v2.0.0 release.** Two comments in the live `claude-code-review.yml` on `main` are stale. The fix points them at `review-tiers.md`, which is only accurate on `main` once develop's rules land there. Redo that edit during v2.0.0 release prep.
- **Own workflow-only PRs merge on two local reviews** (PR #167). The full procedure is in `.claude/rules/review-tiers.md` § Workflow-only PRs skip the review. When writing the PR comment that records the head SHA and both verdicts, never write the deep-review trigger phrase.
- **Review verdicts name the model that ran** (PRs #165, #166). It shows in the `Evaluate review outcome` annotation and in the `Claude On-Demand` check title.

---

## Open work (task list)

- #22: receipts. `tools/receipts.py` and its tests are merged (#164; run `python -m unittest tools/test_receipts.py`). Still open: the "session stories" part, which combines the metrics with receipts from the Emberholm and Stockra sessions. It feeds the Phase 3 page's evidence section, replacing the old `RECEIPTS_STATS`/`RECEIPTS_CARDS` data in `index.html` (2026-04-06..05-12). Session logs only exist on the maintainer's PC, so this part runs locally, not in the cloud.
- #10/#15: P1c: tool profiles, plugin skeleton, `/bindwright:setup`; drop the retired tool blocks from the global template.
- #11: P1d: repo-level hooks plus the canonical `.claude/settings.json` deny list. Allow `push --force-with-lease`, deny plain `--force`, deny interactive rebase only, deny direct pushes to `develop` and `main`, no squash deny.
- #20: Phase 2 notes. `setup-review-gate.sh` must set `squash_merge_commit_title=PR_TITLE` and `squash_merge_commit_message=PR_BODY`. The develop ruleset must allow `[squash, merge]` and main `[merge]`.
- #19: the maintainer retires the Emberholm-only workflow-off-main hook (maintainer-owned).
- #32: motion design pass for the configurator page (later).
- #34: parked, see above.
