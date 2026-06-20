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
| `code_research_first` | Sections in `CLAUDE.md`, `find/SKILL.md`, `session-close/SKILL.md` + global hook install per `tools.code_research` (see SETUP.md § Phase 7a). Controls "install the code-research-first hook for whichever tool is at `tools.code_research`." The legacy name `tokensave_entry_point` (from the tokensave-only era) is still accepted as a backward-compat alias — see SETUP.md § Phase 1 alias resolution. | ⚙️ | ⚙️ | ⚙️ | ⚙️ |
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
| `precommit_hooks_scaffold` | Pre-commit hook config for `tools.precommit` (lefthook / husky / pre-commit / simple-git-hooks) with lint/typecheck/commit-msg/test hooks | ❌ | ✅ | ❌ | ✅ |
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

### Per-value markers for tool slots (`:<value>`)

The five **tool slots** in the configurator (`code_research`, `precommit`, `ci`, `ai_reviewer`, `issue_tracker`) are single-select, not boolean. Their picks live in the manifest under `tools.<slot>` (e.g., `tools.code_research: "tokensave"`). Files that need per-tool prose use the same marker pattern with the chosen value as the suffix:

```markdown
<!-- TOGGLE:code_research:tokensave START -->
Use `tokensave_search <name>` for symbol-by-name; `tokensave_context <query>` for fuzzy exploration.
<!-- TOGGLE:code_research:tokensave END -->

<!-- TOGGLE:code_research:ast-grep START -->
Use `ast-grep run --pattern '<pattern>' --lang <lang>` for structural search.
<!-- TOGGLE:code_research:ast-grep END -->

<!-- TOGGLE:code_research:sourcegraph START -->
Use `src search 'r:<repo> <query>'` against the configured Sourcegraph instance.
<!-- TOGGLE:code_research:sourcegraph END -->

<!-- TOGGLE:code_research:ctags START -->
Generate `tags` with `ctags -R -f tags .` once per session; look up symbols with `readtags -t tags -e -p '<prefix>'` (Universal Ctags) or `grep -E '^<name>\b' tags` (any ctags).
<!-- TOGGLE:code_research:ctags END -->

<!-- TOGGLE:code_research:semgrep START -->
Use `semgrep --pattern '<pattern>' --lang <lang>` for AST-aware search.
<!-- TOGGLE:code_research:semgrep END -->

<!-- TOGGLE:code_research:none START -->
No code-research indexer is configured for this project. Use `Grep`, `Glob`, and `Read` directly; the `/find` skill documents the canonical sequence.
<!-- TOGGLE:code_research:none END -->

<!-- TOGGLE:code_research:custom START -->
Use `{{TOOLS_CODE_RESEARCH_NAME}}` per its own documentation ({{TOOLS_CODE_RESEARCH_URL}}). Substitute the appropriate commands into the `/find` skill body.
<!-- TOGGLE:code_research:custom END -->
```

**Resolution rule:** when binding, Claude keeps the block whose `:<value>` matches `tools.<slot>` (with markers stripped) and **removes all other `:<value>` blocks for the same slot entirely** (content + markers). The "Other (specify)" UI choice resolves to `:custom`; the placeholders `{{TOOLS_<SLOT>_NAME}}` and `{{TOOLS_<SLOT>_URL}}` substitute the user-supplied tool name and homepage URL.

Tool-slot per-value markers and the boolean `:off` markers share the same family of syntax — the binder logic that handles one handles the other, parameterized by what to match against.

Placeholders associated with tool slots (substituted in Phase 3 of SETUP.md):

