# BIND.md — self-bind audit trail

This file captures the toggle decisions and placeholder values that produced the `.claude/skills/`, `.claude/rules/`, and `.github/` artifacts currently committed to this repo. It's an audit trail for "what state was this project bound in" — re-binds (issue #3 Audit mode, when shipped) read this to know what they're refreshing.

The templates do not yet ship a `.claude/BIND.md` writer — this is a v1.x improvement worth folding into the bundle workflow.

## Bind metadata

- **Bound at:** 2026-05-17 12:33 (America/Mazatlan); rules, skills and this file re-bound 2026-10-02 14:12 (local clock) from `develop` at `3c7fa31`
- **Bundle:** `2-multi-dev-oss` (open-source library / shared personal project, multi-dev, human review gate, public CONTRIBUTING/PR template)
- **Mode:** Manual hand-bind by Claude during interactive session (no SETUP wizard run — issue #12)
- **Source of templates:** `_core/project-template/` in this same repo (the project dogfoods itself)
- **2026-10-02 re-bind:** `.claude/rules/*.md`, `.claude/skills/*/SKILL.md` and `.claude/scripts/research-adherence.py` were rendered with the engine's own template renderer (`engine/render.js`: toggle blocks, then placeholders, then blank-line folding) using the toggle and placeholder state below, then the tailoring and deviations listed in "Self-bind deviations" were applied by hand. Root `CLAUDE.md`, `.github/` and the guard hooks were not re-bound.

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
| `{{REVIEW_DEEP_MODEL}}` | `claude-fable-5-1` | what `.github/workflows/claude.yml` runs today (the 2026-05 pin was `claude-opus-4-8`) |
| `{{REVIEW_ROUTINE_MODEL}}` | `claude-fable-5-1` | what `.github/workflows/claude-code-review.yml` runs today (the 2026-05 pin was `claude-sonnet-4-6`) |
| `{{REVIEW_DEEP_EFFORT}}` | `low` | the deep tier's `--effort` in `.github/workflows/claude.yml` |
| `{{REVIEW_ROUTINE_EFFORT}}` | `low` | the routine tier's `--effort` in `.github/workflows/claude-code-review.yml` |
| `{{REVIEW_BACKUP_MODEL}}` | `claude-opus-5-5` | the backup reviewer both live workflows fall back to |
| `{{REVIEW_BACKUP_EFFORT}}` | `high` | the backup reviewer's `--effort` in both live workflows |
| `{{TOOLS_CODE_RESEARCH_NAME}}` | `tokensave` | `code_research: tokensave` |
| `{{TOOLS_CODE_RESEARCH_URL}}` | `https://github.com/aovestdipaperino/tokensave` | `engine/model.js` `CODE_RESEARCH_TOOLS.tokensave` |
| `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` | `TOKENSAVE_BYPASS:` | same |
| `{{TOOLS_CODE_RESEARCH_MATCH}}` | `tokensave` | same (tool-name regex in `.claude/scripts/research-adherence.py`) |

## Toggles resolved

User-explicit (3):

| Toggle | Value | Reason |
|---|---|---|
| `code_research` | `tokensave` | User-explicit |
| `context_refresh_files` | `true` | User-explicit |
| `code_research_first` | `true` | User-explicit (re-confirms `code_research`; formerly `tokensave_entry_point`) |

Bundle 2 defaults kept verbatim (22):

`github_actions_routine_review: true`, `github_actions_deep_review: true`, `github_actions_deep_review_auto_fire: true`, `github_actions_paths_ignore_auto_merge: false`, `binary_verdict_rule: true`, `definition_of_done_verification: true`, `lazy_rules_folder: true`, `memory_system: true`, `skill_session_start: true`, `skill_session_close: true`, `permissions_file_template: true`, `contributing_md: true`, `pr_template: true`, `collaboration_rule: true`, `confidentiality_rule: false`, `audit_trail_commits: false`, `billable_handoff_summary: false`, `team_handoff_notes: false`, `branch_protection_loose: false`, `branch_protection_strict: true`, `mandatory_deep_review_before_merge: true`, `dod_devlog_step: false`, `language_specific_rules_scaffold: true`, `clean_room_rule: false`.

Discovery resolutions (4 null-in-bundle, inferred from repo state — the 5th null toggle `code_research_first` was promoted to the User-explicit table above):

| Toggle | Value | Repo evidence |
|---|---|---|
| `codeowners` | `false` | `CONTRIBUTING.md` line 3: "This project is solo-maintained on a best-effort basis." No team to map ownership across. |
| `oncall_awareness` | `false` | Static GitHub Pages project (`index.html` deployed via `pages.yml`). No service-tier on-call rotation concept applies. |
| `architecture_rules_scaffold` | `none` | Single hand-authored `index.html` + nine sibling `redesign/*.jsx` modules. No formal architecture pattern (Clean / Hexagonal / Layered / DDD / etc.) fits the actual shape; over-scaffolding one would be cargo-culting. |
| `visual_test_discipline` | `true` | The page IS the deliverable — `CHANGELOG.md` v1.1.0 cites visual-slice discipline; `_core/project-template/.claude/rules/visual.md` is already referenced from this repo's CLAUDE.md. |

Added at the 2026-10-02 re-bind (toggles and choices the canonical templates gained since 2026-05; neither the table above nor `bundles/2-multi-dev-oss/bundle.toggles.md` lists them, so each was resolved from repo state, with the engine default as the tie-breaker):

| Toggle / choice | Value | Repo evidence |
|---|---|---|
| `attribution_guard` | `true` | `.claude/settings.json` blanks the commit and PR attribution and runs `.claude/hooks/no-ai-attribution.py`; the engine default is also on. Keeps the attribution line in `git.md`. |
| `default_branch_is_dev` | `false` | The GitHub default branch is `main` (`gh repo view --json defaultBranchRef`). `git.md` keeps the "always pass `--base develop`" line and the "workflow changes land on `main` as a hotfix" paragraph. |
| `merge_style` | `merge` | Founder decision 2026-09-29: every PR merges with `--merge` (root `CLAUDE.md` "Git workflow"). |
| `precommit` (tool slot) | `none` | Follows `precommit_hooks_scaffold: false` below. |
| `plainWriting` (ships `.claude/rules/shipped-text.md`) | off | Not in this file or in the bundle; the engine default is off. Not bound. |
| `guard_hooks_repo` | `true` | The guard hooks live in `.claude/hooks/` in this repo. No rule or skill template reads it; recorded for completeness. |

Toggles this file lists that the current canonical rules and skills no longer read: `mandatory_deep_review_before_merge` and `oncall_awareness` (both gone from `collaboration.md`; deep-review gating now lives in `review-tiers.md` under `github_actions_deep_review_auto_fire`), `binary_verdict_rule`, `branch_protection_strict` and `team_handoff_notes`. Their values above are unchanged and still describe the repo.

Bundle 2 now defaults `precommit_hooks_scaffold` to `true`; this repo keeps it `false` (see "Intentional non-artifacts").

## Artifacts produced

| Artifact | Status |
|---|---|
| `.claude/skills/session-start/SKILL.md` | Re-bound 2026-10-02 (`context_refresh_files` block kept; `{{PROJECT_NAME_UPPER}}` and `{{DEV_BRANCH}}` substituted). |
| `.claude/skills/session-close/SKILL.md` | Re-bound 2026-10-02 (`definition_of_done_verification`, `context_refresh_files`, `code_research_first` and `branching_model_gitflow` blocks kept; placeholders substituted). |
| `.claude/skills/find/SKILL.md` | Re-bound 2026-10-02 (`code_research:tokensave` block kept, the `lsp-plugins` / `codegraph` / `serena` / `codebase-memory` / `none` blocks stripped; `code_research_first` fallback block kept). |
| `.claude/skills/architecture-graph/SKILL.md` | Re-bound 2026-10-02 (`code_research:tokensave` blocks kept in the enumerate and diff steps). The engine no longer ships this skill to new binds; this repo keeps its copy because it already had one. |
| `.claude/scripts/research-adherence.py` | New 2026-10-02. The session-close code-research count runs it; it ships whenever `code_research_first` is on. Rendered with the tokensave values. Re-rendered 2026-10-05: the renderer now folds blank lines only in templates with toggle blocks, so the script keeps its double blank lines between functions. |
| `.claude/rules/git.md` | Re-bound 2026-10-02 (`attribution_guard`, `branching_model_gitflow`, `default_branch_is_dev:off` and `merge_style:merge` blocks kept; `branching_model_trunk`, `default_branch_is_dev`, the other `merge_style` values and `precommit_hooks_scaffold` stripped; `{{MAIN_BRANCH}}` → `main`, `{{DEV_BRANCH}}` → `develop`). |
| `.claude/rules/review-tiers.md` | Re-bound 2026-10-02 (`github_actions_deep_review_auto_fire` block kept, `:off` variant stripped; model cells per the placeholder table). |
| `.claude/rules/token-efficiency.md` | Re-bound 2026-10-02 (`{{TOOLS_CODE_RESEARCH_NAME}}` → `tokensave`; the `github_actions_paths_ignore_auto_merge` docs-only fast-path block stripped, since that toggle is off). |
| `.claude/rules/collaboration.md` | Re-bound 2026-10-02 (no toggles left in the canonical file; `{{DEV_BRANCH}}` → `develop`). |
| `.claude/rules/visual.md` | Re-bound 2026-10-02 (no toggles, no placeholders: verbatim copy). |
| `.claude/rules/task-tracking.md` | New 2026-10-02. Canonical core rule with no toggle (the engine ships it to every bind): verbatim copy. |
| `.claude/rules/testing.md` | New 2026-10-02. Canonical core rule with no toggle, scoped by its own `paths:` frontmatter to source files: verbatim copy. |
| `.claude/rules/code-size.md` | New 2026-10-02. Canonical core rule with no toggle, scoped by `paths:` to source files. Tailored: the per-language table keeps only the JavaScript / TypeScript and Python rows (`engine/`, `redesign/`, `tools/`, `.claude/hooks/`), and the "keep the rows for this project's languages" instruction is removed. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Resolved (`audit_trail_commits` block stripped per bundle 2) |
| `.claude/BIND.md` | This file |
| `CLAUDE.md` (root) | Edited to reflect now-local skills + rules |

## Intentional non-artifacts

| Artifact | Why omitted |
|---|---|
| `.claude/rules/clean-room.md` | `clean_room_rule: false` (not a derived-from-prior-art project). |
| `.claude/rules/shipped-text.md` | `plainWriting` off (see the toggle table above). |
| `.claude/rules/confidentiality.md` | `confidentiality_rule: false` (open-source toolkit, no NDA stake). |
| `.claude/rules/architecture/*.md` | `architecture_rules_scaffold: none` (single hand-authored `index.html` + sibling `redesign/*.jsx` modules; no formal architecture pattern fits the actual shape). |
| `CODEOWNERS` | `codeowners: false` (solo-maintained) |
| `~/.claude/hooks/tokensave-first.py` (project copy) | Hook is installed **globally**, not project-local — per CLAUDE.md's note about the tokensave template-inheritance bug that makes per-project installation unsafe. As of the v1.3-unreleased agnostification, the hook is rendered from `_core/global-template/hooks/code-research-first.py.template` + `code-research-profiles.json` → tokensave profile; the rendered filename remains `tokensave-first.py` for this bind because `tools.code_research = "tokensave"`. |
| Devlog scaffolding (`devlog/posts/0000-template/`) | `dod_devlog_step: false` (no devlog tradition for this project — release notes live in `CHANGELOG.md` and GitHub Releases). |
| `.claude/rules/git.md` Pre-commit hooks section + a repo-root precommit config | `precommit_hooks_scaffold: false` — new toggle ([Unreleased]); this repo resolves it OFF (overriding the bundle-2 ON default). Re-decided 2026-10-03: the repo now has engine, Python-twin, hook and mod tests, but the required `Engine and hook tests` check already runs them on every PR, and a local gate would add about 40 seconds to every commit, docs-only ones included. |

## Self-bind deviations

Places where this repo's bound text differs on purpose from what the renderer produces from the canonical templates. Re-apply them after every re-bind until the canonical text covers them.

| File | Deviation | Reason |
|---|---|---|
| `.claude/rules/collaboration.md` | "Who reviews" replaces "ask the owner of the touched directory" and "every PR needs an approval from someone other than its author" with: zero required approvals, the AI routine verdict (plus the deep verdict when raised) is the gate, the maintainer merges on 🟢, and an external contributor's PR also needs the maintainer's read of the whole diff. | Maintainer decision 2026-10-02. This is a solo-maintainer repo (`codeowners: false`); its branch protection requires zero approvals because an author cannot approve their own PR, so the canonical approval line could never be met. Root `CLAUDE.md` "Review discipline" states the same external-contributor rule. |
| `.claude/rules/token-efficiency.md` | "Watching CI" opens with the ci-watch mod as the default watcher; the canonical Monitor-tool watcher and the background `gh pr checks` loop stay as the fallbacks, in that order. | Maintainer decision 2026-10-02. The maintainer's global setup loads a `ci-watch` mod that watches PR checks after a push or PR creation and wakes the session once they settle; a second watcher on the same PR would duplicate it. Root `CLAUDE.md`'s CI bullets say the same. |
| `.claude/skills/session-close/SKILL.md` | The "only the hand-off file changed" row points at the docs-only note in `review-tiers.md` instead of "the docs-only path in `token-efficiency.md`". | That path sits inside the `github_actions_paths_ignore_auto_merge` block, which this bind strips (the toggle is off), so the canonical pointer would dangle. |
| `.claude/skills/session-close/SKILL.md` | The timestamp line accepts a `[session-facts]` or `[time]` line from a hook. | Approved audit fix 2026-10-02: the maintainer's current time hook writes `[session-facts]`. |
| `.claude/skills/architecture-graph/SKILL.md` | The first diagram lands through a PR instead of "no PR, just land it". | Approved audit fix 2026-10-02: `develop` and `main` accept changes only through PRs. |

## Re-bind procedure (until Audit mode lands)

When toggles change or templates evolve in `_core/`:

1. Open issue describing the re-bind intent.
2. Branch `chore/rebind-<reason>` off `develop`.
3. Re-resolve any affected `.claude/skills/*.md`, `.claude/rules/*.md`, `.claude/scripts/`, `.github/PULL_REQUEST_TEMPLATE.md`, this file's toggle table, and CLAUDE.md from the latest `_core/project-template/` sources. `engine/render.js` resolves one template from the flags, choices and values recorded above; then re-apply "Self-bind deviations".
4. Atomic commits per artifact category.
5. Standard PR + merge to `develop`.

Once Audit mode (issue #3, tracked as a v1.x follow-up — has not shipped as of v1.2.1) lands, that flow replaces this manual procedure.
