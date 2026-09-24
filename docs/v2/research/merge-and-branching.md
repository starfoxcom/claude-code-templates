# Merge style and branching research (2026-09-23)

## Merge methods
- Merge commit: keeps every commit plus the merge point, one-step revert (`git revert -m1`), safe for stacked PRs. Bisect and blame hit work-in-progress commits unless you use `--first-parent`. Good when commits are curated and each one builds.
- Squash: one PR becomes one commit. Revert, blame and bisect work per PR; the PR title becomes the commit subject. Recommended by release-please for conventional-commit changelogs. GitHub signs the squash commit. Loses per-commit authorship and body trailers unless the squash message is configured; breaks stacked PRs.
- Rebase-merge: linear history with every commit kept, so every commit must build. GitHub rewrites SHAs and drops signature verification.
- Agent-authored PRs are full of review-fix and retry commits that often do not build alone. That rules out rebase-merge and makes plain merges noisy. Squash matches "one task, one commit" (inference, no single authoritative source).

## Branching
- Driessen (git-flow author, 2020 note): git-flow suits versioned software with several supported versions; for continuous delivery use something simpler like GitHub flow.
- DORA: high performers keep three or fewer active branches and merge to trunk at least daily.
- GitHub Actions: `issue_comment` and `schedule` workflows run from the default branch, and claude-code-action requires the PR's workflow file to match the default branch. With Gitflow (PRs into `develop`, default branch `main`) any drift breaks review. This is the root cause of the hotfix-then-cascade ritual. If Gitflow stays, make `develop` the default branch.

## Merge queues and linear history
- Merge queue: worth it for busy branches with many concurrent mergers. Org-owned repos only, needs a `merge_group` trigger, re-runs CI.
- Require linear history: cheap once standardized on squash or rebase.

## Recommendation for Bindwright
Default: GitHub flow (main plus short-lived branches), squash merge, PR title in conventional-commit form. Advanced options: merge commit, rebase merge, require linear history, merge queue, Gitflow (with the default-branch warning).

## Per-project facts (2026-09-23)
- This repo: default `main`. Since 2026-05-26, 43 merged PRs: 9 hotfix, 10 cascade, 2 release. Pages deploys on push to `main` (unaffected by the default branch). All three merge methods allowed.
- Stockra (from its session): default `main`. Since 2026-05-23, 61 merged PRs: 11 hotfix, 9 cascade, 0 release. Every hotfix since 2026-04-28 was a CI or review-workflow change. Scheduled jobs already check out `develop` explicitly. No deploy, store build or migration triggers. Rulesets allow only merge commits and `.claude/settings.json` denies squash merges, so the `develop` ruleset must allow merge and squash. The first real release PR will carry about 360 commits.
- Emberholm (from its session): default `main`. 2026-05-25 to 2026-09-24, 765 merged PRs: 683 work, 47 hotfix (all CI-workflow fixes), 33 cascade, 2 workflow syncs, 0 release; `main` is 3776 commits behind `develop`. Scheduled jobs run `main`'s workflow file against `develop`'s tree, which is why their target lists must be kept in step by hand. Closing keywords (`Resolves ...`) never auto-close because PRs target a non-default branch. Both rulesets allow only merge commits. A global hook blocks workflow edits off `main`; it and the matching memory must be rewritten if `develop` becomes the default.

Across the three repos, every hotfix in the period was a workflow change, not a product fix: the hotfix-plus-cascade pair exists because comment-triggered and scheduled workflows run the default branch's copy.

### Decision (2026-09-24)
- Emberholm and Stockra: `develop` becomes the GitHub default branch. Flip it right after a cascade, while `.github/workflows` is identical on both branches.
- This repo: keeps `main` as default (public repo; the home page should show the released README).
- Bindwright default: `main`; `develop` as default is an Advanced option (`devIsDefault`).

### Squash-specific follow-ups (from Emberholm)
- Stacked PRs: after the parent squash-merges, rebase the child with `git rebase --onto develop <old-parent-tip>`.
- One logical change per PR becomes the history unit; commits inside a PR serve review only. Bisect lands on a PR.
- GitHub appends ` (#1234)` to the squash subject: cap PR titles at 64 characters.
- Rulesets must list `squash` in `allowed_merge_methods` for `develop`.

Sources: docs.github.com (merge methods, commit signature verification, events that trigger workflows), docs.gitlab.com merge request methods, github.com/googleapis/release-please, nvie.com/posts/a-successful-git-branching-model, dora.dev/capabilities/trunk-based-development, martinfowler.com/articles/branching-patterns.html, trunkbaseddevelopment.com, google.github.io/eng-practices, github.com/anthropics/claude-code-action issues 443 and 722, gist.github.com/mitchellh/319019b1b8aac9110fcfb1862e0c97fb.
