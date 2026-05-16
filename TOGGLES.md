# Feature toggles — master catalog

Every bundle ships with the **same file inventory**. Bundles differ only in which features are ON by default in their `bundle.toggles.md`.

During SETUP, Claude:
1. Reads the bundle's `bundle.toggles.md` (defaults for THAT bundle)
2. Walks the user through each toggle during the interview
3. Applies the final state by:
   - **OFF + file-scoped:** deleting the listed files
   - **OFF + section-scoped:** stripping content between matching `<!-- TOGGLE:NAME START -->` and `<!-- TOGGLE:NAME END -->` markers in the listed files
   - **ON:** removing only the marker lines (or leaving them; markers are invisible in rendered Markdown)

This means you can take **any bundle** and shape it to your project's needs by overriding toggle defaults — you don't have to pick the "exact right bundle" up front.

---

## Toggle catalog

Legend: ✅ on by default · ❌ off by default · ⚙️ asked during interview (depends on context)

| Toggle | What it controls | Solo | OSS | Cli-Solo | Cli-Team |
|---|---|---|---|---|---|
| `github_actions_routine_review` | `.github/workflows/claude-code-review.yml` | ✅ | ✅ | ⚙️ | ✅ |
| `github_actions_deep_review` | `.github/workflows/claude.yml` | ✅ | ✅ | ⚙️ | ✅ |
| `github_actions_deep_review_auto_fire` | Section in `review-tiers.md` + workflow Step 2.5 | ❌ | ✅ | ❌ | ✅ |
| `github_actions_paths_ignore_auto_merge` | Section in `token-efficiency.md` + `git.md` | ✅ | ❌ | ❌ | ❌ |
| `binary_verdict_rule` | Section in `review-tiers.md` + `git.md` | ✅ | ✅ | ✅ | ✅ |
| `definition_of_done_verification` | Section in `CLAUDE.md` + `session-close.md` skill | ✅ | ✅ | ✅ | ✅ |
| `context_refresh_files` | Section in `CLAUDE.md` + `session-close.md` skill | ✅ | ✅ | ✅ | ✅ |
| `tokensave_entry_point` | Section in `CLAUDE.md` + read-before-writing rule | ⚙️ | ⚙️ | ⚙️ | ⚙️ |
| `lazy_rules_folder` | `docs/lazy/` directory + section in `CLAUDE.md` | ✅ | ✅ | ✅ | ✅ |
| `memory_system` | `global-template/memory-template/` + section in `CLAUDE.md` | ✅ | ✅ | ✅ | ✅ |
| `skill_session_start` | `.claude/skills/session-start/SKILL.md` | ✅ | ✅ | ✅ | ✅ |
| `skill_session_close` | `.claude/skills/session-close/SKILL.md` | ✅ | ✅ | ✅ | ✅ |
| `permissions_file_template` | `.claude/settings.local.json.template` | ✅ | ✅ | ✅ | ✅ |
| `contributing_md` | `CONTRIBUTING.md` | ❌ | ✅ | ❌ | ✅ |
| `pr_template` | `.github/PULL_REQUEST_TEMPLATE.md` | ❌ | ✅ | ❌ | ✅ |
| `codeowners` | `.github/CODEOWNERS` | ❌ | ⚙️ | ❌ | ✅ |
| `collaboration_rule` | `.claude/rules/collaboration.md` + section in `CLAUDE.md` | ❌ | ✅ | ❌ | ✅ |
| `confidentiality_rule` | `.claude/rules/confidentiality.md` + section in `CLAUDE.md` | ❌ | ❌ | ✅ | ✅ |
| `audit_trail_commits` | Section in `git.md` + `session-close.md` | ❌ | ❌ | ✅ | ✅ |
| `billable_handoff_summary` | Section in `session-close.md` | ❌ | ❌ | ✅ | ❌ |
| `team_handoff_notes` | Section in `session-start.md` + `session-close.md` | ❌ | ❌ | ❌ | ✅ |
| `oncall_awareness` | Section in `session-start.md` + collaboration rule | ❌ | ❌ | ❌ | ⚙️ |
| `branch_protection_loose` | Section in `git.md` (single reviewer = self) | ✅ | ❌ | ⚙️ | ❌ |
| `branch_protection_strict` | Section in `git.md` (deep review required) | ❌ | ✅ | ⚙️ | ✅ |
| `mandatory_deep_review_before_merge` | Section in `git.md` + branch protection guide | ❌ | ✅ (architectural) | ❌ | ✅ |
| `dod_devlog_step` | Section in `session-close.md` (devlog drafts on milestone close) | ❌ | ❌ | ❌ | ❌ |
| `language_specific_rules_scaffold` | `.claude/rules/code-style.md` scaffolded from codebase audit | ✅ | ✅ | ✅ | ✅ |
| `architecture_rules_scaffold` | `.claude/rules/architecture.md` scaffolded from codebase audit | ⚙️ | ⚙️ | ⚙️ | ⚙️ |
| `clean_room_rule` | `.claude/rules/clean-room.md` (spiritual-successor / derived-from-prior-art projects) | ❌ | ❌ | ❌ | ❌ |
| `visual_test_discipline` | `.claude/rules/visual.md` (UI/visual projects) | ⚙️ | ⚙️ | ⚙️ | ⚙️ |

