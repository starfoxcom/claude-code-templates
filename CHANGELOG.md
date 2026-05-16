# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [SemVer](https://semver.org/) from v1.0.0 onward.

Earlier conversational `v17` and `v18` mentions never shipped as standalone artifacts — they're consolidated into the v1.0.0 release.

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

Nothing yet. Open an issue or PR — see [CONTRIBUTING.md](CONTRIBUTING.md).
