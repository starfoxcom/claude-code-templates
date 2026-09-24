# Bindwright 2.0 plan

Status: approved by the maintainer on 2026-09-23. This file is the working record for the v2 overhaul. Sessions read it before touching v2 work and update the phase checklist as PRs merge.

## Goal

Rename the project to **Bindwright** and rebuild it so the path from "land on the page" to "Claude Code follows my house rules and my PRs get reviewed" works on the first try with almost no decisions.

## Why

- **Name.** Anthropic's Claude Code legal page says third parties cannot use "Claude Code" or "Anthropic" as part of a product name or logo. Plain descriptive text such as "works with Claude Code" is allowed. A larger unrelated project (`davila7/claude-code-templates`) already uses the same name.
- **The download does not work.** `bindAndDownload()` writes six files (manifest, VERSION, SETUP.md, one bundle file, README.txt, PASTE-TO-CLAUDE.md) and none of `_core/`. The paste brief then points Claude at a path that does not exist, so the run aborts.
- **Too many decisions.** 36 tri-state switches, a mode choice, and three tool slots that change nothing in the output. Five switches have no template content at all.
- **Drift.** The review workflows and rules are about three months behind Emberholm and Stockra, which fixed real gate holes (for example, triage dying currently auto-passes both checks).
- **Weight.** SETUP.md is 54 KB. The always-loaded rules are about 490 lines, with duplicated sections and two contradictions.

## Decisions

| Area | Decision |
|---|---|
| Name | Bindwright. "for Claude Code" only as descriptive text, never in the name or logo. |
| Page tech | Plain HTML, CSS and JS. No React, no in-browser Babel, no build step. |
| Look | Dark graphite with tactile key controls. The answer combo's hue is the only accent. See `DESIGN.md` and `mockup.html`. |
| Choices | Two questions (just me or a team; my project or a client's) plus an Advanced drawer with at most seven switches. |
| Bind | Deterministic. The page renders `_core/` in the browser and the zip is a ready overlay for the repo root. Claude only does judgment work afterward (`TAILOR.md`, about 5 KB). |
| Review gate | One required check, "Review gate". Shared logic in `.github/scripts/review_gate.py`, settings in `.github/review-gate.yml` and repo variables, so the workflow file is identical for every user. Primary model Fable 5.1 (low effort), one-shot fallback Opus 5.5 (medium). |
| Code-research tools | Keep several options, but only ones that research shows are good. Each tool is a small data profile, not install prose. |
| Guard hooks | Ship in the repo (`.claude/hooks/`), registered in the committed `.claude/settings.json`, with `attribution` turned off, so cloud sessions and teammates get them. |
| Licensing | Repo stays MIT. Generated output ships under MIT-0 so users owe no attribution. Add a non-affiliation notice, `SECURITY.md`, and a code of conduct. |
| Merge style and branching | Not a fixed rule. Merge method (merge commit, squash, rebase) and branching model become Advanced choices with a researched default. Research in progress; the result also applies to this repo, Emberholm and Stockra. |
| Version | v2.0.0 (breaking: toggle model, bind format, review gate). |

## Phases

Each item is one PR unless noted. Workflow files land on `main` first (hotfix + cascade), everything else on `develop`.

### Phase 1: engine
- [ ] New answer model: two questions, advanced switches, presets kept internal. Delete dead toggles and dead tool slots; bake in the always-same toggles.
- [ ] Deterministic renderer (browser JS, plus a stdlib Python twin for CI tests) that resolves toggle blocks and placeholders against `_core/`.
- [ ] Code-research tool profiles (data file) replacing the SETUP.md hook-install prose.
- [ ] `TAILOR.md` replaces SETUP.md. `install-global.py` handles `~/.claude` changes.
- [ ] Rules trimmed to one owner per concept (about 200 always-loaded lines), `paths:` scoping, new rules: task-tracking, testing, code-size (language profiles), shipped-text (toggle). Fix the squash and self-merge contradictions. Monitor-based CI watching replaces polling loops.
- [ ] Skills updated from Emberholm and Stockra (stop conditions, cascade step, `--body-file`, measured adherence). `architecture-graph` becomes an add-on.
- [ ] Repo-level hooks and `attribution` settings (this repo first, then canonical).

### Phase 2: review gate v2
- [ ] Prototype the single-check workflow and `review_gate.py` on this repo (hotfix to `main`, then cascade).
- [ ] Port general fixes from Emberholm: triage fail-closed, paginated file list, enforced escalation, sticky label, subagent ban, tiered verdict parsing, failure classifier, current action pin. Keep the `claude[bot]` author filter.
- [ ] `scripts/setup-review-gate.sh` (labels, merge settings, ruleset, secret, App check) with a read-only `--check` mode used by session-start.
- [ ] Canonical templates follow the prototype once it has run on real PRs.

### Phase 3: the page
Built in visual slices of about 150 lines each, checked locally by the maintainer before any push.
- [ ] Shell, tokens, fonts, header, theme.
- [ ] Two-question picker with key controls and the hue accent.
- [ ] Live file tree and file preview driven by the renderer.
- [ ] Advanced drawer, URL state and Share link.
- [ ] Download, review panel, mobile bottom bar.
- [ ] Secondary pages: compare, all settings, how it works.

### Phase 4: rename and release
- [ ] Rename the repo and Pages site, update every reference, add the non-affiliation notice, `SECURITY.md`, code of conduct, MIT-0 for output.
- [ ] Release v2.0.0 (release branch, tag, cascade).

## Follow-ups outside this repo
- Emberholm and Stockra: the routine-verdict lookup no longer filters on the `claude[bot]` author. Both repos are private, so the risk is low. The maintainer decides when to fix it.
