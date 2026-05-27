# claude-code-templates — session handoff (2026-05-27 15:46)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `0c79be3` (post #107) | `v1.2.1` @ `1dbfa83` | Advanced this session: PR #105 (routine reviewer prompt enforcement) + PR #107 (orphan `'TIMEZONE'` allowlist cleanup). v1.3.0 still NOT tagged. |
| `develop` | matches `main` modulo TOD-hook canonical work | — | Advanced via PR #104 (TOD hook + OS-clock session-close + `{{TIMEZONE}}` removal), PR #106 (cascade of #105 + canonical template sync), PR #108 (cascade of #107). |
| `release/v1.3.0` | `8e0f17f` | — | Still stale. No movement this session. |

Live workflow `claude-code-review.yml` and its canonical template at `_core/project-template/.github/workflows/claude-code-review.yml.template` now BOTH carry the strengthened verdict-emoji enforcement.

---

## What this session shipped — TOD-awareness hook + OS-clock-first session-close + reviewer prompt enforcement

**Triggered by**: cross-session note from an Emberholm session today that landed a local `UserPromptSubmit` hook to inject `[time] YYYY-MM-DD HH:MM:SS <zone>` into every prompt. The user asked to lift the principle into canonical so every downstream bind picks it up.

### PR chain

| PR | Branch | Target | Content | Merge |
|---|---|---|---|---|
| #104 | `feature/canonical-tod-hook` | `develop` | TOD hook docs + AI awareness + OS-clock session-close + full `{{TIMEZONE}}` removal | Admin-merge (maintainer self-clearing approval gate) |
| #105 | `hotfix/routine-verdict-emoji-enforcement` | `main` | Strengthen routine reviewer prompt — FAIL-CLOSED + WRONG-formats + self-check | Admin-merge (OIDC trip confirmed) |
| #106 | `chore/cascade-routine-verdict-emoji-enforcement` | `develop` | Cascade #105 + **canonical template sync** (caught by Opus on the cascade as a 🔴) | Admin-merge (carried a non-merge follow-up commit) |
| #107 | `hotfix/remove-timezone-allowlist-entry` | `main` | One-line drop of orphan `'TIMEZONE'` from CANONICAL allowlist in `claude-code-review.yml` | Admin-merge (OIDC trip confirmed) |
| #108 | `chore/cascade-remove-timezone-allowlist-entry` | `develop` | Cascade #107 | Admin-merge (approval gate only; routine 🟢 + no deep escalation) |

### Where each piece of the TOD work lives now

| Artifact | Path | Purpose |
|---|---|---|
| **Hook snippet docs** | `_core/global-template/hooks/time-injection.snippet.md` | The one-line `UserPromptSubmit` hook + Python fallback + JSON snippet to paste into `~/.claude/settings.json`. Parameter-free — OS resolves the zone via `Intl.DateTimeFormat().resolvedOptions().timeZone`. |
| **README pointer** | `_core/global-template/README.md` § 4 | Optional, recommended. § 5 retitled from § 4 (Verify). |
| **AI-side awareness** | `_core/global-template/CLAUDE.md.additions` § "Time-of-day awareness" | Instructions for models to attend to `[time]` lines and **not** re-derive via terminal commands. |
| **Canonical session-close** | `_core/project-template/.claude/skills/session-close/SKILL.md` § "Update context" | Step 1 checks the hook output first; step 2 falls back to OS-clock-only terminal commands. |
| **Live dogfood mirror** | `.claude/skills/session-close/SKILL.md` § "Update context" | Same shape as canonical. `_core/global-template/README.md` cross-reference dropped — describe-by-feature. |
| **Live workflow prompt** | `.github/workflows/claude-code-review.yml` § Step 3 | FAIL-CLOSED warning + WRONG-formats list + pre-post self-check on the verdict line. |
| **Canonical workflow prompt** | `_core/project-template/.github/workflows/claude-code-review.yml.template` § Step 3 | Mirror of the live prompt (modulo `{{PROJECT_NAME}}` placeholder). |

### `{{TIMEZONE}}` removal — full scope

