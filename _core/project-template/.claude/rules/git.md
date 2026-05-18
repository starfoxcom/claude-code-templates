# Git rules

## Atomic commits

One logical change per commit. No mixing features with refactors or fixes with config.

### Format

```
<type>(<scope>): <imperative description>
```

- Max 72 characters
- Imperative: `add`, `fix`, `remove`, `update`, `refactor`, `extract`
- `scope` = system or layer
- **NEVER** include any AI-attribution markers anywhere — not in commit messages, not in PR titles, not in PR bodies. Specifically banned strings and patterns:
  - `Co-Authored-By: Claude <…>` (or any Claude email)
  - `Co-Authored-By:` referencing Claude in any form
  - `🤖 Generated with [Claude Code](…)` or any variant
  - `🤖 Generated with Claude Code`
  - Any sentence ending with "Claude", "via Claude Code", "with Claude", etc., as an attribution line
  - Any link to `claude.com/claude-code`, `claude.ai`, or `anthropic.com` in commit/PR footers
- These bans apply to commits AND PR bodies AND PR titles AND issue comments authored programmatically. The work itself is attributed via authorship metadata if at all — never via a body footer.

### Valid types

| Type | When |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | No new functionality or fix |
| `perf` | Performance improvement |
| `test` | Tests |
| `docs` | Documentation, README, ROADMAP, ADRs |
| `chore` | Build, CI, tooling, dependency bumps |
| `data` | Game/app data, configs, assets |
| `style` | Formatting only (no logic change) |

---

<!-- TOGGLE:branching_model_gitflow START -->
## Branches (Gitflow)

| Branch | Prefix | Purpose |
|---|---|---|
| Production | `{{MAIN_BRANCH}}` | Stable releases only |
| Development | `{{DEV_BRANCH}}` | Base for all work |
| Feature | `feature/<n>` | From `{{DEV_BRANCH}}`, merges back to `{{DEV_BRANCH}}` |
| Release | `release/<v>` | From `{{DEV_BRANCH}}`, merges to `{{MAIN_BRANCH}}` + `{{DEV_BRANCH}}` |
| Hotfix | `hotfix/<n>` | From `{{MAIN_BRANCH}}`, merges to `{{MAIN_BRANCH}}` + `{{DEV_BRANCH}}` |

- Kebab-case branch names: `feature/user-auth-flow`
- **Always** `gh pr create --base {{DEV_BRANCH}}` — repo default may be `{{MAIN_BRANCH}}`, override explicitly
- **Always** merge commit — never squash or rebase
- **Never** push directly to `{{MAIN_BRANCH}}` or `{{DEV_BRANCH}}`

### Scope discipline

If a branch is `feature/<name>`, only files within that feature's directory tree should change. Cross-cutting changes (shared utilities, core layers) need their own branch and a merged-to-dev pre-requisite.

### When `{{DEV_BRANCH}}` advances

Cascade to all open feature branches before resuming work on them:

```bash
git fetch origin
git checkout feature/<n>
git merge origin/{{DEV_BRANCH}}
git push origin feature/<n>
```
<!-- TOGGLE:branching_model_gitflow END -->

<!-- TOGGLE:branching_model_trunk START -->
## Branches (trunk-based)

| Branch | Prefix | Purpose |
|---|---|---|
| Trunk | `{{MAIN_BRANCH}}` | The single long-lived branch; all work merges here |
| Feature | `feature/<n>` | From `{{MAIN_BRANCH}}`, merges back to `{{MAIN_BRANCH}}` |
| Hotfix | `hotfix/<n>` | From `{{MAIN_BRANCH}}`, fast-merge back |

- Kebab-case branch names: `feature/user-auth-flow`
- **Always** `gh pr create --base {{MAIN_BRANCH}}`
- **Always** merge commit — never squash or rebase
- **Never** push directly to `{{MAIN_BRANCH}}`

### Scope discipline

If a branch is `feature/<name>`, only files within that feature's directory tree should change. Cross-cutting changes need their own branch.

### When `{{MAIN_BRANCH}}` advances

Cascade to all open feature branches before resuming work on them:

```bash
git fetch origin
git checkout feature/<n>
git merge origin/{{MAIN_BRANCH}}
git push origin feature/<n>
```
<!-- TOGGLE:branching_model_trunk END -->

---

## Review tiers

Two review tiers, both fully workflow-driven via `.github/workflows/`:

