# claude-code-templates — session handoff (2026-05-20 15:58)

Single source of truth for what this session left undone. `/session-start` reads this file first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `1dbfa83` | `v1.2.1` @ `1dbfa83` | Carries v1.2.0 + v1.2.1 release commits. Live workflows + canonical templates on HEAD-SHA-floor verdict-read pattern. |
| `develop` | `11a1201` | — | Cascaded from main via PR #70. Byte-identical to main on `.github/workflows/claude*.yml` and `_core/project-template/.github/workflows/*.template`. |

v1.2.0 tag (`ee302a0`) is still in place even though v1.2.1 superseded it for the gate-correctness fix — see § "v1.2.0 / v1.2.1 versioning" below for why we cut a clean patch rather than re-tagging.

---

## The gate architecture as it now stands

### HEAD-SHA-floor verdict correlation (load-bearing)

Both `Evaluate review outcome` (routine, required) and `Evaluate deep-tier verdict` (deep, advisory) read PR verdict comments through the same correlation mechanism:

1. Capture HEAD SHA. Routine gate gets it from `${{ github.event.pull_request.head.sha }}` (pull_request event populates it). Deep gate fetches via `gh api /pulls/$PR_NUMBER --jq '.head.sha'` because `claude.yml` fires on `issue_comment` events where the field is null.
2. Query `/actions/runs?head_sha=$HEAD_SHA&per_page=100` with `--paginate`.
3. Compute floor as `min(.workflow_runs[].run_started_at)` across all runs at that HEAD SHA.
4. Filter issue comments with `select(.created_at >= $floor)`.

**The floor invariant:** any verdict belonging to the current push was posted by SOME run firing on this HEAD SHA, so its `created_at` is necessarily ≥ the earliest `run_started_at` at this HEAD. Push A's verdict was posted under HEAD SHA A — `actions/runs?head_sha=B` doesn't include Run A — Push A's verdict (`created_at < floor`) is correctly rejected. Closes the false-green attack path where a workflow-touching Push B fails App OIDC and `| last` would otherwise fall back to Push A's 🟢.

**HEAD-SHA over `$GITHUB_RUN_ID`-based correlation:** generalises to multi-tier reads where the verdict is posted by a different workflow run than the one running the gate. Architectural-fit improvement caught by Emberholm's port of v1.2.0 (their PR #139) and cross-ported back here. Pattern is now the canonical verdict-correlation contract — re-use it for any future gate logic that reads PR comments posted by workflow runs.

**Residual race (Opus PR #70):** in the theoretical sub-second window where Push A's `gh pr comment` POST is in flight at the GitHub API exactly when Push B's runner-allocation finishes, the comment's server-side `created_at` could land ≥ Push B's `run_started_at`. Not practically exploitable — POST processing is tens-to-hundreds of ms; runner allocation is seconds-scale; Sonnet review duration is minutes-scale and not attacker-controllable. The previous `| last`-only gate was bypassable by ANY push-A-then-push-B sequence with no timing precision; the HEAD-SHA floor reduces the exploit surface from "any timing" to "millisecond-precision race". CHANGELOG's "necessarily ≥" claim is slightly imprecise as a formal tautology but the gate is a substantial improvement.

### Pre-screen scope guards

`.github/workflows/claude-code-review.yml`'s Python pre-screen got two structural fixes this session (PR #65):

- **Check 1 (toggle balance)** has an `if not fname.startswith('_core/project-template/'): continue` scope guard. Without it, `CHANGELOG.md` documenting the toggle feature in backticked examples produced `TOGGLE_UNBALANCED` false positives (the regex is markdown-unaware). Future CHANGELOG entries describing the gate feature won't trip this.
- **Check 2's CANONICAL placeholder set** includes `'TIMEZONE'`. Without it, every PR touching `_core/project-template/.claude/skills/session-close/SKILL.md` produced `UNKNOWN_PLACEHOLDER` false positives because `{{TIMEZONE}}` is canonical per `SETUP.md:175` but was missing from the hardcoded set.

Both defects were live-gate-only — canonical templates don't carry these checks (they're hand-authored extras). Downstream binds were never affected.

### `actions: read` permission on evaluate jobs

The HEAD-SHA correlation requires `actions: read` to call `/actions/runs`. Added at job scope on `evaluate-review-outcome` (claude-code-review.yml) and the claude job (claude.yml). Don't strip this — the gate breaks silently if removed (returns empty floor → exits 1 with "Could not determine HEAD-SHA run-started-at floor").

---

## v1.2.0 / v1.2.1 versioning — why patch, not re-tag

v1.2.0 shipped the verdict-cutoff removal as "structurally sufficient." That claim held only for the in-flight race case (the original problem) and missed the workflow-validation-failure case. Sonnet's review on the v1.2.0 cascade PR (#67) caught the gap.

Chose `v1.2.1` over re-tagging because:
- v1.2.0 tag (`ee302a0`) sits at the pre-HEAD-SHA-fix code. Anyone checking out `v1.2.0` gets the vulnerable gate — re-tagging would silently rewrite that history for upstream consumers.
- v1.2.0 CHANGELOG entry can describe what shipped at the tag (cutoff-free with `| last` only). v1.2.1's `### Security` entry describes the patch.
- Downstream binds at v1.2.0 should re-fetch templates to pick up the corrected gate. The patch-version boundary makes this explicit.

