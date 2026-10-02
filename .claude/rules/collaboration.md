# Collaboration

Applies when more than one person pushes to the repo. Everything in `git.md` still applies.

## Branches

- Fetch and merge `develop` into your branch before starting, so you do not fix something already fixed.
- Never push to someone else's branch without agreeing in the PR first. Never force-push a shared branch.

## Pull requests

- Open as a draft while the work is incomplete; mark it ready only when you want review.
- Read your own diff on GitHub before asking for review.
- Answer every review comment before asking again: fix it, push back with a reason, or link the issue that tracks it.
- After review starts, add fixup commits instead of force-pushing, so reviewers keep their place. The merge style in `git.md` decides how they land.
- Make review comments specific: "this O(n²) loop runs on every keystroke", not "this won't scale".

## Who reviews

- This repo has one maintainer and no `CODEOWNERS` file. Branch protection requires zero approvals, so the AI review gates decide: a PR merges on a 🟢 routine verdict, plus a 🟢 deep verdict when a deep review was raised (`review-tiers.md`). The maintainer merges on a 🟢 gate without a separate approval.
- A PR from an external contributor also needs the maintainer to read its whole diff before it merges, on top of the AI verdicts.

## When CI is red

- A 🔴 review verdict is fixed on the same PR branch. Never merge past it.
- A red check caused by infrastructure (flaky test, runner outage) goes to whoever maintains CI. Never disable a workflow to get a merge through.
