# claude-code-templates — session handoff (2026-09-25 11:14)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues and the CHANGELOG don't already show.

---

## Headline: work stays local, the cloud is retired

The cloud trial ended the same day. Do not move this repo's work to a Claude Code cloud session again.

- **Why:** the cloud session's GitHub connector appends a Claude Code attribution footer, with a session link, to every PR body it creates and every comment it posts. An immediate body edit removes the footer, but GitHub keeps the first version in the PR's edit history. The cloud harness also forces `claude/<session>` branch names, which a `--merge` PR writes into its merge commit.
- **What was clean:** commits. With the maintainer's git identity set and local attribution hooks installed, the test commit carried no trailers.
- **Test PR #169:** closed unmerged. The maintainer deleted the footer revision from its edit history; the branch is deleted. Only GitHub Support can delete the PR itself.

---

## Decisions made this session

- **No interim release.** `main` stays on v1.4.0 until v2.0.0. `docs/v2/PLAN.md` says `main` and the live page change only with v2.0.0, and `develop` holds partial v2 template rewrites. A v1.5.0 cut would ship them early.
- **#34 is parked until the v2.0.0 release.** Two comments in the live `claude-code-review.yml` on `main` are stale. The fix points them at `review-tiers.md`, which is only accurate on `main` once develop's rules land there. Redo that edit during v2.0.0 release prep.
- **Own workflow-only PRs merge on two local reviews** (PR #167). The full procedure is in `.claude/rules/review-tiers.md` § Workflow-only PRs skip the review. When writing the PR comment that records the head SHA and both verdicts, never write the deep-review trigger phrase.
- **Review verdicts name the model that ran** (PRs #165, #166). It shows in the `Evaluate review outcome` annotation and in the `Claude On-Demand` check title.

---

## Open work (task list)

- #22: receipts. `tools/receipts.py` and its tests are merged (#164; run `python -m unittest tools/test_receipts.py`). Still open: the "session stories" part, which combines the metrics with receipts from the Emberholm and Stockra sessions. It feeds the Phase 3 page's evidence section, replacing the old `RECEIPTS_STATS`/`RECEIPTS_CARDS` data in `index.html` (2026-04-06..05-12). Session logs only exist on the maintainer's PC.
- #10/#15: P1c: tool profiles, plugin skeleton, `/bindwright:setup`; drop the retired tool blocks from the global template.
- #11: P1d: repo-level hooks plus the canonical `.claude/settings.json` deny list. Allow `push --force-with-lease`, deny plain `--force`, deny interactive rebase only, deny direct pushes to `develop` and `main`, no squash deny.
- #20: Phase 2 notes. `setup-review-gate.sh` must set `squash_merge_commit_title=PR_TITLE` and `squash_merge_commit_message=PR_BODY`. The develop ruleset must allow `[squash, merge]` and main `[merge]`.
- #19: the maintainer retires the Emberholm-only workflow-off-main hook (maintainer-owned).
- #32: motion design pass for the configurator page (later).
- #34: parked, see above.
