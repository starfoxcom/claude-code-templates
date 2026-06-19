# claude-code-templates — session handoff (2026-06-19 00:16)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Headline: stale "review workflows not installed" doc claims corrected (PR #136)

The prior handoff's queued item #1 (doc-accuracy cleanup) is **DONE**. The routine + deep review workflows were self-hosted out-of-band a while ago, but several guidance docs still described them as a tracked follow-up / not-yet-installed. A multi-lens discover→verify sweep found **4 stale passages across 3 files** (more than the 2 the prior handoff named) and PR #136 corrected them:

- **CLAUDE.md** — `## Review discipline` note rewritten to "installed and active in `.github/workflows/` (`claude-code-review.yml`, `claude.yml`)"; the `## What's intentionally NOT here` section removed entirely (its only item was the obsolete workflow note — a tracked follow-up was never a deliberate omission).
- **CONTRIBUTING.md** — dropped the stale "*(Workflow installation is tracked follow-up — when it lands…)*" parenthetical; the main routine-review sentence was already accurate.
- **.claude/skills/session-close/SKILL.md** — removed the stale **and operationally dangerous** "Note for this repo, pre-review-workflows: …PRs to develop have no CI gate. Use `--admin`…" paragraph. It told future sessions to bypass a gate that now exists. Canonical `_core/` never had this note, so removing it *reduced* live↔canonical drift.

Phantom issue refs (`#1`, `#6`) are gone with the passages that carried them — GitHub #1 is the merged v1.0.0 release PR, not an open tracking issue.

**CHANGELOG.md deliberately untouched.** The matching passages live in frozen dated-release sections (`[v1.3.0]`, `[v1.2.0]` → "Known follow-ups" / "Out-of-band"). Those are append-only history, accurate as of their release dates. The workflow install is explicitly out-of-band / not SemVer-tracked, so no `[Unreleased]` entry was owed, and this docs-only PR didn't warrant its own entry. (New memory `feedback_changelog_append_only` records the discipline — two verify agents disagreed; append-only won.)

All three edited files are root-`.md` / `.claude/**` → the PR rode the **fast-path auto-pass lane** (triage non-reviewable → `Evaluate review outcome: SUCCESS`, `Claude On-Demand: SKIPPED`). Merged via `--admin` (clears the maintainer self-approval gate), branches cleaned local + remote.

## Where the branches are

| Branch | State | Notes |
|---|---|---|
| `main` | `v1.4.0` @ `291ace1` | unchanged this session |
| `develop` | post-#136 @ `b5daa1a` (+ this context-refresh PR) | doc-accuracy correction only |

No stranded branches — only `main` + `develop`.

---

## What's queued next

All remaining open issues are **design-gated feature backlog** — none touched this session, each needs a design decision before code (see the v1.3.0 CHANGELOG roadmap for target releases + the open question per item):

1. **#2** — community before/after metrics (opt-in, anonymized, PR-submitted). Heavy design: what's collected, where submitted, privacy review. Targeted v1.9.0.
2. **#3** — Audit/Optimize mode (third SETUP mode: read `.claude/BIND.md`, diff against templates, surface drift). Targeted v1.5.0. Open Q: user-facing trigger shape.
3. **#4** — opt-in telemetry Stop hook (session metadata). Targeted v1.7.0. Open Q: local-file-only vs opt-in remote.
4. **#5** — "I want them all" bundle-bypass + toggle-conflict detection. Targeted v1.8.0.

Nearer-term roadmap items not yet ticketed (from v1.3.0 CHANGELOG "Known follow-ups"): v1.3.1 `tokensave_entry_point` → `code_research_first` rename (mechanical, alias shape pre-committed in SETUP.md Phase 1); v1.4.0-line `precommit` slot wiring (extends the v1.3.0 per-value-marker + tool-profile pattern).

---

## Operational lessons (this session)

- **CHANGELOG is append-only — including "Known follow-ups" subsections.** They read like live roadmaps but record state as-of the release date; never retroactively edit a dated `[vX.Y.Z]` section. Forward/corrected state → `[Unreleased]`; out-of-band repo infra → no entry at all; fix the live guidance docs instead. (Memory: `feedback_changelog_append_only`.)
- **The multi-lens discover→verify sweep earned its keep again.** Scoped as "fix 2 CLAUDE.md notes," it surfaced 2 more stale claims the handoff never named — including the session-close `--admin` landmine. The adversarial-verify stage also correctly *rejected* editing the frozen v1.2.0 CHANGELOG entry (one lens wanted to edit it, another refused on append-only grounds).
- **Live-mirror-only annotations aren't lockstep edits.** The session-close note was a repo-specific bind-time addition absent from canonical `_core/`. Removing live-only content reduces drift — verify the canonical counterpart before assuming a lockstep edit is needed.

---

## Files for next session to read first

1. This file.
2. `CLAUDE.md` § "Review discipline" + "Repo layout" — confirm the corrected workflow-status wording (no more "not installed").
3. For any backlog pickup (#2–#5): the v1.3.0 CHANGELOG "Known follow-ups (with target releases)" block — it carries the target release + open design question per item.