| Placeholder | Substituted with |
|---|---|
| `{{TOOLS_CODE_RESEARCH_NAME}}` | `tools.code_research` (for known options: the canonical name; for "Other": `otherTools.code_research` user-supplied name) |
| `{{TOOLS_CODE_RESEARCH_URL}}` | the tool's homepage URL (from the catalog or `otherToolUrls.code_research`) |
| `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` | the bypass marker string from `_core/global-template/hooks/code-research-profiles.json` (e.g., `TOKENSAVE_BYPASS:`, `AST_GREP_BYPASS:`); computed for `custom` from the user-supplied name |
| `{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}` | lowercase + kebab form of the code-research tool name; for built-in profiles equals the JSON key (`tokensave`, `ast-grep`, `sourcegraph`, `ctags`, `semgrep`); for `custom`, computed from the user-supplied name per SETUP.md § Phase 7a sanitization rules. Used in hook filename paths (`<name-kebab>-first.py`). |
| `{{TOOLS_CODE_RESEARCH_NAME_UPPER_SNAKE}}` | UPPER_SNAKE form, complement to NAME_KEBAB; used only inside `code-research-profiles.json`'s `custom` profile for deriving the bypass marker (e.g., `MY_TOOL_BYPASS:`). Not substituted into other templates directly. |
| `{{TOOLS_PRECOMMIT_NAME}}` / `{{TOOLS_PRECOMMIT_URL}}` | name + homepage URL of `tools.precommit` from `_core/project-template/precommit/precommit-profiles.json` (or `otherTools.precommit` for "Other"); feeds the install-hint + the `git.md` `:custom` block. The copied precommit config template additionally substitutes `{{LINT_COMMAND}}` / `{{TYPECHECK_COMMAND}}` / `{{TEST_COMMAND}}` from `stack_commands` (SETUP.md step 8e). |
| `{{TOOLS_CI_NAME}}` / `{{TOOLS_CI_URL}}` | analogous |
| `{{TOOLS_AI_REVIEWER_NAME}}` / `{{TOOLS_AI_REVIEWER_URL}}` | analogous |
| `{{TOOLS_ISSUE_TRACKER_NAME}}` / `{{TOOLS_ISSUE_TRACKER_URL}}` | analogous |

### File-scoped toggles

Some files are entirely toggle-controlled (e.g., `CONTRIBUTING.md` only exists if `contributing_md` is ON). Those are deleted wholesale on OFF. The toggle catalog's "What it controls" column distinguishes file-scoped from section-scoped toggles.

---

## Asked-during-interview (⚙️) toggles

A few toggles default to "ask the user" because they depend on context Claude doesn't know until the interview:

- `code_research_first` — depends on whether the chosen code-research tool is installed (per-tool availability probe, e.g. `tokensave_status` for tokensave)
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

---

## Adding a new value to an existing tool slot (e.g., a new `code_research` option)

The five tool slots (`code_research` / `precommit` / `ci` / `ai_reviewer` / `issue_tracker`) accept user-selectable values; `code_research` (global hook, v1.3.0) and `precommit` (project-local config) ship with profile-driven generation. To add a new option (e.g., a hypothetical `"grit"`):

1. **Configurator catalog** — add `{ key: "grit", name: "Grit", desc: "...", url: "..." }` to `TOOL_SLOTS[code_research].options` in BOTH `redesign/data.jsx` AND `index.html` (and `index.legacy.html` for parity with the v1.0.0 fallback). Run `grep -n "key: \"" redesign/data.jsx index.html index.legacy.html` to confirm parity afterwards.
2. **Profile entry** — add a `"grit": { ... }` block to `_core/global-template/hooks/code-research-profiles.json` matching the schema documented in that file's `_schema` field (required: `filename_basename`, `bypass_marker`, `detection_mode`, `detection_target`, `sequence_bullets`; optional: `url`). Validate by parsing the JSON (`python -c "import json; json.load(open('_core/global-template/hooks/code-research-profiles.json'))"`) — must succeed.
3. **Per-value blocks** — add `<!-- TOGGLE:code_research:grit START/END -->` blocks in EVERY canonical template that already has per-value `code_research` markers. To find them all: `grep -rln "TOGGLE:code_research:" _core/`. As of v1.3.0 this enumerates:
   - `_core/project-template/.claude/skills/find/SKILL.md` (sequence + reporting + why-this-exists)
   - `_core/project-template/.claude/skills/architecture-graph/SKILL.md` (TWO sections — enumerate + diff-coupling)
   - `_core/project-template/.claude/skills/session-close/SKILL.md` (adherence-metric heuristic; the `:none` value is intentionally absent — see file)
   - `_core/project-template/.claude/rules/token-efficiency.md` (read-before-writing branch)
   - `_core/global-template/CLAUDE.md.additions` (no-Explore-agents-for-code-research rule)

   **Exemplar shape:** open the existing `<!-- TOGGLE:code_research:tokensave START -->` block in `find/SKILL.md` (lines 19-37) to see the canonical body — a `### Sequence` numbered list (5 steps), a `### Reporting` citation example, a `### Why this exists` paragraph. Use that shape for every value across every file; the adherence-metric block in `session-close/SKILL.md` is shorter (one line: how to count matching calls). Profile `detection_mode` values: `walk_up` (project-marker file) or `cli_available` (binary on PATH). No third mode exists.
