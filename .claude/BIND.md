# BIND.md — self-bind audit trail

This file captures the toggle decisions and placeholder values that produced the `.claude/skills/` and `.github/` artifacts currently committed to this repo. It's an audit trail for "what state was this project bound in" — re-binds (issue #3 Audit mode, when shipped) read this to know what they're refreshing.

The templates do not yet ship a `.claude/BIND.md` writer — this is a v1.x improvement worth folding into the bundle workflow.

## Bind metadata

- **Bound at:** 2026-05-17 12:33 (America/Mazatlan)
- **Bundle:** `2-multi-dev-oss` (open-source library / shared personal project, multi-dev, human review gate, public CONTRIBUTING/PR template)
- **Mode:** Manual hand-bind by Claude during interactive session (no SETUP wizard run — issue #12)
- **Source of templates:** `_core/project-template/` in this same repo (the project dogfoods itself)

## Placeholders resolved

| Placeholder | Value | Source |
|---|---|---|
| `{{PROJECT_NAME}}` | `claude-code-templates` | repo name |
| `{{PROJECT_NAME_UPPER}}` | `CLAUDE-CODE-TEMPLATES` | uppercased + hyphen-preserved |
| `{{ONE_LINE_DESCRIPTION}}` | "Open-source toolkit for setting up Claude Code in any project — four opinionated bundles and a configurable web UI hosted on GitHub Pages." | derived from README/CLAUDE.md |
| `{{LANGUAGE_AND_FRAMEWORK}}` | `HTML + CSS + React via CDN, Babel-in-browser, no build step` | from CHANGELOG v1.1.0 + CLAUDE.md "Project conventions" |
| `{{REPO_URL}}` | `https://github.com/starfoxcom/claude-code-templates` | `gh repo view` |
| `{{MAIN_BRANCH}}` | `main` | Gitflow production branch (tagged releases only) |
| `{{DEV_BRANCH}}` | `develop` | Gitflow dev integration branch — where day-to-day work targets and PRs base from. Renamed from `{{DEFAULT_BRANCH}}` in #14 because the old name collided with GitHub's UI "default branch" setting (which is `main` for this repo). |
| `{{GITFLOW_OR_TRUNK}}` | `Gitflow` | from CLAUDE.md "Git workflow" + CONTRIBUTING.md "Branch from develop" |
| `{{CONVERSATION_LANGUAGE}}` | English | from CLAUDE.md "Project conventions" |
| `{{CODE_LANGUAGE}}` | English | from CLAUDE.md "Project conventions" |
| `{{TIMEZONE}}` | `America/Mazatlan` | maintainer locale (Sinaloa, MST no-DST) |

## Toggles resolved

User-explicit (3):

| Toggle | Value | Reason |
|---|---|---|
| `code_research` | `tokensave` | User-explicit |
| `context_refresh_files` | `true` | User-explicit |
| `tokensave_entry_point` | `true` | User-explicit (re-confirms `code_research`) |

Bundle 2 defaults kept verbatim (22):

`github_actions_routine_review: true`, `github_actions_deep_review: true`, `github_actions_deep_review_auto_fire: true`, `github_actions_paths_ignore_auto_merge: false`, `binary_verdict_rule: true`, `definition_of_done_verification: true`, `lazy_rules_folder: true`, `memory_system: true`, `skill_session_start: true`, `skill_session_close: true`, `permissions_file_template: true`, `contributing_md: true`, `pr_template: true`, `collaboration_rule: true`, `confidentiality_rule: false`, `audit_trail_commits: false`, `billable_handoff_summary: false`, `team_handoff_notes: false`, `branch_protection_loose: false`, `branch_protection_strict: true`, `mandatory_deep_review_before_merge: true`, `dod_devlog_step: false`, `language_specific_rules_scaffold: true`, `clean_room_rule: false`.

Discovery resolutions (4 null-in-bundle, inferred from repo state — the 5th null toggle `tokensave_entry_point` was promoted to the User-explicit table above):

| Toggle | Value | Repo evidence |
|---|---|---|
| `codeowners` | `false` | `CONTRIBUTING.md` line 3: "This project is solo-maintained on a best-effort basis." No team to map ownership across. |
| `oncall_awareness` | `false` | Static GitHub Pages project (`index.html` deployed via `pages.yml`). No service-tier on-call rotation concept applies. |
| `architecture_rules_scaffold` | `none` | Single hand-authored `index.html` + nine sibling `redesign/*.jsx` modules. No formal architecture pattern (Clean / Hexagonal / Layered / DDD / etc.) fits the actual shape; over-scaffolding one would be cargo-culting. |
| `visual_test_discipline` | `true` | The page IS the deliverable — `CHANGELOG.md` v1.1.0 cites visual-slice discipline; `_core/project-template/.claude/rules/visual.md` is already referenced from this repo's CLAUDE.md. |

## Artifacts produced

| Artifact | Status |
|---|---|
| `.claude/skills/session-start/SKILL.md` | Resolved (Step 1 reads CONTEXT file, placeholders substituted, renumbered) |
| `.claude/skills/session-close/SKILL.md` | Resolved (DoD + context + tokensave-adherence kept, devlog step stripped, placeholders substituted) |
| `.claude/skills/find/SKILL.md` | Resolved (per-tool blocks for tokensave / ast-grep / sourcegraph / ctags / semgrep / none / custom; this bind resolves to the tokensave block, all others stripped). Issue #10 closed by the v1.3-unreleased code_research agnostification. |
| `.claude/skills/architecture-graph/SKILL.md` | Resolved (per-tool blocks for the enumerate + diff-coupling steps; this bind resolves to the tokensave commands). |
| `.github/PULL_REQUEST_TEMPLATE.md` | Resolved (`audit_trail_commits` block stripped per bundle 2) |
| `.claude/BIND.md` | This file |
| `CLAUDE.md` (root) | Edited to reflect now-local skills |

## Intentional non-artifacts

| Artifact | Why omitted |
|---|---|
| `.claude/rules/*` | CLAUDE.md's "What's intentionally NOT here" deliberately keeps rules pointing at `_core/project-template/.claude/rules/`. Rules are prose — duplicating them risks drift between source-of-truth and bound copies. The repo IS the templates; keeping rules canonical at `_core/` is correct here. |
| `CODEOWNERS` | `codeowners: false` (solo-maintained) |
| `~/.claude/hooks/tokensave-first.py` (project copy) | Hook is installed **globally**, not project-local — per CLAUDE.md's note about the tokensave template-inheritance bug that makes per-project installation unsafe. As of the v1.3-unreleased agnostification, the hook is rendered from `_core/global-template/hooks/code-research-first.py.template` + `code-research-profiles.json` → tokensave profile; the rendered filename remains `tokensave-first.py` for this bind because `tools.code_research = "tokensave"`. |
| Devlog scaffolding (`devlog/posts/0000-template/`) | `dod_devlog_step: false` (no devlog tradition for this project — release notes live in `CHANGELOG.md` and GitHub Releases). |

## Re-bind procedure (until Audit mode lands)

When toggles change or templates evolve in `_core/`:

1. Open issue describing the re-bind intent.
2. Branch `chore/rebind-<reason>` off `develop`.
3. Re-resolve any affected `.claude/skills/*.md`, `.github/PULL_REQUEST_TEMPLATE.md`, this file's toggle table, and CLAUDE.md from the latest `_core/project-template/` sources.
4. Atomic commits per artifact category.
5. Standard PR + merge to `develop`.

Once Audit mode (issue #3, tracked as a v1.x follow-up — has not shipped as of v1.2.1) lands, that flow replaces this manual procedure.
