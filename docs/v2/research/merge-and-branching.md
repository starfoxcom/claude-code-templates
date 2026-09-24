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

Sources: docs.github.com (merge methods, commit signature verification, events that trigger workflows), docs.gitlab.com merge request methods, github.com/googleapis/release-please, nvie.com/posts/a-successful-git-branching-model, dora.dev/capabilities/trunk-based-development, martinfowler.com/articles/branching-patterns.html, trunkbaseddevelopment.com, google.github.io/eng-practices, github.com/anthropics/claude-code-action issues 443 and 722, gist.github.com/mitchellh/319019b1b8aac9110fcfb1862e0c97fb.