- Canonical `_core/project-template/.claude/skills/session-close/SKILL.md` Node line — placeholder dropped, OS-clock command.
- `SETUP.md` Phase 1 — placeholder ← `project.timezone` mapping removed; JSON example field removed; Discovery question step removed (renumbered: Bundle confirmation → License holder → audit ambiguity).
- `redesign/bind.jsx` ↔ `index.html` (lockstep): state init, audit packet, both Field UIs (Advanced + Discovery preferences), `advancedFilledCount` array, discovery-copy line. Discovery preferences `StepHead` annot `2 THINGS` → `1 THING`.
- `.claude/BIND.md` — `{{TIMEZONE}}` row dropped from placeholder table.
- `.github/workflows/claude-code-review.yml:224` — `'TIMEZONE'` removed from CANONICAL allowlist.

The Discovery preferences section now has a single field (`conversation_language`). The card still renders cleanly but is conceptually thin — a future UI refactor could fold it into Advanced or rename the section, but that's out of scope.

### Routine reviewer prompt strengthening — the load-bearing additions

The previous prompt told Sonnet to end with `🟢 LGTM` or `🔴 Blocking — must fix` but didn't make the failure consequences explicit. Sonnet 4.6 repeatedly degraded to bare `LGTM` (no emoji), tripping the strict `Evaluate review outcome` parser (`grep -E "🔴|🟢" | tail -n 1`). Three additions fixed it on first re-run:

1. **FAIL-CLOSED ENFORCEMENT block** stating the parser is strict, bare `LGTM` is a missing verdict, no fallback parser exists.
2. **WRONG-formats list** with concrete bad examples (bare `LGTM`, wrong emoji like ✅, missing `— must fix` suffix, caveats variants, trailing prose). Models pick up patterns from examples more reliably than abstract rules.
3. **Pre-post self-check** instruction: look at the literal last line before invoking `gh pr comment`.

Captured in memory as `feedback_routine_verdict_emoji_fidelity`.

---

## Operational lessons from this session

### Cascades catch parallel canonical drift that the originating hotfix didn't

PR #105 strengthened the live workflow's reviewer prompt but I forgot to apply the same strengthening to the canonical template `_core/project-template/.github/workflows/claude-code-review.yml.template`. Opus on the cascade PR #106 caught it as 🔴 — the cascade brings the merge from main into scope alongside the working tree, so the canonical/live drift was visible there even though it was invisible on #105. **The cascade resolved the drift in the same PR** by carrying a non-merge follow-up commit (`eefd83d`). Cascade branches aren't strictly merge-commit-only — they can carry minor follow-ups that the cascade's depth-pass surfaces.

### The deep review's substance verdict isn't the merge gate; the routine emoji is

PR #104 had a clean deep-review 🟢 LGTM on two consecutive SHAs but stayed BLOCKED twice because the routine review's bare `LGTM` failed the Evaluate gate. This is exactly the failure mode `feedback_admin_bypass_discipline` warns against admin-merging through — substantive PRs don't inherit the workflow-edit exception. The right path was: pause on #104, hotfix the prompt (#105) + cascade (#106), then re-fire #104's routine review by merging develop into its branch. Discipline cost: 4 PRs instead of 1. Worth it — admin-merging through a broken routine gate would have set a precedent.

### App OIDC validates on the PR head ref's workflow file

PR #106's cascade brought the workflow change in via merge from main. Because main's workflow content matched what the App expected (since #105 was already merged there), OIDC passed for #106's routine review — even though the cascade's diff included workflow content. This contradicts the simpler heuristic "any PR touching a workflow file trips OIDC." The precise rule: OIDC passes when the PR head ref's workflow file is byte-identical to the default branch's. After a hotfix merges to main, cascades to develop can clear OIDC even though they "touch" the file via merge.

### The bare-`LGTM` regression was prompt-fidelity, not model capability

Same Sonnet model emitted bare `LGTM` three times in a row across PR #104 and PR #106, then emitted proper `🟢 LGTM` on the first run under the strengthened prompt. The model had the capability the whole time — the prompt didn't enforce it strongly enough. Recipe for the next prompt-fidelity issue: explicit failure consequences + concrete WRONG examples + a pre-action self-check instruction.

---

## What's queued next (priority order — preserved from prior handoff)

**Priority 1 — Phase 3 v1.3.0 release** (carried over):

