# Bindwright 2.0 plan

Status: approved by the maintainer on 2026-09-23. This file is the working record for the v2 overhaul. Sessions read it before touching v2 work and update the phase checklist as PRs merge.

## Goal

Rename the project to **Bindwright** and rebuild it so the path from "land on the page" to "Claude Code follows my house rules and my PRs get reviewed" works on the first try with almost no decisions.

## Why

- **Name.** Anthropic's Claude Code legal page says third parties cannot use "Claude Code" or "Anthropic" as part of a product name or logo. Plain descriptive text such as "works with Claude Code" is allowed. A larger unrelated project (`davila7/claude-code-templates`) already uses the same name.
- **The download does not work.** `bindAndDownload()` writes six files (manifest, VERSION, SETUP.md, one bundle file, README.txt, PASTE-TO-CLAUDE.md) and none of `_core/`. The paste brief then points Claude at a path that does not exist, so the run aborts.
- **Too many decisions.** 36 tri-state switches, a mode choice, and three tool slots that change nothing in the output. Five switches have no template content at all.
- **Drift.** The review workflows and rules are about three months behind GameProject and Stockra, which fixed real gate holes (for example, triage dying currently auto-passes both checks).
- **Weight.** SETUP.md is 54 KB. The always-loaded rules are about 490 lines, with duplicated sections and two contradictions.

## Decisions

