# claude-code-templates — session handoff (2026-05-22 14:46)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `d69d643` | `v1.2.1` @ `1dbfa83` | Carries Phase 4a hotfix (PR #83). Live `.github/workflows/claude-code-review.yml` restructured to fold-in gate (3 jobs: triage + claude-review + evaluate-review-outcome). v1.3.0 still NOT tagged. |
| `develop` | `ff370fc` | — | Has Phase 4-cascade (PR #84) + Phase 4b (PR #85, canonical mirror + `review-tiers.md` rewrite). Live workflow on develop matches main. Canonical template at `_core/project-template/.github/workflows/claude-code-review.yml.template` mirrors the live structure. |
| `release/v1.3.0` | `8e0f17f` | — | Still stale — branched before any of the prior session's work AND before Phase 4. Resume by merging main in (brings PRs #76, #78, #83 onto release branch) when Phase 3 starts. |

---

## What this session shipped — Phase 4 (gate fold-in)

Three PRs landed; Phase 4 work is **structurally deployed but behaviourally partial** — see "Plumbing bugs discovered" below.

- **PR #83 (hotfix → main, admin-merge):** Restructured `.github/workflows/claude-code-review.yml` from 2 jobs (triage + evaluate-review-outcome-with-inline-Sonnet-and-gate) to 3 jobs: `triage` → `claude-review` (Sonnet) → `evaluate-review-outcome` (fold gate). Gate fires on `pull_request` AND on `issue_comment` events containing `Claude finished`. Gate logic: routine 🟢 alone passes when no `needs-deep-review` label; with label, also requires deep 🟢. Workflow-touching → App-auth OIDC failure → admin-merge once.

- **PR #84 (chore/cascade → develop, admin-merge):** Cascaded main → develop bringing the new live workflow. First PR to exercise the new gate-fold logic end-to-end. Routine 🟢 + deep 🟢 both posted in comments; gate stuck at FAILURE due to plumbing bugs — admin-merged with explicit nod.

- **PR #85 (chore → develop, admin-merge):** Mirrored gate-fold restructure into canonical template at `_core/project-template/.github/workflows/claude-code-review.yml.template`. Rewrote "The gate model" section + tier-table deep-tier row in canonical `_core/project-template/.claude/rules/review-tiers.md` AND the bound `.claude/rules/review-tiers.md`. Same plumbing-bug merge pattern as #84.

---

## ⚠️ Plumbing bugs discovered during rollout

The gate-fold logic is functionally correct (verdicts read accurately, fold rule is right), but THREE workflow-plumbing bugs prevent the gate from automatically flipping the PR's required-check status when only the deep tier comment lands. Next session MUST address Bug 2 before relying on the fold-in for the auto-escalation path.

### Bug 1 — `contains(body, 'Claude finished')` filter too loose (Medium)

Sonnet routine verdict bodies can **quote the literal string** `"Claude finished"` while explaining the gate's deep-extraction mechanism in their `🟡 Uncertainty surfaced` section. The gate's filter then matches the routine verdict comment + the `@claude review this PR` trigger comment, not just the actual deep-tier completion.

**Symptom:** gate fires multiple times per PR on auto-escalated paths, fails-closed on each false-fire because deep verdict not yet posted.

**Fix:** tighten filter to
```yaml
github.event_name == 'issue_comment'
  && github.event.issue.pull_request != null
  && startsWith(github.event.comment.body, '**Claude finished')
  && github.event.comment.user.login == 'claude[bot]'
```
The deep tier's `claude-code-action` completion comment ALWAYS starts with `**Claude finished @claude[bot]'s task in <duration>**` per the action's behavior.

**Where:** live `.github/workflows/claude-code-review.yml` + canonical `.template`. Emberholm's pattern has the same loose filter — when fixed here, also propose the change upstream.

### Bug 2 — Issue_comment check-runs don't attach to PR HEAD SHA (HIGH — load-bearing)

When the gate fires via `issue_comment` event (the whole point of the fold-in), its check-run attaches to the **default branch's HEAD SHA** (`main` in this repo), NOT the PR's HEAD SHA. Verified via:
```bash
gh api repos/.../check-runs/<id> --jq '.pull_requests'  # → []
```

**Symptom:** the PR's required-check status (`Evaluate review outcome`) is set ONLY by the `pull_request`-event-triggered gate run. The issue_comment-triggered gate fires that read the deep verdict produce check-runs on main's SHA — invisible to the PR's check rollup. PR stays BLOCKED until manually intervened.

**Hypotheses to investigate next session:**
- Maybe Emberholm doesn't actually rely on issue_comment-driven PR status updates (their workflow has the same architecture; the question is whether they've ever hit this in practice or if they work around it manually).
- Maybe a `pull_requests` parameter in the check-run create API can force association — but check-runs created by GHA workflows don't expose that knob directly.
- Maybe a `workflow_dispatch` re-trigger could work — but synthesising a re-fire from the gate's own workflow context is tricky.
- The deep tier's `Evaluate deep-tier verdict` step in `claude.yml` runs on `issue_comment` too AND its check-run ALSO doesn't attach to the PR. Same root cause.

**Practical effect:** every PR that auto-escalates to deep tier currently requires admin-merge to land. That defeats the gate-fold's purpose for the auto-escalation path.

### Bug 3 — `gh run rerun --failed` advances HEAD-SHA floor (Medium)

The gate computes `HEAD_SHA_FLOOR` as `min(run_started_at)` across all workflow runs on the PR's HEAD SHA. When you `gh run rerun --failed <run-id>` to retry a failed gate, the rerun's `run_started_at` is updated to NOW — moving the floor forward past the original verdict timestamps. The gate then rejects the valid routine verdict (`created_at < new floor`) and fails with "No routine review comment found".

**Symptom:** `--failed` reruns of stuck gates are counter-productive.

**Fix:** change correlation primitive. Options:
- Use commit SHA-based correlation (verdict comment must reference the HEAD SHA somewhere)
- Use the EARLIEST run_started_at across runs with `run_attempt = 1` only
- Or replace the floor entirely with a different mechanism

---

## What's queued next (priority order)

**Follow-up hotfix — gate plumbing (next session):**
1. Branch `hotfix/gate-plumbing-fixes` from `main`.
2. Fix Bug 1 (filter tighten) — high-confidence fix.
3. Investigate Bug 2 (issue_comment check-run attachment) — this is the load-bearing one. Possibly requires a different gate architecture (e.g., the gate creating a check-run on the PR's HEAD SHA via the Checks API directly, rather than relying on GHA's automatic attachment).
4. Fix Bug 3 (HEAD-SHA floor + rerun) — change correlation primitive.
5. Mirror to canonical template + cascade to develop.
6. Until this hotfix lands: every auto-escalating PR will need admin-merge.

**Phase 3 — resume v1.3.0 release** (queued from prior handoff; depends on gate working OR willingness to admin-merge):

1. Merge `main` into `release/v1.3.0` (brings in PRs #76, #78, #83 + any gate-plumbing hotfix).
2. Address deep-review findings from prior PR #77 (now closed):
   - **Invariant 4:** SETUP.md Phase 7a-Install validate-vs-resolve ordering ambiguity for `custom` profile.
   - **Invariant 5:** `_core/project-template/.claude/skills/find/SKILL.md` ctags block missing `# CTAGS_BYPASS:` marker in its example.
3. Reopen the release PR (release/v1.3.0 → main).
4. Merge on full 🟢. Tag `v1.3.0`. Cascade main → develop.

**Out-of-band cleanup:**
- **`mandatory_deep_review_before_merge` toggle** — stays `true` (deep is mandatory when raised). Update CHANGELOG `Known follow-ups` to remove any "flip to false" plan.
- **Issue #1 — install routine + deep review workflows in this repo's own `.github/workflows/`** — still tracked; this repo currently runs hand-authored variants. Independent of public-toolkit version cadence.

---

## Operational lessons from this session

### The fold-in gate cannot rely on issue_comment alone to update PR status

The architectural assumption behind Phase 4 ("just add an issue_comment trigger and re-fire the gate") missed a GitHub Actions implementation detail: issue_comment-triggered workflow check-runs don't attach to the PR's HEAD SHA. They attach to the default branch's HEAD SHA and have `pull_requests: []` in the check-run API. The PR's status check rollup queries by HEAD SHA, so it never sees the issue_comment-fire's SUCCESS even if the gate logic flipped correctly.

This invalidates the simple-version-of-the-design that says "fire on issue_comment + read deep verdict + done." A working fold-in either needs:
- A separate Checks API call from inside the gate job to create/update a check on the PR's HEAD SHA explicitly
- OR the gate's required-status outcome to be communicated through some non-check-run mechanism (PR review comment with status, label-based gate, etc.)
- OR a different trigger (workflow_dispatch with PR number, or pull_request_target on label change)

Emberholm has the same architectural pattern AND has been working with it. Next session's investigation: how does Emberholm actually behave when its fold-in gate fires on issue_comment for the deep tier? Does Emberholm ever rely on this in practice or does it also admin-merge auto-escalated PRs?

### "Claude finished" is in scope of free text whenever workflow internals are discussed

When the routine reviewer surfaces uncertainty about the gate's deep-tier-extraction mechanism, it cites the literal filter string. This is the same root cause as prior false-positive issues — workflow internals appearing in reviewable file content. Tighter filters (anchoring `startsWith` + author predicate) are the structural fix, but it's also worth documenting the meta-pattern: filter strings inside workflow files inevitably leak into review prose and become false-positive triggers.

### Admin-merge on cascade + canonical-mirror PRs is now established practice while Bug 2 is open

Per the per-merge nod given by maintainer on PR #84 + PR #85: until Bug 2 is fixed, auto-escalating PRs that produce routine 🟢 + deep 🟢 in comments BUT whose gate is stuck due to plumbing get admin-merged. This is scope-narrow: it's only legitimate when both verdicts are posted and the gate stuck IS the only issue. NOT a general license to bypass.

---

## What's intentionally NOT done

- **v1.3.0 release on `main`.** Phase 3 still queued; depends on gate-plumbing hotfix landing first (or willingness to admin-merge through it).
- **Gate-plumbing hotfix (Bug 1 / Bug 2 / Bug 3).** Queued for next session.
- **CHANGELOG entry for the gate-fold.** Will land with v1.3.0 release notes when that ships.
- **Issue #1** (routine + deep review workflow installation in this repo's own `.github/workflows/`) — still out-of-band.

---

## Files for next session to read first

1. This file.
2. `.github/workflows/claude-code-review.yml` (live, on develop = matches main) — to see the deployed fold-in gate. Look at the `evaluate-review-outcome` job; the `if:` filter is the loose one to tighten.
3. `_core/project-template/.github/workflows/claude-code-review.yml.template` — canonical mirror, same fixes apply.
4. `_core/project-template/.claude/rules/review-tiers.md` + `.claude/rules/review-tiers.md` — already-updated gate model description; will need a small follow-up edit if Bug 2 fix changes the architecture significantly.
5. `MEMORY.md` index — no new memories landed this session (the discoveries are session-specific facts captured in this file; will promote to memory if they recur).