---

## Toggle naming convention

`<category>_<feature>` in snake_case. Categories used:

- `github_actions_*` — CI workflows
- `skill_*` — skills under `.claude/skills/`
- `branch_protection_*` — branch protection posture
- Free-form for cross-cutting concerns (binary_verdict_rule, memory_system, etc.)

---

## How section markers work

Sections that vary between bundles are wrapped in HTML comments invisible in rendered Markdown:

```markdown
Plain content always present.

<!-- TOGGLE:github_actions_paths_ignore_auto_merge START -->
## Auto-merge on paths-ignore PRs

PRs whose entire diff falls under the workflows' `paths-ignore` set...
<!-- TOGGLE:github_actions_paths_ignore_auto_merge END -->

More content always present.
```

When the toggle is OFF, Claude strips everything between START and END (including the marker lines). When ON, Claude removes only the marker lines so the rendered Markdown is clean.

### Inverse markers (`:off`)

Some sections should appear ONLY when a toggle is OFF — e.g., text explaining what the user has to do manually because the automated version isn't enabled. Use the `:off` suffix:

```markdown
<!-- TOGGLE:github_actions_deep_review_auto_fire START -->
**Auto-escalation enabled** — the workflow auto-fires the deep review on trigger-list matches.
<!-- TOGGLE:github_actions_deep_review_auto_fire END -->

<!-- TOGGLE:github_actions_deep_review_auto_fire:off START -->
**Auto-escalation disabled** — fire manually with `@claude review this PR`.
<!-- TOGGLE:github_actions_deep_review_auto_fire:off END -->
```

Exactly one of the two blocks remains after Claude applies the toggles. Use `:off` markers sparingly — only when there's genuinely different content for the OFF state, not just absence.

### File-scoped toggles

Some files are entirely toggle-controlled (e.g., `CONTRIBUTING.md` only exists if `contributing_md` is ON). Those are deleted wholesale on OFF. The toggle catalog's "What it controls" column distinguishes file-scoped from section-scoped toggles.

---

## Asked-during-interview (⚙️) toggles

A few toggles default to "ask the user" because they depend on context Claude doesn't know until the interview:

- `tokensave_entry_point` — depends on whether tokensave is installed (`tokensave_status` check)
- `architecture_rules_scaffold` — depends on whether the codebase has clear layer boundaries worth documenting
- `visual_test_discipline` — depends on whether the project has a UI / visual surface
- `codeowners` — depends on team size and structure
- `oncall_awareness` — depends on whether the team has on-call rotations
- `github_actions_*` (client bundles) — depends on whether the client allows Claude Code-driven CI
- `branch_protection_*` (client) — depends on the client's existing CI/CD posture

These are presented as direct questions in the SETUP interview.

---

## Adding a new toggle (future you)

When you discover a pattern that varies between projects:

1. Add a row to this catalog with the file/section it controls and per-bundle defaults.
2. Wrap the section(s) in `<!-- TOGGLE:NAME START/END -->` markers in the affected files.
3. Add the toggle to each bundle's `bundle.toggles.md` with the bundle's default.
4. (If needed) Update SETUP.md's interview script to ask about it.

The catalog grows monotonically — toggles get added, rarely removed. Removing a toggle means deciding the feature is always-on or always-off (rare).
