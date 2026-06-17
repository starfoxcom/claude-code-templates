# claude-code-templates — session handoff (2026-06-17 15:21)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Headline: v1.4.0 shipped + tagged; review workflows fully reconciled

**`v1.4.0` is released** (tagged `291ace1` on `main`). After the release, a full **live↔canonical reconciliation audit** of the review workflows was run and its findings landed as doc-fix PRs. Net: the review workflows are confirmed in lockstep with **no behavioral drift** — only documentation/prose gaps existed, and they're now closed.

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | post-#129 | **`v1.4.0` @ `291ace1`** | v1.4.0 + the live-workflow hotfixes #120 / #123 / #129. |
| `develop` | `5a75323` (Merge PR #131) | — | Everything on main + the post-v1.4.0 reconciliation doc fixes (#128/#130/#131). `[Unreleased]` holds the three reconciliation Fixed entries (→ next minor). |

No stranded branches — only `main` + `develop`.

---

## This session in two phases

### Phase 1 — v1.4.0 (P2+P7+P8 review-gate hardening → release)
Shipped across PRs #120–#127. Two bugs were surfaced by adversarial verification and fixed before the tag: the **Evaluate selector title-fragility** (P8 — gate fail-closed when Sonnet deviates from the `## Code Review —` title; fixed with a tolerant selector, live #123 / canonical #122) and a **changelog-completeness gap** (missing the canonical gate-hardening mirrors #79/#85/#92 + #103). Full detail is in the v1.4.0 CHANGELOG. (Prior handoff content preserved in git history.)

### Phase 2 — post-v1.4.0 review-workflow reconciliation
Triggered by "continue" + a user-approved **full reconciliation audit** (5-agent read-only workflow). The audit classified every live↔canonical divergence in `claude-code-review.yml` + `claude.yml` vs their `.template`s. Result: **no behavioral/logic drift** (the Checks-API lifecycle, the title-tolerant selector, the terminal-state guards, the pre-screen logic are all byte-identical or correctly-divergent template generalization). It found **8 doc items**, fixed across:

| PR | Branch | Target | Content |
|---|---|---|---|
| #128 | `chore/reconcile-review-template-drift` | `develop` | task #6 — canonical Step 4 backtick-skip clarifier (one sentence) |
| #129 | `hotfix/correct-stale-workflow-comments` | `main` | **Bucket A** — 4 stale LIVE comments: `conclusion=neutral`→accurate `in_progress→skipped` lifecycle (claude-code-review.yml + claude.yml header + Upsert); narrowed admin-bypass scope `claude*.yml`→`claude-code-review.yml` (removed a `review-tiers.md` contradiction). Comment-only; admin-bypass (OIDC). |
| #130 | `chore/cascade-stale-comment-fixes` | `develop` | cascade of #129 |
| #131 | `chore/mirror-verdict-rule-canonical` | `develop` | **Bucket B** — mirrored the live's fuller BINARY VERDICT RULE prose into the canonical prompt (the 🔴 "minor-nit/all-clear-with-caveats" clauses, the "All clear on X as section heading" bullet, Step 2.5 "verdict stays binary regardless") |

**Deliberately NOT changed** (verified intentional, left as-is): the canonical's `{{PLACEHOLDER}}`/TOGGLE template generalizations, POST-BIND PREREQUISITES, the generic-vs-`_core/`-aware classifier, the intentional selector split (live project-name regex / canonical name-independent), and the 🟡 block's auto-fire-specific "depth-pass follows" line (the canonical 🟡 block is toggle-agnostic and must read correctly with auto-fire OFF).

---

## Operational lessons (this session)

- **Don't run a develop PR concurrently with a pending live-workflow cascade.** #131 (canonical-template PR off develop) tripped the App OIDC `Workflow validation failed` even though it doesn't touch a live workflow — because #129's live fix was on `main` but its cascade (#130) hadn't merged yet, so develop's live `claude-code-review.yml` lagged main. The PR's head byte-differed from the default branch → OIDC trip. **Fix:** land the cascade first, then merge develop into the waiting PR and re-trigger. Serialize when a live-workflow cascade is in flight.
- **CI usage-limit / server-throttle are infra, not content.** Hit both this session (the v1.4.0 release review on the subscription limit; the first audit-workflow attempt on a server-side "temporarily limiting requests" throttle). Re-run after the limit resets / the throttle clears. Captured as memory `feedback_ci_usage_limit_is_infra_rerun`.
- **Adversarial-verify-before-irreversible** caught the v1.4.0 changelog gap before the permanent tag (5-skeptic workflow), and the release-verify (3-skeptic) cleared the release-prep. Reinforces `feedback_adversarial_verify_before_irreversible`.

---

## What's queued next

1. **Model-pin promotion check — DUE (carried, now stronger).** Two-plus clean multi-PR sessions on `claude-opus-4-8[1m]` (v1.3.0 ship, the v1.4.0 ship, and this long reconciliation run). **Recommendation: move the Deep-tier pin `claude-opus-4-6[1m]` → `claude-opus-4-8[1m]`** in `.claude/skills/session-start/SKILL.md` (project-local; canonical stays version-free). See `feedback_model_default_opus_4_6`.
2. **Issue #1 (carried)** — install routine + deep review workflows in THIS repo's own `.github/workflows/` (they run live already; canonical self-host tracking remains). Branches from `main`.
3. **Issue #95 (carried)** — bind-time `plan_tier` selector for the session-start ladder. Scoped v1.4/v1.5.

(No open follow-up tasks — task #6 and both reconciliation buckets are done.)

---

## Session model setup

- **Recommended at start:** Deep → `claude-opus-4-8[1m]` (watched-trial continuation) · xhigh / ultracode.
- **Used:** Deep → `claude-opus-4-8[1m]` · xhigh · ultracode (whole session). Multiple usage-limit/throttle pauses, all recovered cleanly.
- **Outcome:** Clean. Shipped v1.4.0 (8 PRs + tag) AND a full review-workflow reconciliation (4 more PRs: #128–#131), plus 3 verification workflows (2 adversarial-verify + 1 reconciliation audit). Zero wrong-branch edits; every OIDC admin-bypass confirmed by failure-mode inspection; the one OIDC surprise (#131 develop-lags-main) diagnosed + resolved without a wrong bypass. 4.8[1m] sustained a very long multi-phase session across day boundaries + capacity pauses without losing threads. **Promotion to the Deep pin is overdue — move it to 4.8[1m] next session.**

---

## Files for next session to read first

1. This file.
2. `CHANGELOG.md` — `[Unreleased]` (the 3 reconciliation Fixed entries) + `[v1.4.0]`.
3. The review-workflow lockstep pairs, now fully reconciled: `.github/workflows/claude-code-review.yml` ↔ `_core/project-template/.github/workflows/claude-code-review.yml.template`, and `claude.yml` ↔ its `.template`. The only *intentional* live↔canonical differences are template generalizations (placeholders/toggles/bind-guidance) + the documented selector split.
