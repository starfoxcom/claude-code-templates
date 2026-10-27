# Review tiers

Every PR gets an AI review with a pass or block verdict, run by `.github/workflows/`. Local sessions never start the CI reviews themselves; the one local review is the path for PRs that edit `claude-code-review.yml`, in § PRs that edit the review workflow.

| Tier | Starts when | Model |
|---|---|---|
| Routine | Every PR (`claude-code-review.yml`) | `claude-fable-5-1` at low effort; backup `claude-opus-5-5` at high |
| Deep | A comment starting with `@claude review this PR` (`claude.yml`), posted by the routine reviewer or by someone with write access | `claude-fable-5-1` at low effort; backup `claude-opus-5-5` at high |

Both tiers report into one check, `Review gate`, written by `.github/scripts/review_gate.py` with its settings in `.github/review-gate.yml`. It passes only when the routine review passed and, if a deep review was asked for on that head, the deep review passed too; it waits while a deep review runs, and any 🔴, missing verdict or errored run fails it. Diffs on the deep-review trigger list always owe a deep review: the workflow applies `needs-deep-review` itself and fails the routine run if no request was posted. `Review gate` is the required review check on protected branches, and branch protection has no bypass actors. With a single maintainer, require zero approvals so the gate alone decides, since authors cannot approve their own PRs. With more people, also require one approval from someone other than the author. Docs-only and other non-reviewable diffs pass automatically in about 30 seconds. Model pins change only after a side-by-side comparison of candidate models on the same saved PRs, never just because a newer model exists.

## The verdict rule (both tiers)

- 🟢 LGTM only when the review is fully clean: no caveats, no nits, no "non-blocking" findings.
- 🔴 Blocking when any real finding exists, however it is framed. "LGTM with caveats" is 🔴.
- Style preferences and speculative future-proofing are dropped, not listed as minor.
- In a 🟢 review, 🔴 and the word Blocking appear only inside inline backticks on the same line (a line inside a fenced code block counts like any other; no "Blocking issues" heading, no "Blocking: none"). The gate blocks on lines like `**🔴 …**`, `- 🔴 x`, `### Blocking issues` or `**Verdict:** blocking` wherever they sit, and on any 🔴 on the last line, backticks or not, so a 🟢 verdict line holds no 🔴 at all. The verdict is the last line (under the review action's footer), and it opens with 🔴 or 🟢.

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

## What a finding blocks on

A finding belongs to the PR when the PR causes it: a regression from the base branch, or a break of what the PR says it does. A gap the base branch already has, or one the comparable community tool shares (for a workflow, the official action it pins), is not the PR's finding. It goes into a follow-up issue instead of the verdict. The review still covers the whole diff; this only decides what blocks.

- Write this bar into every reviewer prompt from the first round, local or CI, before any finding arrives.
- When a review reports, sort each finding against the bar before touching code. Fix only what passes it, with the smallest change, and add no features while fixing.
- After 6 red rounds in a row, stop patching: look up how others solved the same problem, simplify the design, then continue. Do the same at every 6th red round.

Without the bar, each fix adds surface for the next round to find, and the rounds never converge.

## PRs that edit the review workflow

The review action refuses to run when the PR's copy of `claude-code-review.yml` differs from the default branch's copy, so the review must never start on them. Triage never reviews that one file, and skips Markdown, images and fonts outside the always-reviewed paths (`_core/`, `bundles/`, `redesign/`, `.github/scripts/`, `.claude/` at any depth, `SETUP.md`, `TOGGLES.md`, `COMPARISON.md`, any `CLAUDE.md` or its `.local` variant); everything else gets a review, including `claude.yml` and every other workflow. A PR that edits `claude-code-review.yml` with only skippable files beside it is non-reviewable: both checks pass without a review. That makes two rules:

- An edit to `claude-code-review.yml` goes alone. Anything reviewable in the same PR (`claude.yml`, another workflow, the gate script, `.claude/`, a `CLAUDE.md`, code) starts the review, which fails `Workflow validation failed`, and the PR can never merge; split it. An edit to `claude.yml` alone runs under the unchanged routine workflow and gets a normal review.
- No AI reviews a PR that edits `claude-code-review.yml` in CI, so it is reviewed before merge, one of two ways:
  - **Every commit in it was written in the maintainer's own sessions:** two fresh subagents review the exact head commit that will merge. Neither is a fork of the session that wrote the change, and each gets only the PR's diff and its own prompt. One follows the review steps and the binary verdict rule of the routine-review prompt taken from the base branch's copy of `claude-code-review.yml`, never the PR's own copy. It runs the pre-screen's mechanical checks itself, since the CI pre-screen report does not exist locally. The other reviews as the deep tier, briefed to review the whole diff at that SHA adversarially under the binary verdict rule; the author may add focus points but never narrows that scope. Neither reviewer posts to the PR, applies a label or writes the deep-review trigger phrase; each returns its verdict to the author. Once both give 🟢, a PR comment records the head SHA and both verdict lines, and the merge passes `--match-head-commit <sha>` so it goes through only while that SHA is still the head. Any new commit re-runs both.
  - **Anything else,** including a PR the maintainer opened that carries someone else's commits: it merges only after the maintainer has read its whole diff.

For any other failure, fix the cause.

## Local session's job

Push, open the PR, watch the checks (see `token-efficiency.md`), and merge on 🟢. If `needs-deep-review` appears but no deep review starts within a few minutes, report it instead of starting one yourself.
