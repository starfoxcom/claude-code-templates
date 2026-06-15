# claude-code-templates — session handoff (2026-06-15 04:13)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Headline: v1.4.0 shipped + tagged

**`v1.4.0` is released.** Tagged at `291ace1` on `main` (annotated tag `v1.4.0 — canonical-template parity + session-lifecycle tuning`), cascaded to `develop` (`5bd2ef7`). `VERSION` = `v1.4.0` on both branches. No stranded branches — only `main` + `develop` remain.

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `291ace1` (Merge PR #125) | **`v1.4.0` @ `291ace1`** | The v1.4.0 release + the two live-workflow hotfixes this session (#120 deep-trigger, #123 selector). |
| `develop` | `5bd2ef7` (Merge PR #126 cascade) | — | Has everything on main + the release-prep. `[Unreleased]` is the fresh empty scaffold (`_Nothing yet._`). |

---

## What this session did — review-gate hardening (P2+P7+P8) → v1.4.0 release

Planned scope was "P2+P7 canonical sync, then cut v1.4.0." Mid-session adversarial verification surfaced **two real bugs** that were fixed before the tag, so the actual shipped scope is larger.

### PR chain (7 merged + the release)

| PR | Branch | Target | Content | Merge |
|---|---|---|---|---|
| #120 | `hotfix/deep-trigger-fail-closed` | `main` | **P7 live** — Step 4 deep-trigger comment gained FAIL-CLOSED + WRONG-formats + self-check | admin-bypass (OIDC trip, confirmed) |
| #121 | `chore/cascade-deep-trigger-fail-closed` | `develop` | cascade of #120 | routine 🟢 + deep 🟢 |
| #122 | `chore/sync-review-template-hardening` | `develop` | **P2** non-reviewable guard + **P7 canonical** + **P8b canonical selector** + CHANGELOG | routine 🟢 + deep 🟢 (after P8 fix) |
| #123 | `hotfix/evaluate-selector-title-tolerance` | `main` | **P8a live** — title-tolerant Evaluate selector | admin-bypass (OIDC trip, confirmed) |
| #124 | `chore/cascade-evaluate-selector` | `develop` | cascade of #123 — **self-healed** (own gate ran the tolerant selector) | routine 🟢 + deep 🟢 |
| #125 | `release/v1.4.0` | `main` | release cut: VERSION + CHANGELOG finalization | admin-merge (real 🟢 both tiers) + tag |
| #126 | `chore/cascade-v1.4.0` | `develop` | Gitflow cascade of the release | fast-path auto-pass |

### The two bugs the session surfaced (both caught by adversarial verification)

1. **P8 — Evaluate selector title-fragility (NEW bug, fixed).** The routine gate's `evaluate-review-outcome` selected the verdict comment via `contains("## Code Review — <project>")` — the literal H2 + em-dash title. Sonnet 4.6 does **not** reliably reproduce it (observed `**Code Review - …**` and a heading-less `Code Review — …`), so the gate fail-closed on a genuine 🟢 LGTM. This blocked #122 twice (the re-run re-deviated, confirming it's systematic). **Fix:** make the selector tolerant — the title is only a *selector key*, not a load-bearing contract like the verdict emoji. Live `.github/workflows/claude-code-review.yml` uses `test("Code Review[^a-zA-Z]+claude-code-templates")` scoped to `claude[bot]` (#123); canonical `.template` uses a name-independent `contains("Code Review")` (#122, P8b) so a downstream project name with regex/substring-special chars can't silently break the gate. Same class as the v1.3.0 verdict-emoji enforcement (#105). **The fix is validated in production** — #124 and #125's own gates passed via the tolerant selector despite title deviation.

2. **Changelog-completeness gap (pre-existing, fixed in release-prep).** `[Unreleased]` was missing v1.4.0 entries: (a) the **canonical-template + rule mirrors of the v1.3.0 CI gate-hardening** (PRs #79/#85/#92 — two-check architecture, gate-fold, lifecycle, fail-closed, invariants, terminal guards, fast-path rollup, 🟡-section, cascade/branch-verify rules) whose live halves shipped in v1.3.0 and whose canonical halves [v1.3.0]'s "Also shipped" *promised* for v1.4.0; (b) **#103** session-start context budget audit. Verified missed (not deliberately trimmed) via `git merge-base --is-ancestor` + the trim commit's diff. Resolved as a **roll-up Fixed entry** (cross-ref [v1.3.0] "Also shipped") + a dedicated #103 Added entry (maintainer chose roll-up over per-item).

### Verification harnesses run (ultracode on)

- **Adversarial-verify on the P2/P7/P8 content (5 skeptics)** during CI idle → all refuted (byte-identical lockstep confirmed via md5), AND surfaced the changelog-completeness gap (skeptic #5) before the irreversible tag.
- **Release-verify on the v1.4.0 release-prep (3 skeptics)** before merge → all refuted (changelog PR-ref accuracy, prep coherence, merge completeness; even dismissed two false-positives).

---

## Operational lessons from this session

- **CI usage-limit is infra, not content.** #125's routine review failed with `You've hit your limit · resets 10:50am UTC` — the shared-subscription capacity outage (the same one that paused the local session). Re-ran clean after the reset. Captured as memory `feedback_ci_usage_limit_is_infra_rerun`. Distinct from the OIDC trip and a real 🔴.
- **Bespoke `gh ... comments` grep filters kept failing** (matched diff content, missed `**Code Review` vs `## Code Review`). The `feedback_ci_polling_use_run_status_not_comment_parsing` memory already warns about this; I tripped it several times this session. Heed it: read run status / `statusCheckRollup` first; when reading a verdict, scope to `claude[bot]` + a tolerant phrase match, never a strict title.
- **Adversarial-verify-before-irreversible earned its keep again** — it caught the changelog gap that would otherwise have frozen into the permanent v1.4.0 tag. Reinforces `feedback_adversarial_verify_before_irreversible`.
- **The selector fix's live↔canonical divergence is intentional**, not drift: live hardcodes the known-safe project name in a regex; canonical generalizes to name-independent to avoid a downstream regex-metachar footgun. Documented in both files' comments + the CHANGELOG entry.

---

## What's queued next

1. **Follow-up: residual Step 4 drift (task #6, still open).** The live `claude-code-review.yml` Step 4 "CRITICAL — do not skip step B" paragraph ends with a sentence ("…inside backticks or a code block, the deep tier silently skips.") that the canonical `claude-code-review.yml.template` lacks. Pre-existing, out of P2/P7 scope, low-risk doc-string completion. Fold into a future canonical↔live reconciliation chore.
2. **Model-pin promotion check — DUE.** This is the **2nd clean multi-PR session on `claude-opus-4-8[1m]`** (the v1.3.0 session was the 1st; the prior handoff invited "one more clean multi-PR session before moving the pin"). 4.8[1m] held an 8-PR workstream with two adversarial-verify workflows, two review-finding loops, and a usage-limit recovery without dropping threads. **Recommendation: move the Deep-tier pin from `claude-opus-4-6[1m]` → `claude-opus-4-8[1m]`** in `.claude/skills/session-start/SKILL.md` (and re-resolve canonical evidence-neutrally). See `feedback_model_default_opus_4_6` memory.
3. **Issue #1 (carried)** — install routine + deep review workflows in THIS repo's own `.github/workflows/` (they already run live here; the canonical self-host tracking remains). Branches from `main`.
4. **Issue #95 (carried)** — bind-time `plan_tier` selector for the session-start ladder. Scoped v1.4/v1.5.

---

## Session model setup

- **Recommended at start:** Deep → `claude-opus-4-8[1m]` (watched-trial continuation, NOT the standing 4.6 pin) · xhigh / ultracode · multi-PR review-gate hardening + canonical/live lockstep + workflow OIDC.
- **Used:** Deep → `claude-opus-4-8[1m]` · xhigh · ultracode (on for the whole session). No mid-session model switch. One usage-limit pause (subscription window), resumed cleanly.
- **Outcome:** Clean. Shipped v1.4.0 end-to-end across 8 PRs (#120–#126 + the release) + the tag, zero wrong-branch edits, all OIDC admin-bypasses confirmed by failure-mode inspection, every conflict/merge verified. Surfaced + fixed two real bugs (selector fragility, changelog gap) via adversarial verification before the permanent tag. 4.8[1m] sustained a very long multi-PR session with two verification workflows and multiple review loops without losing the thread. **Promotion-check is DUE — move the Deep pin to 4.8[1m] next session (see "What's queued next" #2).**

---

## Files for next session to read first

1. This file.
2. `CHANGELOG.md` — `[v1.4.0]` (shipped) + the fresh empty `[Unreleased]`.
3. `.github/workflows/claude-code-review.yml` ≈ line 689 (the title-tolerant Evaluate selector) — lockstep pair with `_core/project-template/.github/workflows/claude-code-review.yml.template` ≈ line 614 (name-independent variant). Keep the *intentional* divergence.
4. Task #6 follow-up target: the Step 4 "CRITICAL" paragraph in both the live workflow and its `.template`.
