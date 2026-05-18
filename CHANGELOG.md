# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [SemVer](https://semver.org/) from v1.0.0 onward.

Earlier conversational `v17` and `v18` mentions never shipped as standalone artifacts — they're consolidated into the v1.0.0 release.

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

## [Unreleased]

_Nothing yet._

---

## [v1.2.0] — 2026-05-18

End-to-end review-gate hardening. Workflows installed on this repo, refactored to a single combined gate, then propagated to the canonical templates. Self-bind landed. Configurator form + placeholder semantics aligned with the Gitflow / trunk distinction.

### Added
- **Routine + deep review workflows installed at `.github/workflows/`** (#17). The templates project now self-hosts the same gate it ships. `Evaluate review outcome` is the single required status check on `develop-protection` + `main-protection`.
- **Combined-gate model in canonical workflow templates** (#26). `_core/project-template/.github/workflows/claude-code-review.yml.template` now owns the gate end-to-end: folds in the deep tier via `issue_comment` re-evaluation when the `needs-deep-review` label is applied, extracts the verdict from the last non-empty line, branches on Gitflow vs trunk via `<!-- TOGGLE:branching_model_gitflow|trunk -->` blocks, declares `id-token: write` for OIDC. `claude.yml.template` strips the redundant `evaluate-deep-verdict` job (verdict folds into routine gate) and adds `id-token: write`. Both template headers document the workflow-PR admin-bypass limitation.
- **Workflow post-bind prerequisites** documented in template header comments (#18). Set `CLAUDE_CODE_OAUTH_TOKEN` secret + land the workflow on the GitHub default branch first if PRs target a non-default branch (the action won't fire on files installed only on a non-default branch).
- **This repo is now self-bound** (#12, #13). `.claude/skills/{session-start,session-close,find,architecture-graph}/SKILL.md` resolved from `_core/project-template/.claude/skills/` per `bundles/2-multi-dev-oss/bundle.toggles.md` + Discovery for null toggles. `.claude/BIND.md` documents the audit trail. The templates' own project finally dogfoods itself.

### Changed
- **Template placeholder rename: `{{DEFAULT_BRANCH}}` → `{{DEV_BRANCH}}`** (#14). The old name collided with GitHub's UI "default branch" setting concept — template uses it to mean "the dev integration branch where day-to-day work targets" (`develop` for Gitflow, `main` for trunk-based), which is the opposite of what GitHub's UI labels "default". Renamed for clarity. SETUP.md retains a backwards-compat shim that accepts `developer_branch` / `default_branch` in older manifests and warns.
- **Configurator form: branch fields simplified** (#14). The previous three-field setup ("Default branch" + "Developer branch" + optional "Production branch" override) collapsed into two clearer fields:
  - **Main branch** (required) — production / release branch. Tagged versions live here. Default `main`.
  - **Dev branch** (Gitflow only) — where day-to-day work targets and PRs base from. Default `develop`. Hidden when Branching model = Trunk-based (which mirrors the main branch).

  State variables renamed in `index.html` + `redesign/bind.jsx`: `default_branch` removed, `developer_branch` → `dev_branch`. Manifest schema emits `main_branch` + `dev_branch`.
- **Workflow refactor: paths-ignore dropped, single gate model** (#21, #22). The earlier design had two required checks (`Evaluate review outcome` + `Evaluate deep-tier verdict`) and a `paths-ignore` set that caused docs / rules / no-comment PRs to never report the required check — admin-bypass was the only path. The refactor folds both tiers into one `Evaluate review outcome` check that resolves cleanly on every PR. The deep tier is gated by the `needs-deep-review` label and re-evaluates the routine gate via `issue_comment`. Rulesets for `develop-protection` and `main-protection` should list only `Evaluate review outcome` going forward.
- **Verdict extraction: last non-empty line only** (#23, #24). Earlier code grepped the whole comment body for 🔴 / 🟢, which false-fired when a 🟢 review recapped a prior 🔴 finding. The gate now reads only the last non-empty line per the prompt's "ending with EXACTLY one of" rule, and explicitly asserts 🟢 — closing a robustness regression in an earlier patch.
- **`github_actions_paths_ignore_auto_merge` toggle semantics** (#28). Toggle ID kept stable for backward-compatibility but the underlying mechanism shifted from "diff under `paths-ignore` → no runs" to "diff classified non-reviewable by triage → gate auto-passes". 90s grace + auto-merge sequence preserved. Configurator blurb in `index.html` (#27) updated to drop the now-incorrect "CI-YAML-only" claim — workflow-touching PRs now fail App-token validation rather than auto-merging.
- **CI polling cadence discipline made binding** (#28). Both the 90s grace (fast-path) and the 7-minute loop (normal review) must run with `run_in_background: true` per the canonical rules and this repo's CLAUDE.md. Foreground sleeps freeze the agent unnecessarily; background polling lets the agent stack a cascade or open the next PR while CI runs.

### Fixed
- **`id-token: write` permission** added to both workflows (#21). `anthropics/claude-code-action@beta` requires an OIDC-exchanged token; without the permission the action errors at setup before posting any review.
- **Configurator produced incoherent binds for Gitflow projects** (#14). Bundle 2 (OSS, Gitflow) bundles rules that say "branch from develop / PR to develop", but the configurator's `default_branch` field carried the release-branch value, and SETUP.md substituted `{{DEFAULT_BRANCH}}` from it — so resolved skills would have said "PR to main" even though the rules said "PR to develop". Fixed by the rename + UI restructure above.
- **Session-start now reads the CONTEXT handoff file** (#9). The template's session-close skill writes `{{PROJECT_NAME_UPPER}}-CONTEXT_*.md`, but session-start ignored it — the read/write loop was broken on the read side. Gated by `context_refresh_files: true` (OSS bundle default).
- **Auto-merge toggle blurb factual accuracy** in `index.html` (#27). The "CI-YAML-only PRs auto-merge" claim was true under v1.1.0's paths-ignore design but stopped being true after the workflow refactor.

### Documented
- **Workflow-touching PR admin-bypass limitation** (#25). The Anthropic Claude Code GitHub App's anti-tamper check rejects the OIDC token exchange when the head branch's workflow file differs from the default branch's, so PRs editing `.github/workflows/claude*.yml` cannot get a routine review verdict pre-merge. `gh pr merge --admin` is the only path. Documented in canonical rules + workflow template header comments + this repo's CLAUDE.md.

### Known follow-ups
- **Community metrics (issue #2).** Opt-in, anonymised, PR-submitted before/after metrics aggregate. Promised for v1.2 in the v1.1.0 release notes; reslipped to v1.3.0 in this release because the workflow refactor took priority.
- **`manifest.json` build script.** Still hand-curated; auto-generation from the repo tree is roadmap.
- **`/find` skill parametrisation.** Currently names tokensave explicitly; should read `tools.code_research.name` from the bound config.
- **Triage regex doesn't include `.md` or `.template`** in the canonical workflow. PRs touching only those files auto-pass without Sonnet input. Worth revisiting if a downstream incident shows that's too permissive.
