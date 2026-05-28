# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [SemVer](https://semver.org/) from v1.0.0 onward.

Earlier conversational `v17` and `v18` mentions never shipped as standalone artifacts — they're consolidated into the v1.0.0 release.

## [Unreleased]

Targeted for **v1.4.0** (minor bump — new feature, no break) once cut. The v1.3.0 release branch (`release/v1.3.0`) does NOT carry these changes; they landed on `develop` after the release cut.

### Added

- **Time-injection hook docs + AI awareness** (PR #104). New `_core/global-template/hooks/time-injection.snippet.md` documents an optional `UserPromptSubmit` hook that injects `[time] YYYY-MM-DD HH:MM:SS <zone>` into every prompt. Parameter-free — the zone is resolved at call time via `Intl.DateTimeFormat().resolvedOptions().timeZone` (Node) or `datetime.now().astimezone().tzinfo` (Python fallback, OS-localized form). `_core/global-template/README.md` § 4 documents installation; `_core/global-template/CLAUDE.md.additions` § "Time-of-day awareness" tells models to attend to the injected lines and trust them over terminal `date` re-derivations. Lifts Emberholm's local fix into canonical so every downstream bind picks up the same time-of-day-awareness discipline without per-project bind substitution.
- **Routine reviewer prompt — FAIL-CLOSED enforcement of verdict emoji** (PRs #105 + #106). Both `.github/workflows/claude-code-review.yml` and its canonical template at `_core/project-template/.github/workflows/claude-code-review.yml.template` got three additions in Step 3: a FAIL-CLOSED warning stating the parser is strict (`grep -E "🔴|🟢" | tail -n 1`) and bare `LGTM` is treated as a missing verdict; a WRONG-formats list with concrete bad examples (bare `LGTM`, wrong emoji like ✅, missing `— must fix` suffix, caveats variants, trailing prose); a pre-post self-check instruction. Fix for the regression where Sonnet 4.6 reliably degraded to bare `LGTM` and tripped the Evaluate gate.

### Changed

- **OS-clock-first session-close** (PR #104). Canonical `_core/project-template/.claude/skills/session-close/SKILL.md` § "Update context" now checks the time-injection hook output as step 1 (authoritative when present); step 2 falls back to OS-clock-only terminal commands with NO hardcoded IANA strings (`'America/Mazatlan'` etc.). Hardcoded zones inherit US-DST assumptions that are wrong for non-US-DST locales — OS clock is always the right source. Live mirror `.claude/skills/session-close/SKILL.md` re-resolved against the new canonical.
- **Session-start model + effort analyzer** in `_core/project-template/.claude/skills/session-start/SKILL.md` and `.claude/skills/session-start/SKILL.md`. New step emits a `## Recommended setup for this session` block before the approval gate. The matrix is keyed to **capability tiers** (Deep / Standard / Frugal), not model versions — archetype → tier / effort — and a resolution sub-step turns the tier into a concrete `/model <id>` via a **pinned-incumbent rule** (the model the project's outcome log has *proven* — never newest-by-default) with a visible `<unverified — confirm via /model>` fallback that halts at the approval gate. Because the tier ladder names no model version, the **canonical carries zero model IDs and needs no per-release edit**; it stays generic + evidence-neutral and marked "starting point, not permanent answer". The project-local file maps this repo's archetypes (workflow YAML state-machine surgery / lockstep canonical+live edits / bind resolution / multi-PR cascade) to tiers and carries the single project-private pin block (`Deep → claude-opus-4-6[1m]`, `Standard → claude-opus-4-6`, `Frugal → claude-sonnet-4-6`) alongside the version-specific 4.6-vs-4.7 evidence.
- **Session-close outcome log** in `_core/project-template/.claude/skills/session-close/SKILL.md` and `.claude/skills/session-close/SKILL.md`. Appends a `## Session model setup` block (`Recommended at start / Used / Outcome`, each recording **both tier and resolved id** so the log stays comparable as concrete IDs drift) to the regenerated context file, plus a **promotion-check nudge** that flags when a newer top-tier model has been available for several sessions without the pin being re-evaluated. Empirical feedback loop for tuning the tier-resolution pins. **Lives inside the `context_refresh_files` toggle block** so disabling that toggle strips both file-generation and outcome-log coherently.
- **Canonical SESSION START prose updated** in `_core/project-template/CLAUDE.md` — the `Recommended model + effort` step now describes picking a capability tier and resolving it to a concrete `/model <id>` via the skill's pinned-incumbent rule (not newest-by-default), keeping step ordering aligned with the SKILL (the archetype match needs the planned step list as input).
- **Plan-tier tuning guidance** in canonical session-start SKILL.md — documents how Pro / Max / Team / Enterprise / API cost and 1M-context availability vary by tier (map Deep → Standard / Frugal on cost-sensitive plans); cites the [official Claude Code model config docs](https://code.claude.com/docs/en/model-config#extended-context). The canonical refers to the 1M-context variant as a capability ("your plan's 1M-context suffix"), not a literal id, so it stays version-free.
- **Memory entry: `feedback_model_default_opus_4_6`** — captures why this repo pins the Deep tier to Opus 4.6 rather than the newer 4.7 on high-judgment / long-context / multi-step-discipline sessions, sourced from [anthropics/claude-code#58369](https://github.com/anthropics/claude-code/issues/58369) evidence (project-private memory, not shipped); the rationale behind the mirror's pinned-incumbent block.

### Removed

- **`{{TIMEZONE}}` placeholder, end to end** (PRs #104 + #107). The placeholder existed solely to feed a `timeZone:` option to one hardcoded Node command in the canonical session-close skill — now obsoleted by the OS-clock-first principle. Removed from canonical `_core/project-template/.claude/skills/session-close/SKILL.md`, `SETUP.md` (placeholder mapping + JSON example + Discovery question step), `redesign/bind.jsx` ↔ `index.html` (state init, audit packet, both Field UIs, `advancedFilledCount`, discovery-copy line; Discovery preferences annotation `2 THINGS` → `1 THING`), `.claude/BIND.md` placeholder table, and the workflow's CANONICAL placeholder allowlist.

### Known follow-ups

- **Issue #95** — bind-time `plan_tier` selector for the session-start ladder. Now that the matrix is **tier-valued** (Deep / Standard / Frugal) rather than carrying concrete model IDs, the selector simplifies from "rewrite the model rows" to "annotate / filter by tier per the maintainer's plan" (e.g. collapse Deep → Standard on Pro). Scoped for v1.4 / v1.5. Touches `redesign/data.jsx` + bind logic + canonical `{{PLAN_TIER}}` placeholder + 4 bundle defaults + `BIND.md` schema. Until it lands, the canonical ships a `<MAINTAINER: …>` placeholder pin table in the resolution sub-step (filled in on first bind) plus the "Tuning for your plan tier" subsection as the manual bootstrap.

## [v1.3.0] — 2026-05-21 — code_research agnostification

The `tools.code_research` slot was promised in v1.0.0 (tokensave / ast-grep / Sourcegraph / ctags / Semgrep / none / other) but the canonical templates, the hook file, and the `/find` skill hardcoded `tokensave` references. Downstream users who picked a different code-research tool got templates that referenced tools their project didn't have. This release wires the slot through end to end **and establishes the per-value-marker + tool-profile-JSON pattern as the canonical mechanism for the other four tool slots** (`precommit` / `ci` / `ai_reviewer` / `issue_tracker`) that remain hardcoded or absent in templates today.

Scope intentionally exceeded Issue #10's letter — `/find` parametrisation pulled in `/architecture-graph`, `_core/project-template/.claude/rules/token-efficiency.md`, `_core/project-template/.claude/skills/session-close/SKILL.md`'s adherence-metric section, and `_core/global-template/CLAUDE.md.additions`'s no-Explore-agents rule, because hardcoded tokensave references in any of those would have re-exposed the same surface for the next person to hit.

### Added
- **Generic hook template + per-tool profile system.** `_core/global-template/hooks/code-research-first.py.template` is the new canonical hook. `_core/global-template/hooks/code-research-profiles.json` holds per-tool profile data (display name, bypass marker, detection mode + target, command sequence bullets) for tokensave / ast-grep / Sourcegraph / ctags / Semgrep / none / custom. The bind step picks the profile matching `tools.code_research`, substitutes its placeholders into the template, and writes the result to `~/.claude/hooks/<tool>-first.py` (e.g., `tokensave-first.py`, `ast-grep-first.py`).
- **Canonical SETUP.md shipped at bind time.** The configurator now fetches `SETUP.md` from the same-origin GitHub Pages deployment when assembling the zip. If fetch fails (file:// protocol, offline, CORS), it falls back to an inline stub that captures the v1.3 contract verbatim. Both paths produce a `SETUP.md` in the downloaded archive — downstream Claude sessions never read a stale stub.
- **Atomic write contract for `~/.claude/hooks/*.py` and `~/.claude/settings.json`.** SETUP.md § Phase 7a documents the `.tmp` + `fsync` + `os.replace` pattern; a crash mid-bind cannot corrupt the user's global hook config.
- **Profile schema validation step.** SETUP.md § Phase 7a validates the resolved profile against `code-research-profiles.json`'s inline `_schema` field (required-field presence, `detection_mode` enum, `bypass_marker` regex, `detection_target` path-traversal guard) before rendering. Malformed profiles abort with a clear error.
- **Per-value toggle marker syntax.** New marker shape `<!-- TOGGLE:<slot>:<value> START/END -->` for single-select tool slots (`code_research`, `precommit`, `ci`, `ai_reviewer`, `issue_tracker`). Symmetric with the existing boolean `:off` markers — same binder logic, parameterized by what to match against. Documented in TOGGLES.md § "Per-value markers for tool slots".
- **`{{TOOLS_<SLOT>_NAME}}`, `{{TOOLS_<SLOT>_URL}}`, `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` placeholders.** Substituted at bind time from the configurator's `tools.<slot>` selection + the hook profile JSON. Documented in SETUP.md § Phase 3 step 2.

### Changed
- **`/find` skill parametrised (closes issue #10).** Canonical `_core/project-template/.claude/skills/find/SKILL.md` now ships seven per-tool blocks (tokensave / ast-grep / Sourcegraph / ctags / Semgrep / none / custom); the bind step keeps only the block matching `tools.code_research`. Each block is self-contained: sequence + reporting + why-this-exists. Shared fallback + citation prose uses `{{TOOLS_CODE_RESEARCH_NAME}}` placeholders.
- **`/architecture-graph` skill parametrised.** Generation step 1 (enumerate boundaries) and Refresh step 2 (diff against code reality) carry per-tool blocks; the bind step resolves to the chosen tool's primitive.
- **`_core/project-template/CLAUDE.md` "BEFORE ANY CODE RESEARCH" + "TOKENSAVE ENTRY POINT" sections agnostified.** The two sections now reference `{{TOOLS_CODE_RESEARCH_NAME}}` and delegate per-tool command shapes to `/find`. The "TOKENSAVE ENTRY POINT" heading renamed to "CODE-RESEARCH ENTRY POINT".
- **`_core/project-template/.claude/rules/token-efficiency.md` "Read before writing" rule** simplified to "invoke `/find` first," delegating per-tool sequence to the skill. The boolean "If tokensave is installed / Otherwise" branch is gone.
- **`_core/project-template/.claude/skills/session-close/SKILL.md` Tokensave-adherence section** generalised to "Code-research adherence metric" — counts calls matching the chosen tool's primitive shape vs Grep/Glob fallbacks. Per-tool counting heuristic via `<!-- TOGGLE:code_research:<value> START/END -->` blocks.
- **`_core/global-template/CLAUDE.md.additions` rule heading** renamed from "No Explore Agents When Tokensave Is Available" to "No Explore Agents When the Project's Code-Research Tool Is Available". Per-tool guidance via `:code_research:<value>` blocks; the tokensave-specific tool list moved inside the `:tokensave` block.
- **`_core/global-template/README.md` verify question** rephrased from "tokensave-first rule" to "no-Explore-agents-for-code-research rule".
- **Configurator UI blurbs (index.html + redesign/data.jsx + index.legacy.html).** The `tokensave_entry_point` toggle's label, controls, and blurb fields now describe the agnostic semantics. The toggle ID is preserved (legacy — see "Known follow-ups" below).
- **Manifest entries** (index.legacy.html) updated: ships `code-research-first.py.template` + `code-research-profiles.json` instead of the old hand-coded `tokensave-first.py`.

### Removed
- **`_core/global-template/hooks/tokensave-first.py`** (orphan after the template+profile system supersedes it). The bind step renders the equivalent file from the template + tokensave profile.

### Migration

**If you do NOT re-bind, nothing changes for you.** Your existing `~/.claude/hooks/tokensave-first.py` (hand-installed or installed by a prior bind) keeps working unchanged. The v1.3.0 patch updates only the canonical templates in this repo; nothing on your machine is touched until you re-run setup.

**To pick up the parametrised templates on an existing v1.2.1 bind:**
1. Re-download the configurator zip from https://starfoxcom.github.io/claude-code-templates/ with the same bundle + same `tools.code_research` value you previously chose.
2. Unzip at your project root (overwriting the prior `claude-code-templates/` folder is fine).
3. Paste the new `PASTE-TO-CLAUDE.md` content into Claude Code. Claude reads the bundled (or fetched) `SETUP.md`, walks through Phase 1 → Phase 7a, regenerates `.claude/skills/` + hook + CLAUDE.md sections against the new canonical.
4. The bind step asks before overwriting any file whose content diverges from the rendered output — your hand-edits in `~/.claude/hooks/tokensave-first.py` are preserved on a "no" answer.

**To switch tools** (e.g., from `tokensave` to `ast-grep`):
1. Re-run setup as above but pick the new `tools.code_research` value in the configurator UI.
2. The bind step:
   - Computes the new profile (`ast-grep` → `filename_basename: "ast-grep-first"`).
   - Renders the new `~/.claude/hooks/ast-grep-first.py`.
   - Adds the new matcher entry to `~/.claude/settings.json` (atomic write via `.tmp` + `os.replace` — never corrupts the file mid-write).
   - Detects the orphan `tokensave-first.py` entry, asks before removing it + deleting the file.
   - Re-resolves CLAUDE.md / `/find` / `/architecture-graph` / session-close adherence sections against `ast-grep` (per-tool blocks).
   - Updates the global CLAUDE.md additions section block.

**To switch to `none`** (no enforcement hook): pick `tools.code_research: "none"` and `tokensave_entry_point: false`. The bind step still runs the orphan cleanup — your stale `tokensave-first.py` registration is removed.

**Hook is advisory, not a security boundary** — it fails open on malformed input and unknown profile fields. Don't rely on it for sandboxing; rely on it for Claude-discipline.

### Known follow-ups (with target releases)

Consolidates open items from v1.0.0 / v1.1.0 / v1.2.x follow-ups + new items introduced in v1.3.0. Target versions reflect session-paced sequencing (AI does the code; user manages scope + design decisions); see the v1.3.0 roadmap conversation for rationale.

**v1.3.1 — patch**
- **`tokensave_entry_point` toggle rename to `code_research_first`** with backward-compat alias resolution (per `developer_branch`/`default_branch` precedent). Alias accepts the legacy name so existing bound projects keep working; future binds emit the new canonical. Shape pre-committed in SETUP.md Phase 1 step 4 — execution is mechanical.

**v1.4.0 — minor**
- **Extend per-value marker + tool-profile pattern to the `precommit` slot** (lefthook / husky / pre-commit / simple-git-hooks / none / Other). First additional slot using the v1.3.0-established pattern; derisks subsequent slot wirings + Audit mode (v1.5.0). Pattern documented in TOGGLES.md § "Adding a new tool slot".
- **Per-tool MCP server / CLI installation guidance.** The hook template assumes the chosen tool is already installed; doesn't install it. The setup summary should include a "to install `<tool>`: see `<url>`" hint sourced from each profile's `url` field. Trivial polish; bundles naturally with v1.4.0 since the precommit slot wiring also surfaces install hints.

**v1.5.0 — minor**
- **Audit/Optimize mode** (issue #3 — tracked since v1.2.1). New third SETUP mode (alongside Manual + Discovery) that reads existing `.claude/BIND.md` + project state, diffs against current templates, surfaces drift + proposes deltas. Heavy enough to be its own release. Needs a design decision before code: what's the user-facing trigger (re-paste bootstrap brief with `mode: "audit"`? Separate paste? Auto-detect from `.claude/BIND.md` presence?).

**v1.6.0 — minor**
- **Extend per-value markers + tool profiles to the `ci` slot** (GitHub Actions / GitLab CI / CircleCI / Jenkins / Buildkite / none / Other). Heavier than precommit because CI YAMLs differ substantially per vendor — needs per-tool workflow template files, not just per-value blocks. Design decision: ship full YAML translations for non-GitHub-Actions vendors, or stub them with a "translate this GH Actions workflow yourself" pointer?

**v1.7.0 — minor**
- **Telemetry Stop hook** (issue #4 — tracked since v1.2.1). Opt-in `~/.claude/hooks/telemetry-stop.py` writing session metadata. Design decision: local-file-only (privacy-safe default) vs also opt-in remote endpoint? Complements community-metrics path (v1.9.0).

**v1.8.0 — minor**
- **Extend per-value markers to the `ai_reviewer` + `issue_tracker` slots** (Claude / CodeRabbit / Bito / Sourcery / Codium / none / Other; GitHub / Linear / Jira / Notion / Shortcut / none / Other). Both are lower-priority — most users stick with the catalog defaults (Claude + GitHub) — wire for completeness and to close out the "all 4 remaining slots" backlog from v1.0.0's "Tool slot template wiring" entry.
- **'I want them all' bundle bypass** (issue #5 — tracked since v1.2.1). Configurator-level: add a "bypass bundle defaults — every toggle ON" mode with toggle-conflict detection. Bundles cleanly with the final slot wirings since it also touches the configurator UI.

**v1.9.0 — minor**
- **Community metrics aggregate** (issue #2 — tracked since v1.1.0). Opt-in, anonymized, PR-submitted before/after metrics. Heavy design conversation needed before code: what's collected, where it's submitted (GH issue? GH discussions? dedicated repo?), privacy review, schema versioning.

**v1.9.1 or later — patch**
- **`manifest.json` build script** (tracked since v1.1.0). `tools/build-manifest.py` autogenerates the resolved + source manifests from the repo tree on every commit; CI integration. Tooling polish — doesn't change product surface.

**v2.0.0 — major**
- **Drop the `tokensave_entry_point` alias** entirely. Time-gated, not effort-gated — wait until enough minor releases have shipped with the alias that judged-sufficient migration time has passed. No current driver.

**Out-of-band (not SemVer-versioned for the public toolkit)**
- **Routine + deep review workflows installation in this repo** (issue #1 — tracked since v1.2.1). Self-hosting CI that mirrors what the templates already ship to downstream users. Per the `workflow-changes-are-hotfixes` discipline, branches from `main` as `hotfix/install-workflows`. Lands any time independent of the public-toolkit version cadence.

### Versioning policy
- **Minor** release per the SemVer rules: wires an existing v1.0.0 promise (`tools.code_research` slot) through the canonical templates end-to-end, adds the per-value marker syntax + tool-profile JSON pattern, no toggle catalog renames / bundle key renames / manifest schema breaking changes. Downstream binds at v1.2.1 keep working — re-fetch templates to pick up the parametrised skills + hook profile system. Existing `tools.code_research: "tokensave"` users get an equivalent hook at the same filename path.
- **New configurator contract:** every `TOOL_SLOTS[<slot>].options[<i>]` entry now carries a `key` field (lowercase, profile-lookup-safe; falls back to `name.toLowerCase()` for compat). Third-party forks adding options to any tool slot MUST set `key` explicitly — `buildManifest()` emits `key` not `name` into `tools.<slot>`. This is additive (existing options keep working via the fallback) but contributors should set `key` going forward.

---

## [v1.2.1] — 2026-05-20

Security patch on top of v1.2.0. Closes a false-green gate vulnerability introduced when v1.2.0 removed the verdict timestamp cutoffs. No user-visible UI changes; no contract changes; templates-only consumers and the live gate both get the corrected mechanism.

### Security
- **HEAD-SHA verdict correlation closes false-green gate vulnerability.** v1.2.0 removed the timestamp cutoff from both verdict-read pipelines on the assumption that `cancel-in-progress: true` + `| last` + `--paginate` provided sufficient structural prevention of stale-verdict pickup. The reasoning covered the in-flight race case but missed the failure case: `cancel-in-progress` only cancels in-flight runs — it cannot un-post a verdict that an earlier completed run already wrote to the PR.

  **Attack path that shipped in v1.2.0:**
  1. Push A clean → routine review fires → 🟢 verdict posted.
  2. Push B: malicious `_core/` change + any trivial workflow-file touch (one-line comment edit).
  3. Push B's run hits `Workflow validation failed` — the Anthropic Claude Code GitHub App's OIDC token exchange refuses to authenticate when workflow files differ between the PR head and the default branch. This is **expected and documented** behavior for workflow-touching PRs (see `_core/project-template/.claude/rules/review-tiers.md` § "Workflow-touching PRs require admin-bypass").
  4. The action exits without posting any verdict comment. `Evaluate review outcome` still runs (`if: always()`), reads PR comments via `gh api --paginate | jq | last` → returns Push A's 🟢.
  5. Gate exits 0. Required-status-check passes. The maintainer's only remaining gate is manual approval — a false-green that LOOKS like an AI review pass can bypass scrutiny.

  **Fix.** Filter verdict comments by `created_at >= floor`, where `floor = min(.workflow_runs[].run_started_at)` across all workflow runs at the PR's current HEAD SHA. Mechanism:
  - Each evaluate job captures HEAD SHA (`github.event.pull_request.head.sha` for the routine gate, via the PR API for `claude.yml`'s `issue_comment`-fired deep gate).
  - Queries `/actions/runs?head_sha=$HEAD_SHA&per_page=100` with `--paginate`, computes the floor as `min(.workflow_runs[].run_started_at)`.
  - Filters the issue-comments query with `select(.created_at >= $floor)`.
  - Push A's verdict was posted under HEAD SHA A. The `actions/runs?head_sha=B` query doesn't include Run A. The floor is Run B's `run_started_at`. Push A's verdict (`created_at < floor`) is correctly rejected. Gate exits 1 with "No review comment found at or after HEAD-SHA floor". Merge blocked.

  **HEAD-SHA over `$GITHUB_RUN_ID`-based correlation:** generalises to multi-tier reads where the verdict is posted by a different workflow run than the one running the gate (e.g., a deep-tier fold-in pattern where the routine gate's evaluate step reads the deep verdict). Architectural-fit improvement caught by [Emberholm's v1.2.0 port (PR #139)](https://github.com/starfoxcom/Emberholm/pull/139) and cross-ported back here. Bidirectional cross-pollination steady-state.

  **Affected files** (live + canonical templates in lockstep):
  - `.github/workflows/claude-code-review.yml`
  - `.github/workflows/claude.yml`
  - `_core/project-template/.github/workflows/claude-code-review.yml.template`
  - `_core/project-template/.github/workflows/claude.yml.template`

  Each evaluate job gains `actions: read` permission for the `actions/runs` API query.

### Versioning policy
- **Patch** release per the SemVer rules: security fix to the gate mechanism, no toggle catalog / bundle keys / manifest schema / SETUP.md contract changes. Downstream binds existing at v1.2.0 should re-fetch templates to pick up the corrected gate.

---

## [v1.2.0] — 2026-05-20

CI hardening + canonical-template parity. The routine + deep review workflows reach their final hardened shape; the templates that ship to downstream binds catch up to that shape. Configurator branch-field rename closes a Gitflow incoherence bug. No user-visible UI rework — the configurator's form layout shifts but the contract is the same.

### Added
- **Substantive Python pre-screen on routine review.** `claude-code-review.yml`'s `Pre-screen PR diff` step now runs six deterministic checks before Sonnet sees the diff: toggle-marker balance (every `<!-- TOGGLE:name START -->` has a matching END in the same file), placeholder validation (every `{{NAME}}` in `_core/project-template/**` is in the canonical SETUP-resolvable set), AI-attribution scan (regex-based, applies to added lines only), JSX/HTML parity (`redesign/*.jsx` touched without `index.html` in the diff is a warning), file categorization (architecture-critical vs docs vs other code), and deep-trigger surface detection. Sonnet trusts the pre-screen and spends turns on judgment work — not re-discovering grep-able patterns. The `Bash(gh *),Read` action allowlist is sized exactly for this contract.
- **Triage blast-radius coverage.** The reviewable-files regex now catches `\.template$`, `^_core/` (rules, skills, templates), `\.additions$` (CLAUDE.md additions), and `/bundle\.toggles\.md$`. High-blast-radius non-code changes no longer slip past the routine review.
- **Task-tracking discipline with multi-PR pattern.** `_core/project-template/CLAUDE.md` documents the `TaskCreate` / `TaskUpdate({ addBlockedBy: [...] })` pattern for sessions with 3+ discrete work items. **Multi-PR workstreams** (hotfix cascades, large refactors split for review) create one task per PR up-front and chain dependencies via `addBlockedBy` so the task list mirrors the merge order — treating a 10-PR chain as ad-hoc work burns hours on out-of-sequence routing.

### Changed
- **Verdict timestamp cutoffs removed** (PR #62). Both `claude-code-review.yml` (25-min) and `claude.yml` (10-min) dropped the `select(.created_at >= $cutoff)` filter from their verdict-read `jq` pipelines. The original rationale held for the in-flight race case the cutoff was originally addressing (a slow Sonnet run on a large `_core/` diff creeping toward the 25-min cap and silently fail-red'ing the gate). **It missed the workflow-validation-failure case**: a later push that posts no verdict at all causes `| last` to fall back to a prior push's verdict, producing a false-green on the required gate. **v1.2.1 corrects this** with HEAD-SHA verdict correlation — see the v1.2.1 `### Security` entry for the full attack path and the floor-based fix. Canonical templates at `_core/project-template/.github/workflows/*.template` were cutoff-stripped here in v1.2.0; v1.2.1 brings the HEAD-SHA floor to all four files in lockstep.
- **Canonical workflow templates updated to live shape.** `_core/project-template/.github/workflows/{claude-code-review.yml.template, claude.yml.template}` now mirror the live workflows' v1.2.0 form — substantive Python pre-screen, two-job structure (`triage` + `evaluate-review-outcome`), SHA-pinned `claude-code-action@8c196b2f`, `--paginate` on verdict reads. As shipped in v1.2.0, the verdict reads used `| last` with no temporal filter; v1.2.1 added the HEAD-SHA floor to close the false-green gap described above. Downstream binds get the same gate this repo dogfoods.
- **`claude.yml` cleanup.** Removed the `issues:` trigger (the deep tier fires on PR comments only). Bot-loop guard switched from `contains` to `startsWith` on the `Claude Code is working` filter — `contains` rejected legitimate escalation comments that quoted the phrase later in the body, silently blocking the deep tier from firing on PRs that needed it. Added `allowed_bots: "claude"` to opt routine→deep escalations into the bot-trigger path explicitly. Advisory completion-evaluator step retained but corrected.
- **`--paginate` on both `gh api` verdict reads.** Without `--paginate`, PRs with >30 existing comments would put the verdict comment on a later page; the routine gate would silently fail-red and the deep tier's advisory gate would silently pass when a real 🔴 needed to surface.
- **AI-attribution scanner comment de-self-reference.** The pre-screen scanner's docstring previously reproduced the regex patterns from `ai_pats`, causing the scanner to flag itself on every workflow-file edit. Comment is now structural (points at `ai_pats` below); regexes remain the single source of truth.
- **`jq` constraint documented in `token-efficiency.md`.** Background-shell environments may not have the external `jq` binary (absent on Windows Git Bash, stripped-down containers; present on `ubuntu-latest` runners and most devcontainers). The canonical polling snippet uses `gh`'s built-in `--jq` flag instead, with a `python3 -c` fallback noted.
- **Template placeholder rename: `{{DEFAULT_BRANCH}}` → `{{DEV_BRANCH}}`** (#14). The old name collided with GitHub's UI "default branch" concept — the template meant "the dev integration branch where day-to-day work targets" (`develop` for Gitflow, `main` for trunk-based). `SETUP.md` retains a backwards-compat shim that accepts `developer_branch` / `default_branch` in older manifests with a warning.
- **Configurator form: branch fields simplified** (#14). The previous three-field setup ("Default branch" + "Developer branch" + optional "Production branch" override) collapsed into two clearer fields:
  - **Main branch** (required) — production / release branch. Tagged versions live here. Default `main`.
  - **Dev branch** (Gitflow only) — where day-to-day work targets and PRs base from. Default `develop`. Hidden when Branching model = Trunk-based.

  State variables renamed in `index.html` + `redesign/bind.jsx`: `default_branch` removed, `developer_branch` → `dev_branch`. Manifest schema emits `main_branch` + `dev_branch`.

### Fixed
- **Configurator produced incoherent binds for Gitflow projects** (#14). Bundle 2 (OSS, Gitflow) rules said "branch from develop / PR to develop", but the configurator's `default_branch` field carried the release-branch value and `SETUP.md` substituted `{{DEFAULT_BRANCH}}` from it — resolved skills said "PR to main" while rules said "PR to develop". Fixed by the rename + UI restructure above.
- **Session-start now reads the CONTEXT handoff file** (#9). The template's session-close skill writes `{{PROJECT_NAME_UPPER}}-CONTEXT_*.md` but session-start was ignoring it — the read/write loop was broken on the read side. Gated by `context_refresh_files: true` (OSS bundle default).
- **`index.html` `paths-ignore` toggle blurb wording** (PR #60). Mismatched description corrected; `redesign/bind.jsx` source updated to keep parity with the inlined HTML.
- **`.tokensave/` properly ignored.** Was creating phantom unstaged files in every clean checkout before the `.gitignore` update landed.

### Self-bind
- **Repo now self-bound** (#12). `.claude/skills/{session-start,session-close,find,architecture-graph}/SKILL.md` resolved from `_core/project-template/.claude/skills/` per `bundles/2-multi-dev-oss/bundle.toggles.md` + Discovery-mode resolution for null toggles. `.claude/BIND.md` documents the audit trail. The templates' own project finally dogfoods itself.

### Known follow-ups
- **Routine + deep review workflows installation in this repo** (issue #1). The canonical workflows live at `_core/project-template/.github/workflows/`, but this repo's `.github/workflows/` carries hand-authored variants. A consolidation pass to replace them with the canonical templates rendered against this project's placeholders is roadmap.
- **`/find` skill parametrisation** (issue #10). Currently names tokensave explicitly; should read `tools.code_research.name` from the bound config.
- **`'I want them all'` bundle bypass** (issue #5). Bundle bypass + toggle-conflict detection.
- **Audit/Optimize mode** (issue #3). Third mode for analyzing existing setup.
- **Telemetry Stop hook** (issue #4). Opt-in session metadata capture.
- **Community metrics** (issue #2). Opt-in, anonymised, PR-submitted before/after metrics aggregate.

---

## [v1.1.0] — 2026-05-16

UI redesign. Same configurator contract, new shell. React + Babel via pinned CDN; preserves the no-build-step deploy pattern.

### Added
- **React-based UI shell.** `index.html` now renders via React 18.3.1 + ReactDOM 18.3.1 (UMD, production builds) loaded from `unpkg.com` with `integrity` SHA-384 hashes and `crossorigin="anonymous"`. JSX is transpiled in-browser via `@babel/standalone@7.29.0` (same pinning + SRI). All four CDN scripts are version-pinned and SRI-attested; nothing is fetched at "latest" or unpinned.
- **`redesign/` dev source.** Nine `.jsx` modules (`data`, `tweaks-panel`, `bind`, `compare`, `toggles`, `howbinds`, `receipts`, `about`, `app`) plus a `redesign/index.html` dev shell. Each module is the un-bundled equivalent of a `<script type="text/babel" data-component="…">` block in the production `index.html`. Edit a single module during iteration; the bundled output mirrors the same code path.
- **Module markers.** Each inlined block in `index.html` is preceded by `<!-- ==== redesign/<filename>.jsx ==== -->` and tagged with `data-component="…"`. Grep for either to find any component in the single-file output.
- **Six folios.** I · Bind, II · Compare, III · Toggles, IV · How it binds, V · Receipts, VI · About. Folio V (Receipts) is fully baked from `_data/receipts_analysis.json` — 143 sessions across 36 days, with the four canonical receipts (abandoned-PR retros, largest-single-session, highest-tool-error, worst-day) surfaced.
- **Tweaks panel.** Dev-only sidebar surface exposing radius + accent-hue sliders. Gated behind the host's `tweaks` toggle; never shown to end users by default.
- **`index.legacy.html`.** The v1.0.0 landing page is preserved at the repo root as a fallback. GitHub Pages serves it at `/legacy.html` for use during any v1.1.0 deploy issue.

### Changed
- **JSZip CDN.** Switched from `cdn.jsdelivr.net` (v1.0.0) to `cdnjs.cloudflare.com` (v1.1.0) for JSZip 3.10.1, and added SRI `sha512-…` + `crossorigin="anonymous"` to the lazy-loaded script tag. Both providers are reputable; cdnjs aligned with the chosen SRI hash. v1.0.0 did not ship SRI on the JSZip include — adding it for v1.1.0 closes a small supply-chain hole.
- **Font stack.** Geist (v1.0.0) → Space Grotesk + Inter Tight + JetBrains Mono (v1.1.0). All Google Fonts; preconnect hints in `<head>` for both `fonts.googleapis.com` and `fonts.gstatic.com`.
- **Toggle catalog.** Now 36 toggles in 7 groups (was 32 in 6 groups). The data layer is canonical: any change here flows to every consuming view. Bundle defaults preserved across overlap.

### Fixed
- **Discovery-mode toggle promotion.** v1.0.0 promoted universally-off toggles (e.g. `clean_room_rule`, `dod_devlog_step`) to `ask` in the manifest when Discovery mode was active. The first cut of the redesign hid the toggles UI in Discovery but skipped the manifest-side promotion logic. Restored in `buildManifest()` so the contract the UI promises ("5 universally-off toggles will be promoted to ASK in Discovery") is what actually lands in the downloaded `manifest.json`.

### Versioning policy unchanged
- **Major** (`v1 → v2`): breaking change to the toggle catalog, the bundle keys, the manifest schema, or the SETUP.md contract.
- **Minor** (`v1.0 → v1.1`): new bundle, new toggle, new tool slot, new UI capability — additive, fully backward-compatible. ← **this release**
- **Patch** (`v1.0.0 → v1.0.1`): bug fixes, copy edits, design polish without behavior change.

### Known follow-ups
- **Community metrics (issue #2).** Opt-in, anonymised, PR-submitted before/after metrics aggregate. Tracked for v1.2.
- **`manifest.json` build script.** Still hand-curated; auto-generation from the repo tree is roadmap.
- **`/find` skill parametrisation.** Currently names tokensave explicitly; should read `tools.code_research.name` from the bound config.

---

## [v1.0.0] — 2026-05-15

First public release. Toggle-driven configurator, in-browser bind generator, GitHub Pages deployment, full self-application.

### Added
- **In-browser bind-volume generator.** `index.html` assembles a downloadable zip via JSZip, applies `<!-- TOGGLE:key START/END -->` filtering inline, and produces `claude-code-templates-<bundle>-v1.0.0.zip` directly. Two manifests: **resolved** (manual mode, ready-to-commit) and **source** (discovery mode, full templates + `bundle.json` + `DISCOVERY-PROMPT.md` for Claude to read).
- **Modern app aesthetic.** OKLCH color system with dark default + light mirror, layered shades for depth (5 background tiers), Geist (sans + mono), 0.25rem spacing scale, smooth motion. Theme toggle persists.
- **Responsive layout.** Mobile-first single-column at < 640px; bundle grid 2-up at 560px; sidebar nav at 1024px; bundle grid 4-up at 1180px.
- **Discovery mode.** Pick a bundle as the baseline; Claude infers project metadata + non-default toggle overrides by inspecting the repo. Universally-off toggles (specialised rules like `clean_room_rule`, `dod_devlog_step`) are promoted to *ask* in Discovery so Claude evaluates them against your context. No `git clone` required — the discovery zip ships full source templates.
- **Tool slot abstraction.** Five user-pluggable slots in the configurator: `code_research` (tokensave / ast-grep / Sourcegraph / ctags / Semgrep / none / other), `precommit` (lefthook / husky / pre-commit / simple-git-hooks / none / other), `ci` (GitHub Actions / GitLab CI / CircleCI / Jenkins / Buildkite / none / other), `ai_reviewer` (Claude / CodeRabbit / Bito / Sourcery / Codium / none / other), `issue_tracker` (GitHub / Linear / Jira / Notion / Shortcut / none / other). Each slot has an "Other (specify)" escape hatch. Rule files reference these names at bind time so the templates don't lock users into one vendor.
- **`VERSION` file** at repo root. Discoverable from inside any unzipped bundle.
- **Public-facing `README.md`, `LICENSE` (MIT), `CONTRIBUTING.md`, `CHANGELOG.md`.**
- **GitHub Pages deployment** via `.github/workflows/pages.yml` at `https://starfoxcom.github.io/claude-code-templates/`.
- **Self-application.** Project root `CLAUDE.md` + `.claude/settings.local.json`; references canonical rules in `_core/project-template/.claude/rules/` rather than duplicating them.

### Changed
- **`tokensave-first.py` hook** rewritten to be Python 3.5+ compatible. The previous `pathlib.Path | None` PEP 604 union syntax required Python 3.10+ and silently crashed on Windows machines where `py` resolved to 3.9 — leaving enforcement inert despite the hook firing.
- **Hook install path documented as global-only** in `_core/global-template/hooks/tokensave-first.py` and `_core/project-template/CLAUDE.md`. Project-local installation triggers a tokensave template-inheritance bug that corrupts settings on every Stop event.
- **Modified-toggle indicator** clears when the user cycles a toggle back to its bundle default (previously stuck on after first change).
- **Step order:** the Discovery panel now sits *after* the Bundle picker — the user picks the bundle first (which becomes the discovery baseline), then sees what's skipped.

### Removed
- `START-HERE.html` — superseded by `index.html`.

### Fixed
- The hook traceback that surfaced as `PreToolUse:Bash hook error — Failed with non-blocking status code` in Claude Code sessions on Windows.

### Known follow-ups
- **Tool slot template wiring.** The data layer ships in v1.0.0; full per-tool template variants (e.g. GitLab CI YAMLs, husky configs, Linear issue templates) land iteratively. Claude adapts at bind time using the chosen slot names; for known tools the canonical templates ship; for "other / custom" Claude asks during apply.
- **`manifest.json` build script.** The bundler currently uses a hand-curated fallback manifest. A `tools/build-manifest.py` script that auto-generates `manifest.resolved.json` and `manifest.source.json` from the repo tree on every commit is roadmap.
- **`/find` skill parametrisation.** The skill currently names tokensave explicitly. It should read `tools.code_research.name` from the bound config and use that.
