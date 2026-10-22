# Review tiers

Every PR gets an AI review with a pass or block verdict, run by `.github/workflows/`. Local sessions never start the CI reviews themselves; the one local review is the workflow-only PR path in § PRs that edit the review workflow.

| Tier | Starts when | Model |
|---|---|---|
| Routine | Every PR (`claude-code-review.yml`) | `claude-fable-5-1` at low effort; backup `claude-opus-5-5` at high |
| Deep | A comment starting with `@claude review this PR` (`claude.yml`), posted by the routine reviewer or by someone with write access | `claude-fable-5-1` at low effort; backup `claude-opus-5-5` at high |

Both tiers report into one check, `Review gate`, written by `.github/scripts/review_gate.py` with its settings in `.github/review-gate.yml`. It passes only when the routine review passed and, if a deep review was asked for on that head, the deep review passed too; it waits while a deep review runs, and any 🔴, missing verdict or errored run fails it. Diffs on the deep-review trigger list always owe a deep review: the workflow applies `needs-deep-review` itself and fails the routine run if no request was posted. `Review gate` is the required review check on protected branches, and branch protection has no bypass actors. With a single maintainer, require zero approvals so the gate alone decides, since authors cannot approve their own PRs. With more people, also require one approval from someone other than the author. Docs-only and other non-reviewable diffs pass automatically in about 30 seconds. Model pins change only after a side-by-side comparison of candidate models on the same saved PRs, never just because a newer model exists.

## The verdict rule (both tiers)

- 🟢 LGTM only when the review is fully clean: no caveats, no nits, no "non-blocking" findings.
- 🔴 Blocking when any real finding exists, however it is framed. "LGTM with caveats" is 🔴.
- Style preferences and speculative future-proofing are dropped, not listed as minor.
- In a 🟢 review, 🔴 and the word Blocking appear only inside inline backticks on the same line (a line inside a fenced code block counts like any other; no "Blocking issues" heading, no "Blocking: none"). The gate blocks on lines like `**🔴 …**`, `### Blocking issues` or `- Blocking: none` wherever they sit, and on a 🔴 anywhere in the last line holding 🔴 or 🟢, backticks or not, so a 🟢 verdict line holds no 🔴 at all.

A 🟢 that carries findings lets them merge and come back later as the same review.

## Deep review triggers

The routine reviewer escalates automatically: it adds the `needs-deep-review` label and posts the `@claude review this PR` comment when the diff touches the list below. While that label is on the PR, merge only after the deep review is 🟢.

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
- No AI reviews a workflow-only PR in CI, so it is reviewed before merge, one of two ways:
  - **Every commit in it was written in the maintainer's own sessions:** two fresh subagents review the exact head commit that will merge. Neither is a fork of the session that wrote the change, and each gets only the PR's diff and its own prompt. One follows the review steps and the binary verdict rule of the routine-review prompt taken from the base branch's copy of `claude-code-review.yml`, never the PR's own copy. It runs the pre-screen's mechanical checks itself, since the CI pre-screen report does not exist locally. The other reviews as the deep tier, briefed to review the whole diff at that SHA adversarially under the binary verdict rule; the author may add focus points but never narrows that scope. Neither reviewer posts to the PR, applies a label or writes the deep-review trigger phrase; each returns its verdict to the author. Once both give 🟢, a PR comment records the head SHA and both verdict lines, and the merge passes `--match-head-commit <sha>` so it goes through only while that SHA is still the head. Any new commit re-runs both.
  - **Anything else,** including a PR the maintainer opened that carries someone else's commits: it merges only after the maintainer has read its whole diff.

For any other failure, fix the cause.

## Local session's job

Push, open the PR, watch the checks (see `token-efficiency.md`), and merge on 🟢. If `needs-deep-review` appears but no deep review starts within a few minutes, report it instead of starting one yourself.
