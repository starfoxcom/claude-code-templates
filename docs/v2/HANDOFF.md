# Hand-offs in the tracker

Status: draft for the maintainer's sign-off, 2026-10-06. Direction approved the same day: one tracker-based hand-off for every bundle, global-first. This file is the record; the sign-off happens in chat.

## Problem

Every bound project keeps one `<PROJECT>-CONTEXT_<date>.md` at the repo root, rewritten by `/session-close`.

- **Cost.** Each close is a commit, a PR and a CI run, even for a solo project with nothing else to ship. This repo merged two such PRs on 2026-10-06 alone (#271, #272).
- **Teams.** One file for everyone means merge conflicts, items nobody owns, and a stale list when two people close sessions on different branches.
- **Duplication.** GameProject, Stockra and voiceapp already keep work state on a GitHub Project board (issue bodies with a `### Current state` section and a `Full history` block, one project status update per session, a board checker). Their hand-off files shrank to 30 to 80 lines and repeat part of the board.
- **Dead switch.** `team_handoff_notes` is documented in `TOGGLES.md` and implemented nowhere. `context_refresh_files` is the file system above.

## Decision

One system for every bundle, solo and team: the tracker holds the state, the repo holds the rules.

| What | Where it goes | Read by `/session-start` |
|---|---|---|
| State of one piece of work: where it stands, next step, measurements, dead ends | The `### Current state` section of its issue's body, newest first; older detail moves to the issue's `Full history` block. | Issues assigned to me that are open and in progress, plus the next ones in queue order |
| Work found during the session | A new issue, from the work-item template, linked to its parent | Same as above |
| An item on hold | Its issue, with the blocked status and a `Waits on:` line | Listed apart, with what each one waits on |
| Project-wide state: headline, what shipped, health, what comes next | One project status update per session that changed something (60 to 80 words) | The latest status update |
| Durable decisions, conventions, gotchas | `.claude/rules/`, `CLAUDE.md`, or the person's memory when it is personal | Loaded as usual |
| Session meta (code-research count, context figures) | The chat only | Not read |

The issue body, not a comment thread, carries the current state, because all three projects that use a board already work that way: the latest state sits at the top of one page, and nobody scrolls a comment pile to find it. A PR body carries only its `Resolves` / `Part of` lines and the usual What/Why; it never holds hand-off state, so there is one place to look.

Any work without an issue gets one at session close. This replaces the "no PR, commit only" row's silent state: the issue is the hand-off even when the branch has no PR yet. A draft PR is not used for this, because the review workflow runs on draft PRs too (`pull_request: opened`), which would put back the CI cost.

### Trackers

Each tracker is a small data profile (like the code-research profiles): how to list my open items, read and edit an item's body, create an item, post a project status update, and which CLI or MCP server does it.

| Tracker | Item state | Project status | Access |
|---|---|---|---|
| GitHub Issues + Projects (default) | Issue body | Project status update (`createProjectV2StatusUpdate`); a private project is fine for a public repo | `gh` |
| GitHub Issues without a project | Issue body | A pinned "Project status" issue; each update is a comment | `gh` |
| GitLab | Issue description | A pinned "Project status" issue | `glab` |
| Jira | Issue description | A "Project status" issue | Atlassian's MCP server |
| Linear | Issue description | Project update | Linear's MCP server |
| Azure Boards | Work item description | A "Project status" work item | `az boards` |

GitHub ships first, with tests, and becomes the default; setup detects it from the git remote. Every other profile is listed as supported only after a run against a free account of that tracker; until then setup marks it untested. A tracker with no native project status gets the same fallback, the pinned status item.

### The setting

`context_refresh_files` and `team_handoff_notes` merge into one setting, `tracker`: which profile, plus the project and status-item ids. Setup fills it from the remote and asks only when it cannot tell. It is an engine setting and a Phase 3 Advanced control; the frozen v1 page and `TOGGLES.md` do not get it.

## Global-first

The two session skills become one global standard instead of a copy per project.

- **Where.** `~/.claude/skills/session-start/` and `session-close/`. Claude Code runs a personal skill over a project skill of the same name, so installing them takes over every repo on the machine at once.
- **Per-project layer.** A committed `.claude/session.md`: front matter with the project's settings (tracker profile and ids, main and development branch, code-research tool), and two sections, `## Extra start steps` and `## Extra close steps`, that the global skills run at fixed points. GameProject's board checker, its scheduled-failure issue sweep and devlog step, Stockra's visual gate and voiceapp's analyzer runs move there.
- **Teammates.** A skill in one person's `~/.claude` does not reach anyone else. The skills therefore ship in the Bindwright plugin (Phase 2b), and a team repo declares that plugin in its committed `.claude/settings.json` (`extraKnownMarketplaces` plus `enabledPlugins`), which teammates get after trusting the folder. Until the plugin exists, team bundles keep rendered project copies of the same skills: one source, two ways of delivering it.
- **Cloud sessions** do not load plugins from project settings. They keep working through the project copy where one exists.
- **The rest of the setup.** Rules that do not vary per project can move to `~/.claude/rules/` the same way. That is a separate design; this one covers the hand-off and the session skills.

## Migration

- **This repo first.** Create a private GitHub Project for it, turn each open item of the current hand-off file into an issue (or update its existing one), post the first status update, move the durable decisions into rules or `CLAUDE.md`, delete the file, and install the global skills. One PR.
- **GameProject, Stockra, voiceapp.** One PR each: move the project's own steps into `.claude/session.md`, delete the project copies of the two skills and the hand-off file, and move what the file still holds (decisions, gotchas, numbers) to rules, memory or the matching issue. The skill-check contracts keep checking that the board is read.
- **Older binds.** The v2 update flow (`/bindwright:update`, adopt mode) detects a `*-CONTEXT_*.md`, proposes where each section goes, and removes the file only after the person approves. v1 binds get no automatic migration, since v1 is frozen.

## Trade-offs

- **Network and auth.** Start and close now need the tracker reachable and signed in. Offline, `/session-start` says it cannot read the tracker and plans from git alone; `/session-close` keeps the state in the chat summary and retries the writes next session.
- **Public repos.** Issue bodies of a public repo are public, the same exposure the committed hand-off file has today. A project status update on a private project stays private.
- **State outside the repo.** A fork or a bare clone carries no hand-off. Acceptable: the state belongs to whoever runs the work.
- **More tracker writes per close** (a few `gh` calls) in exchange for no hand-off PR and no CI run.

## Rejected

- A personal layer beside the shared one: the same job done twice.
- A hand-off file per branch: branch and commit churn, and the file still needs a PR to land.
- Comments as the item state: the latest state gets buried under older comments.
- A draft PR as the hand-off: the review workflow runs on drafts.

## Build order

1. Canonical: tracker profiles (GitHub), the `tracker` setting replacing the two switches, `.claude/session.md` template, global session skills in `_core/global-template/skills/`, engine golden tests updated. Deep review.
2. This repo migrates and dogfoods it.
3. GameProject, Stockra, voiceapp migrate, one PR each.
4. The plugin carries the skills to teammates (with Phase 2b).
5. Each non-GitHub profile, after its free-account run.
