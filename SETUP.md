# SETUP.md — bootstrap orchestration prompt

This file is read by Claude Code when the user pastes a setup command exported from `START-HERE.html`. It tells Claude exactly how to render the bundle into the user's project.

The user invokes the setup by pasting a message of the form:

```
Run claude-code-templates SETUP with this configuration:

{
  "bundle": "<bundle-id>",
  "project": {
    "name": "<project name>",
    "description": "<one-liner>",
    "stack": "<language + framework>",
    "conversation_language": "English",
    "code_language": "English",
    "repo_url": "<owner/repo>",
    "main_branch": "<main|master>",
    "dev_branch": "<develop|main|...>",
    "branching_model": "<gitflow|trunk>"
  },
  "toggles": {
    "<toggle_name>": true | false | null,
    ...
  },
  "stack_commands": {
    "build": "...",
    "test": "...",
    "dev": "...",
    "lint": "...",
    "format": "..."
  }
}

The templates live at ./claude-code-templates/ (or wherever the user unzipped them).
```

---

## What Claude must do when this prompt arrives

### Phase 1 — Validate

1. **Locate templates.** Expect them at `./claude-code-templates/` by default. If not there, ask the user where they unzipped (don't assume).
2. **Parse the JSON.** Validate required fields: `bundle`, `project.name`, `project.repo_url`, `project.main_branch`, `project.dev_branch`, `toggles`. If any field is `null` or missing, run a short interview to fill it — never assume. For backwards-compat with manifests produced before the v1.x rename: if `dev_branch` is missing but `developer_branch` or `default_branch` is present, accept it and warn.
3. **Cross-check bundle.** Read `claude-code-templates/bundles/<bundle>/bundle.toggles.md` to confirm the bundle exists and to know its expected toggle set. For any toggle in the catalog NOT present in the user's JSON, fall back to the bundle default.
4. **Cross-check toggles + tool-slot values.** Every key in `toggles` must be in `TOGGLES.md`'s catalog. Unknown keys → reject with the offending names. Every `tools.<slot>` value must be in the configurator catalog (`redesign/data.jsx` `TOOL_SLOTS[<slot>].options[].key`) — for slots with profile-driven generation (`code_research` → `_core/global-template/hooks/code-research-profiles.json`; `precommit` → `_core/project-template/precommit/precommit-profiles.json`), the value must additionally match a key in the slot's profile JSON — **except** the literal value `"custom"`, which is always valid for any slot (it is the canonical resolution of the configurator's generic "Other" choice, even when the slot's options array carries no explicit `custom` key). Unknown values → reject with: "`tools.<slot>` value `<value>` is not in the catalog. Valid keys: <list>. If this was a hand-edit, pick a catalog value or use `Other` (resolves to `custom`)."

   **Backward-compat alias map** (handle deprecated toggle names that downstream users may have in their manifests; mirrors the `developer_branch`/`default_branch` precedent):
   - `code_research_first` is the canonical toggle name. `tokensave_entry_point` is its deprecated legacy alias (from the tokensave-only era), still accepted so manifests bound before the rename keep working. Alias-resolution behavior:
     - If `tokensave_entry_point` is present in `toggles` but `code_research_first` is not, accept it as the alias and warn: *"`tokensave_entry_point` is the legacy toggle name; current versions use `code_research_first` for the same toggle. Updating your manifest to the new name is recommended but not required."*
     - If both are present, prefer `code_research_first` (the canonical name) and warn that `tokensave_entry_point` was ignored.
5. **Resolve derived toggles** from `project.branching_model`:
   - `gitflow` → `branching_model_gitflow: true`, `branching_model_trunk: false`
   - `trunk` → `branching_model_gitflow: false`, `branching_model_trunk: true`
6. **Resolve `null` toggles** (those the bundle marks "ask"):
   - `code_research_first` → ask the user "Install the code-research hook (enforces /find-first for **{tools.code_research}** via Grep/Glob/Bash interception)?". If unsure, probe availability of the chosen tool per its profile (`_core/global-template/hooks/code-research-profiles.json`):
     - `detection_mode: walk_up` (tokensave / ctags) → check for the marker file under the project root. Use `true` if found.
     - `detection_mode: cli_available` (ast-grep / sourcegraph / semgrep / custom) → check if the CLI is on PATH. Use `true` if found.
     - `tools.code_research === "none"` → force `false` (no hook to install).
   - `architecture_rules_scaffold` → `true` only if the existing codebase has ≥ 2 clear layer/module boundary directories.
   - `visual_test_discipline` → ask the user if the project has a UI / visual surface.
   - All other `null`s → ask the user one at a time with a short rationale.

### Phase 1.5 — Discovery audit (ONLY when `mode === "discovery"`)

Skip entirely if the pasted JSON has `mode: "manual"` or no `mode` field. Run this between Validate and Plan when the user picked Discovery mode.

The goal: produce the same fully-populated config the Manual form would have, but by **auditing the project instead of asking the user**. Every inferred value carries an evidence trail that gets surfaced in the plan HTML.

#### Step 1 — Audit pass

Use tokensave if available (`tokensave_status` returns `ready`); fall back to Glob + Read otherwise. Note: tokensave-free audit costs ~5× more tokens but is functionally equivalent.

Read these sources, in order:

1. **Manifests** (most authoritative — pick the one that exists, prefer multiple if a monorepo):
   - `package.json` → name, description, scripts, dependencies (→ frontend / backend chips)
   - `pyproject.toml` / `setup.py` / `requirements.txt` → name, description, deps
   - `Cargo.toml` → name, description, binaries, deps
   - `pubspec.yaml` → name, description, deps (Flutter / Dart)
   - `CMakeLists.txt` → `project(<name>)`, languages declared
   - `composer.json` → PHP
   - `Gemfile` / `*.gemspec` → Ruby
   - `pom.xml` / `build.gradle{,.kts}` → JVM
   - `go.mod` → Go module + go version
   - `*.csproj` / `*.sln` → .NET
2. **`.git/config`** → `remote.origin.url` → normalize to `<owner>/<repo>` for `project.repo_url`
3. **`git branch -a` + `git log --oneline -1`** → main + dev branches. If `develop` exists → Gitflow; else → trunk
4. **`LICENSE`** (if exists) → SPDX header → `project.license`; copyright line → `project.license_holder`
5. **`git config user.name`** → fallback license_holder
6. **README.md** → first paragraph for description (if manifest doesn't have one); badges / setup commands for hints
7. **File tree (top-level + 2 levels)** → architecture pattern heuristic:
   - `src/domain/` + `src/usecases/` + `src/adapters/` → `clean`
   - `src/features/<name>/` pattern → `feature-based`
   - `controllers/` + `models/` + `views/` → `mvc`
   - `app/` + `lib/` (Rails) → `mvc`
   - `domain/` + `infrastructure/` + `application/` → `hexagonal` or `clean` (use additional signals)
   - Multiple bounded-context-style folders → `ddd`
   - `Cargo.toml` with `bevy` dep OR Godot project files OR `*.unity` → `ecs`
   - No clear pattern → leave architecture empty (no rule generated)
8. **File extensions histogram** (top 5 most-common code extensions) → language chips
9. **Manifest scripts / Makefile / Cargo bin / pyproject scripts** → stack_commands chips
10. **Existing `.claude/` content** → don't overwrite if user already has rules / skills / memory; note in plan
11. **Code-research tool detection** → infer `tools.code_research` AND `code_research_first`:
    - `.tokensave/tokensave.db` present → `tools.code_research: "tokensave"`, `code_research_first: true`
    - `tags` file at repo root → `tools.code_research: "ctags"`, `code_research_first: true`
    - `ast-grep`, `src`, or `semgrep` binary on PATH → `tools.code_research` to the matching tool, `code_research_first: true`
    - Multiple signals → ask the user which to use as the primary; default to tokensave > ast-grep > sourcegraph > semgrep > ctags in priority order
    - No signal → `tools.code_research: "none"`, `code_research_first: false` (the user can still flip this in the plan-confirmation step)
12. **Pre-commit hooks detection** → infer `tools.precommit` AND `precommit_hooks_scaffold` (mirrors step 11's tool+gate dual-set):
    - `lefthook.yml` / `.lefthook.yml` present → `tools.precommit: "lefthook"`, `precommit_hooks_scaffold: true`
    - `.husky/` directory present → `tools.precommit: "husky"`, `precommit_hooks_scaffold: true`
    - `.pre-commit-config.yaml` present → `tools.precommit: "pre-commit"`, `precommit_hooks_scaffold: true`
    - `.simple-git-hooks.json` present, or a `simple-git-hooks` key in `package.json` → `tools.precommit: "simple-git-hooks"`, `precommit_hooks_scaffold: true`
    - No signal → `tools.precommit: "none"`, `precommit_hooks_scaffold: false` (the user can still flip this in the plan-confirmation step)
13. **`.github/workflows/`** existence → `github_actions_*: true`
14. **`CODEOWNERS`** existence → likely multi-dev / client-team
15. **README mentions of "team" / "client" / "we" / "I"** → bundle heuristic (not definitive — bundle is always user-confirmed)

#### Step 2 — Build the inference table

For each field, record `{value, source, evidence}`. Example:

```
project.name = "acme-billing"
  source: package.json
  evidence: line 2 of package.json: "name": "acme-billing"
project.stack = "TypeScript + Next.js + Supabase"
  source: package.json.dependencies
  evidence: typescript@5.4, next@14.2, @supabase/supabase-js@2.x detected
project.architecture = ["clean"]
  source: file tree
  evidence: src/domain/, src/usecases/, src/adapters/postgres/ structure
```

#### Step 3 — Ask only what's not derivable

After the audit, ask via `AskUserQuestion` (one at a time, brief):

1. **Bundle confirmation** — always ask. Show the four options + a hint from any audit signal (e.g., "I see CODEOWNERS — likely multi-dev or client-team. Which is it?"). User picks.
2. **License holder** — only if neither `LICENSE` nor `git config user.name` had a usable value.
3. **Any audit ambiguity** — e.g., two architecture patterns equally plausible, or manifest says one name but git remote says another. Cap at 2-3 of these or the discovery loses its appeal.

**Do not ask things the audit can confidently infer.** "Did I get the stack right?" should be answered in the plan-confirmation step (user reviews the plan HTML and can correct), not pre-emptively.

#### Step 4 — Hand off to Phase 2 with evidence trail

Construct the same JSON config Manual mode would have. Phase 2's plan HTML must include an **"Evidence" column** alongside each inferred decision, citing the source. The user reviews the plan, can reply with deltas like:

> apply, except change architecture to feature-based — we're moving away from clean

Claude makes the deltas, then proceeds to Phase 3 Apply.

---

### Phase 2 — Plan

Produce a concise HTML plan file `claude-code-setup-plan.html` in the project root showing:

- Selected bundle + final toggle state (resolved from defaults + overrides + null fills)
- Substituted placeholders (a table: placeholder → value)
- For each toggle, ON/OFF + what files/sections it affects
- The full list of files that will be created in the project (with their destination path)
- The full list of sections that will be stripped
- The full list of files that will be deleted / skipped (file-scoped OFF toggles)
- The `~/.claude/` merge plan (if `memory_system` or `code_research_first` is ON)
- The proposed commit message and the diff scope

Tell the user: *"Open `claude-code-setup-plan.html` in your browser to review. Reply `apply` to execute, or describe what to change."*

**Stop here.** Do not write any project files until the user says apply.

### Phase 3 — Apply

On `apply`:

1. **Copy** every file from `claude-code-templates/_core/project-template/` into the project root, preserving the directory tree.

2. **Substitute placeholders** in each file (UPPER_SNAKE_CASE only — GitHub Actions `${{ ... }}` expressions don't collide):
   - `{{PROJECT_NAME}}` ← `project.name`
   - `{{PROJECT_NAME_UPPER}}` ← `project.name` converted to UPPER_SNAKE_CASE (spaces → `_`, lowercase → uppercase, strip non-alphanum)
   - `{{ONE_LINE_DESCRIPTION}}` ← `project.description`
   - `{{LANGUAGE_AND_FRAMEWORK}}` ← `project.stack`
   - `{{CONVERSATION_LANGUAGE}}` ← `project.conversation_language`
   - `{{CODE_LANGUAGE}}` ← `project.code_language`
   - `{{REPO_URL}}` ← `project.repo_url`
   - `{{MAIN_BRANCH}}` ← `project.main_branch` (production / release branch; tagged versions live here. Usually `main`.)
   - `{{DEV_BRANCH}}` ← `project.dev_branch` (development / integration branch where day-to-day work targets and PRs base from. `develop` for Gitflow, same as `main_branch` for trunk-based.)
   - `{{GITFLOW_OR_TRUNK}}` ← `project.branching_model`
   - `{{STACK_COMMANDS_ALLOWLIST}}` ← see step 5 below
   - `{{REVIEW_DEEP_MODEL}}` ← deliberate stable default `claude-opus-4-8` (deep-review tier model for `.github/workflows/claude.yml`'s `--model`). Default-only — no UI field; pick deliberately (not newest-by-default), then tune in the bound workflow or override via a `REVIEW_DEEP_MODEL` GitHub repo variable.
   - `{{REVIEW_ROUTINE_MODEL}}` ← deliberate stable default `claude-sonnet-4-6` (routine-review tier model for `.github/workflows/claude-code-review.yml`'s `--model`). Default-only — same tuning options as `{{REVIEW_DEEP_MODEL}}`.
   - **Tool-slot placeholders** (for each of `code_research`, `precommit`, `ci`, `ai_reviewer`, `issue_tracker`):
     - `{{TOOLS_<SLOT>_NAME}}` ← `tools.<slot>` if the value is one of the catalog options; if `"Other"`, substitute `otherTools.<slot>` (the user-supplied free-text name).
     - `{{TOOLS_<SLOT>_URL}}` ← the homepage URL from the catalog (`TOOL_SLOTS[<slot>].options[<value>].url`); if `"Other"`, substitute `otherToolUrls.<slot>`; if the catalog entry has `url: null` (e.g., `"none"`), substitute the literal string `(no homepage)`.
     - Example: `tools.code_research: "tokensave"` produces `{{TOOLS_CODE_RESEARCH_NAME}} = "tokensave"` and `{{TOOLS_CODE_RESEARCH_URL}} = "https://github.com/aovestdipaperino/tokensave"`.
   - **Code-research profile-derived placeholders** (read from `_core/global-template/hooks/code-research-profiles.json` keyed by `tools.code_research`):
     - `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` ← profile `bypass_marker` (e.g., `"TOKENSAVE_BYPASS:"`, `"AST_GREP_BYPASS:"`). For the `custom` profile, compute as `<NAME_UPPER_SNAKE>_BYPASS:` from the user-supplied name (see Phase 7a for the transformation).
     - `{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}` ← the profile JSON key itself when `tools.code_research` is one of the built-in values (`tokensave`, `ast-grep`, `sourcegraph`, `ctags`, `semgrep` — all already kebab-shaped, so the substituted value equals the manifest's `tools.code_research` value verbatim). For the `custom` profile, computed from the user-supplied name per Phase 7a step "Compute custom-case placeholders". **Substituted into template files** — notably `_core/project-template/CLAUDE.md`, `_core/project-template/.claude/skills/find/SKILL.md`, and `_core/global-template/CLAUDE.md.additions`, wherever the hook filename `~/.claude/hooks/<name-kebab>-first.py` appears in the shared/header sections (which apply to every bind) or inside `:code_research_first` / `:code_research:custom` blocks.
     - `{{TOOLS_CODE_RESEARCH_NAME_UPPER_SNAKE}}` ← UPPER_SNAKE form of the same source (used inside `code-research-profiles.json` for the `custom` profile's `bypass_marker` derivation — not otherwise referenced directly in template files; the resolved `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` placeholder carries the final value into template files).
     - For `tools.code_research === "none"`, substitute the literal string `(no hook)` for `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` — the find skill's fallback block doesn't render in any non-tokensave-entry-point case anyway.

3. **Resolve toggles + placeholders in the correct order** (strip first, then substitute — so placeholder substitution doesn't waste work on about-to-be-stripped blocks):

   **3a. Strip per-value tool-slot blocks first.** For each `<!-- TOGGLE:<slot>:<value> START/END -->` block (where `<slot>` is one of `code_research`, `precommit`, `ci`, `ai_reviewer`, `issue_tracker`): keep the block whose `<value>` matches `tools.<slot>` (with markers stripped) and remove all other `:<value>` blocks for the same slot **entirely** (content + markers). The `"Other"` UI choice resolves to `:custom`. If `tools.<slot>` does not match any `:<value>` block in the file (e.g., unknown tool, or no per-tool blocks exist), strip all `:<value>` blocks for that slot — never leave unresolved markers.

   **3b. Resolve boolean toggles.**
   - For **ON** toggles: remove only the `<!-- TOGGLE:NAME START -->` and `<!-- TOGGLE:NAME END -->` marker lines (keep the content between). Remove `<!-- TOGGLE:NAME:off START/END -->` blocks **entirely** (content + markers).
   - For **OFF** toggles: remove `<!-- TOGGLE:NAME START/END -->` blocks **entirely**. Remove only the `<!-- TOGGLE:NAME:off START/END -->` marker lines (keep their content).
   - For **file-scoped** OFF toggles (e.g., `contributing_md`, `confidentiality_rule`), delete the listed files entirely BEFORE the copy step (or skip during copy).

   **3c. Substitute placeholders** from step 2 (above). Per-tool placeholders are now guaranteed to land only inside the kept-tool block — substitute them in place.

   **3d. Collapse triple-or-more consecutive blank lines** into double blank lines in every text file (regex: `\n\n\n+` → `\n\n`).

4. **Strip lingering bootstrap notes (safety net).** Some templates may contain `> _Bootstrap note: ..._` blockquotes from earlier authoring iterations. Remove any lines matching `^> _Bootstrap note:.*_$` from all generated files. Belt-and-suspenders with the template cleanup.

5. **Render `{{STACK_COMMANDS_ALLOWLIST}}`** in `.claude/settings.local.json.template`:
   - `stack_commands` shape is now `{ selected: ["cmd1", "cmd2", ...], custom: ["customA", ...] | null }`. `selected` is the union of catalog chips + any custom adds; `custom` is just the customs (for traceability / preview).
   - If `stack_commands` is `null` or `selected` is empty, replace the placeholder with `` (empty string).
   - Otherwise, for each entry in `stack_commands.selected`, render one allowlist line of the form `"Bash(<cmd>:*)"`.
   - Each entry is prefixed by a comma + newline + indent (the placeholder sits at the end of the array without a trailing comma). Example output if `stack_commands.selected = ["npm run", "npm test", "cargo build"]`:
     ```
     ,
           "Bash(npm run:*)",
           "Bash(npm test:*)",
           "Bash(cargo build:*)"
     ```
   - Deduplicate against the canonical list already in the template (don't double-add `Bash(git push:*)` if it's already there).
   - Result must be valid JSON. Verify by parsing.

6. **Rename templates** (after placeholder substitution + toggle resolution):
   - `.github/workflows/claude-code-review.yml.template` → `.github/workflows/claude-code-review.yml`
   - `.github/workflows/claude.yml.template` → `.github/workflows/claude.yml`
   - `.claude/settings.local.json.template` → `.claude/settings.local.json` — also add to `.gitignore` if the user expects it to contain anything sensitive
   - `.github/CODEOWNERS.template` → `.github/CODEOWNERS` (no extension)

6a. **(reserved — hook installation moved to Phase 7a, global install. Project-local hook registration is forbidden — see the "Why not project-local?" note in Phase 7a.)**

7. **Merge global additions.** If `code_research_first` or `memory_system` is ON, resolve and append `claude-code-templates/_core/global-template/CLAUDE.md.additions` into `~/.claude/CLAUDE.md`:

   1. **Resolve per-value toggle blocks first.** `CLAUDE.md.additions` ships seven `<!-- TOGGLE:code_research:<value> START/END -->` blocks (`tokensave`, `ast-grep`, `sourcegraph`, `ctags`, `semgrep`, `none`, `custom`) inside the "No Explore Agents" section. Apply the Phase 3 step 3a logic here too: keep the block whose `<value>` matches `manifest.tools.code_research`, strip all others entirely (content + marker lines). This file is in `_core/global-template/`, not `_core/project-template/` — Phase 3 step 3a's "scan `_core/project-template/**`" pass does NOT touch it, so the resolution must happen explicitly at this step. Skipping it leaves all seven contradictory `## MANDATORY` directives in the user's global config and is a correctness bug, not cosmetic.
   2. **Substitute the residual placeholders.** After block stripping, the surviving block (and any shared prose outside the blocks) may still contain `{{TOOLS_CODE_RESEARCH_NAME}}`, `{{TOOLS_CODE_RESEARCH_URL}}`, `{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}`, `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}`. Substitute them using the Phase 3 step 2 + step 3c rules (resolve from `manifest.tools` + `code-research-profiles.json`; for `custom`, resolve the nested computed values first).
   3. **Detect existing sections** in `~/.claude/CLAUDE.md` by H2 heading match (`## MANDATORY: No Explore Agents When the Project's Code-Research Tool Is Available`, `## Auto memory`); if found, ask before overwriting. **Legacy heading transition:** prior binds (pre-v1.3.0) wrote `## MANDATORY: No Explore Agents When Tokensave Is Available` — when that exact heading is detected, treat it as the same section, ask before overwriting, and rewrite using the new heading on accept.
   4. **Append the resolved content.** Only the resolved output (toggle blocks stripped, placeholders substituted) lands in `~/.claude/CLAUDE.md`. No raw `{{...}}` and no `<!-- TOGGLE:... -->` markers should remain in the appended text.

7a. **Manage the code-research-first hook GLOBALLY.** This phase has TWO sub-phases that run independently:

   - **Phase 7a-Cleanup (unconditional, runs first):** orphan-hook de-duplication + cleanup of stale `~/.claude/hooks/*-first.py` files left by a prior bind with a different `tools.code_research` value. Runs whether the new bind installs a hook or not — so a switch from `tokensave` to `none` (or a decline-to-install at the CLI probe in Phase 7a-Install) still cleans up the prior `tokensave-first.py`.
   - **Phase 7a-Install (conditional, runs only if `code_research_first` is ON AND `tools.code_research !== "none"`):** render the template + write the new hook + register the matcher entry.

   ---

   **Phase 7a-Cleanup (unconditional):** iterate `hooks.PreToolUse[*].hooks[*].command` in `~/.claude/settings.json` (using the atomic-write pattern below). For each command whose path ends in `-first.py`:
   - Compute the basename. Compare against the new bind's `<filename_basename>.py` — when there is NO new hook (`tools.code_research === "none"` or `code_research_first: false`), compare against the sentinel `None` so every existing `*-first.py` is treated as orphan.
   - If basename matches the new bind's target → leave alone (idempotent re-bind).
   - If basename is a DIFFERENT `*-first.py` (or the new target is `None` and any `*-first.py` exists) → ask the user before removing the array element AND `os.unlink`-ing the orphan file. Never leave two code-research-first hooks racing.
   - **If the user declines orphan removal:** leave both file + entry intact, BUT surface a prominent warning in the bind summary: ⚠️ *"Stale `<old-basename>.py` hook from a previous bind is still registered in `~/.claude/settings.json` and will fire on every Bash/Grep/Glob call — even though the current bind doesn't reference it. To remove later: edit `~/.claude/settings.json` and delete the matching `PreToolUse` entry, then `rm ~/.claude/hooks/<old-basename>.py`."* Repeat this warning at session-reload disclosure (Phase 3 step 13) so the user can't miss it.

   ---

   **Phase 7a-Install (conditional — `code_research_first` ON AND `tools.code_research !== "none"`):**

   - **Why not project-local?** Empirical finding for the canonical tokensave case: tokensave's own `install` / `reinstall` logic reads project-local `settings.local.json` for hook templates and inherits the executable prefix from existing entries. If a project-local hook uses `python <path>`, tokensave copies that prefix and writes its own auto-registration as `python hook-stop` / `python hook-prompt-submit` — broken commands that block every subsequent Stop / UserPromptSubmit event. Installing globally sidesteps that template-inheritance entirely. The same reasoning applies preemptively to any code-research tool that ships its own hook generator: keep ours global, out of the per-project template-inheritance surface.

   **⚠️ The installed hook is ADVISORY ENFORCEMENT — NOT A SECURITY BOUNDARY.** It fails open on JSON decode errors, unknown DETECTION_MODE, OSError, and any other unexpected exception. Treat it as a guidance nudge that routes Claude to the chosen code-research tool when the tool is available; don't treat it as a sandbox.
   - **Read the profile.** `claude-code-templates/_core/global-template/hooks/code-research-profiles.json` defines per-tool profiles keyed by the value of `tools.code_research`. Pick the profile matching the user's choice. If the user picked `"Other"`, use the `custom` profile and substitute the user-supplied name into the placeholders below.
   - **`tools.code_research === "none"`** — the profile has `_skip_install: true`. Do not render the template, do not write any hook. The unconditional Phase 7a-Cleanup above has already removed any stale `*-first.py` matcher entry + orphan hook file from a prior bind. CLAUDE.md and `/find` resolve their `:none` blocks and route through Grep/Glob/Read.
   - **Compute custom-case placeholders** (only if the user picked `"Other"` — i.e., `tools.code_research === "custom"` in the resolved manifest):
     - Read the user-supplied name from `tool_names.code_research` (or `otherTools.code_research` in the configurator state pre-emit).
     - **Sanitize ASCII-only:** drop any character outside `[A-Za-z0-9 _-]` from the source name BEFORE transforming. Characters like `.`, `/`, `\`, `:`, `;`, quotes, and any Unicode letter are dropped. Unicode letters are not accepted (Windows + Python identifier limits + JSON-config sanity). If the resulting source is empty, reject and re-prompt the user.
     - `{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}` ← sanitized source `.toLowerCase()` with runs of non-alphanumeric characters collapsed to single `-` and leading/trailing `-` stripped. Example: `"My Awesome Indexer"` → `"my-awesome-indexer"`.
     - **Reject** the kebab result if ANY of the following are true (re-prompt the user for a cleaner name):
       - empty (sanitization stripped everything)
       - starts with a digit (Python-identifier-unfriendly)
       - length < 2 (single-char names produce ambiguous `a-first.py` files)
       - length > 40 (filename / settings.json sanity)
       - collides with a built-in profile key: `tokensave`, `ast-grep`, `sourcegraph`, `ctags`, `semgrep`, `none`, `custom` (would shadow built-in behavior)
       - collides with a Python keyword (`if`, `for`, `class`, etc. — produces a syntactically valid filename but a confusing display name)
       - matches a **Windows reserved device name** (case-insensitive): `con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`. These names produce filenames Windows refuses to open (`con-first.py` is unwritable).
     - `{{TOOLS_CODE_RESEARCH_NAME_UPPER_SNAKE}}` ← sanitized source `.toUpperCase()` with runs of non-alphanumeric characters collapsed to single `_` and leading/trailing `_` stripped. Example: `"My Awesome Indexer"` → `"MY_AWESOME_INDEXER"`. Same reject rules.
     - These feed `filename_basename`, `bypass_marker`, and `detection_target` in the `custom` profile.
   - **Probe tool availability at bind time** (parity between detection modes):
     - For `cli_available` (ast-grep / sourcegraph / semgrep / custom-by-default): run `shutil.which(detection_target)` equivalent. On Windows, confirm `PATHEXT` includes the binary's extension (`.exe` / `.cmd` / `.bat` / `.ps1`); some Scoop / npm shims register `.ps1` only and need `PATHEXT` set.
     - For `walk_up` (tokensave / ctags): walk up from the project root looking for `detection_target` (e.g., `.tokensave/tokensave.db`, `tags`). The marker file must exist somewhere in the project's ancestor chain.
   - **If the tool is NOT available** (CLI missing OR walk_up marker missing), do NOT silently install the hook — warn the user: "The code-research tool `<DISPLAY_NAME>` is not available for this project (`<reason>`: CLI not on PATH / no marker file found). The hook will be installed but will fail-open on every Bash/Grep/Glob call until the tool is set up (`<tip>`: install `<binary>` / run `tokensave init`). Continue anyway? [y/N]". If the user declines, set `code_research_first: false` for this bind and skip the hook install (cleanup still runs unconditionally above).
   - **Validate the resolved profile against the inline `_schema` contract** in `code-research-profiles.json`:
     - Required fields present (`filename_basename`, `bypass_marker`, `detection_mode`, `detection_target`, `sequence_bullets`).
     - `detection_mode` is one of `walk_up` or `cli_available`.
     - `bypass_marker` matches `^[A-Z][A-Z0-9_]*_BYPASS:$`.
     - `detection_target` does NOT contain `..` (in any form — `..`, `../foo`, `..\foo`, `foo/../bar`, `foo\..\bar`; check after replacing `\` with `/` then splitting on `/`), absolute path prefixes (`/`, `\`, drive letters `X:`), or null bytes. Path-traversal guard: the hook's `detect_walk_up` also re-checks this at runtime as defense-in-depth.
     - If validation fails, abort with a clear error message naming the offending field.
   - **Resolve nested placeholders inside the profile FIRST.** The `custom` profile's values themselves contain `{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}` / `{{TOOLS_CODE_RESEARCH_NAME_UPPER_SNAKE}}` / `{{TOOLS_CODE_RESEARCH_URL}}` — substitute these INTO the profile data structure BEFORE using it to substitute placeholders into the hook template. Resolution order: (a) compute kebab/upper-snake/URL values; (b) substitute them into the `custom` profile's `filename_basename`, `bypass_marker`, `detection_target`, `sequence_bullets`, `url`; (c) THEN substitute the resulting profile values into `code-research-first.py.template`'s placeholders. Skip step (b) for built-in profiles (their values are already literal).
   - **Python-string-escape user-flowing substitutions.** When substituting any user-derived value into a Python string literal in the hook template, use `json.dumps(value)` (or equivalent). The flowing values are:
     - `{{TOOLS_CODE_RESEARCH_NAME}}` → `DISPLAY_NAME = "..."` literal. Apply `json.dumps` so embedded `"`, `\`, or newlines produce valid Python.
     - `{{TOOLS_CODE_RESEARCH_SEQUENCE_BULLETS}}` → `SEQUENCE_BULLETS = """..."""` triple-quoted literal. For the `custom` profile (where bullets reference `{{TOOLS_CODE_RESEARCH_URL}}` — itself user-supplied), additionally check the substituted result does NOT contain `"""` OR `'''` (either triple-quote terminator — defense against a future quoting refactor). If it does, escape the inner quote characters before substitution.
     - `{{TOOLS_CODE_RESEARCH_URL}}` → embedded inside `SEQUENCE_BULLETS` for `custom`. Same triple-quote check applies; built-in profiles use static URLs (no escaping needed).
     - Built-in profile names (`tokensave`, `ast-grep`, `Sourcegraph`, `ctags`, `Semgrep`) and built-in URLs are pre-validated as safe — escape transforms produce no-op output.
   - **Render the template.** Read `claude-code-templates/_core/global-template/hooks/code-research-first.py.template`. Substitute:
     - `{{TOOLS_CODE_RESEARCH_NAME}}` ← profile display name (the JSON key for built-in tools; user-supplied name for custom)
     - `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` ← profile `bypass_marker`
     - `{{TOOLS_CODE_RESEARCH_DETECTION_MODE}}` ← profile `detection_mode` (`walk_up` or `cli_available`)
     - `{{TOOLS_CODE_RESEARCH_DETECTION_TARGET}}` ← profile `detection_target`
     - `{{TOOLS_CODE_RESEARCH_SEQUENCE_BULLETS}}` ← profile `sequence_bullets` (multi-line; embed verbatim inside the template's triple-quoted string)
   - **Write the rendered hook ATOMICALLY.** Destination: `~/.claude/hooks/<filename_basename>.py` (from the profile). E.g., tokensave → `~/.claude/hooks/tokensave-first.py`; ast-grep → `~/.claude/hooks/ast-grep-first.py`; custom `"my-tool"` → `~/.claude/hooks/my-tool-first.py`. Create `~/.claude/hooks/` if missing. Atomic-write pattern: write the rendered content to `~/.claude/hooks/<filename_basename>.py.tmp`, `fsync`, then `os.replace(<...>.py.tmp, <...>.py)`. If the destination already exists AND its content diverges from the rendered output (user hand-edited), show the diff and ask before overwriting; preserve user customisation if they decline.
   - **Register the hook** in `~/.claude/settings.json` under `hooks.PreToolUse` (alongside any existing entries):
     ```json
     {
       "matcher": "Grep|Glob|Bash",
       "hooks": [
         { "type": "command", "command": "py \"~/.claude/hooks/<filename_basename>.py\"" }
       ]
     }
     ```
     **Path expansion:** `~` is NOT auto-expanded by every Claude Code hook executor. On ALL platforms (Windows / macOS / Linux), expand `~` to the absolute home path (e.g., Windows: `C:/Users/<name>/...`, POSIX: `/home/<name>/...`). Use `os.path.expanduser` equivalent at bind time. On Windows, the launcher is `py`; on macOS/Linux, swap to `python3`. **ATOMIC write pattern for settings.json:** parse → mutate → write to `settings.json.tmp` → `fsync` → `os.replace`. Never write directly to `settings.json` (crash mid-write would corrupt the user's global config). **Preserve unrelated entries:** mutate only the targeted PreToolUse entry, write back with `indent=2`. Never rewrite sibling matchers (memory hook, telemetry hooks, etc.) — leave them byte-identical.
   - **Concurrent-bind safety.** Two parallel Claude sessions binding different projects on the same machine could race on `~/.claude/settings.json`. If you suspect a concurrent bind (e.g., file mtime changed since you read it), re-read + re-mutate before writing.
     - **mtime granularity caveat:** FAT32/exFAT external drives have 2-second mtime granularity, and Windows can return cached stat values. An mtime-only check is unreliable below 2-second resolution. For higher confidence, also compare `(size, sha256)` against the read snapshot, or apply an OS-level advisory file lock (`fcntl.flock` on POSIX, `msvcrt.locking` on Windows).
     - For pessimistic safety, document the recommendation in the bind summary: "do not run setup in two projects simultaneously."
   - **Pre-write settings.json validity check + shape normalization + backup.** Before any mutation:
     - (a) If `~/.claude/settings.json` is MISSING (fresh `~/.claude/` install / first-time user), create it with the minimal baseline `{ "hooks": { "PreToolUse": [] } }` — do NOT abort, this is a normal first-run case. Skip the backup step in this branch (nothing to back up). Proceed to step (d).
     - (b) If the file exists, parse it — if `json.JSONDecodeError`, abort with "Existing settings.json is malformed; please fix it before re-running setup" (do NOT overwrite a corrupted file).
     - (c) Copy the parsed file to `~/.claude/settings.json.bak` using `shutil.copy2` (preserves mode bits via `copystat`) so the user can recover if the bind somehow lands a bad write. Atomic-write the backup itself (`.bak.tmp` → fsync → `os.replace` to `.bak`) to avoid a half-written snapshot.
     - (d) **Normalize the in-memory shape before iterating.** A hand-curated `settings.json` may legitimately have any of: `{}`, `{"hooks": null}`, `{"hooks": {}}`, or `{"hooks": {"PreToolUse": null}}` — all valid JSON, all accepted by Claude Code. Coerce to the canonical shape WITHOUT clobbering other keys:
       ```python
       data.setdefault("hooks", {})
       if data["hooks"] is None: data["hooks"] = {}
       data["hooks"].setdefault("PreToolUse", [])
       if data["hooks"]["PreToolUse"] is None: data["hooks"]["PreToolUse"] = []
       if not isinstance(data["hooks"]["PreToolUse"], list):
           abort with "settings.json has hooks.PreToolUse set to a non-list value; fix it manually before re-running setup"
       ```
       This guarantees Cleanup's iteration and Install's append don't crash with `KeyError` or `TypeError`. Run this normalization step ONCE per Phase 7a invocation, before either Cleanup or Install touches the data.
   - **Disk-full / read-only-home handling.** Wrap the atomic-write step in a try/except. On `OSError` / `PermissionError` / `OSError(errno.ENOSPC)`: clean up any leftover `.tmp` file, name the path in the error message, and suggest a remediation ("check disk free space" / "your `~/.claude/` directory appears to be read-only — check ownership and `chmod`"). Do NOT leave orphan `.tmp` files on disk.
   - **`cli_available` re-probe at runtime.** The bind-time `shutil.which` probe verifies the tool is installed when the hook is rendered — but PATH may differ between the bind shell and Claude Code's spawned shell (especially on Windows where `py` inherits a different env). The hook RE-probes via its own `shutil.which` at runtime, so a tool that was uninstalled between bind and hook execution will simply fail-open. Document this in the bind summary as "the hook re-checks tool availability per call; it will not block if the tool is uninstalled later."
   - **(Orphan cleanup happens in Phase 7a-Cleanup above — runs UNCONDITIONALLY, including when `_skip_install: true` or `code_research_first: false`.)**
   - **Do NOT** add the hook entry to project-local `settings.local.json` or the project's `.claude/settings.json`. Even for tools that don't have tokensave's template-inheritance bug, project-local hook installation is forbidden by convention so users can switch projects without per-project hook surgery.
   - **Do NOT** add `python:*` to project-local permissions allowlist (hook runs globally with the `py` launcher).

7b. **Install the status line** (only if `statusline_config` is ON):
   - Copy `claude-code-templates/_core/global-template/statusline-command.sh.template` → `~/.claude/statusline-command.sh` (drop the `.template` suffix). If the file already exists, ask before overwriting.
   - Make it executable: `chmod +x ~/.claude/statusline-command.sh` (no-op on Windows).
   - Merge this block into `~/.claude/settings.json`:
     ```json
     "statusLine": {
       "type": "command",
       "command": "bash \"~/.claude/statusline-command.sh\""
     }
     ```
   - On Windows, swap the path to absolute: `bash "C:/Users/<name>/.claude/statusline-command.sh"`.
   - Verify by starting a Claude Code session — the status line should show `<model> | <last2dirs> | <branch> | ctx:N%`.

8. **Initialize per-project memory.** If `memory_system` is ON, copy `_core/global-template/memory-template/MEMORY.md` to `~/.claude/projects/<slug>/memory/MEMORY.md` (only if it doesn't already exist). `<slug>` is auto-derived by Claude Code from the project's working-directory path.

9. **Audit the codebase** (if any) for scaffolds:
   - `language_specific_rules_scaffold: true` → write `.claude/rules/code-style.md` with 5–10 conventions detected from a sample of source files. Greenfield → skip and note in the summary.
   - `architecture_rules_scaffold: true` → write `.claude/rules/architecture.md` if clear layer boundaries exist in the file tree.

8a. **Apply LICENSE** if `license_file` is ON and `project.license !== "none"`:
   - Read `_core/licenses/<project.license>.txt`. Substitute `{{YEAR}}` (current year) and `{{LICENSE_HOLDER}}` (`project.license_holder` or `project.name` as fallback). Write to `LICENSE` in project root.

8b. **Apply README scaffold** if `readme_scaffold` is ON:
   - Copy `_core/project-template/README.md.template` → `README.md`. Substitute placeholders. Strip toggle markers per the usual logic.

8c. **Apply CHANGELOG seed** if `changelog_seed` is ON:
   - Copy `_core/project-template/CHANGELOG.md` → `CHANGELOG.md` (no placeholders).

8d. **Apply issue templates** if `github_issue_templates` is ON:
   - Copy `_core/project-template/.github/ISSUE_TEMPLATE/` (full directory). Substitute `{{REPO_URL}}` in `config.yml`.

8e. **Apply pre-commit hooks scaffold** if `precommit_hooks_scaffold` is ON. This is **profile-driven** off `tools.precommit` (mirrors the `code_research` slot): look up the matching profile in `_core/project-template/precommit/precommit-profiles.json`, then —
   - **`tools.precommit: "none"`** (profile `_skip_install: true`) → write nothing and skip the rest of this step. The gate being ON with no manager selected is a deliberate no-op (mirrors `code_research: "none"`).
   - **`tools.precommit: "Other"` / custom** (profile `_uses_user_input: true`) → write nothing; tell the user: *"Configure your chosen pre-commit tool (the name you supplied) per its own documentation to run lint / typecheck / test on commit — we don't scaffold a config for custom tools."*
   - **Any catalogued manager** (`lefthook` / `husky` / `pre-commit` / `simple-git-hooks`) → from its profile entry:
     - Copy `_core/project-template/<template_ref>` → the profile's `config_filename` in the project root (e.g. `lefthook` → `lefthook.yml`; `husky` → `.husky/pre-commit`; `pre-commit` → `.pre-commit-config.yaml`; `simple-git-hooks` → `.simple-git-hooks.json`).
     - Substitute `{{LINT_COMMAND}}` / `{{TYPECHECK_COMMAND}}` / `{{TEST_COMMAND}}` based on `stack_commands` (use the user's `lint` / typecheck / `test` values; leave as `{{...}}` placeholder if not provided and note the user must fill them).
     - **Emit, never execute** (the bind writes config + instructs; it does not run `npm`/`pip`/installs): tell the user *"Run `<activation_command>` once after this setup to activate the hooks. `<runtime_note>`. See `<url>`."* — taking `activation_command`, `runtime_note`, and `url` verbatim from the profile (e.g. `lefthook install`; `npm install --save-dev husky && npm pkg set scripts.prepare=husky && npm run prepare`; `pre-commit install`; `npx simple-git-hooks`).

8f. **Apply architecture-graph skill** if `architecture_diagram_skill` is ON:
   - The skill file is already copied via the universal copy step. No additional action beyond ensuring it's at `.claude/skills/architecture-graph/SKILL.md`. The user invokes `/architecture-graph` when ready.

9a. **Apply architectural patterns** if `project.architecture` is set (non-null, non-empty):
   - `project.architecture` is a comma-joined list of pattern keys (e.g., `"clean, ddd, ecs"` for combos). Custom patterns are listed separately under `project.architecture_custom_research_needed` (array of pattern names not in the canonical catalog).
   - Build `.claude/rules/architecture.md` with one H2 section per pattern, in the order listed:
     - For each KNOWN key (in `clean / hexagonal / layered / feature-based / mvc / ddd / ecs`): read `_core/project-template/.claude/rules/architecture/<key>.md`, drop its `# Architecture — <Name>` H1, append the body under a new `## <Name>` H2 in the combined file.
     - For each CUSTOM pattern in `architecture_custom_research_needed`:
       1. Use the WebSearch / WebFetch tools to look up the pattern (e.g., "BLoC pattern Flutter", "Onion Architecture conventions", "PEAA enterprise patterns").
       2. Synthesize a section in the same shape as the canonical templates: brief description → key roles/layers → directory layout sketch → rules of thumb → "what this rule will reject in review" list.
       3. Add it under a `## <Custom Name> (researched)` H2 with a note at the top: `> This section was generated by web research during setup. Verify against canonical sources and tighten to your project's specifics.`
   - Prepend a single combined preamble at the top of `.claude/rules/architecture.md`:
     > `> This rule was scaffolded from the templates "<list of patterns>" during setup. Each section below applies to a different aspect of the project; refine to match your actual conventions. The template is a starting point, not a contract.`
   - Substitute generic placeholders (`{ext}`, `<name>`, etc.) where appropriate based on the user's stack chips (e.g., for TypeScript projects, replace `{ext}` with `ts`).
   - If `architecture_rules_scaffold` was ALSO set to `true` and you wrote one from the codebase audit, prefer the audited version + cite the chosen patterns at the top of it instead of overwriting.

10. **Stage + commit atomically:**
    ```
    chore(claude): bootstrap Claude Code setup
    ```
    **Strictly forbidden in the commit message:** any `Co-Authored-By:` line, any `🤖 Generated with [Claude Code](…)` footer, any variant of "Generated with Claude", any link to `claude.com/claude-code` / `claude.ai` / `anthropic.com`, any sentence ending in "via Claude Code" or "with Claude". This rule also binds **any future PR body, PR title, or commit message Claude authors in this project** — see `.claude/rules/git.md` § "Atomic commits / Format" for the canonical ban list.
    No push.

11. **Run self-verification:**
    - Grep for orphaned `<!-- TOGGLE:` markers — must be zero.
    - Grep for unresolved `{{` placeholders — must be zero.
    - Parse `.claude/settings.local.json` (if it exists) as JSON — must succeed.
    - List every file declared in the plan and confirm it exists at its destination path.
    - If any check fails, report immediately. Do not amend silently.

12. **Report a summary** to the user: files created, sections stripped, files deleted/skipped, files scaffolded, the commit SHA, and the `~/.claude/` merge result.

12a. **Surface post-bind GitHub configuration** (only if `github_actions_routine_review` OR `github_actions_deep_review` is ON). The installed workflow files are no-ops until the user does both of the following via the GitHub UI — these steps Claude **cannot** perform during setup, so they MUST be enumerated explicitly in the summary (do not bury them in "see the workflow file's header comment"):

    > **⚠️ Workflow setup is not complete yet.** The following two GitHub-UI steps are required before the workflows you just installed will actually run. Without them, every future PR will silently skip review.
    >
    > 1. **Add the `CLAUDE_CODE_OAUTH_TOKEN` secret** — GitHub → repo Settings → Secrets and variables → Actions → New repository secret. Generate the token from your Claude Code subscription per Anthropic's docs. Until this secret exists, the `anthropics/claude-code-action@beta` step fails with a missing-token error on every PR.
    > 2. **Push the workflows to the repo's DEFAULT branch first.** GitHub Actions only triggers workflows that live on the repo's default branch. The setup just committed the workflow files locally on your current branch (`<branch-name>`) — but if your default branch is different (common in Gitflow: default=`{{MAIN_BRANCH}}`, day-to-day PRs target `{{DEV_BRANCH}}`), the workflows won't fire until they land on `{{MAIN_BRANCH}}`. Recommended path: open this commit as a `hotfix/*` PR against `{{MAIN_BRANCH}}` first, merge, then cascade-merge `{{MAIN_BRANCH}}` → `{{DEV_BRANCH}}`. Pushing directly to your dev branch leaves the workflows installed-but-inert.
    >
    > Optionally also add `Evaluate review outcome` AND (if deep review is ON) `Claude On-Demand` as required status checks under your branch protection rules — this is what makes the binary 🔴/🟢 verdict an actual merge gate. `Claude On-Demand` is the deep-tier check (per `.claude/rules/review-tiers.md`); it walks through a state machine — created at in_progress on PR open, PATCHed to skipped when no escalation is needed, or to success/failure based on Opus's verdict when the deep tier runs. Both checks are PR-HEAD-SHA-attached and ANDed by branch protection. Omit `Claude On-Demand` to leave the deep tier visible-but-advisory.

    Substitute `<branch-name>` with the user's current `git branch --show-current` value. Substitute `{{MAIN_BRANCH}}` and `{{DEV_BRANCH}}` with the resolved values from the user's config. If trunk-based (`branching_model: trunk`), simplify step 2 to *"Push the commit to your default branch — workflows installed only on feature branches won't fire."*

13. **Mandatory session-reload disclosure.** Tell the user — using bold and an attention-grabbing format — that the new rules / skills / CLAUDE.md are NOT loaded in the current session. They MUST close it (`/exit`) and start a fresh Claude Code session in the same project root before continuing any work, otherwise Claude won't follow the rules they just configured. Exact wording to use (or close equivalent):

    > **⚠️ IMPORTANT — reload the session before continuing.** The new rules, skills, and `CLAUDE.md` you just installed are NOT loaded in this current session. To activate them:
    >
    > 1. Type `/exit` here to close this session cleanly.
    > 2. Re-open Claude Code from your terminal in this same project root (`claude`), or use `claude --resume` if you specifically want to pick up this conversation (rare; for a clean setup a fresh session is what you want).
    > 3. Verify the new setup is live by asking the new session: *"What's my session-start ritual?"* — Claude should recite the steps from `.claude/skills/session-start/SKILL.md`.

    This is non-negotiable. Do NOT proceed to Phase 4 cleanup without surfacing this — the user will otherwise continue working in a session that ignores the setup they just paid for.

### Phase 4 — Cleanup (mandatory disclosure, user decides via AskUserQuestion)

After the atomic commit lands AND the session-reload disclosure from Phase 3 step 13 has been delivered, **always remove `claude-code-setup-plan.html`** (it's a transient artifact — the plan was already executed; keeping it just adds noise).

For `claude-code-templates/` (the unzipped source folder), Claude **must use the `AskUserQuestion` tool** to present all three options with their full trade-offs. The folder is NOT auto-removed silently and the user does NOT need to type free text.

Use exactly this `AskUserQuestion` shape (one question, three options, first option marked Recommended):

```
question: "What should I do with the claude-code-templates/ folder?"
header: "Cleanup"
multiSelect: false
options:
  - label: "Keep + add to .gitignore (Recommended)"
    description: "Folder stays on disk for re-runs (paste the same or a different command later to flip toggles). Your repo's git status stays clean because .gitignore excludes it. ~75 KB on disk; zero git noise."
  - label: "Delete entirely"
    description: "Removes claude-code-templates/ from your project root. Cleanest state. To re-run setup later, re-unzip the bundle. No git noise either."
  - label: "Keep without touching .gitignore"
    description: "Folder stays, and it'll show up in git status until you decide whether to commit it or ignore it. Pick this only if you want to commit the templates folder into the repo so collaborators can also re-run setup from inside the repo without re-downloading."
```

Map the user's answer to the action below by matching the leading word in the option label (Keep + add → A, Delete → B, Keep without → C). If the user picks "Other" and types something custom, parse their intent before acting.

On `A`:
- Append `claude-code-templates/` to `.gitignore` (create the file if missing). Detect prior entry; don't double-write.
- Delete `claude-code-setup-plan.html`.
- Optional second commit (only if `.gitignore` was created/modified): `chore: gitignore claude-code-templates/ setup folder`.

On `B`:
- Remove `claude-code-templates/` and `claude-code-setup-plan.html`.
- No new commit needed.

On `C`:
- Remove only `claude-code-setup-plan.html`.
- Leave `claude-code-templates/` and `.gitignore` untouched.
- Note in the summary: "Templates folder is in your repo root and not gitignored — your next commit will pick it up unless you ignore it or stage selectively."

Report the chosen path back to the user in the final summary.

---

## Rules Claude must follow during setup

- **Use Read / Edit / Write tools**, never Bash for file creation.
- **Use Glob / Grep** for file discovery, not `ls -R` or `find`.
- **Use tokensave** if installed (`tokensave_status` to check); otherwise Grep/Read.
- **Atomic commit** at the end — single `chore(claude): bootstrap Claude Code setup`. No piecemeal commits.
- **Do not push.** The user pushes when they're ready.
- **No `Co-Authored-By:` lines.**

---

## Re-running setup

If the user wants to change toggles later:

1. Open `START-HERE.html` again, change toggles, export a new command.
2. Paste back into Claude with the same SETUP.md instruction.
3. Claude detects the existing state (rules, skills, etc.) and applies only the deltas — does NOT wipe per-project memory or existing custom rules outside the canonical set.
4. Surfaces conflicts (user-modified files that would be overwritten) and asks before touching them.
