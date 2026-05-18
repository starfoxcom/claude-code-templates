# claude-code-templates — session handoff (2026-05-18 00:01)

Single source of truth for what the previous session left undone. `/session-start` reads this file first (per `.claude/skills/session-start/SKILL.md` Step 1). Everything below is current state that isn't derivable from `git log` or open issues alone.

---

## Where the branches are

| Branch | Commit | Notes |
|---|---|---|
| `main` | `9403f43` | Tagged `v1.1.0`. Release at https://github.com/starfoxcom/claude-code-templates/releases/tag/v1.1.0 |
| `develop` | `40f8387` | Six merges ahead of v1.1.0. After this PR lands, `develop` advances by one more merge (this context refresh). |

`develop` history since v1.1.0:

```
40f8387 Merge #15 — refactor DEFAULT_BRANCH → DEV_BRANCH + configurator UI restructure (closes #14)
809172f Merge #13 — self-bind (closes #12)
18870da Merge #8  — tokensave onboarding
d54204a Merge #11 — session handoff fix + context file (closes #9)
c505fe3 Merge #7  — Gitflow + strict-review docs
```

---

## What the working repo looks like now (state, not history)

### Self-bound — finally

`.claude/skills/{session-start,session-close,find,architecture-graph}/SKILL.md` are resolved files at the canonical path the harness discovers, bound from `_core/project-template/.claude/skills/` per `bundles/2-multi-dev-oss/bundle.toggles.md` defaults with Discovery-mode resolution for null toggles. Audit trail in `.claude/BIND.md`.

`.claude/rules/` is deliberately NOT bound — rules stay canonical at `_core/project-template/.claude/rules/`. The repo IS the templates, so duplicating rules would create drift between source-of-truth and bound copies. The skills' references-by-path to `_core/` are intentional.

`.github/PULL_REQUEST_TEMPLATE.md` exists (bundle 2 default, `audit_trail_commits` block stripped).

No `CODEOWNERS` (solo-maintained, `codeowners: false`).

### Template placeholder rename

`{{DEFAULT_BRANCH}}` is now `{{DEV_BRANCH}}` across all `_core/` templates + `SETUP.md`. The previous name collided with GitHub's UI "default branch" setting concept. `SETUP.md` includes a backwards-compat shim that accepts `developer_branch` / `default_branch` in older manifests and warns.

### Configurator form (Folio I → Step 3 → Advanced) restructured

Three branch fields collapsed to two, with a clearer parent-child reactive layout:

```
NAME              | REPOSITORY URL
BRANCHING MODEL   | LICENSE          ← Branching model is now the parent decision; License anchored here
MAIN BRANCH       | DEV BRANCH       ← Dev branch slot only renders when Gitflow is selected; trunk leaves col empty
TECH STACK (full-width)
```

State variables in `index.html` + `redesign/bind.jsx`:
- Removed `default_branch`
- Renamed `developer_branch` → `dev_branch`
- Kept `main_branch` (now defaults to `"main"`, required)
- `buildManifest()` emits `main_branch` + `dev_branch` (trunk-based mirrors main_branch into dev_branch)

UI hint text for Branching model now reads *"Gitflow = separate main + dev branches. Trunk-based = single branch."* — previously referenced the old field names.

### Tokensave state

- CLI: v5.1.1 (upgraded mid-prior-session from v4.3.4)
- Project index: `.tokensave/` — 32 files / 287 nodes / schema v9
- MCP server: registered in `~/.claude.json` (auto-repaired by `tokensave doctor` post-upgrade)
- All 9 new MCP tools from the 4→5 jump are permitted

---

## Open issues, priority order