1. Merge `main` into `release/v1.3.0` (brings in PRs #97, #99, #105, #107 from this and prior sessions).
2. Address deep-review findings from prior PR #77 (now closed): SETUP.md Phase 7a validate-vs-resolve ordering for `custom` profile; `/find` skill ctags block missing `# CTAGS_BYPASS:` marker example.
3. Reopen the release PR (`release/v1.3.0` → `main`).
4. Merge on full 🟢. Tag `v1.3.0`. Cascade `main` → `develop`.

**Priority 2 — Canonical template sync for invariant 5** (carried over from prior session): The non-reviewable terminal-state guard (invariant 5) landed on the live file on both `main` and `develop` last session, but `_core/project-template/.github/workflows/claude-code-review.yml.template` on `develop` still lacks it. Feature branch from `develop` to add the guard to the canonical template's non-reviewable PATCH path. **Unrelated to this session's canonical template touch** (which was about the reviewer prompt, not the resolve-step guard).

**Priority 3 — Emberholm port** (carried over): the `EMBERHOLM-TWO-CHECK-PROMPT.md` user has from prior sessions. Out-of-band; fresh Emberholm session.

**Priority 4 — Issue #1** (carried over): routine + deep review workflows installed. Remaining scope on #1 needs review.

**Priority 5 — Issue #95** (carried over): bind-time `plan_tier` selector for the session-start matrix.

**Priority 6 — Decide release scope for analyzer feature + this session's TOD-hook work** (updated): PR #94's analyzer + this session's TOD hook discipline are both on `develop`-only. v1.4.0 is the natural home (minor bump, new opt-in canonical artifact + canonical template change).

**Priority 7 (new) — Strengthen deep-tier prompt symmetrically** (optional): The deep-tier (Opus) prompt in `.github/workflows/claude.yml` references the same binary verdict rule but lacks the FAIL-CLOSED + WRONG-formats + self-check strengthening this session added to the routine-tier prompt. Opus has not regressed on emoji format, so this is defensive — fold in if a future deep verdict misses the emoji. Touch points: live `claude.yml` + canonical `_core/project-template/.github/workflows/claude.yml.template`.

---

## Session model setup

- **Recommended at start:** `claude-opus-4-6[1m]` · `high` · canonical templates / lockstep canonical+live edits / multi-PR cascade chain
- **Used:** `claude-opus-4-7[1m]` (active in this session — fast mode) · `high`
- **Outcome:** 5 PRs shipped, all clean on final SHA. One reviewer-finding loop on PR #104 (deep review 🔴 on bind-path + Python tzinfo claims → fixed in commit `4429d37` → re-fire 🟢 / 🟢). One canonical drift loop on PR #106 (Opus caught the routine prompt missing on canonical template → fixed in commit `eefd83d` → re-fire 🟢). One routine-prompt-fidelity loop on PR #104 (bare `LGTM` × 2 → fixed via separate hotfix #105 + cascade #106 → re-fire #104 🟢 with proper emoji). No wrong-branch edits; workflow files stayed on `hotfix/*` from `main`. Admin-merge justified on every workflow-touching PR (OIDC trip confirmed via `--log-failed`). Total branches cleaned up: 5 local + 5 remote.

**Recommended for next session matching this shape (canonical+live lockstep + workflow-edit hotfix + cascade):** stay on Opus 4.6 `[1m]` `high`. Opus 4.7 worked here but the previous session's `feedback_model_default_opus_4_6` memory still applies — high-judgment multi-step discipline is the regression surface 4.6 is safer on.

---

## Files for next session to read first

1. This file.
2. `.github/workflows/claude-code-review.yml` — now has the strengthened reviewer prompt (Step 3 expanded with FAIL-CLOSED + WRONG-formats + self-check). Live workflow is byte-identical to canonical except for `{{PROJECT_NAME}}` substitution in the comment title.
3. `_core/project-template/.github/workflows/claude-code-review.yml.template` — canonical mirror. **Still lacks invariant 5 (non-reviewable terminal-state guard) per Priority 2.**
4. `_core/global-template/hooks/time-injection.snippet.md` — new optional global hook; users opt in by appending to `~/.claude/settings.json` `hooks.UserPromptSubmit`.
5. `_core/global-template/CLAUDE.md.additions` § "Time-of-day awareness" — AI-side counterpart.
6. `release/v1.3.0` branch state — still stale at `8e0f17f`. Priority 1 next session: merge `main` into it to pick up #97, #99, #105, #107 before release.
