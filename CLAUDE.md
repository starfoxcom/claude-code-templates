# CLAUDE.md — claude-code-templates

This file guides Claude Code when working in **this** repository — the templates project itself.

Yes, the templates project dogfoods itself: the discipline we ship to other projects also applies to development of this repo. The rules below are the same ones a fresh **Multi-dev · OSS** bind would write to your project — except instead of duplicating them at `.claude/rules/`, they live canonically at `_core/project-template/.claude/rules/` and we reference them from here.

If you bind a downstream project from this repo, your `.claude/rules/` gets a *resolved* copy (toggle blocks stripped per your selections). The originals never leave `_core/`.

---

## 🚨 BEFORE ANY CODE RESEARCH

**The first tool for any "where is X / what calls Y / find usages of Z / locate the implementation of W" task MUST be `tokensave_search` or `tokensave_context`. NOT `Grep`. NOT `Glob`. NOT raw `grep`/`rg` in Bash.**

This rule is enforced by a hook at `~/.claude/hooks/tokensave-first.py` (installed **globally**, never project-local — see `reference_tokensave_hook_global_install` memory for why). Grep/Glob/raw-grep calls are **blocked** when tokensave is available.

**This repo has a tokensave index** at `.tokensave/` (32 files / 287 nodes, schema v9). The hook routes code-research through tokensave MCP tools by default. Re-sync incrementally with `tokensave sync` after edits; full rebuild via `tokensave sync -f` after schema migrations or large refactors.

Fallback to Grep/Glob is allowed when:
1. You've tried tokensave with 2+ keyword variants and got nothing usable
2. You're searching non-code content (markdown, binaries, `.gitignored`)
3. `tokensave_status` returns `unavailable` for the scope you need

Bypass for Bash `grep`/`rg`: include `# TOKENSAVE_BYPASS: <reason>` in the command. For Grep/Glob tools: briefly explain in chat and re-issue.

---

## Project overview

**claude-code-templates** is an open-source toolkit for setting up Claude Code in any project. It ships four opinionated bundles (Solo, OSS, Client-solo, Client-team) and a configurable web UI hosted on GitHub Pages.

- **Live page:** `index.html` — also deployed at https://starfoxcom.github.io/claude-code-templates/
- **Source of truth for templates:** `_core/`
- **Bundle-specific overrides:** `bundles/<n>/bundle.toggles.md`
- **In-browser binder:** JSZip-based, client-side, no backend
- **Versioning:** SemVer (`v1.0.0 → v1.1.0 → v2.0.0 …`). Earlier conversational `v17 / v18` mentions consolidated into the v1.0.0 release. See `VERSION` file and `CHANGELOG.md`.

The page itself is the deliverable. There is no separate frontend build step; `index.html` is hand-authored and deployed as-is via the Pages workflow.

---

## Git workflow

Per `_core/project-template/.claude/rules/git.md`:

- **Atomic commits.** One logical change per commit. Format: `<type>(<scope>): <imperative description>` (max 72 chars).
- **Conventional types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `data`.
- **No AI-attribution markers** anywhere — not in commit messages, PR titles, PR bodies, or issue comments. No `Co-Authored-By: Claude`, no `Generated with Claude Code`, no `claude.com` links in footers. The discipline is the work; the tool is a detail.
- **Gitflow branching model.** Per the project's own `_core/project-template/.claude/rules/git.md`:
  - `main` — stable releases only, tag every release commit
  - `develop` — base for all in-flight work
  - `feature/<n>` — branches from `develop`, merges back to `develop`
  - `release/<v>` — branches from `develop`, merges to `main` AND `develop`
  - `hotfix/<n>` — branches from `main`, merges to `main` AND `develop`
- **Always merge commit** on PR merge — never squash or rebase. Keep merge history visible.

---

## Token-efficiency discipline

Per `_core/project-template/.claude/rules/token-efficiency.md`:

- **Task tracking is mandatory for 3+ step sessions.** Use the `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` tools (standard Claude Code as of v2.1.142, default-flip May 2026; opt-in available since v2.1.16, Jan 2026; on older builds or when `CLAUDE_CODE_ENABLE_TASKS=0` is set, `TodoWrite` is the fallback). Enumerate the planned steps with `TaskCreate` at session start. To chain dependencies, capture each new task's ID from the `tool_result` and call `TaskUpdate({ taskId, addBlockedBy: [<prereq-id>] })` (`addBlockedBy` is a `TaskUpdate` input parameter, not a separate tool). `TaskUpdate({ taskId, status: 'in_progress' })` BEFORE starting; `TaskUpdate({ taskId, status: 'completed' })` immediately when done — don't batch. New follow-ups discovered mid-session get their own `TaskCreate` call. The task list is the in-session source of truth and the basis for the session-close DoD audit. Single-task or trivial conversational work doesn't need it; the threshold is 3+ discrete items. **For multi-PR workstreams** (hotfix + cascade chains, large refactors split for review), create one task per PR up-front and chain dependencies with `TaskUpdate({ taskId, addBlockedBy: [<prior-pr-task-id>] })` so the task list mirrors the merge order — treating a 10-PR chain as ad-hoc work burns hours on out-of-sequence routing.
- **Read before writing.** Locate the relevant function/class before reading whole files. Use `tokensave_body <symbol>` to pull a single symbol's source when reading the whole file would be wasteful.
- **Command timeout scaling.** Default starting timeout for builds: 420 000 ms. Each retry escalates by 120 000 ms.
- **Never use `gh run watch`.** Always poll `gh run list` with a background loop — see the canonical pattern in the rule file.
- **CI polling cadence is fixed by PR class, and ALL cadences run in the background.** Use the Bash tool with `run_in_background: true` and an until-loop — never foreground-sleep. The harness notifies on exit; pick up other work while CI runs.
  - **Fast-path / auto-pass PRs** (docs-only, rules-only, anything `triage` classifies non-reviewable) — background until-loop with `sleep 90` per check, then `gh pr view <pr> --json statusCheckRollup`. Expect `Diff triage: SUCCESS`, `Evaluate review outcome: SKIPPED`. Auto-merge with `gh pr merge <pr> --merge --admin`.
  - **Normal-review PRs** — background until-loop with `sleep 420` (7 minutes) between checks. Read the routine reviewer's verdict comment via `gh pr view <pr> --json comments` and act on the last non-empty 🟢/🔴 line. On 🟢, merge with `--merge --admin`; on 🔴, fix on the PR branch and push.
  - **Workflow-touching PRs** (`.github/workflows/claude*.yml`) — same 7-minute background loop. Expect `Workflow validation failed` because App auth blocks the action. Confirm via `gh run view --job <id> --log-failed` (look for `Workflow validation failed`), then `--admin` merge. This is the ONLY scenario where `--admin` is justified pre-verdict; for all other PRs, wait for the comment.
- **Branch cleanup after every merge.** Delete the branch BOTH locally and on remote. Chain `git branch -D <name> && git push origin --delete <name>` into the post-merge sequence — `gh pr merge --delete-branch` only handles remote.
- **Auto-merge on paths-ignore PRs is OFF** for this repo. The OSS bundle defaults this off because a public repo deserves a human eyeball on every PR.
- **Usage ceiling:** at ≥80%, commit locally and stop. Don't push to PR (CI run costs 10–15% of remaining capacity).

---

## Review discipline — strict because supply-chain matters

This project ships templates that downstream users install verbatim. A malicious PR landing on `main` could inject hidden code into the bundle that every future bind ships to every user. That makes the review surface load-bearing in a way ordinary OSS isn't.

Per `_core/project-template/.claude/rules/review-tiers.md`, applied with extra strictness here:

- **Two tiers.** Routine review (Sonnet, every PR) + on-demand deep review (Opus, fired by `@claude review` comment).
- **Binary verdict rule.** `🟢 LGTM` only when fully clean. `🔴 Blocking` when *any* real finding exists. No "minor non-blocking" rot. This applies to both tiers.
- **Auto-fire deep review** on the trigger surface (parsing/codec/serialization, threading, scheduling, save/load formats, mod-loader DAG changes — full list in `git.md`). The routine reviewer applies the `needs-deep-review` label automatically.
- **Strict OSS review posture on `main` AND `develop`:**
  - Required-status-checks: routine-review verdict MUST be 🟢 before merge
  - Required approvals: 1 (the maintainer manually approves after reading the AI verdict)
  - Bypass: admin role only (the maintainer can self-merge their own PRs without the approval; that's their accountability)
  - Every external contribution: AI routine review verdict + maintainer eyes-on review + approval = three signals before merge
  - Deep review fires automatically on any PR touching `_core/`, the bundled `index.html`, `_core/project-template/.claude/hooks/`, or `redesign/*.jsx`. These are the highest-blast-radius surfaces.

The routine-review + deep-review workflows are tracked-follow-up for installation here (issue #1) — they exist canonically in `_core/project-template/.github/workflows/` and need to be copied to the project's own `.github/workflows/` to self-host the same discipline the templates ship.

---

## Visual-slice discipline

The page IS a visual artifact. Per `_core/project-template/.claude/rules/visual.md`:

- Ship one verifiable slice at a time. Smaller than ~150 lines of net change per slice.
- **Local-iterate-then-push** for visual changes. Commit locally, report, wait for visual approval, then push. Skipping this burns CI cycles on iteration.
- **Concrete visual smoke-test checklists** — never "verify no regressions." Hand the reviewer a specific yes/no list tied to what changed.

---

## Session ritual

Skills `/session-start` and `/session-close` (and `/find`, `/architecture-graph`) live at `.claude/skills/` — this repo is self-bound from `_core/project-template/.claude/skills/` per `bundles/2-multi-dev-oss/bundle.toggles.md` with Discovery-mode resolution for null toggles. See `.claude/BIND.md` for the full audit trail (placeholders, toggle decisions, evidence). When templates evolve in `_core/`, re-resolve and replace the corresponding `.claude/skills/*.md` files; once issue #3 (v1.2.0 Audit mode) ships, that flow becomes automated.

---

## What's intentionally NOT here

- **No `.claude/rules/` duplication** — rules live canonically in `_core/project-template/.claude/rules/` and are referenced from here. A downstream bind copies them out with toggle blocks resolved.
- **Routine + deep review workflows not yet installed** — the workflows exist canonically in `_core/project-template/.github/workflows/` but haven't been copied to this project's own `.github/workflows/` yet. Tracked follow-up.

---

## Repo layout

```
claude-code-templates/
├── index.html              # the live page
├── README.md               # public-facing
├── CLAUDE.md               # this file
├── CHANGELOG.md            # version history
├── CONTRIBUTING.md         # how to PR
├── LICENSE                 # MIT
├── VERSION                 # current edition
├── COMPARISON.md, TOGGLES.md, SETUP.md
├── _core/
│   ├── project-template/   # lands in user's repo on bind
│   ├── global-template/    # lands in user's ~/.claude on bind
│   └── licenses/           # LICENSE variants per type
├── bundles/                # four bundle defaults
│   ├── 1-solo-personal/
│   ├── 2-multi-dev-oss/
│   ├── 3-client-solo/
│   └── 4-client-team/
└── .github/
    └── workflows/
        └── pages.yml       # GitHub Pages deployment
```

---

## Project conventions

- **All code + prose in English.** Variable names, comments, manifest text, docs.
- **HTML/CSS in `index.html` is hand-authored** — no build step, no minification. The file is meant to be readable in a browser dev tools window.
- **OKLCH for color** in CSS — see the v1.0.0 redesign rationale in `CHANGELOG.md`.
- **Geist (sans + mono) from Google Fonts** — loaded via `<link>` at the top of `index.html`.
- **JSZip loaded on demand from CDN** for the bundle generator. No npm, no node_modules, no bundling.