1. **#6 (v1.x)** — Install routine + deep review workflows on this repo. Approved plan from earlier session preserved below.
2. **#10** — Parameterize `code_research` tool name + bypass mechanism (structural rewrite, not just rename — needs conditional toggle sections for tokensave / ast-grep / ctags / Sourcegraph / Semgrep / none / other).
3. **#3 (v1.2.0)** — Audit mode: propose-then-confirm on existing setups. Strongest user-facing pick after #6.
4. **#2 (v1.3.0)** — Community metrics aggregate.
5. **#4 (v1.4.0)** — Telemetry capture Stop hook.
6. **#5 (v1.5.0)** — "I want them all" mode + toggle-conflict detection.

Closed this session: #9 (PR #11), #12 (PR #13), #14 (PR #15).

---

## Approved plan for #6 (next session's first work, unchanged from previous handoff)

**Branch:** `feature/review-workflows` off `develop`.

**Scope:**

- Install both `.github/workflows/claude-code-review.yml` and `.github/workflows/claude.yml` from `_core/project-template/.github/workflows/*.template`.
- Placeholder resolution: `{{DEV_BRANCH}}` → `develop` (note: renamed since the previous handoff was written), `{{PROJECT_NAME}}` → `claude-code-templates`, `{{LANGUAGE_AND_FRAMEWORK}}` → `HTML + CSS + React via CDN, Babel-in-browser, no build step`.
- Strip `<!-- TOGGLE:github_actions_deep_review_auto_fire -->` markers (auto-fire is ON per CLAUDE.md).
- Adjust the triage `Reviewable extensions` regex to match this repo's actual code surface: `\.(html|jsx|js|json|yml|yaml|py)$`.
- Rewrite the auto-fire trigger surface in the routine-review prompt to path-based blast radius per CLAUDE.md: `_core/**`, root `index.html`, `_core/project-template/.claude/hooks/**`, `redesign/*.jsx`.

**Doc cleanup (same PR, separate commit):**
- CLAUDE.md: remove "tracked-follow-up for installation here" sentence (line ~87 region).
- CLAUDE.md "What's intentionally NOT here": drop the "Routine + deep review workflows not yet installed" bullet.
- CONTRIBUTING.md line 17 region: drop the `*(Workflow installation is tracked follow-up …)*` parenthetical.
- CLAUDE.md references `(issue #1)` for this work — actual issue number is **#6**. Fix in the same doc commit.

**Atomic commits:**
- `chore(ci): add routine + deep review workflows`
- `docs: drop follow-up notes for review-workflow install`

**Manual post-merge steps user must do via GitHub UI:**
- Add `CLAUDE_CODE_OAUTH_TOKEN` to repo secrets (`gh secret list` was empty earlier — workflows install but no-op until the secret lands).
- Add `Evaluate review outcome` (and the deep-tier equivalent) as required status checks in `main` + `develop` branch protection.

**Known caveats not blocking the PR:**
- Action pinned at `anthropics/claude-code-action@beta`. Conventional but mildly ironic for a project preaching SRI'd CDN pins.
- The installation PR can't smoke-test itself — `.github/workflows/claude*.yml` is in the workflow's own `paths-ignore`. Real smoke test is the next feature PR.

---

## Known doc drift not fixed in this session

- **`CLAUDE.md` line 148 (font stack):** still references "Geist (sans + mono) from Google Fonts". v1.1.0 changed it to Space Grotesk + Inter Tight + JetBrains Mono. One-line fix, fold into the next docs PR.
- **`_core/project-template/CLAUDE.md` § "SESSION START" prose:** doesn't mention the CONTEXT-file read in the prose body, even though the skill source does. Same fix as #9 but in the prose layer. Could fold into a future docs PR or into the cleanup commit of #6.

---

## Suggested opening for next session

1. `/session-start` reads this file → reports project status (post-#15, develop at `40f8387`, six merges ahead of v1.1.0).
2. Confirms the plan for #6 is still good (user approved before /clear in the previous arc).
3. Branches `feature/review-workflows` off `develop`. Starts with the routine-review workflow file.
4. Watch for issue-number drift: CLAUDE.md still says `(issue #1)` where the actual tracking issue is #6.