| Tier | Trigger | Cost | What it does |
|---|---|---|---|
| **Routine** | Auto on every PR (`claude-code-review.yml`) | Subscription-included (Sonnet) | Pre-screen + architectural review + **binary 🔴/🟢 verdict comment**. Merge gate is real — exits red on 🔴. |
| **On-demand deep** | `@claude review this PR` comment (`claude.yml`) | Subscription-included (Opus) | Depth pass on the focus the routine review escalated to. Same binary 🔴/🟢 rule. |

<!-- TOGGLE:github_actions_deep_review_auto_fire START -->
The deep review **auto-fires** when the routine review's Step 2.5 detects the diff touches the trigger surface (parsers, threading, public API, auth, migrations) — see `review-tiers.md`.
<!-- TOGGLE:github_actions_deep_review_auto_fire END -->

<!-- TOGGLE:github_actions_deep_review_auto_fire:off START -->
The deep review is **opt-in** — fire it manually with `@claude review this PR` when the routine review flags uncertainty, or when you know the PR touches an architecturally-critical area (see `review-tiers.md` for the trigger list).
<!-- TOGGLE:github_actions_deep_review_auto_fire:off END -->

### Binary verdict rule

- **🟢 LGTM ONLY when fully clean** — zero caveats, zero nits, zero "with caveats" headings.
- **🔴 Blocking when ANY real finding exists.**
- The only legitimate omission is style preferences or future-proofing for hypothetical changes — those get **DROPPED**, not labeled non-blocking.

A 🟢 with "minor non-blocking" findings tucked in the body becomes useless — the findings rot, the merge proceeds, they re-surface weeks later as the same review.

### Local Claude's role

Local-session Claude (this harness) does NOT auto-fire reviews. The workflow does. Local responsibilities:

- Push the branch + open the PR per PR format below.
- Run the CI polling loop (`token-efficiency.md` § "CI monitoring + auto-merge") and report PR state.
- On approval (🟢), merge via `gh pr merge --merge` and clean up branches (standing authorization).
- On 🔴, fetch failing logs, propose the fix in one sentence, apply it, push. Re-enter polling loop.

---

## PR format

```
## What
<1-3 bullets>

## Why
<1-2 lines>

## Notes (optional)
<Non-obvious decisions, perf implications, required manual steps>
```

No empty sections. No generic testing checklist. The reviewer reads the diff, not the PR body — the body is for context the diff can't show.

---

## Definition of "feature complete"

A feature is complete when it can be exercised end-to-end in the running app — not when the code compiles. CI green ≠ feature complete. See `CLAUDE.md` § "SESSION CLOSE / 0. Definition-of-done verification".

---

<!-- TOGGLE:github_actions_paths_ignore_auto_merge START -->
## Auto-merge on fast-path PRs

PRs whose diff the routine reviewer will skip (no source-extension files changed — typically docs-only, rules-only, `.claude/**`, manifest tweaks) cause the workflow to fire, `triage` to classify the diff as non-reviewable, `claude-review` to skip, and `evaluate-review-outcome` to auto-pass. The whole run completes in ~30 seconds. Don't sit on a 7-minute polling loop — but also **don't foreground-sleep**; both cadences run in the background.

1. **Background-poll** with `run_in_background: true` and an until-loop that sleeps 90 s per check (see `token-efficiency.md` § "Fast-path / auto-pass" for the exact pattern). The harness notifies on exit; work on the next thing in the meantime.
2. **Check the gate** — `gh pr view <pr> --json statusCheckRollup`. Expect `Diff triage: SUCCESS`, `Claude review: SKIPPED`, `Evaluate review outcome: SUCCESS`.
3. **Verify mergeable** — `gh pr view <pr> --json mergeable,mergeStateStatus` should report `MERGEABLE` + `CLEAN` (or `BLOCKED` only on the required-approval gate, which `--admin` resolves for the maintainer).
4. `gh pr merge <pr> --merge --admin --delete-branch` (merge commit; `--admin` bypasses the required-approval gate maintainers can self-clear; `--delete-branch` removes the remote branch).
5. **Delete the local branch too** — `git checkout <base>; git pull --ff-only; git branch -D <merged-branch>`. `--delete-branch` only handles the remote; the local copy persists otherwise and clutters `git branch -a` fast.

User authorization for this fast path is implied by approval to open the PR; it's part of the same task. Do not ask per-PR.
<!-- TOGGLE:github_actions_paths_ignore_auto_merge END -->