4. **Bundle file mapping** — no per-bundle change needed; `tools.code_research` is configurator-driven, not bundle-default.
5. **CHANGELOG** — add an "Added" line under the next `[Unreleased]` section.
6. **Verification checklist** — before opening PR, run:
   - `grep -c "TOGGLE:code_research:grit" _core/` should equal `2 × <number of files in step 3>` (one START + one END per file; architecture-graph contributes 4 because it has two parametrised sections).
   - Open the configurator (`index.html`), pick your new option, click "Bind a volume" — the downloaded zip's `SETUP.md` should reference your tool by name in the `tools.code_research` line of the embedded JSON.
   - Manually substitute the placeholders in `code-research-first.py.template` against your `grit` profile and confirm the result is valid Python (`python -c "import ast; ast.parse(open('rendered-hook.py').read())"`).

If you're adding a value to `ci` / `ai_reviewer` / `issue_tracker`, those slots don't yet have profile-driven generation — until they get their own `*-profiles.json`, adding a value there is configurator-only (steps 1 + 4 + 5). The `precommit` slot **is** profile-driven (project-local profile at `_core/project-template/precommit/precommit-profiles.json`): add the option `key` in the two primary configurator mirrors (`redesign/data.jsx` + `index.html`; `index.legacy.html` uses a keyless `<select>`), an entry in `precommit-profiles.json`, and a `<!-- TOGGLE:precommit:<value> -->` block in `git.md`.

---

## Removing a value from a tool slot

The inverse operation. To retire an existing option (e.g., the project drops support for `ctags`):

1. Remove the option from `TOOL_SLOTS[<slot>].options` in `redesign/data.jsx` + `index.html` + `index.legacy.html`.
2. Remove the entry from `_core/global-template/hooks/<slot>-profiles.json` (or whichever profile file the slot uses).
3. Remove every `<!-- TOGGLE:<slot>:<value> START/END -->` block (content + markers) across the canonical templates listed in "Adding a new value" step 3.
4. **Downstream-bind compatibility:** existing bound projects whose manifest has the now-removed value will fail Phase 1 toggle validation. Add a SETUP.md alias entry (mirror the `dev_branch`/`default_branch` precedent) that warns the user and asks them to pick a replacement.
5. Update CHANGELOG with a `### Removed` entry plus a `### Breaking changes` note if the removal is in a minor/major; patch releases must not remove values silently.

---

## Promoting a configurator-only slot to profile-driven

`ci` / `ai_reviewer` / `issue_tracker` ship configurator-only today — the manifest carries `tools.<slot>` but no canonical template branches on it. (`precommit` was the first slot promoted; its project-local profile + per-manager config templates are the worked example for the steps below.) To retrofit profile-driven generation onto an existing slot:

1. **Build the profile JSON + templates.** For a **global** slot whose artifact lands in `~/.claude` (like `code_research`'s hook), place them under `_core/global-template/<slot>/<slot>-profiles.json` + `<slot>-first.<ext>.template`. For a **project-local** slot whose artifact lands in the user's repo (like `precommit`'s config files), place them under `_core/project-template/<slot>/<slot>-profiles.json` + the per-value config templates. Follow the schema in the slot's profile `_schema` as a model — `precommit`'s is leaner than `code_research`'s (no `bypass_marker` / `detection_mode`, since it writes a static config rather than an executable hook).
2. **Add per-value blocks** to the canonical templates that should now vary per `tools.<slot>` choice. Use the same `<!-- TOGGLE:<slot>:<value> START/END -->` syntax already documented above.
3. **Extend SETUP.md.** A global hook slot adds a new Phase 7c / 7d covering render + install (follow Phase 7a: Cleanup unconditional + Install conditional). A project-local config slot may instead **generalize an existing copy step** — `precommit` generalized step 8e from a hardcoded lefthook copy into a `tools.precommit` profile lookup (copy `template_ref` → `config_filename`, substitute the commands, emit `activation_command`; never execute installs).
4. **Document new placeholders** ({{TOOLS_<SLOT>_NAME}} etc.) in the placeholder table above + in SETUP.md Phase 3 step 2.
5. **CHANGELOG entry** stating the slot now has profile-driven generation; existing bound projects keep working (the configurator-only emission path is unchanged); re-binding picks up the new per-value templates.

---

## Adding a new tool slot

Tool slots are the broader category (`code_research`, `precommit`, etc.). `code_research` (a global hook) and `precommit` (project-local config) are the profile-driven slots today; adding a sixth slot follows the same pattern. Steps:

1. **Configurator catalog** — add the slot to `TOOL_SLOTS` in `redesign/data.jsx` + `index.html` (+ `index.legacy.html`). Schema: `{ id, label, hint, options: [{ key, name, desc, url }], default }`. The `key` field on each option is mandatory — it's what `tools.<slot>` emits to the manifest and what profile lookups join against.
2. **Profile JSON + template** (only if the slot needs runtime enforcement like `code_research`'s hook):
   - Build `_core/global-template/<slot>/<slot>-profiles.json` with the same shape as `code-research-profiles.json` (`_doc`, `_schema`, one block per built-in option, plus `none` and `custom` if they apply).
   - Build `_core/global-template/<slot>/<slot>-first.py.template` (or whatever rendered artifact the slot needs — script, YAML, etc.) with `{{TOOLS_<SLOT>_*}}` placeholders.
3. **Placeholders** — document the new `{{TOOLS_<SLOT>_NAME}}` / `{{TOOLS_<SLOT>_URL}}` / `{{TOOLS_<SLOT>_BYPASS_MARKER}}` / `{{TOOLS_<SLOT>_NAME_KEBAB}}` / `{{TOOLS_<SLOT>_NAME_UPPER_SNAKE}}` in the placeholder table above AND in `SETUP.md` § Phase 3 step 2. The `_KEBAB` and `_UPPER_SNAKE` variants are needed only if the slot resolves Other → custom (and the custom case feeds filenames or shell-var-like names).
4. **Per-value blocks** — wire `<!-- TOGGLE:<slot>:<value> START/END -->` into the canonical templates that need to vary per choice. For `code_research` this was 5 files; the count for a new slot depends on how many places need per-tool prose. Use the same template list (`find/SKILL.md`, etc.) as a starting reference.
5. **Bind procedure** — extend `SETUP.md` § Phase 7a (or add a new Phase 7c, 7d, etc.) describing the rendering + installation procedure for the new slot. Follow the `code_research` precedent: profile lookup → custom-case sanitization → nested-placeholder resolution → atomic file write → settings.json or equivalent registration → de-dup orphan cleanup.
6. **Bundle defaults** — unlike `code_research` (configurator-only), some slots may want bundle-default opinions. For example, the `ci` slot might want OSS bundle default = `GitHub Actions`, Client-team bundle default = ASK. If so, also wire the slot into `bundles/<n>/bundle.toggles.md` as a per-bundle key.
7. **CHANGELOG** — add an entry establishing the new slot as a stable user contract. Position it as "wires another v1.0.0 tool-slot promise through end to end, following the `code_research` precedent."
8. **Verification checklist:**
   - All THREE configurator copies (`redesign/data.jsx` + `index.html` + `index.legacy.html`) emit the new slot in `tools.<slot>` (paste-text + manifest preview). Run `grep -n "id: \"<new-slot>\"" redesign/data.jsx index.html index.legacy.html` — must return one match per file.
   - Profile JSON (if applicable) parses cleanly; every `_schema` required field is populated for every built-in option.
   - Per-value markers in all canonical files balance (each `:<value>` has matching START + END).
   - SETUP.md describes the bind procedure unambiguously; a downstream Claude session can execute it end-to-end without inferring missing steps.
   - Bind the dogfooded `_core/project-template/CLAUDE.md` against the new slot's options and verify the resolved output looks correct for at least 3 values (including `none` and `custom` if they apply).
