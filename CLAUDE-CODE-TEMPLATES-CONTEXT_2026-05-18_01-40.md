# claude-code-templates — session handoff (2026-05-18 01:40)

Single source of truth for what this session left undone. `/session-start` reads this file first (per `_core/project-template/.claude/skills/session-start/SKILL.md` Step 0). Everything below is current state that isn't derivable from `git log` or open issues alone.

---

## Where the branches are

| Branch | Commit | Notes |
|---|---|---|
| `main` | `79003c0` | Now carries `.github/workflows/claude*.yml`. Still tagged `v1.1.0` at `9403f43` — release tag unchanged this session. |
| `develop` | `c1bbadf` | Three merges ahead of `main`: workflow install (#17), cascade-merge from main, SETUP-docs (#18). |

`develop` history since the prior context file (`6c378f2`):

```
c1bbadf Merge #18 — docs(setup): document workflow post-bind prerequisites
547165e docs(setup): document workflow post-bind prerequisites
4f47a28 chore: cascade main into develop (review workflows)
79003c0 Merge #17 — chore(ci): add routine + deep review workflows
a0da852 chore(ci): add routine + deep review workflows
```

---

## What the working repo looks like now (state, not history)

### Review workflows are now LIVE and wired

Two workflow files installed on both `main` and `develop`:

- `.github/workflows/claude-code-review.yml` — Sonnet 4.6 routine review with binary 🔴/🟢 verdict gate. Triggers on PRs targeting `develop`. Triage step's reviewable-extensions regex: `\.(html|jsx|js|json|yml|yaml|py)$`. Auto-fire trigger surface (label `needs-deep-review` + structured `@claude` comment): `_core/**`, root `index.html`, `_core/project-template/.claude/hooks/**`, `redesign/*.jsx`.
- `.github/workflows/claude.yml` — Opus 4.7 deep review on `@claude` comments. Fires on `issue_comment` + `pull_request_review_comment` (any PR/issue, regardless of branch).

**Both prerequisites are satisfied:**

1. **`CLAUDE_CODE_OAUTH_TOKEN` secret set.** Note: the user's account is Claude.ai (subscription), not Anthropic Console — there's no API-keys page; the token came from `claude setup-token`. The user rotated the token mid-session after one was briefly leaked in a shell command and consolidated to a single shared token used across this repo + Emberholm + Stockra (trade-off: easier rotation, slightly wider blast radius if ever leaked again).
2. **Branch-protection status checks on develop ruleset only.** Required checks: `Evaluate review outcome` + `Evaluate deep-tier verdict`. Deliberately NOT on the `main` ruleset — the routine workflow's `branches:` is scoped to `[develop]`, so PRs to main never fire it; making the check required-on-main would block every hotfix/release PR forever waiting for a check that never reports.

**First self-test signal:** PR #18 itself fired the freshly-installed routine workflow on develop, ran the triage step in 30 s, correctly classified `.template` + `.md` files as non-reviewable, and exited green without invoking the OAuth-token-using job. So the install is real and the gate works.

### SETUP.md + workflow templates now document the post-bind prerequisites

PR #18 added the two gotchas that bit us during install to the user-facing setup surface:

- **`SETUP.md` step 12a** — toggle-gated (only when `github_actions_routine_review` or `github_actions_deep_review` is ON). Surfaces both prerequisites in the post-bind summary with a Gitflow-aware "land on main first via hotfix, then cascade" prescription (and a trunk-based simplification). Substitutes `<branch-name>` from `git branch --show-current`, plus `{{MAIN_BRANCH}}` / `{{DEV_BRANCH}}` from the user's config.
- **`_core/project-template/.github/workflows/claude-code-review.yml.template` + `claude.yml.template` header comments** — expanded with a `POST-BIND PREREQUISITES` block visible at the top of every resolved `.yml`. Also dropped the scaffolding line `# Renamed from .yml.template → .yml after SETUP fills placeholders.` which was leaking into the final installed file.

### Tokensave state

- Develop branch is now **tracked** (user ran `tokensave branch add develop` at session start). Tools now return develop-accurate results instead of falling back to main.
- Index: 33 files / 302 nodes / schema v9, last sync ran clean (0 added/modified/removed in 102 ms).
- MCP server still registered globally in `~/.claude.json`.

### Issue housekeeping

Closed via `gh issue close` this session (their PRs had merged without auto-closing):

- #9 — closed by PR #11
- #12 — closed by PR #13
- #14 — closed by PR #15

(Closure was flagged by Claude Code's auto-mode classifier as needing more explicit authorization than "do as you see best" provided — see the auto-mode-critique exchange in the session transcript. The closures landed despite the late flag; if any need reopening, do so manually.)

---

## Open issues, priority order

1. **#10** — Parameterize `code_research` tool name + bypass mechanism (structural rewrite — needs conditional toggle sections for tokensave / ast-grep / ctags / Sourcegraph / Semgrep / none / other).
2. **#3 (v1.2.0)** — Audit mode: propose-then-confirm on existing setups. Strongest user-facing pick after the routine-review install is now done.
3. **#2 (v1.3.0)** — Community metrics aggregate.
4. **#4 (v1.4.0)** — Telemetry capture Stop hook.
5. **#5 (v1.5.0)** — "I want them all" mode + toggle-conflict detection.

No open tracking issue exists for review-workflow installation — the work is done, the CLAUDE.md "(issue #1)" reference was always bogus (it pointed at the merged v1.0.0 release PR, not a tracking issue).

---

## Known doc drift not fixed this session

A single small `docs:` PR could fold all of these in:

- **`CLAUDE.md` line ~87 region:** "Routine + deep review workflows not yet installed" — now stale; they're installed.
- **`CLAUDE.md` "What's intentionally NOT here" section:** drop the workflow-install bullet.
- **`CLAUDE.md` "tracked-follow-up for installation here (issue #1)"** sentence — both halves are wrong (workflows installed, #1 isn't a tracking issue).
- **`CLAUDE.md` line ~148 font stack:** still says "Geist (sans + mono) from Google Fonts" — v1.1.0 changed it to Space Grotesk + Inter Tight + JetBrains Mono.
- **`CONTRIBUTING.md` line ~17 region:** drop the `*(Workflow installation is tracked follow-up …)*` parenthetical.
- **`_core/project-template/CLAUDE.md` § "SESSION START" prose:** doesn't mention the CONTEXT-file read in the prose body, even though the skill source does.

---

## Possible follow-ups worth considering (not yet planned)

- **Extend routine workflow to also fire on PRs targeting `main`.** Change `branches: [develop]` → `[main, develop]` in `claude-code-review.yml` so hotfix and release PRs get routine review too. If adopted, `Evaluate review outcome` could then be added to the main ruleset's required checks. Low effort, real safety upside — but requires deciding whether release/hotfix PRs should block on the same gate as develop-bound feature work.
- **Pin `anthropics/claude-code-action@beta` to a specific SHA.** Currently floating `@beta` — mildly ironic for a project preaching SRI'd CDN pins.

---

## Suggested opening for next session

1. `/session-start` reads this file → reports project status (develop at `c1bbadf`, review workflows live and gated).
2. Decide which open follow-up to pick up. Doc drift is the cheapest cleanup; #10 (code_research parameterization) is the next architectural piece; #3 (Audit mode) is the strongest user-facing pick.
3. Any feature/chore branch off `develop` from here on will exercise the routine review workflow for real — first one becomes the genuine smoke test of the install.
