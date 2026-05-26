# claude-code-templates — session handoff (2026-05-26 02:24)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `4d9b64d` | `v1.2.1` @ `1dbfa83` | Advanced this session: PR #97 (4 hardening invariants) + PR #99 (5th invariant — non-reviewable terminal-state guard). v1.3.0 still NOT tagged. |
| `develop` | `6dea397` | — | Advanced via PR #98 (cascade + 5th invariant fix), PR #100 (matrix xhigh→high fix), PR #101 (cascade #99). Live workflow files on main and develop are now in sync for all 5 invariants. |
| `release/v1.3.0` | `8e0f17f` | — | Still stale. No movement this session. |

---

## What this session shipped — 5 hardening invariants + matrix effort fix

**Triggered by**: Priority 1 carry-over from prior session (Task #14 follow-up). The 4 hardening invariants Opus surfaced over 4 deep-review cycles on PR #92 existed in canonical templates on `develop` but not in live workflow files on `main`.

### Invariants ported (PRs #97 → #98 → #99 → #101)

1. **Stale-verdict floor in routine gate** (`claude-code-review.yml`): `evaluate-review-outcome` used `| last` without timestamp filtering → added `RUN_STARTED_AT` floor via `${{ github.run_id }}`. Closes false-green vulnerability where a workflow-touching push B picks up push A's prior 🟢 verdict. Also added `actions: read` permission for the API call.

2. **Stale-comment floor in deep-tier gate** (`claude.yml`): `Evaluate deep-tier verdict` used `| last` without filtering → added `RUN_STARTED_AT` floor. Replaced incorrect "No HEAD-SHA-floor correlation needed" comment that rationalized away the vulnerability.

3. **Terminal-state guard on Resolve step** (`claude-code-review.yml`): The `Resolve Claude On-Demand check post-routine` step could overwrite an Opus `success`/`failure` verdict with `skipped` or `in_progress` if Opus finished before the routine review or on a "Re-run all jobs" trigger. Guard reads `EXISTING_STATUS`/`EXISTING_CONCLUSION` and skips the PATCH if the check is at a terminal state.

4. **Self-heal POST for init-deep-check failures** (`claude-code-review.yml`): The non-reviewable-diff path in `evaluate-review-outcome` only warned when `init-deep-check` failed to create the `Claude On-Demand` check. Now creates the check directly via POST at `conclusion=skipped`, preserving the fast-path ~30s auto-merge UX on transient Checks API failures.

5. **Terminal-state guard on non-reviewable PATCH path** (`claude-code-review.yml`): **NEW — surfaced by deep review on cascade PR #98.** The non-reviewable diff path in `evaluate-review-outcome` could overwrite an Opus verdict with `skipped` on a routine re-run. Same guard pattern as invariant 3, applied to the symmetric write site. Not in the original 4 — Opus caught it during the cascade review.

### PR chain

| PR | Branch | Target | Content | Merge |
|---|---|---|---|---|
| #97 | `hotfix/workflow-hardening-invariants` | `main` | Invariants 1–4 | Admin-merge (OIDC failure confirmed) |
| #98 | `chore/cascade-workflow-hardening` | `develop` | Cascade #97 + invariant 5 fix | Admin-merge (OIDC failure on fix push) |
| #99 | `hotfix/non-reviewable-terminal-guard` | `main` | Invariant 5 only | Admin-merge (OIDC failure confirmed) |
| #100 | `fix/session-matrix-effort-levels` | `develop` | Matrix xhigh→high fix | Normal merge (routine 🟢 + deep 🟢) |
| #101 | `chore/cascade-terminal-guard` | `develop` | Cascade #99 (no-op content) | Fast-path auto-merge |

### Matrix effort fix (PR #100)

The session-start matrix paired `claude-opus-4-6` with `xhigh` effort, but `xhigh` is only available on Opus 4.7. Downgraded to `high` (the highest 4.6 supports) in both live `.claude/skills/session-start/SKILL.md` and canonical `_core/project-template/.claude/skills/session-start/SKILL.md`.

---

## Operational lessons from this session

### Deep review catches what multi-round deep review missed

The original 4 invariants were surfaced by Opus over 4 deep-review cycles on PR #92. The 5th invariant (non-reviewable terminal-state guard) was missed in those 4 rounds but caught on the cascade PR #98. The symmetric write site in `evaluate-review-outcome`'s non-reviewable branch was invisible because PR #92's diff focused on the Resolve step. Lesson: cascades are worth reviewing, not just rubber-stamping — they bring the full file into scope, exposing patterns the original diff didn't show.

### OIDC failure propagation on fix pushes to cascade PRs

The first push on cascade PR #98 (which was a pure merge of main→develop) passed OIDC because the workflow file matched main's version. The fix push (adding invariant 5) diverged from main's version → OIDC failed on the second push. Expected but worth noting: fix pushes to cascade branches are workflow-touching if they edit the workflow file, even when the cascade itself was a clean merge.

### The `needs-deep-review` label persists across pushes

When the first push on PR #98 triggered escalation (label + @claude comment), the label persisted to the second push. The Resolve step on the second push found the label and set the check to `in_progress` — but no new @claude comment was posted (OIDC failure prevented Sonnet from running Step 4). Result: `Claude On-Demand` stuck at `in_progress` forever. The admin-merge was justified on the fix-push scenario; but this is a known interaction pattern worth documenting.

---

## What's queued next (priority order, updated from prior handoff)

**Priority 1 — Phase 3 v1.3.0 release** (carried over, was Priority 2):

1. Merge `main` into `release/v1.3.0` (brings in PRs #76, #78, #83, #87, #89, #90, plus now #97 and #99 from this session).
2. Address deep-review findings from prior PR #77 (now closed): SETUP.md Phase 7a validate-vs-resolve ordering for `custom` profile; `/find` skill ctags block missing `# CTAGS_BYPASS:` marker example.
3. Reopen the release PR (`release/v1.3.0` → `main`).
4. Merge on full 🟢. Tag `v1.3.0`. Cascade `main` → `develop`.

**Priority 2 — Canonical template sync for invariant 5**: The non-reviewable terminal-state guard (invariant 5) landed on the live file on both `main` and `develop`, but the canonical template (`_core/project-template/.github/workflows/claude-code-review.yml.template`) on `develop` does NOT have it yet. Feature branch from `develop` to add the guard to the canonical template's non-reviewable PATCH path.

**Priority 3 — Emberholm port** (carried over): the `EMBERHOLM-TWO-CHECK-PROMPT.md` user has from prior sessions. Out-of-band; fresh Emberholm session.

**Priority 4 — Issue #1** (carried over): routine + deep review workflows installed. Remaining scope on #1 needs review.

**Priority 5 — Issue #95 (v1.4 / v1.5)** (carried over): bind-time `plan_tier` selector for the session-start matrix.

**Priority 6 — decide release scope for analyzer feature** (carried over): PR #94's analyzer + this session's matrix fix. v1.4.0 is the natural home (minor bump, new feature).

---

## Session model setup

- **Recommended at start:** `claude-opus-4-6[1m]` · `xhigh` · Workflow YAML state-machine surgery
- **Used:** `claude-opus-4-6[1m]` · `high` (xhigh is Opus 4.7-only; discovered at session-start, corrected before code work)
- **Outcome:** 5 PRs shipped, all clean. No wrong-branch edits, no retries, no cleanup PRs needed. Branch verification before every edit. Admin-merge justified on all workflow-touching PRs (OIDC failure confirmed via `--log-failed` each time). Deep review on cascade PR #98 surfaced a genuine 5th invariant — addressed in-session rather than deferred. The matrix xhigh/4.6 incompatibility discovered at session-start was fixed as a follow-up (PR #100). Total: 5 PRs merged, 5 branches cleaned up (local + remote).

---

## Files for next session to read first

1. This file.
2. `.github/workflows/claude-code-review.yml` — now has all 5 hardening invariants on both `main` and `develop`.
3. `.github/workflows/claude.yml` — has invariant 2 (stale-comment floor).
4. `_core/project-template/.github/workflows/claude-code-review.yml.template` — canonical template on `develop` still lacks invariant 5. Priority 2 next session.
5. `release/v1.3.0` branch state — still stale at `8e0f17f`. Priority 1 next session: merge `main` into it to pick up #97 + #99 before release.
