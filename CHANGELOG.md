# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project loosely tracks ascending integer editions (`v17 → v18 → v19 …`) rather than SemVer. A breaking change to the toggle / bundle / manifest surface bumps the integer; everything else is implicit minor.

## [v18] — 2026-05-15

First file-tracked release. Earlier `v17` references existed only as conversational mentions and never shipped a versioned artifact — `v18` is the canonical first edition.

### Added
- **In-browser bind-volume generator.** `index.html` now assembles a downloadable zip via JSZip, applies `<!-- TOGGLE:key START/END -->` filtering inline, and produces `claude-code-templates-<bundle>-v18.zip` directly. The previous paste-config-to-Claude flow remains as a secondary path.
- **Editorial × technical-journal redesign** of the landing page. Fraunces (variable serif) + JetBrains Mono. Cream/ink/oxidized-red palette with optional night edition (`☾`/`☀` toggle, persists). Six folios laid out as a print periodical; no dashboard cards.
- **`VERSION` file** at repo root. The version is now discoverable from inside any unzipped bundle.
- **Public-facing `README.md`, `LICENSE` (MIT), `CONTRIBUTING.md`, `CHANGELOG.md`.** Replaces the prior internal-only README.
- **GitHub Pages deployment** via `.github/workflows/pages.yml`. The landing page is now hosted at `https://starfoxcom.github.io/claude-code-templates/`.

### Changed
- **`tokensave-first.py` hook** rewritten to be Python 3.5+ compatible. The previous `pathlib.Path | None` PEP 604 union syntax required Python 3.10+ and silently crashed on Windows machines where `py` resolved to 3.9 — leaving enforcement inert despite the hook firing.
- **Hook install path documented as global-only** in `_core/global-template/hooks/tokensave-first.py` and `_core/project-template/CLAUDE.md`. Project-local installation triggers a tokensave template-inheritance bug that corrupts settings on every Stop event.

### Removed
- `START-HERE.html` — superseded by `index.html`.

### Fixed
- The hook traceback that surfaced as `PreToolUse:Bash hook error — Failed with non-blocking status code` in Claude Code sessions on Windows.

## [Unreleased]

Nothing yet. Open an issue or PR — see [CONTRIBUTING.md](CONTRIBUTING.md).
