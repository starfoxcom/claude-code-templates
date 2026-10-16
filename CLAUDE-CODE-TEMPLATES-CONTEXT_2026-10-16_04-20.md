# Hand-off — 2026-10-16 04:20

Closed at the maintainer's request. No PR is open other than this hand-off; `develop` is clean.

## Shipped since the last hand-off
- #310: the usage-guard card that offers a closed session's saved pause work to the next session.
- #313: the guards mod is removed. The live hooks stay the real guard.
- #314: a usage-guard test steps its fake clock past the reset in 10-minute steps, so slow runners no longer fail it.
- #316 (main) and #317 (cascade): the routine review runs on the org's monthly API credits first. A plain `claude -p` run on the `ANTHROPIC_API_KEY` secret posts as the review bot via the action's OIDC token exchange. It runs in a worktree whose config files come from the base branch, with `--setting-sources user --strict-mcp-config`. The step succeeds only when a verdict comment from this run is on the PR. With no verdict, the existing action steps run on the subscription. A verdict from a run that then broke fails the job (`halt`) and asks for a re-run, so a second review never re-rolls the verdict.

## Decisions
- The review action itself is refused the API credits ("Credit balance is too low"). Only a plain CLI run uses them.
- One API key per repo, all in the Console workspace `ci-reviews`, which has a $150/month cap. The key goes straight into the repo secret and is never saved anywhere else. This repo's key expires 2027-01-13.
- The deep tier (`claude.yml`, tag mode) stays on the subscription for now.
- CLI versions stay pinned: 2.1.300 on the credits path, the action path unchanged.

## On hold
- Confirm on the next reviewable PR that the review job log shows "Reviewed on the API credits: $X over N turns" and that the reviewer label reads "(API credits)".
- Follow-ups, maintainer picks the order:
  - a weekly check for newer CLI releases;
  - the action path loads the base `.claude/settings.local.json`, which allows `git push`/`git commit` for the reviewer;
  - the deep tier on the credits;
  - port to the public templates;
  - rotate the key before 2027-01-13.
- Delete the purge backups once GitHub Support replies.
- Confirm the session-facts fallback fires in a fresh session.

## First steps next session
1. If a reviewable PR ran, check its review log for the credits line, and check the Console balance.
2. Ask the maintainer which follow-up goes first.
