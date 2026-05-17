# Collaboration rules

This rule applies when multiple humans push to the repo — open-source, team project, or paid client team. The discipline below complements `git.md`; everything in `git.md` still applies.

---

## Branch hygiene

- **Pull `{{DEV_BRANCH}}` before starting** — `git fetch && git merge origin/{{DEV_BRANCH}}` so you don't waste a PR on an already-fixed bug.
- **Rebase or merge dev INTO your feature branch** when dev advances, never the other way (the PR's merge commit handles dev). The cascade is:
  ```bash
  git checkout feature/<n>
  git merge origin/{{DEV_BRANCH}}
  git push origin feature/<n>
  ```
- **Don't push to other people's branches** without coordinating in the PR. Force-push to a shared branch is a hard no.
- **One concern per branch.** If you find a tangential bug while working on a feature, fix it on its own branch and PR — don't bundle.

---

## PR etiquette

- **Open as Draft** when the work is incomplete but you want CI feedback. Mark Ready for Review only when you actually want eyes.
- **Self-review first** — read your own diff in the GitHub UI before requesting review. You'll catch half your own findings.
- **Respond to every comment** before re-requesting review. Either fix it, push back with a reason, or "tracked in #N" if deferring.
- **Don't force-push after review starts** unless you note the rewrite explicitly. Reviewers lose their place. Use additive fixup commits; squash on merge is configured at the repo level.
- **Be specific in review comments.** "This won't scale" is not actionable; "this O(n²) loop runs on every keystroke" is.

---

## Review distribution

If `CODEOWNERS` is configured, GitHub auto-requests reviewers. Otherwise:

- Request reviewers based on the **directory the change touches**, not seniority. The owner of the affected module reviews.
- For cross-cutting changes, request a reviewer per affected module.
- Don't merge your own PR — at least one other human approval is required.

---

## When CI is red

If the routine review posts 🔴, **fix on the PR branch** — don't open a new PR. Re-request review after pushing the fix. Don't "merge anyway" — the workflow's `Evaluate review outcome` step blocks merge.

If CI is red for **infrastructure reasons** (flaky test, runner outage), surface it to the maintainer who manages CI. Don't disable the workflow just to merge.

<!-- TOGGLE:mandatory_deep_review_before_merge START -->
---

## Mandatory deep review

For PRs whose diff touches the deep-review trigger surface (parsers, threading, public API, auth, migrations, scheduler/DAG, save/load format), the on-demand Opus deep review is **mandatory** before merge — not optional. The routine review auto-applies the `needs-deep-review` label AND posts the structured `@claude review this PR` follow-up. Merge is blocked until the deep review's 🟢 verdict lands.

If the deep review is 🔴, fix on the PR branch, re-request the deep review with another `@claude review this PR — re-check on <focus>` comment.
<!-- TOGGLE:mandatory_deep_review_before_merge END -->

<!-- TOGGLE:oncall_awareness START -->
---

## On-call awareness

If your team has an on-call rotation:

- Don't merge risky changes (migration, infra, config) Friday afternoon or before on-call handoff. The person on call shouldn't inherit your unverified change.
- For migrations, deploy + monitor the morning AFTER merge — don't ship-and-leave.
- If you're on-call, surface this in PR comments: "I'm on-call this week, prefer to defer this merge to Mon."
<!-- TOGGLE:oncall_awareness END -->
