# claude-code-templates — session handoff (2026-05-17 12:21)

Single source of truth for what the previous session left undone. `/session-start` reads this file first (per `_core/project-template/.claude/skills/session-start/SKILL.md` Step 0). Everything below is current state that isn't derivable from `git log` or the open issues alone.

---

## Where the branches are

| Branch | Commit | Notes |
|---|---|---|
| `main` | `9403f43` | Tagged `v1.1.0`. Release at https://github.com/starfoxcom/claude-code-templates/releases/tag/v1.1.0 (zip attached, ~277 KB). |
| `develop` | `18870da` | One merge ahead of `9403f43`: chore/gitflow-setup (Gitflow + strict-review docs) + chore/tokensave-onboarding (.gitignore + CLAUDE.md tokensave-state update). |

After this PR (`chore/session-handoff` → develop) lands, `develop` advances by the session-start skill fix + this context file. No release pending.

---

## Tokensave state

- **CLI version:** v5.1.1 (upgraded from v4.3.4 during this session via `tokensave upgrade && tokensave doctor`)
- **Project-local index:** initialized at `.tokensave/` — 32 files / 287 nodes, schema v9
- **MCP server registration:** auto-repaired by `tokensave doctor` — 9 new MCP tools from the 4→5 jump are now permitted in `~/.claude.json`. They activate on next session start after `/clear`.
- **Notable new MCP tools you have access to next session:** `tokensave_read` (mode-aware file read with cross-session cache; unchanged-file re-reads cost ~30 tokens), `tokensave_diagnostics` (structured cargo/tsc/pyright errors), `tokensave_outline`, `tokensave_implementations`, `tokensave_signature_search`, `tokensave_constructors`, `tokensave_field_sites`, `tokensave_unsafe_patterns`, `tokensave_config`. Plus the cross-session memory tools from v4.5: `tokensave_record_decision`, `tokensave_record_code_area`, `tokensave_session_recall`.
- **Bug fixes that matter for our usage:** `tokensave_body` no longer drops the closing brace (v4.3.14 — was returning bodies unusable as `Edit` `old_string`); markdown indexer no longer hangs on YAML frontmatter (v4.3.13).

---

## What this session shipped

- **v1.1.0 release** — PR #6 merged with admin override (branch policy `BLOCKED` but `--admin` worked without hitting the `require_last_push_approval` signature from the v1.0.0 caveat). Pages deploy run 25984859398 green. Live at https://starfoxcom.github.io/claude-code-templates/.
- **Tokensave onboarding** — PR #8 (`chore/tokensave-onboarding`). Added `.tokensave/` to `.gitignore`, updated CLAUDE.md to flip the "no tokensave index" notes.
- **Session-handoff fixes** — this PR. Adds Step 0 (context-read) to the template's session-start skill; generates this CONTEXT file.

---

## Open issues, priority order

1. **#6 (v1.x)** — Install routine + deep review workflows on this repo. **Next branch:** `feature/review-workflows`. Plan summary preserved below.
2. **#9 (NEW this session)** — `fix(skill): session-start should read context handoff file`. Partially closed by this PR's first commit; close the issue when merged.
3. **#10 (NEW this session)** — `refactor(templates): parameterize code_research tool name + bypass mechanism`. Structural — not just rename. v1.0.0 already flagged `/find` parameterization; this issue extends the scope to CLAUDE.md, token-efficiency.md, session-close adherence metric. Requires conditional toggle sections at SETUP-resolve time for each `code_research` option (tokensave / ast-grep / ctags / Sourcegraph / Semgrep / none / other).
4. **#3 (v1.2.0)** — Audit mode: propose-then-confirm on existing setups. Strongest user-facing pick after #6 lands.
5. **#2 (v1.3.0)** — Community metrics: opt-in PR-submitted aggregate.
6. **#4 (v1.4.0)** — Telemetry capture Stop hook.
7. **#5 (v1.5.0)** — "I want them all" mode + toggle-conflict detection.

