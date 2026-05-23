# claude-code-templates — session handoff (2026-05-22 19:00)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `285a300` | `v1.2.1` @ `1dbfa83` | Carries gate-checks-architecture (#87) + fail-closed (#89) + lifecycle (#90). Live workflows: two-check architecture via Checks API, lifecycle in_progress → skipped/in_progress → success/failure, fail-closed on Opus errors. v1.3.0 still NOT tagged. |
| `develop` | `c1ef1ef` | — | Cascades #88 + #91 brought all three live hotfixes onto develop. PR #92 (canonical mirror) landed the same architecture into `_core/project-template/.github/workflows/*.template` + canonical rules + SETUP.md. Canonical templates have 4 hardening invariants Opus surfaced that the LIVE workflows still lack (see task 14 below). |
| `release/v1.3.0` | `8e0f17f` | — | Still stale — branched before any Phase 4 / two-check work. Resume by merging main in (brings PRs #76, #78, #83, #87, #89, #90) when Phase 3 starts. |

---

## What this session shipped — two-check merge gate

**The architecture**: replaced the fold-in-via-`issue_comment` merge gate (broken by GHA's check-run attachment behavior — issue_comment-triggered check-runs attach to default-branch HEAD, not PR HEAD SHA) with two independent required status checks, both attached to PR HEAD SHA via explicit Checks API calls, both ANDed by branch protection:

1. **`Evaluate review outcome`** (routine, existing — simplified): triage non-reviewable → pass + PATCH `Claude On-Demand` to skipped; claude-review job not success → fail; routine verdict 🔴 → fail; 🟢 → pass.
2. **`Claude On-Demand`** (deep, new): walks a state machine via Checks API — `in_progress` ("Waiting for routine review to evaluate") → `skipped` (no escalation OR non-reviewable diff) OR `in_progress` ("Deep review in progress" — escalated) → `success`/`failure` (Opus verdict) OR `failure` (Opus errored, fail-closed).

**PRs landed**:

- **#87 (hotfix → main, admin-merge)**: live workflow restructure into 2-check architecture with neutral default.
- **#88 (chore/cascade → develop, admin-merge)**: brought architecture onto develop. First full end-to-end test — Opus caught fail-open bug (empty-comment → conclusion=neutral was passing branch protection).
- **#89 (hotfix → main, admin-merge)**: fail-closed fix (empty-comment → conclusion=failure). Drops stale "remove label to dismiss" guidance from output summaries.
- **#90 (hotfix → main, admin-merge)**: lifecycle UX refinement per user feedback — replace neutral default with in_progress → skipped/in_progress → success/failure (visually clearer in PR status panel).
- **#91 (chore/cascade → develop, admin-merge)**: cascade of #90.
- **#92 (chore → develop, admin-merge)**: canonical mirror of the entire architecture into `_core/project-template/.github/workflows/*.template` + `_core/project-template/.claude/rules/review-tiers.md` + git.md table row + bound `.claude/rules/*.md` + SETUP.md branch-protection guidance. Took 4 Opus deep-review cycles — Opus surfaced 4 hardening invariants (see below).

**Branch protection updated on both main and develop**: required status checks now `Evaluate review outcome` AND `Claude On-Demand` (both integration_id 15368 = GitHub Actions). Per `feedback_admin_bypass_discipline`, admin-merge remains scope-narrow (workflow-touching only).

---

## ⚠️ Four hardening invariants in canonical but NOT in live workflows (task #14)

Opus surfaced these across the 4-cycle deep review on PR #92 (canonical mirror). The canonical templates have them; the LIVE workflows on main + develop do not. Live workflows have the same fail-open / silent-block gaps Opus flagged. **Next session: open a single live hotfix from main → cascade.**

### Invariant 1 — `run_started_at` floor on routine verdict comment read (`evaluate-review-outcome`)

`needs.claude-review.result == 'success'` reflects job-level exit status. Action can exit clean WITHOUT posting a verdict comment (`--max-turns 50` hit, gh API blip during post, Claude refusal). Without a floor, `| last` selector picks the PRIOR push's stale 🟢 → fail-opens the gate.

**Fix**: resolve `gh api repos/$REPO/actions/runs/${{ github.run_id }} --jq .run_started_at`, filter ROUTINE_COMMENT by `created_at >= run_started_at`, fail if empty. Add `actions: read` permission. Already in canonical `_core/project-template/.github/workflows/claude-code-review.yml.template` lines 540–552; missing in live `.github/workflows/claude-code-review.yml`.

### Invariant 2 — `run_started_at` floor on deep-tier completion-comment read (`claude.yml` Evaluate)

Same root cause, mirror in deep tier. `Evaluate deep-tier verdict` runs via `if: always()` even when Run Claude failed silently. CHECK_ID lookup is HEAD-SHA-bound but COMMENT was not — stale 🟢 completion comment from prior push PATCHes current HEAD's check to success.

**Fix**: same `run_started_at` floor on the completion-comment jq selector. Already in canonical `_core/project-template/.github/workflows/claude.yml.template` lines 187–210; missing in live `.github/workflows/claude.yml`.

### Invariant 3 — Terminal-state guard on Resolve step (`claude-review`)

When maintainer reruns routine workflow AFTER Opus has PATCHed `Claude On-Demand` to success/failure, Resolve step re-reads label state and PATCHes back to in_progress (or skipped). Overwrites Opus's authoritative verdict.

**Fix**: before label-based PATCH, fetch existing check's status/conclusion. If `completed` AND `success`/`failure` (only set by claude.yml's Evaluate step), exit 0 without PATCH. `skipped` + `in_progress` remain safe to overwrite (set by routine, not authoritative). Already in canonical lines 444–456; missing in live workflow.

### Invariant 4 — Self-heal POST on non-reviewable path (`evaluate-review-outcome`)

When `init-deep-check` fails (Checks API 5xx, permission propagation on fresh bind, runner blip), non-reviewable branch's CHECK_ID lookup returns empty → naive impl emits `::warning::` + exit 0 → branch protection sees `Evaluate review outcome: SUCCESS` + `Claude On-Demand: Expected (pending)` → silent block with no PR-panel signal.

**Fix**: when CHECK_ID is empty in non-reviewable branch, POST a new check directly at `conclusion=skipped`. Preserves fast-path ~30s auto-merge UX on docs PRs. Already in canonical lines 537–554; missing in live workflow.

---

## Operational lessons from this session

### Lifecycle UX: replace neutral default with status=in_progress → skipped

Original architecture defaulted Claude On-Demand to `conclusion=neutral` on PR open. GitHub renders neutral as a passing checkmark — visually identical to success. Maintainers couldn't distinguish "deep tier didn't apply" from "deep tier passed". Replaced with explicit lifecycle:

- `status=in_progress` (spinner visible) while anything is running OR while waiting for routine to decide.
- `conclusion=skipped` (passing, but clearly "didn't apply") when no escalation.
- `conclusion=success`/`failure` only when Opus has spoken.

User flagged this UX issue during the architecture deploy; PR #90 implemented the fix.

### OIDC scope: only `claude-code-review.yml` edits trip admin-bypass

The OIDC validation checks the workflow file CURRENTLY running the action. claude.yml runs from default-branch on `issue_comment` events, so its file-on-PR-head differing from default doesn't matter — OIDC passes. Only `claude-code-review.yml` edits cause workflow validation failures requiring admin-bypass. CLAUDE.md L70 + canonical review-tiers.md were updated to reflect this narrower scope.

### Filter false-positive: routine verdict body fires claude.yml

`claude.yml`'s `if:` uses `contains(github.event.comment.body, '@claude review this PR')`. Sonnet's routine verdict body LEGITIMATELY discusses the filter mechanism (quoting `@claude review this PR` as part of explaining workflow internals). That quote matches → claude.yml fires as false-positive on the verdict comment body → finds no completion comment → fail-closed PATCH to failure → check briefly shows failure → real @claude trigger fires shortly after → Opus runs → PATCH back to success. Net: transient FAILURE for ~1 minute, settles. Tightening to `startsWith('@claude review this PR')` would help but breaks legitimate trigger comments that preface with context. Live with it; just be aware when watching CI logs.

### Sonnet escalation completeness can fail silently

Twice during PR #92 cycles, Sonnet's verdict body said "A depth-pass request follows in the next comment" but the actual @claude trigger comment was never posted. Sonnet's protocol is non-atomic — verdict + trigger are two separate `gh pr comment` calls. If the second one fails or Sonnet exits early, you get an incomplete escalation. Branch protection still resolves correctly (the previous Opus verdict from the actual trigger remains on the check), so it doesn't block merge — but it's a signal that Sonnet completeness isn't guaranteed.

### "hello world test" comments + 20+ min stuck Sonnet runs

PR #91's first cycle saw Sonnet post a literal `hello world test` comment ~9 min into the run, then go silent for ~15 more min before posting the real verdict. The action eventually completes but the latency is way outside the normal 2–5 min envelope. Consider enabling `show_full_output: true` (or `--verbose` in `claude_args`) for diagnosability next time — verbose doesn't cost extra tokens, just dumps Claude's per-turn thinking into the workflow log so stuck runs are debuggable.

---

## What's queued next (priority order)

**Priority 1 — Task #14 follow-up live hotfix**: apply invariants 1–4 above to live `.github/workflows/claude-code-review.yml` + `claude.yml`. Single hotfix from main, cascade to develop. Workflow-touching → admin-merge (only `claude-code-review.yml` portion trips OIDC; `claude.yml` changes don't). The fixes already exist verbatim in the canonical templates — lift them across.

**Priority 2 — Phase 3 v1.3.0 release** (queued from prior handoff):

1. Merge `main` into `release/v1.3.0` (brings in PRs #76, #78, #83, #87, #89, #90, #92's cascade-state).
2. Address deep-review findings from prior PR #77 (now closed):
   - **Invariant 4**: SETUP.md Phase 7a-Install validate-vs-resolve ordering ambiguity for `custom` profile.
   - **Invariant 5**: `_core/project-template/.claude/skills/find/SKILL.md` ctags block missing `# CTAGS_BYPASS:` marker in its example.
3. Reopen the release PR (release/v1.3.0 → main).
4. Merge on full 🟢. Tag `v1.3.0`. Cascade main → develop.

**Priority 3 — Emberholm port** (out-of-band, fresh session): the Emberholm prompt drafted this session (`EMBERHOLM-TWO-CHECK-PROMPT.md`, delivered via SendUserFile) is the canonical version with all 4 hardening invariants baked in. User has the file; not committed to this repo. Drop into an Emberholm session to port the architecture there — Emberholm has the same latent issue_comment-attachment bug and the same need for invariants 1–4.

**Priority 4 — Issue #1**: still tracked. Routine + deep review workflows ARE installed (we just iterated on them all session). The remaining open work on #1 is whatever scope the original issue described beyond installation; review on next session-start.

---

## Files for next session to read first

1. This file.
2. `_core/project-template/.github/workflows/claude-code-review.yml.template` — canonical workflow with all 4 hardening invariants. Diff vs live `.github/workflows/claude-code-review.yml` shows what task #14 must port.
3. `_core/project-template/.github/workflows/claude.yml.template` — same, deep tier.
4. `_core/project-template/.claude/rules/review-tiers.md` — gate model rewrite (canonical).
5. `MEMORY.md` index — no new memories landed this session (the discoveries are session-specific facts captured here; will promote to memory if they recur — particularly the lifecycle UX choice and the filter-false-positive trade-off).
