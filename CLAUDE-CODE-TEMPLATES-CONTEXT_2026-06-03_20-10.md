# claude-code-templates — session handoff (2026-06-03 20:10)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Headline: v1.3.0 shipped + tagged

**`v1.3.0` is released.** Tagged at `88f7d4e` on `main`. This session reconciled the long-stale `release/v1.3.0` and took it all the way out the door, then cascaded back to `develop`.

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `88f7d4e` (Merge PR #77) | **`v1.3.0` @ `88f7d4e`** | The v1.3.0 release. Contains code_research agnostification + the CI review-gate Checks-API hardening (#76–#115) accumulated on main since v1.2.1. |
| `develop` | `825be4b` (Merge PR #118 cascade) | — | Has everything on main + the v1.4.0 work + the release-prep fixes that were stranded on the release branch. `[Unreleased]` trimmed to v1.4.0-only. |
| `release/v1.3.0`, `chore/cascade-v1.3.0` | — | — | **Deleted** (local + remote) after merge. No stranded branches. |

---

## What this session did — reconcile + ship the tangled v1.3.0 release

The release was badly stalled: `release/v1.3.0` was 109 commits behind `develop` and 31 behind `main`, PR #77 was CONFLICTING, `VERSION` said v1.3.0 but the latest tag was v1.2.1, and v1.3.0/v1.4.0 work was interleaved across `main`+`develop`. The 2026-05-27 handoff was a week stale (the #113–#117 de-version workstream had landed without a session-close refresh).

**Key realization:** a "clean code_research-only v1.3.0" did not exist. `main` already carried items the CHANGELOG filed as v1.4.0 (#105/#107/#111/#113/#115), so any tag on `main` necessarily included them. We chose **full reconciliation** (user-approved): make v1.3.0 the honest cut of everything-on-main + the code_research feature, and reconcile the CHANGELOG to match.

### PR chain

| PR | Branch | Target | Content | Merge |
|---|---|---|---|---|
| #77 | `release/v1.3.0` | `main` | Merge main into release (resolve workflow→main's version byte-identical, SETUP.md→union); CHANGELOG `[v1.3.0]` reconciliation (+ "Also shipped" subsection documenting #78–#99 gate hardening, date → 2026-06-03); **fallback-stub legacy-heading fix** | Admin-merge (maintainer self-clearing approval gate; OIDC PASSED — real routine 🟢 + deep 🟢) |
| #118 | `chore/cascade-v1.3.0` | `develop` | Gitflow back-merge of v1.3.0 + the stranded release-prep fixes + `[Unreleased]` trim to v1.4.0-only | Admin-merge (green both tiers) |

### Where the verification came from (two independent catches)

1. **Adversarial-verify workflow (4 skeptics, 49 tool calls)** ran while CI was in flight — re-checked workflow byte-identity, all 13 in-scope PRs as main-ancestors, all 4 mirror PRs as develop-only, scope-leak, merge debris. Caught a **dangling `[Unreleased]` cross-reference** in the reconciliation prose (release branch has no `[Unreleased]`); fixed in `9ef1709`.
2. **Deep review (Opus) caught a real latent feature bug** (Invariant 3, 🔴): the `buildSetupMd()` `file://` fallback stub (`bind.jsx` + `index.html`, byte-identical) had dropped the legacy-heading transition that canonical `SETUP.md:244` carries — a pre-v1.3.0 re-bind via the fallback could append a **duplicate "No Explore Agents" section** to `~/.claude/CLAUDE.md`. Fixed in `2f62179` (both stubs, lockstep). Re-review came back 🟢 with a fresh 5-invariant depth pass.

---

## Operational lessons from this session

### The cascade carried real stranded content, not just topology

`develop` was **missing the v1.3.0 release-prep fixes entirely** — `3280f2c` (per-value toggle resolution), `c57dcdb` (CLAUDE.md.additions H2-rename tracking), `348ade2` (~ expansion), `467c139` (Phase 7a sub-phase split) — they'd been made on `release/v1.3.0` and never back-merged. Gitflow's "release merges to main AND develop" is exactly the discipline that recovers this. Skipping the cascade would have left the next release cut from `develop` on a wrong baseline.

### Adversarially verify *before* the irreversible step, not after

The verify workflow ran during CI idle time and caught a prose bug before the permanent tag. On a supply-chain repo (templates shipped verbatim downstream) + an irreversible public tag, the pattern earned its keep: fan out independent skeptics → fix what they find → THEN merge to main.

### CHANGELOG straddling entries split by half

When a feature lands as live-workflow-half (hotfix → main) + canonical-template-half (→ develop), and you tag a release off main, the live half ships and the canonical half doesn't. Both `[v1.3.0]` (Also shipped) and `[Unreleased]` (trimmed) had to name the split per item: #105↔#106, #111↔#112, #113/#115↔#116, #107↔#104.

### The two-stage (routine→deep) poller needs the rollup, not the SHA run list

The deep review fires on `issue_comment` and PATCHes `Claude On-Demand` asynchronously — its run never shows under the push's HEAD SHA. Poll `statusCheckRollup` until `Claude On-Demand` is terminal (and guard against the stale prior-SHA verdict). This worked cleanly for both #77's re-review and #118.

---

## What's queued next (v1.4.0 + carried priorities)

The `develop` `[Unreleased]` block is the live v1.4.0 scope. **Priority order:**

1. **Cut v1.4.0 when ready.** `[Unreleased]` now accurately lists develop-only v1.4.0 work: TOD-injection hook docs (#104), session-start model+effort analyzer, session-close outcome log, OS-clock-first session-close, canonical-template counterparts (reviewer-prompt #106, claude.yml.template 4.8 #112, template tokenization #116), `{{TIMEZONE}}` canonical+bind removal (#104). When cutting: `release/v1.4.0` from `develop`, bump `VERSION`, date the section, tag, cascade.
2. **Priority 2 (carried) — invariant 5 canonical template sync.** The non-reviewable terminal-state guard landed on the LIVE `claude-code-review.yml` (main+develop) but `_core/project-template/.github/workflows/claude-code-review.yml.template` still lacks it. Feature/chore branch from `develop`. **Verify whether still outstanding** — several workflow-template changes landed via the de-version workstream; confirm against the canonical template before assuming.
3. **Priority 7 (carried) — symmetric deep-tier prompt strengthening.** `claude.yml`'s Opus prompt lacks the FAIL-CLOSED + WRONG-formats + self-check that the routine prompt got. Defensive (Opus hasn't regressed on emoji). Live `claude.yml` + canonical `claude.yml.template`.
4. **Issue #95 (carried)** — bind-time `plan_tier` selector for the session-start ladder. Simplified now that the matrix is tier-valued. Scoped v1.4/v1.5.
5. **Issue #1 (carried, out-of-band)** — install routine + deep review workflows in THIS repo's own `.github/workflows/` (self-host the discipline the templates ship). Branches from `main` as `hotfix/install-workflows`.

---

## Session model setup

- **Recommended at start:** Deep → `claude-opus-4-6[1m]` (the standing pin) · ultracode (xhigh) · multi-PR release-reconciliation + canonical/live lockstep + workflow OIDC.
- **Used:** Deep → `claude-opus-4-8[1m]` (the session ran on 4.8 + ultracode) · xhigh. **Deliberate deviation from the pin, logged as a watched Deep-tier 4.8 trial** (the pin discipline says trial 4.8 on Frugal/Standard first; here it ran Deep).
- **Outcome:** Clean. Shipped v1.3.0 end-to-end across 2 PRs (#77, #118) + the tag, zero wrong-branch edits, all conflict resolutions verified (workflow byte-identity proven, stub lockstep held). 4.8 held multi-step discipline across a long reconciliation with an adversarial-verify workflow and two review-finding loops (dangling ref + fallback-stub bug) without dropping threads. **Recommendation:** 4.8[1m] is now a credible Deep-tier candidate on this shape; one more clean multi-PR session before moving the pin off 4.6. Don't auto-promote — log the next outcome and compare.

---

## Files for next session to read first

1. This file.
2. `CHANGELOG.md` — `[Unreleased]` (v1.4.0 scope, trimmed) + `[v1.3.0]` (shipped, with the "Also shipped — CI review-gate hardening" subsection).
3. `redesign/bind.jsx` ≈ line 2073 + `index.html` ≈ line 3640 — the `buildSetupMd()` fallback stub, now with the legacy-heading transition (lockstep pair, byte-identical — keep them so).
4. `_core/project-template/.github/workflows/claude-code-review.yml.template` — check Priority 2 (invariant-5 guard) status before acting on it.
