# Git rules

## Commits

One logical change per commit. Never mix a feature with a refactor, or a fix with config.

```
<type>(<scope>): <imperative description>
```

- 72 characters max. Imperative verb: `add`, `fix`, `remove`, `update`, `refactor`, `extract`.
- `scope` is the system or layer touched.
- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore` (build, CI, tooling, deps), `data` (app data, configs, assets), `style` (formatting only).
<!-- TOGGLE:attribution_guard START -->
- No AI-attribution lines anywhere: no co-author trailers, "generated with" footers or session links in commits, PR titles, PR bodies or comments. `.claude/settings.json` turns off the harness's own trailers, and the `no-ai-attribution` hook catches the ones written by hand.
<!-- TOGGLE:attribution_guard END -->

---

<!-- TOGGLE:branching_model_gitflow START -->
## Branches (Gitflow)

| Branch | From | Merges into |
|---|---|---|
| `{{MAIN_BRANCH}}` | | Production. Every release commit is tagged. |
| `{{DEV_BRANCH}}` | | Integration. Base for all work. |
| `feature/<name>` | `{{DEV_BRANCH}}` | `{{DEV_BRANCH}}` |
| `release/<version>` | `{{DEV_BRANCH}}` | `{{MAIN_BRANCH}}`, then cascade to `{{DEV_BRANCH}}` |
| `hotfix/<name>` | `{{MAIN_BRANCH}}` | `{{MAIN_BRANCH}}`, then cascade to `{{DEV_BRANCH}}` |

- Kebab-case names: `feature/user-auth-flow`.
- Never push directly to `{{MAIN_BRANCH}}` or `{{DEV_BRANCH}}`.
<!-- TOGGLE:default_branch_is_dev START -->
- `{{DEV_BRANCH}}` is the GitHub default branch, so `gh pr create` targets it automatically. Pass `--base {{MAIN_BRANCH}}` only for release and hotfix PRs.
<!-- TOGGLE:default_branch_is_dev END -->
<!-- TOGGLE:default_branch_is_dev:off START -->
- The GitHub default branch is `{{MAIN_BRANCH}}`, so always pass `--base {{DEV_BRANCH}}` to `gh pr create` for work PRs.
<!-- TOGGLE:default_branch_is_dev:off END -->
<!-- TOGGLE:branching_model_gitflow END -->

<!-- TOGGLE:branching_model_trunk START -->
## Branches (trunk-based)

| Branch | From | Merges into |
|---|---|---|
| `{{MAIN_BRANCH}}` | | The only long-lived branch. Release commits are tagged. |
| `feature/<name>` | `{{MAIN_BRANCH}}` | `{{MAIN_BRANCH}}` |
| `hotfix/<name>` | `{{MAIN_BRANCH}}` | `{{MAIN_BRANCH}}` |

- Kebab-case names: `feature/user-auth-flow`.
- Never push directly to `{{MAIN_BRANCH}}`.
<!-- TOGGLE:branching_model_trunk END -->

### Keep branches current

When the base branch advances, merge it into your open branches before continuing (`git fetch origin`, then `git merge origin/{{DEV_BRANCH}}` on the work branch, then push). Never rewrite a branch someone else has pulled.

### Scope

A branch changes one concern. A tangential bug gets its own branch. Before coding, list the directories the work will touch; anything outside the branch's scope becomes a prerequisite branch and PR that merges first.

### Check the branch before the first edit

Run `git branch --show-current` before editing. Switch or branch first, then edit. If you notice you edited on the wrong branch, stop and say so instead of stashing and moving the work silently.

---

## Merging

<!-- TOGGLE:merge_style:squash START -->
- Work PRs squash-merge: `gh pr merge <pr> --squash --delete-branch`. The PR title becomes the commit, so it must follow the commit format above, in 64 characters or fewer (GitHub appends ` (#123)`). One PR is one logical change; the commits inside it serve review only.
- A branch stacked on a PR that was just squash-merged still carries the parent's commits. Before continuing, run `git rebase --onto origin/{{DEV_BRANCH}} <old-parent-tip>` and force-push the stacked branch.
<!-- TOGGLE:merge_style:squash END -->
<!-- TOGGLE:merge_style:merge START -->
- Every PR merges with a merge commit: `gh pr merge <pr> --merge --delete-branch`. Keep each commit buildable, and read history with `git log --first-parent`.
<!-- TOGGLE:merge_style:merge END -->
<!-- TOGGLE:merge_style:rebase START -->
- Work PRs rebase-merge: `gh pr merge <pr> --rebase --delete-branch`. Every commit must build on its own, so squash fixup commits on the branch before merging.
<!-- TOGGLE:merge_style:rebase END -->
<!-- TOGGLE:branching_model_gitflow START -->
- Release PRs (`{{DEV_BRANCH}}` into `{{MAIN_BRANCH}}`) and cascade PRs (`{{MAIN_BRANCH}}` into `{{DEV_BRANCH}}`) always use `--merge`. Squashing them makes the two branches diverge and turns the next release into a conflict.
<!-- TOGGLE:branching_model_gitflow END -->
- After merging: `--delete-branch` removes the remote branch, but the local one only when it is checked out. Run `git branch -D <name>` if it remains, then confirm with `git branch`.
- Re-run a failed CI workflow as a whole (or push again). Re-running only the failed job can leave a required check stuck.

<!-- TOGGLE:branching_model_gitflow START -->
### Cascade after every merge into `{{MAIN_BRANCH}}`

GitHub does not copy `{{MAIN_BRANCH}}` back into `{{DEV_BRANCH}}`. After a hotfix or release merges:

```bash
git fetch origin
git checkout -b chore/cascade-<name> origin/{{DEV_BRANCH}}
git merge --no-ff origin/{{MAIN_BRANCH}} -m "chore: cascade <name> into {{DEV_BRANCH}}"
git push -u origin chore/cascade-<name>
gh pr create --base {{DEV_BRANCH}} --title "chore: cascade <name> into {{DEV_BRANCH}}" --body-file <file>
```

The hotfix or release is done only when the cascade PR is merged and its branch deleted.

### Workflow file changes

Review workflows triggered by comments or schedules run the copy on the GitHub default branch, and the review action refuses to run when a PR's workflow file differs from that copy.
<!-- TOGGLE:default_branch_is_dev START -->
Because `{{DEV_BRANCH}}` is the default branch, workflow changes are ordinary work PRs into `{{DEV_BRANCH}}`. They reach `{{MAIN_BRANCH}}` with the next release. A hotfix cut while `{{DEV_BRANCH}}` holds unreleased workflow changes will fail that check; release first, then cut the hotfix.
<!-- TOGGLE:default_branch_is_dev END -->
<!-- TOGGLE:default_branch_is_dev:off START -->
Because `{{MAIN_BRANCH}}` is the default branch, a change to `.github/workflows/` lands on `{{MAIN_BRANCH}}` first as a `hotfix/<name>` PR, then cascades to `{{DEV_BRANCH}}`. A workflow change made on a feature branch fails the review check.
<!-- TOGGLE:default_branch_is_dev:off END -->
<!-- TOGGLE:branching_model_gitflow END -->

---

## Pull requests

Write the body to a file and pass `--body-file <path>`. Inline bodies get truncated or mangled by the shell.

```
## What
<1-3 bullets>

## Why
<1-2 lines>

## Notes (optional)
<non-obvious decisions, performance impact, manual steps>
```

No empty sections and no generic testing checklist. The body carries what the diff cannot show.

Review tiers, the verdict rule and CI watching live in `review-tiers.md` and `token-efficiency.md`.

---

## Dead code does not ship

Code with no remaining caller is deleted in the same PR that orphaned it. Check with the project's lint or dead-code tool, then judge the result: a symbol reached only through reflection, dependency injection, bindings or serialization is not dead. If a tool reports a false positive, record the exception where the tool reads it instead of silencing the tool.

## Definition of done

A feature is done when it works end to end in the running app, not when it compiles. CI green is necessary, not sufficient.

<!-- TOGGLE:precommit_hooks_scaffold START -->
---

## Pre-commit hooks

<!-- TOGGLE:precommit:lefthook START -->
Gate: **lefthook**, config `lefthook.yml`. Activate with `lefthook install`.
<!-- TOGGLE:precommit:lefthook END -->
<!-- TOGGLE:precommit:husky START -->
Gate: **husky**, config `.husky/pre-commit`. Activate with `npm install --save-dev husky && npm pkg set scripts.prepare=husky && npm run prepare`.
<!-- TOGGLE:precommit:husky END -->
<!-- TOGGLE:precommit:pre-commit START -->
Gate: **pre-commit**, config `.pre-commit-config.yaml`. Activate with `pre-commit install`.
<!-- TOGGLE:precommit:pre-commit END -->
<!-- TOGGLE:precommit:simple-git-hooks START -->
Gate: **simple-git-hooks**, config `.simple-git-hooks.json`. Activate with `npx simple-git-hooks`.
<!-- TOGGLE:precommit:simple-git-hooks END -->

The hook runs lint, type check and tests before each commit. Do not bypass it with `--no-verify`; fix the failure.
<!-- TOGGLE:precommit_hooks_scaffold END -->