CHANGELOG editing pattern used: kept the v1.2.0 entry mostly as-was, appended forward-reference notes ("v1.2.1 corrects this — see the v1.2.1 ### Security entry") to the two bullets that overpromised. Future iterative corrections should follow this — preserve the original entry's accuracy at the tag, point forward to the patch.

---

## Operational lessons that bit this session

### Rebase is wrong for cascading-develop-advance

When `develop` advances during an open release PR, the canonical pattern (per `_core/project-template/.claude/rules/git.md` § "When `{{DEV_BRANCH}}` advances") is `git merge origin/develop` from the release branch — NOT `git rebase`. Rebasing rewrites history, requires force-push, breaks PR comment links, and violates the project's "always merge, never rebase" rule.

This session attempted a rebase on `release/v1.2.0` mid-flight and the user caught it. Reset to origin (the rebased commits never reached the remote) and re-did via merge. Don't repeat.

### Force-push hard-block at the harness layer

The harness blocks `git push --force-with-lease` and `git reset --hard` with no in-conversation approval path — even after the user explicitly chooses an option that requires them. The user had to run `git reset --hard origin/release/v1.2.0` themselves in their terminal. If a future step needs a force-push or hard-reset, plan for the user-runs-it-manually path from the start, not as a fallback.

### Sonnet stochasticity caught the false-green that earlier Sonnet missed

Sonnet 🟢'd the cutoff-removal-without-cutoff code on PR #64 (v1.2.0 release to main). Sonnet 🔴'd the SAME code on PR #67 (v1.2.0 cascade to develop) — flagged the false-green attack path explicitly. Both reviews were on identical content. Either Sonnet's analysis depth varies between runs, or the framing-as-cascade prompted deeper security scrutiny than framing-as-release-prep. **Treat a single 🟢 from one tier on novel security-surface changes as suggestive, not authoritative — re-review on the cascade.**

### Workflow validation pattern on cascade PRs

When a hotfix's workflow file change cascades from main to develop, the cascade PR's head-ref workflow file content is byte-identical to main's. App OIDC validation passes → routine review runs normally. Confirmed twice this session (PRs #63, #66, #70). The "workflow-touching PR needs admin-bypass" rule only applies to the ORIGINAL hotfix, not the cascade.

---

## Emberholm bidirectional cross-pollination — steady-state

The Emberholm and claude-code-templates projects have settled into a bidirectional cross-port pattern. Five cross-ports in seven days per the user's last update from the Emberholm session, the latest being:

- **Emberholm → templates (last session):** initial cutoff-removal analysis with the `cancel-in-progress + | last + --paginate` reasoning. We adopted it for v1.2.0.
- **Templates → Emberholm (this session, early):** four findings handed off (`--paginate` missing on Emberholm's verdict reads, `startsWith` vs `contains` bot-loop guard, AI-attribution scanner self-reference, `issues:` trigger removal).
- **Emberholm → templates (this session, late):** ported the cutoff-removal to Emberholm's PR #139, hit the multi-tier-read architectural-fit issue with `$GITHUB_RUN_ID`-based correlation, designed the HEAD-SHA-floor mechanism, sent it back. We adopted it for v1.2.1.

What's important about this for future sessions: **when one project hardens its gate, the other gets the finding within days.** Don't assume an analysis is final because it shipped — there's a high chance the cross-port surfaces something. Treat the bidirectional channel as a load-bearing review tier, not an occasional exchange.

The user is the same person across both projects, but with separate sessions. Cross-port handoffs are explicit message pastes between sessions.

---

## What's intentionally NOT done

- **Routine + deep review workflows installation in this repo** (issue #1). The canonical workflows at `_core/project-template/.github/workflows/` are NOT what `.github/workflows/` runs. The live workflows here are hand-authored variants (added to support the project's own dogfooding before the templates were stable). They share the same hardened shape but the live ones have project-specific pre-screen checks (toggle balance, placeholder validation, JSX/HTML parity, file categorization, deep-trigger surface) that aren't in the canonical templates. Consolidating them is roadmap.
- **Emberholm-side improvements** to our four-finding handoff. We sent the findings; Emberholm decides what to apply. The `--paginate` ask was acknowledged by their own report as latent; the other three are situational on their setup.
- **`stash/recovery-snapshot-pre-reset` branch on remote** — still there. Safe to delete now that v1.2.1 has shipped (everything was re-applied through this session's PRs). User confirmation pending.
- **`C:\Users\alexz\AppData\Local\Temp\recovery-snapshot.patch`** — same, safe to delete.

---

## Open questions / next session

- **Consolidate live workflows onto canonical templates (issue #1).** Replace `.github/workflows/claude-code-review.yml` and `claude.yml` with renderings of `_core/project-template/.github/workflows/*.template` against this project's placeholders + project-specific pre-screen additions. Bring the live pre-screen's six checks (toggle balance, placeholder validation, AI-attribution scan, JSX/HTML parity, file categorization, deep-trigger detection) into the canonical template so downstream binds get them too — currently they're hand-authored live-only. Big refactor; cut as a v1.3.0 feature, not a hotfix.
- **Audit mode (issue #3).** Discussed as a future feature for analyzing existing projects without re-binding. Still scoped out.
- **Telemetry Stop hook (issue #4).** Opt-in session metadata capture. Not started.
- **`/find` skill parameterization (issue #10).** Currently hardcodes tokensave. Should read `tools.code_research.name` from the bound config.
- **Community metrics (issue #2).** Opt-in, anonymised, PR-submitted before/after metrics aggregate.
- **"I want them all" bundle bypass (issue #5).** Bundle bypass + toggle-conflict detection.
