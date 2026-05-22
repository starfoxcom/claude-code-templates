# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [SemVer](https://semver.org/) from v1.0.0 onward.

Earlier conversational `v17` and `v18` mentions never shipped as standalone artifacts — they're consolidated into the v1.0.0 release.

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
