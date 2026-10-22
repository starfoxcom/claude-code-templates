# Review guide

The project's own part of the review prompt. Both review tiers read this file from the PR's base branch, so a PR cannot change the guide its own review follows, and every change to it gets a review.

## About this project

**claude-code-templates** is the open-source toolkit that ships opinionated Claude Code bundles. The configurator and the canonical templates here become the binds every downstream user installs verbatim, so the review surface is load-bearing in a way ordinary OSS isn't.

## Project invariants to verify (in priority order)

1. **Canonical template integrity**: anything in `_core/project-template/**` lands verbatim in every downstream bind. Toggle markers (`<!-- TOGGLE:name START/END -->`) must be balanced; placeholders (`{{MAIN_BRANCH}}`, `{{DEV_BRANCH}}`, `{{PROJECT_NAME}}`, etc.) must be the canonical names that SETUP.md resolves. A missing END marker silently swallows downstream content.
2. **Workflow template parity**: `_core/project-template/.github/workflows/*.template` should behave like this repo's live workflows after substitution. Drift between live and canonical means downstream binds get a different gate than this repo dogfoods.
3. **Hook safety**: `_core/project-template/.claude/hooks/**` runs on every user's machine. Any Bash / shell / Python edit there must be cross-platform (Linux/macOS/Windows-Git-Bash), POSIX-portable, and never assume a specific PATH or interpreter.
4. **Configurator (`index.html` + `redesign/*.jsx`)**: JSX source and inlined production HTML are kept manually in sync. A change to `redesign/bind.jsx` that doesn't land in `index.html` ships a broken configurator. Toggle catalog edits must update both the data layer and the manifest emission.
5. **Bundle defaults (`bundles/<n>/bundle.toggles.md`)**: each bundle's per-toggle default must be defensible. A toggle that flips ON for OSS but OFF for client-team needs a documented reason somewhere (CLAUDE.md, TOGGLES.md, or bundle.toggles.md itself).
6. **Versioning policy**: major/minor/patch matches the rules in `CHANGELOG.md`. New bundle / new toggle / new tool slot = minor. Bug fix / copy edit = patch. Breaking schema change = major.
7. **No AI-attribution markers**: per `_core/project-template/.claude/rules/git.md`, never `Co-Authored-By: Claude`, never "Generated with Claude Code" footers, never claude.com links in PR bodies or commit messages.

## Also escalate when the diff includes

The trigger paths in `.github/review-gate.yml` (`escalate.paths`: `_core/`, `redesign/`, `index.html`) escalate on their own. Mark these for escalation too:

- `bundles/<n>/bundle.toggles.md` defaults changes
- SETUP.md contract changes
- `_core/project-template/.github/workflows/*.template` (canonical CI)
