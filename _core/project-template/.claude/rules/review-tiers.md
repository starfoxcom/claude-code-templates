# Review tiers

Every PR gets an AI review with a pass or block verdict, run by `.github/workflows/`. Local sessions never start reviews themselves.

| Tier | Starts when | Model | Gate check |
|---|---|---|---|
| Routine | Every PR (`claude-code-review.yml`) | `{{REVIEW_ROUTINE_MODEL}}` | `Evaluate review outcome` |
| Deep | A comment starting with `@claude review this PR` (`claude.yml`) | `{{REVIEW_DEEP_MODEL}}` | `Claude On-Demand` |

Both checks are required on protected branches, and branch protection has no bypass actors. With a single maintainer, require zero approvals so the two checks alone decide, since authors cannot approve their own PRs. With more people, also require one approval from someone other than the author. Docs-only and other non-reviewable diffs pass both automatically in about 30 seconds. Model pins change only after a side-by-side comparison of candidate models on the same saved PRs, never just because a newer model exists.

## The verdict rule (both tiers)

- 🟢 LGTM only when the review is fully clean: no caveats, no nits, no "non-blocking" findings.
- 🔴 Blocking when any real finding exists, however it is framed. "LGTM with caveats" is 🔴.
- Style preferences and speculative future-proofing are dropped, not listed as minor.

A 🟢 that carries findings lets them merge and come back later as the same review.

## Deep review triggers

<!-- TOGGLE:github_actions_deep_review_auto_fire START -->
The routine reviewer escalates automatically: it adds the `needs-deep-review` label and posts the `@claude review this PR` comment when the diff touches the list below. While that label is on the PR, merge only after the deep review is 🟢.
<!-- TOGGLE:github_actions_deep_review_auto_fire END -->
<!-- TOGGLE:github_actions_deep_review_auto_fire:off START -->
Deep review is manual: comment `@claude review this PR` (the comment must start with that phrase) when the routine reviewer flags uncertainty or the diff touches the list below.
<!-- TOGGLE:github_actions_deep_review_auto_fire:off END -->

Escalate on risk, not size:

- Parsing, encoding or serialization logic
- Threading, locking, async coordination
- Schedulers, graph or DAG algorithms
- New public API surface
- Save or load formats, schema migrations
- Authentication, authorization, secrets, cryptography
- Anything that crosses a trust boundary (user input, network, plugins)

Skip escalation for docs, CI or settings tweaks, version bumps, mechanical refactors, test-only changes and one-line fixes. Keep this list in sync with the escalation list in `claude-code-review.yml`.

## After a 🔴

Fix on the same PR branch and push; the review re-runs. Then search the codebase for the same mistake elsewhere and fix every copy in that commit, because the reviewer only sees the diff.

## PRs that edit the review workflow

The review action refuses to run when the PR's copy of `claude-code-review.yml` differs from the default branch's copy, so the review must never start on them. Triage reviews only source files, so a PR that changes only workflow files (and docs) is non-reviewable: both checks pass without a review. That makes two rules:

- A workflow edit ships in a PR of its own, with no source files. Mixed with code, the review starts, fails `Workflow validation failed`, and the PR can never merge; split it.
- No AI reviews a workflow-only PR, so the maintainer reads its whole diff before it merges.

For any other failure, fix the cause.

## Local session's job

Push, open the PR, watch the checks (see `token-efficiency.md`), and merge on 🟢. If `needs-deep-review` appears but no deep review starts within a few minutes, report it instead of starting one yourself.