---

## Approved plan for #6 (next session's first work)

User approved this plan in the previous session, before `/clear`:

**Branch:** `feature/review-workflows` off `develop`.

**Scope:**

- Install both `.github/workflows/claude-code-review.yml` and `.github/workflows/claude.yml` from `_core/project-template/.github/workflows/*.template`.
- Placeholder resolution: `{{DEFAULT_BRANCH}}` → `develop`, `{{PROJECT_NAME}}` → `claude-code-templates`, `{{LANGUAGE_AND_FRAMEWORK}}` → `HTML + CSS + React via CDN, Babel-in-browser, no build step`.
- Strip `<!-- TOGGLE:github_actions_deep_review_auto_fire -->` markers, keep contents (auto-fire is ON for this repo).
- Adjust the triage `Reviewable extensions` filter to match this repo's actual code surface: `\.(html|jsx|js|json|yml|yaml|py)$`.
- Rewrite the auto-fire trigger surface in the routine-review prompt to path-based blast radius per CLAUDE.md: `_core/**`, root `index.html`, `_core/project-template/.claude/hooks/**`, `redesign/*.jsx`.

**Doc cleanup (same PR, separate commit):**
- CLAUDE.md line 87 area: remove "tracked-follow-up for installation here" sentence.
- CLAUDE.md "What's intentionally NOT here": drop the "Routine + deep review workflows not yet installed" bullet (now line ~110 after this session's edits).
- CONTRIBUTING.md line 17: drop the `*(Workflow installation is tracked follow-up …)*` parenthetical.
- CLAUDE.md references `(issue #1)` for this work — actual issue number is **#6**. Fix in the same doc commit.

**Atomic commits:**
- `chore(ci): add routine + deep review workflows`
- `docs: drop follow-up notes for review-workflow install`

**Manual post-merge steps user must do via GitHub UI:**
- Add `CLAUDE_CODE_OAUTH_TOKEN` to repo secrets (`gh secret list` was empty at session-close — workflows install but no-op until the secret lands).
- Add `Evaluate review outcome` (and the deep-tier equivalent) as required status checks in `main` + `develop` branch protection.
- Per the v1.0.0 caveat, ruleset PATCH via API is blocked for Claude; that's a GitHub UI step.

**Known caveats not blocking the PR:**
- Action pinned at `anthropics/claude-code-action@beta`. Conventional but ironic for a project that preaches SRI'd CDN pins. Track a follow-up issue: `chore(ci): pin action when v1 lands`.
- This PR can't smoke-test itself — `.github/workflows/claude*.yml` is in the workflow's own `paths-ignore`. Real smoke test is the next feature PR (e.g. #3 Audit mode).

---

## Known doc drift not fixed this session

- **CLAUDE.md line 148 (font stack):** still references "Geist (sans + mono) from Google Fonts". v1.1.0 changed it to Space Grotesk + Inter Tight + JetBrains Mono. CHANGELOG and README were updated for v1.1.0; CLAUDE.md was missed. One-line fix on its own commit, can be folded into the next docs PR.
- **`_core/project-template/CLAUDE.md` "## SESSION START" prose:** doesn't mention the CONTEXT-file read either (same bug as the skill file, in a different layer of the templates). The skill fix in this PR addresses the skill; the prose in the template-side CLAUDE.md will need the same toggle-gated paragraph in the next pass. Could fold into #9 or do it now as a follow-up commit before this session truly ends.

---

## Suggested opening for next session

1. /session-start reads this file → reports project status (we're at `develop` 18870da, post-v1.1.0).
2. Confirms the plan for #6 is still good (user said "OK to proceed" before /clear, after reviewing the plan above).
3. Branches `feature/review-workflows` off `develop` and starts with the routine-review workflow file.
4. Issues #9 and #10 are NEW this session — flag them as "tracked, do not work on now."
