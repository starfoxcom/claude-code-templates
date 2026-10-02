# Git rules

## Commits

One logical change per commit. Never mix a feature with a refactor, or a fix with config.

```
<type>(<scope>): <imperative description>
```

- 72 characters max. Imperative verb: `add`, `fix`, `remove`, `update`, `refactor`, `extract`.
- `scope` is the system or layer touched.
- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore` (build, CI, tooling, deps), `data` (app data, configs, assets), `style` (formatting only).
- No AI-attribution lines anywhere: no co-author trailers, "generated with" footers or session links in commits, PR titles, PR bodies or comments. `.claude/settings.json` turns off the harness's own trailers, and the `no-ai-attribution` hook catches the ones written by hand.

---

## Branches (Gitflow)

| Branch | From | Merges into |
|---|---|---|
| `main` | | Production. Every release commit is tagged. |
| `develop` | | Integration. Base for all work. |
| `feature/<name>` | `develop` | `develop` |
| `release/<version>` | `develop` | `main`, then cascade to `develop` |
| `hotfix/<name>` | `main` | `main`, then cascade to `develop` |

- Kebab-case names: `feature/user-auth-flow`.
- Never push directly to `main` or `develop`.
- The GitHub default branch is `main`, so always pass `--base develop` to `gh pr create` for work PRs.

### Keep branches current

When the base branch advances, merge it into your open branches before continuing (`git fetch origin`, then `git merge origin/develop` on the work branch, then push). Never rewrite a branch someone else has pulled.

### Scope

A branch changes one concern. A tangential bug gets its own branch. Before coding, list the directories the work will touch; anything outside the branch's scope becomes a prerequisite branch and PR that merges first.

### Check the branch before the first edit

Run `git branch --show-current` before editing. Switch or branch first, then edit. If you notice you edited on the wrong branch, stop and say so instead of stashing and moving the work silently.

---

## Merging

- Every PR merges with a merge commit: `gh pr merge <pr> --merge --delete-branch`. Keep each commit buildable, and read history with `git log --first-parent`.
- Release PRs (`develop` into `main`) and cascade PRs (`main` into `develop`) always use `--merge`. Squashing them makes the two branches diverge and turns the next release into a conflict.
- After merging: `--delete-branch` removes the remote branch, but the local one only when it is checked out. Run `git branch -D <name>` if it remains, then confirm with `git branch`.
- Re-run a failed CI workflow as a whole (or push again). Re-running only the failed job can leave a required check stuck.

### Cascade after every merge into `main`

GitHub does not copy `main` back into `develop`. After a hotfix or release merges:

```bash
git fetch origin
git checkout -b chore/cascade-<name> origin/develop
git merge --no-ff origin/main -m "chore: cascade <name> into develop"
git push -u origin chore/cascade-<name>
gh pr create --base develop --title "chore: cascade <name> into develop" --body-file <file>
```

The hotfix or release is done only when the cascade PR is merged and its branch deleted.

### Workflow file changes

Review workflows triggered by comments or schedules run the copy on the GitHub default branch, and the review action refuses to run when a PR's workflow file differs from that copy.
Because `main` is the default branch, a change to `.github/workflows/` lands on `main` first as a `hotfix/<name>` PR, then cascades to `develop`. A workflow change made on a feature branch fails the review check.

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