| Area | Decision |
|---|---|
| Name | Bindwright. "for Claude Code" only as descriptive text, never in the name or logo. |
| Page tech | Plain HTML, CSS and JS. No React, no in-browser Babel, no build step. |
| Look | Dark graphite with tactile key controls. The answer combo's hue is the only accent. See `DESIGN.md` and `mockup.html`. |
| Choices | Two questions (just me or a team; my project or a client's) plus an Advanced drawer with at most seven switches. |
| Bind | Deterministic. Decided 2026-09-24: Bindwright ships as a Claude Code plugin. The page ends in a setup code; `/bindwright:setup <code>` renders `_core/` in the repo with the plugin's own engine and templates, then does the judgment work (merge existing `CLAUDE.md`, README and friends, fill real lint and test commands, trim the code-size table to the repo's languages, offer the `~/.claude` extras). A zip download stays as the fallback for people without plugins. |
| Previews | Three live panes on the page: (1) the files the setup produces; (2) a small TypeScript demo app with planted problems, shown before and after for every setting that has a visible effect, as red and green diffs; (3) a Claude Code terminal replay of skills and rules in action, with and without Bindwright, chosen from a list of scenario prompts. Panes 2 and 3 come only from real recorded runs: session logs replayed as a terminal chat, never hand-written. Each recording stores a hash of the files it exercised, and a test fails when they change so stale demos cannot ship. |
| Plugin lifecycle | `/bindwright:update` rebuilds with the answers saved in `.bindwright/` and a three-way merge against the stored pristine render, so hand edits are never overwritten silently. A once-a-day SessionStart notice (cached, silent offline) says when the plugin or the repo's files are behind. `/bindwright:audit` reads recent session logs, measures how the rules hold up, and proposes exact edits that apply only on approval. |
| Engine runtime | Decided 2026-09-24: the JS engine plus a byte-identical stdlib Python twin, held together by a golden test, so `/bindwright:setup` runs wherever Node or Python exists. Neither is guaranteed (native Windows may have only PowerShell), so the zip download stays as the fallback. |
| Adoption | Decided 2026-09-24 after both source projects judged a whole install would cost them more than it gives (`research/adoption-impact.md`). First run on a repo with its own setup is adopt mode: it proposes diffs piece by piece, never overwrites, and the adopted result becomes the pristine base for later updates. A manifest of project-owned files and keep markers inside shared files are never touched by `/bindwright:update`. The gate and the session skills get plug-in points for project checks and steps. |
| No admin bypass | Decided 2026-09-24: nothing Bindwright ships tells anyone to merge with admin rights, and there is no setting for it. Setup recommends rulesets with no bypass actors and zero required approvals, so the review checks alone decide. A blocked PR means fix the cause; a blocked hotfix means release first. |
| Review gate | One required check, "Review gate", by default; two checks (routine plus deep) as an option for projects that already run them. Shared logic in `.github/scripts/review_gate.py`, settings in `.github/review-gate.yml` and repo variables, so the workflow file is identical for every user. Primary model Fable 5.1 (low effort), one-shot fallback Opus 5.5 (high effort). The fallback effort is a founder decision of 2026-09-24, to offset the spent Fable allowance; the best-of-three head-to-heads chose Opus 5.5 at medium. These are defaults the user can change; see Model choice. |
| Model choice | Decided 2026-09-30. Bindwright names a model only where a workflow has to: the two review tiers. Each tier has a primary and a fallback, each a model plus an effort level, and every one of them is a user setting. The defaults are the maintainer's measured picks, the same in GameProject and Stockra: Fable 5.1 low, falling back to Opus 5.5 high. Setup asks nothing about models; its closing summary names the values and the file that holds them (`.github/review-gate.yml`), and the answers file can override them for people who know what they want. A model the workflow's CLI refuses fails the review with a message naming the setting, never a silent pass. Bindwright never sets the session's model or effort: no `model` in the shipped `settings.json`, no model advice in the session ritual, and the token-efficiency rule tells `Workflow` and agent calls to leave `model` and `effort` out so they follow the session. |
| Code-research tools | Offer tokensave, Claude Code LSP plugins, CodeGraph, Serena, codebase-memory-mcp, none, and custom. Drop Semgrep, Sourcegraph and ctags (wrong category or audience). Each tool is a small data profile, not install prose. See `research/code-research-tools.md`. |
| Guard hooks | Ship in the repo (`.claude/hooks/`), registered in the committed `.claude/settings.json`, with `attribution` turned off, so cloud sessions and teammates get them. |
| Licensing | Repo stays MIT. Generated output ships under MIT-0 so users owe no attribution. Add a non-affiliation notice, `SECURITY.md`, and a code of conduct. |
| Branching | Default stays `main` for production and `develop` for integration. GitHub flow and trunk-based are Advanced options. Decided 2026-09-24: GameProject and Stockra make `develop` the GitHub default branch (every hotfix in the period was a workflow change; the switch removes the hotfix-plus-cascade pair). This repo keeps `main` as default because it is public and visitors should see the released README; the Bindwright default stays `main`, with `develop` as default an Advanced option. See `research/merge-and-branching.md`. |
| Merge style | Every PR merges with a merge commit, so each branch stays visible in the history graph (the maintainer reversed the squash default on 2026-09-29: squash flattened the graph). Release and cascade PRs are merge commits under every style so the branches never diverge. Squash and rebase are Advanced options. Applies to this repo, GameProject and Stockra. See `research/merge-and-branching.md` for the earlier squash reasoning. |
| Claude Code mods | Decided 2026-10-02. Claude Code 2.1.287 added mods: plugins of function hooks that can gate tool calls, add prompt context, take over compaction and draw panes and bands. Bindwright offers them as `~/.claude` extras, installed only with consent and only on 2.1.287 or later, since the API is early access. The guard hooks stay settings hooks, because those run on every version, in cloud sessions and for teammates. Defaults: session facts (time, context fill against the compaction window, plan usage) is pre-checked. These are opt-in: the compaction hand-off (once its A/B passes), shared-PC turn-taking for heavy local work, the usage guard (pause and resume near plan limits) and the status line pieces (local runners through a config file). Every mod has a hard disk cap and cleans up after itself, scales any text it injects to the context window, and keeps its data under `~/.claude/mods-data/<mod>/`. Nothing machine- or project-specific ships. |
| Version | v2.0.0 (breaking: toggle model, bind format, review gate). |

## Phases

