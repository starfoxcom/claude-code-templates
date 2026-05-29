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
    "branching_model": "<gitflow|trunk>",
    "timezone": "<IANA timezone like America/Mazatlan>"
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
4. **Cross-check toggles.** Every key in `toggles` must be in `TOGGLES.md`'s catalog. Unknown keys → reject with the offending names.
5. **Resolve derived toggles** from `project.branching_model`:
   - `gitflow` → `branching_model_gitflow: true`, `branching_model_trunk: false`
   - `trunk` → `branching_model_gitflow: false`, `branching_model_trunk: true`
6. **Resolve `null` toggles** (those the bundle marks "ask"):
   - `tokensave_entry_point` → ask the user; if unsure, run `tokensave_status` and use `true` only if it returns "ready".
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
11. **`.tokensave/tokensave.db`** existence → `tokensave_entry_point: true`
12. **`.github/workflows/`** existence → `github_actions_*: true`
13. **`CODEOWNERS`** existence → likely multi-dev / client-team
14. **README mentions of "team" / "client" / "we" / "I"** → bundle heuristic (not definitive — bundle is always user-confirmed)

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
2. **Timezone** — only if `preferences.timezone` was blank in the JSON. Provide a sensible system-default suggestion.
3. **License holder** — only if neither `LICENSE` nor `git config user.name` had a usable value.
4. **Any audit ambiguity** — e.g., two architecture patterns equally plausible, or manifest says one name but git remote says another. Cap at 2-3 of these or the discovery loses its appeal.

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
- The `~/.claude/` merge plan (if `memory_system` or `tokensave_entry_point` is ON)
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
   - `{{TIMEZONE}}` ← `project.timezone`
   - `{{STACK_COMMANDS_ALLOWLIST}}` ← see step 5 below
   - `{{REVIEW_DEEP_MODEL}}` ← deliberate stable default `claude-opus-4-8` (deep-review tier model for `.github/workflows/claude.yml`'s `--model`). Default-only — no UI field; pick deliberately (not newest-by-default, per the session-start model-choice discipline), then tune in the bound workflow or override via a `REVIEW_DEEP_MODEL` GitHub repo variable.
   - `{{REVIEW_ROUTINE_MODEL}}` ← deliberate stable default `claude-sonnet-4-6` (routine-review tier model for `.github/workflows/claude-code-review.yml`'s `--model`). Default-only — same tuning options as `{{REVIEW_DEEP_MODEL}}`.

3. **Resolve toggles** in every file:
   - For **ON** toggles: remove only the `<!-- TOGGLE:NAME START -->` and `<!-- TOGGLE:NAME END -->` marker lines (keep the content between). Remove `<!-- TOGGLE:NAME:off START/END -->` blocks **entirely** (content + markers).
   - For **OFF** toggles: remove `<!-- TOGGLE:NAME START/END -->` blocks **entirely**. Remove only the `<!-- TOGGLE:NAME:off START/END -->` marker lines (keep their content).
   - For **file-scoped** OFF toggles (e.g., `contributing_md`, `confidentiality_rule`), delete the listed files entirely BEFORE the copy step (or skip during copy).
   - After all toggle resolution, **collapse triple-or-more consecutive blank lines** into double blank lines in every text file (regex: `\n\n\n+` → `\n\n`).

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

7. **Merge global additions.** If `tokensave_entry_point` or `memory_system` is ON, append `claude-code-templates/_core/global-template/CLAUDE.md.additions` to `~/.claude/CLAUDE.md`. Detect existing sections by H2 heading match (`## MANDATORY: No Explore Agents When Tokensave Is Available`, `## Auto memory`); if found, ask before overwriting.

7a. **Install the tokensave-first hook GLOBALLY** (only if `tokensave_entry_point` is ON):
   - **Why not project-local?** Empirical finding: tokensave's own `install` / `reinstall` logic reads project-local `settings.local.json` for hook templates and inherits the executable prefix from existing entries. If a project-local hook uses `python <path>`, tokensave copies that prefix and writes its own auto-registration as `python hook-stop` / `python hook-prompt-submit` — broken commands that block every subsequent Stop / UserPromptSubmit event. Installing globally sidesteps that template-inheritance entirely.
   - Copy `claude-code-templates/_core/global-template/hooks/tokensave-first.py` → `~/.claude/hooks/tokensave-first.py` (create the dir if missing). If the destination already exists, ask before overwriting.
   - Merge this PreToolUse entry into `~/.claude/settings.json` under `hooks.PreToolUse` (alongside any existing entries):
     ```json
     {
       "matcher": "Grep|Glob|Bash",
       "hooks": [
         { "type": "command", "command": "py \"~/.claude/hooks/tokensave-first.py\"" }
       ]
     }
     ```
     On Windows, expand `~` to the absolute path (e.g., `py "C:/Users/<name>/.claude/hooks/tokensave-first.py"`). On macOS/Linux, swap `py` for `python3`.
   - **Do NOT** add the hook entry to project-local `settings.local.json` or the project's `.claude/settings.json`. That triggers the tokensave template-inheritance bug.
   - **Do NOT** add `python:*` to project-local permissions allowlist (no longer needed — hook runs globally with `py` launcher).

7a. **Install the status line** (only if `statusline_config` is ON):
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

8e. **Apply pre-commit hooks scaffold** if `precommit_hooks_scaffold` is ON:
   - Copy `_core/project-template/lefthook.yml.template` → `lefthook.yml`.
   - Substitute `{{LINT_COMMAND}}` / `{{TYPECHECK_COMMAND}}` / `{{TEST_COMMAND}}` based on `stack_commands` (use the user's `lint` / typecheck / `test` values; leave as `{{...}}` placeholder if not provided and note the user must fill them).
   - Tell the user: *"Run `lefthook install` once after this setup to activate the hooks. Install lefthook first if needed (brew/scoop/npm/cargo/go binary)."*

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
    > Optionally also add `Evaluate review outcome` (and `Evaluate deep-tier verdict` if deep review is ON) as required status checks under your branch protection rules — this is what makes the binary 🔴/🟢 verdict an actual merge gate.

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
