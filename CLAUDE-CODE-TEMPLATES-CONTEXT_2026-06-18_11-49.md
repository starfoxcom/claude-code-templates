# claude-code-templates — session handoff (2026-06-18 11:49)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Headline: the session-start model+effort recommendation feature was REMOVED

This session shipped two PRs to `develop`, the second reverting most of the first:

1. **PR #133** — promoted the session-start Deep-tier pin `claude-opus-4-6[1m]` → `claude-opus-4-8[1m]` (the carried "model-pin promotion DUE" item).
2. **PR #134** — **removed the entire session-start model + effort recommendation apparatus** (the capability-tier ladder, archetype→tier matrix, pinned-incumbent resolution + pins table, the `## Recommended setup for this session` emit block), the **context budget audit** step, and the session-close **`## Session model setup` outcome log** + promotion-check nudge — across **both** the canonical templates (`_core/`) and the live `.claude/` mirrors. The session ritual is now back to its pre-feature shape.

**Decision rationale (from the maintainer):** pinning the ritual to specific models is a liability when model availability can change without notice, and in practice the maintainer runs a consistent setup (ultracode + Opus 4.8) and rarely switches — so the recommendation was per-session context-cost dead-weight. **Do NOT re-introduce a model/tier/effort recommendation into the session ritual** unless explicitly asked (recorded in memory `feedback_model_default_opus_4_6`).

Because #134 superseded #133 within the same unreleased cycle, the CHANGELOG `[Unreleased]` carries a single `### Removed` entry (the #133 `### Changed` pin-promotion bullet was dropped — it never shipped in a release). Net for the next release: the v1.4.0 feature is removed.

## Where the branches are

| Branch | State | Notes |
|---|---|---|
| `main` | `v1.4.0` @ `291ace1` | unchanged this session |
| `develop` | post-#134 (+ this context-refresh PR) | #133 (pin promote) then #134 (full feature removal); session ritual back to pre-feature shape |

No stranded branches — only `main` + `develop`.

---

## Session ritual is now simpler (post-#134)

- **session-start:** handoff → project status → git status → branch decision → modules touched → session steps → **Stop for approval** → After approval (TaskCreate). No model/effort/budget steps. The approval gate line no longer mentions "model + effort setup."
- **session-close:** DoD verification → commit/PR decision tree → update context → update derived docs → (canonical: devlog draft) → code-research adherence metric → signal close. No `## Session model setup` outcome log.
- Canonical `_core/` stayed version-free throughout (it carried `<MAINTAINER: …>` placeholders, now removed with the rest); the live mirror's concrete pins are gone.

---

## Operational lessons (this session)

- **CI triage classifies by file ZONE, not just source extension** (verified at `.github/workflows/claude-code-review.yml:111`): `run_review=true` fires on `\.(html|jsx|js|json|yml|yaml|py|template)$ | ^_core/ | \.additions$ | bundle.toggles.md`. So **any `_core/` touch → full routine review + auto-deep-escalation** (`_core/` is in both the reviewable set and the deep-trigger set), while a **`.claude/`-only + root-`.md` diff → fast-path auto-pass**. This is why #133 (`.claude/` + CHANGELOG) was fast-path but #134 (`_core/`) drew routine + deep. Budget the 7-min + deep cadence for any `_core/`-touching PR, even docs-only ones.
- **In-cycle promote-then-revert is clean via CHANGELOG supersession** — when a later PR undoes an earlier one within the same `[Unreleased]` cycle, drop the earlier entry and write one accurate `### Removed`/`### Changed`; don't leave both (they net to user-visible noise).
- **The discovery + adversarial-verify workflow pattern earned its keep both PRs** — it caught a stale `session-close` "Opus 4.8+" next-frontier example in #133 and a dangling `SETUP.md` cross-reference in #134, both before commit. Surgical removal (excise feature sections) beat a literal git-revert, because the pre-feature files predate unrelated later improvements (timezone fixes, the adherence-metric rename) that must be kept.

---

## What's queued next

1. **Issue #1 appears DONE but its CLAUDE.md note is STALE.** The routine + deep review workflows ARE installed and running (they gated #133/#134 all session). Issue #1 ("install review workflows in this repo") is no longer open. BUT the project `CLAUDE.md` still has a "What's intentionally NOT here → Routine + deep review workflows not yet installed" section and a parallel note in `## Review discipline` — both now factually wrong. **Small doc-accuracy cleanup follow-up:** delete/correct those stale notes (a `.claude/`/root-doc `chore`, fast-path lane).
2. **Open issues (feature backlog, none touched this session):** #2 community metrics, #3 Audit/Optimize mode, #4 opt-in telemetry Stop hook, #5 "I want them all" bundle-bypass.
3. **Closed this session:** #95 (bind-time `plan_tier` selector) — moot after #134 removed the matrix it would configure.

(The "Standard-pin / is-4.6-base-still-offered" question from the prior handoff is also MOOT — the tier pins were removed entirely.)

---

## Model setup note

The session-start model recommendation was removed this session, so there is no `## Session model setup` block here by design. The session ran on the maintainer's standing setup (Opus 4.8 + ultracode) across both PRs; outcome was clean (two merges, deep-review 🟢 on #134, zero wrong-branch edits, no cleanup PRs needed).

---

## Files for next session to read first

1. This file.
2. `CHANGELOG.md` — `[Unreleased]` `### Removed` entry.
3. `.claude/skills/session-start/SKILL.md` + `.claude/skills/session-close/SKILL.md` — the simplified rituals (and their canonical counterparts under `_core/project-template/.claude/skills/`, a lockstep pair).