Each item is one PR unless noted. Workflow files land on `main` first (hotfix + cascade), everything else on `develop`.

Until Phase 3 lands, the current page (`index.html`, `redesign/*.jsx`) and `SETUP.md` stay frozen at v1 and are not kept in sync with the engine. New options get their controls in the Phase 3 Advanced drawer. `main` and the live page change only with the v2.0.0 release.

### Phase 1: engine
- [x] New answer model: two questions, advanced switches, presets kept internal. Delete dead toggles and dead tool slots; bake in the always-same toggles.
- [x] Deterministic renderer (browser JS) that resolves toggle blocks and placeholders against `_core/`.
- [x] Python twin of the engine with a golden test that fails when the two renders differ. `engine/*.py` mirror the JS files one to one; `engine/test/golden.test.js` compares about 200 binds and the error messages for bad answers. No CI job runs the engine tests yet, so the test runs locally.
- [ ] Code-research tool profiles (data file) replacing the SETUP.md hook-install prose.
- [ ] Plugin skeleton (`plugin/`: `plugin.json`, skills, engine, templates) and `/bindwright:setup` (replaces `SETUP.md` and the planned `TAILOR.md`; installs `~/.claude` extras only with consent). Setup-code format shared with the page.
- [x] Rules trimmed to one owner per concept (about 200 always-loaded lines), `paths:` scoping, new rules: task-tracking, testing, code-size (language profiles), shipped-text (toggle). Fix the squash and self-merge contradictions. Monitor-based CI watching replaces polling loops.
- [x] Skills updated from GameProject and Stockra (stop conditions, cascade step, `--body-file`, measured adherence). `architecture-graph` is held out of setups until it returns as an add-on.
- [x] Repo-level hooks and `attribution` settings (this repo first, then canonical). Hook location is a setting (repo or `~/.claude`) with duplicate detection, because GameProject keeps hooks global only. Shipped as the `hookLocation` and `attributionGuard` switches; the attribution guard is opt-out (on by default) because attribution is a personal preference, and its rule is "no attribution", not "no mention". Duplicate detection lives in `run-hook.sh`, which steps aside for a guard registered in `~/.claude/settings.json`.
- [x] Deny-list profiles (standard and strict) in a committed `.claude/settings.json`. The force-push deny must not block `--force-with-lease`. Shipped as the `denyProfile` switch: `standard` blocks force pushes, direct pushes to the main and development branches, interactive rebase and admin merges; `strict` adds `git reset --hard`, `git clean -f`, deleting those branches, `gh repo delete` and `gh api` DELETE calls. `settings.local.json` keeps only the allow list.
- [x] Shipped-text scope as a per-project list of globs. Shipped as the `shippedTextPaths` switch: the rule keeps its default globs in its frontmatter, and the engine swaps in a project's list after rendering, so neither the canonical placeholder scan nor `SETUP.md` changes.
- [x] Remove every admin-merge instruction from rules and workflow templates (#155, #156).
- [ ] One line in the canonical token-efficiency rule: `Workflow` and agent calls leave `model` and `effort` out so they follow the session's choice (see Model choice).

### Phase 2: review gate v2
- [ ] Prototype the single-check workflow and `review_gate.py` on this repo (hotfix to `main`, then cascade).
- [ ] Port general fixes from GameProject: triage fail-closed, paginated file list, enforced escalation, sticky label, subagent ban, tiered verdict parsing, failure classifier, current action pin. Keep the `claude[bot]` author filter.
- [ ] `scripts/setup-review-gate.sh` (labels, merge settings, ruleset, secret, App check) with a read-only `--check` mode used by session-start.
- [ ] Extension points: a project pre-screen directory, project escalation triggers (paths and patterns), reviewer tool allowlist, max turns, primary and fallback model and effort per tier (see Model choice) with usage-limit detection, runner label (`runs-on`), one or two checks.
- [ ] Merging PRs that edit the review workflow without a bypass. The review action refuses to run on them. Stockra's working answer: triage never reviews `.github/workflows/**`, so a workflow-only PR passes as non-reviewable. `review_gate.py` excludes that path explicitly with a comment on why, never through a file-extension accident. Two rules come with it: a workflow edit ships in a PR of its own (mixed with code it deadlocks), and, because no AI review covers it in CI, it is reviewed before merge: by two fresh local subagent reviews on the head commit, recorded in a PR comment with that SHA, when every commit came from the maintainer's own sessions (the routine prompt taken from the base branch), otherwise by the maintainer reading the whole diff (decided 2026-09-25). A later option: review workflow diffs with a plain CLI or API call, which the action's check does not apply to.
- [ ] Canonical templates follow the prototype once it has run on real PRs. Until then the templates still pin an action whose CLI predates Fable 5.1 and refuses Opus 5.5, so `REVIEW_MODELS` in the engine (Sonnet 4.6 and Opus 4.8) changes in the same PR as the action pin, never before: a default the pinned CLI refuses would fail every review. The engine's single model per tier becomes the Model choice settings in that PR.

### Phase 2b: plugin lifecycle
- [ ] `.bindwright/` state: saved answers, template version, pristine render for three-way merges.
- [ ] Adopt mode, the project-owned manifest and keep markers.
- [ ] Add-ons: GitHub Project board tracking in place of `ROADMAP.md`; a code-size checker with a baseline ratchet that fails CI on any new breach.
- [ ] `/bindwright:update` and the daily SessionStart notice.
- [ ] `/bindwright:audit`: measurements from session logs, proposed edits applied on approval. It covers only what the built-in `/doctor prompt-audit` misses (that one already checks instruction files for outdated advice, stale paths and commands, and contradictions) and points to it for the rest (maintainer, 2026-10-02).
- [ ] Marketplace: own marketplace first, then a community-marketplace submission.
- [ ] Mods as `~/.claude` extras: canonical copies in `_core/global-template/mods/`, `/bindwright:setup` writes the `CLAUDE_CODE_PLUGIN_DIRS` entry only with consent, and a version check skips them before 2.1.287. Checked 2026-10-02: a mod inside a project's `.claude/skills/<name>` folder does not load (the same mod loads through `--plugin-dir`), so a repo cannot ship a mod to its teammates that way; mods stay `~/.claude` extras. The built-in "You should know" mod is a side agent that reviews each session for misses: it costs a model call per check and needs telemetry, overlaps none of these mods, and setup leaves it off by default with a one-line note on its cost.

### Phase 3: the page
Built in visual slices of about 150 lines each, checked locally by the maintainer before any push.
- [ ] Shell, tokens, fonts, header, theme.
- [ ] Two-question picker with key controls and the hue accent.
- [ ] Live file tree and file preview driven by the renderer.
- [ ] Demo project (`demo/`): a small TypeScript app with one planted problem per rule that has a visible effect.
- [ ] Recording harness: headless Claude Code runs per scenario, with and without Bindwright, saved as sanitized replay data with the staleness hash test.
- [ ] Demo pane: before and after diffs per setting.
- [ ] Terminal pane: scenario picker and replay of recorded sessions.
- [ ] Advanced drawer, URL state and Share link.
- [ ] Setup code, zip fallback, review panel, mobile bottom bar.
- [ ] Evidence section: numbers from `tools/receipts.py` (session logs and PR history) plus the incident stories from GameProject and Stockra, each with the rule it produced.
- [ ] Secondary pages: compare, all settings, how it works.

### Phase 4: rename and release
- [ ] Rename the repo and Pages site, update every reference, add the non-affiliation notice, `SECURITY.md`, code of conduct, MIT-0 for output.
- [ ] Release v2.0.0 (release branch, tag, cascade).

## Follow-ups outside this repo
- GameProject and Stockra: the routine-verdict lookup no longer filters on the `claude[bot]` author. Both repos are private, so the risk is low. The maintainer decides when to fix it.
