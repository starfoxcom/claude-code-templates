# Review tiers

Every PR gets an AI review with a pass or block verdict, run by `.github/workflows/`. Local sessions never start the CI reviews themselves; the one local review is the workflow-only PR path in § PRs that edit the review workflow.

| Tier | Starts when | Model |
|---|---|---|
| Routine | Every PR with reviewable files (`claude-code-review.yml`) | `claude-fable-5-1` at low effort; backup `claude-opus-5-5` at high |
| Deep | A comment starting with `@claude review this PR` (`claude.yml`) | `claude-fable-5-1` at low effort; backup `claude-opus-5-5` at high |

Both tiers report into one check, `Review gate`: it passes when the routine verdict is 🟢 and, once a deep review is asked for, the deep verdict is 🟢 too. That check is required on protected branches, and branch protection has no bypass actors; `.github/scripts/setup-review-gate.sh` sets this up (`--check` only reports what is missing). With a single maintainer, require zero approvals so the gate alone decides, since authors cannot approve their own PRs. With more people, also require one approval from someone other than the author. Docs-only and other non-reviewable diffs pass automatically in about 30 seconds.

The gate's settings live in `.github/review-gate.yml` (models, runner, the project's own pre-screen checks, trigger paths and always-reviewed paths), and the project's part of the review prompt lives in `.github/review-guide.md`. Both are read from the PR's base branch, so a PR cannot change the rules of its own review. Model pins change only after a side-by-side comparison of candidate models on the same saved PRs, never just because a newer model exists.

## The verdict rule (both tiers)

- 🟢 LGTM only when the review is fully clean: no caveats, no nits, no "non-blocking" findings.
- 🔴 Blocking when any real finding exists, however it is framed. "LGTM with caveats" is 🔴.
- Style preferences and speculative future-proofing are dropped, not listed as minor.

A 🟢 that carries findings lets them merge and come back later as the same review.

## Deep review triggers

The routine reviewer escalates automatically: it adds the `needs-deep-review` label and posts the `@claude review this PR` comment when the diff touches the gate's own files, the trigger paths and patterns in `.github/review-gate.yml` (`escalate.*`), or the list below. While that label is on the PR, every push gets a deep review, and the gate waits for its 🟢.

Escalate on risk, not size:

- Parsing, encoding or serialization logic
- Threading, locking, async coordination
- Schedulers, graph or DAG algorithms
- New public API surface
- Save or load formats, schema migrations
- Authentication, authorization, secrets, cryptography
- Anything that crosses a trust boundary (user input, network, plugins)

Skip escalation for docs, CI or settings tweaks, version bumps, mechanical refactors, test-only changes and one-line fixes. Fit the list to the project's risk: paths and added-line patterns go in `.github/review-gate.yml` (`escalate.paths`, `escalate.patterns`), changes that need judgment to spot go in `.github/review-guide.md` under "Also escalate when the diff includes". Keep this list in step with both.

## After a 🔴

Fix on the same PR branch and push; the review re-runs. Then search the codebase for the same mistake elsewhere and fix every copy in that commit, because the reviewer only sees the diff.

## What a finding blocks on

A finding belongs to the PR when the PR causes it: a regression from the base branch, or a break of what the PR says it does. A gap the base branch already has, or one the comparable community tool shares (for a workflow, the official action it pins), is not the PR's finding. It goes into a follow-up issue instead of the verdict. The review still covers the whole diff; this only decides what blocks.

- Write this bar into every reviewer prompt from the first round, local or CI, before any finding arrives.
- When a review reports, sort each finding against the bar before touching code. Fix only what passes it, plus the other copies of that same mistake (§ After a 🔴), with the smallest change, and add no features while fixing.
- After 6 red rounds in a row, stop patching: look up how others solved the same problem, simplify the design, then continue. Do the same at every 6th red round.

Without the bar, each fix adds surface for the next round to find, and the rounds never converge.

## PRs that edit the review workflow

The review action refuses to run when the PR's copy of `claude-code-review.yml` differs from the default branch's copy, so the review must never start on them. Triage never reviews `claude-code-review.yml`, which it skips by name, so a PR whose only other files are skippable (Markdown, images and fonts outside the always-reviewed paths) is non-reviewable: the `Review gate` check passes without a review. That makes two rules:

- An edit to `claude-code-review.yml` ships in a PR of its own. Anything reviewable in the same PR (`claude.yml`, another workflow, the gate's scripts, `.claude/`, a `CLAUDE.md`, code) starts the review, which fails `Workflow validation failed`, and the PR can never merge; split it. Edits to `claude.yml` alone get a normal review: it runs from the default branch's copy.
- No AI reviews such a PR in CI, so it is reviewed before merge, one of two ways:
  - **Every commit in it was written in the maintainer's own sessions:** two fresh subagents review the exact head commit that will merge. Neither is a fork of the session that wrote the change, and each gets only the PR's diff and its own prompt. One follows the review steps and the binary verdict rule of the routine-review prompt taken from the base branch's copy of `claude-code-review.yml`, never the PR's own copy. It runs the pre-screen's mechanical checks itself, since the CI pre-screen report does not exist locally. The other reviews as the deep tier, briefed to review the whole diff at that SHA adversarially under the binary verdict rule; the author may add focus points but never narrows that scope. Neither reviewer posts to the PR, applies a label or writes the deep-review trigger phrase; each returns its verdict to the author. Once both give 🟢, a PR comment records the head SHA and both verdict lines, and the merge passes `--match-head-commit <sha>` so it goes through only while that SHA is still the head. Any new commit re-runs both.
  - **Anything else,** including a PR the maintainer opened that carries someone else's commits: it merges only after the maintainer has read its whole diff.

For any other failure, fix the cause.

## Local session's job

Push, open the PR, watch the checks (see `token-efficiency.md`), and merge on 🟢. If `needs-deep-review` appears but no deep review starts within a few minutes, report it instead of starting one yourself.
