# Hand-offs in the tracker, project settings and shared setups

Status: signed off by the maintainer on 2026-10-07; drafted 2026-10-06. Direction approved the same day: one tracker-based hand-off for every bundle, global-first, plus a way to share a project's setup with its team. This file is the record; the sign-off happens in chat. Amended 2026-10-07: project status updates post only on a real change of state (see Project status updates), agreed with the maintainer for all four projects.

## Problem

Every bound project keeps one `<PROJECT>-CONTEXT_<date>.md` at the repo root, rewritten by `/session-close`.

- **Cost.** Each close is a commit, a PR and a CI run, even for a solo project with nothing else to ship. This repo merged two such PRs on 2026-10-06 alone (#271, #272).
- **Teams.** One file for everyone means merge conflicts, items nobody owns, and a stale list when two people close sessions on different branches.
- **Duplication.** The maintainer's three other projects already keep work state on a GitHub Project board (issue bodies with a `### Current state` section and a `Full history` block, one project status update per session, a board checker). The per-session updates turned into a session log, some days three or four of them. Their hand-off files shrank to 30 to 80 lines and repeat part of the board.
- **Dead switch.** `team_handoff_notes` is documented in `TOGGLES.md` and implemented nowhere. `context_refresh_files` is the file system above.

## Decision

One system for every bundle, solo and team: the tracker holds the state, the repo holds the rules.

| What | Where it goes | Read by `/session-start` |
|---|---|---|
| State of one piece of work: where it stands, next step, measurements, dead ends | The `### Current state` section of its issue's body, newest first; older detail moves to the issue's `Full history` block. | Issues assigned to me that are open and in progress, plus the next ones in queue order |
| Work found during the session | A new issue, from the work-item template, linked to its parent | Same as above |
| An item on hold | Its issue, with the blocked status and a `Waits on:` line | Listed apart, with what each one waits on |
| Project-wide state: health and plan | A project status update, posted only when that state truly changes (see Project status updates). Most sessions post none. | The latest status update, with the question "is its colour still true?" |
| Durable decisions, conventions, gotchas | `.claude/rules/`, `CLAUDE.md`, or the person's memory when it is personal | Loaded as usual |
| Session meta (code-research count, context figures) | The chat only. A count that stays low across sessions becomes a rule change, not a hand-off line. | Not read |

The issue body, not a comment thread, carries the current state, because all three projects that use a board already work that way: the latest state sits at the top of one page, and nobody scrolls a comment pile to find it. A PR body carries only its `Resolves` / `Part of` lines and the usual What/Why; it never holds hand-off state, so there is one place to look.

Any work without an issue gets one at session close. This replaces the "no PR, commit only" row's silent state: the issue is the hand-off even when the branch has no PR yet. A draft PR is not used for this, because the review workflow runs on draft PRs too (`pull_request: opened`), which would put back the CI cost.

### Project status updates

A status update says the project's state changed; it is not a session log. It is posted only when a milestone, or a major arc of one, completes (`COMPLETE`, with a short recap), when the health colour changes between on track, at risk and off track (with the reason), or when the plan changes (a goal redefined, a date moved, a direction call). Its shape is a dated headline, a `Health:` line and a `Plan:` line, about 60 to 100 words.

- `/session-start` reads the newest update and asks whether its colour is still true; if not, that is a colour change and the session posts one.
- `/session-close` checks the three triggers and posts only when one fired. No checker or skill contract requires an update per session.
- Board checkers drop the age check. They check that every closed milestone has a later `COMPLETE` update, and that an at-risk or off-track update carries its reason.
- A feed that holds updates below this bar is cleaned by archiving each removed body verbatim into a committed repo file, then deleting it from the board with the maintainer's yes, then posting one update on where the milestone stands.

The rule lives in one place per machine, `~/.claude/rules/status-updates.md` (live since 2026-10-07), and each project's `CLAUDE.md`, session skills and board checker point at it. The canonical copy for bound projects ships with build step 1, since the templates do not ship a board before that.

### Trackers

Each tracker is a small data profile (like the code-research profiles): how to list my open items, read and edit an item's body, create an item, post a project status update, and which CLI or MCP server does it. The issues may live in a different repo or project from the code, for example a board kept apart from a private code repo.

| Tracker | Item state | Project status | Access |
|---|---|---|---|
| GitHub Issues + Projects (default) | Issue body | Project status update (`createProjectV2StatusUpdate`); a private project is fine for a public repo | `gh` |
| GitHub Issues without a project | Issue body | A pinned "Project status" issue; each update is a comment | `gh` |
| GitLab | Issue description | A pinned "Project status" issue | `glab` |
| Jira | Issue description | A "Project status" issue | Atlassian's MCP server |
| Linear | Issue description | Project update | Linear's MCP server |
| Azure Boards | Work item description | A "Project status" work item | `az boards` |

GitHub ships first, with tests, and becomes the default; setup detects it from the git remote. Every other profile is listed as supported only after a run against a free account of that tracker; until then setup marks it untested. A tracker with no native project status gets the same fallback, the pinned status item.

Issue bodies follow the shape two of those projects already enforce with the global `issue-body-contract.py` hook (what it is, why it matters, current state, done when, blocked by, milestone, then the full-history block). Shipping that hook as a canonical, opt-in guard is a follow-up, not part of this change.

## Settings layers

Bindwright settings sit in three layers, the same way Claude Code's own settings do. A later layer wins, except for keys the project marks as required, which a personal layer cannot change.

| Layer | File | Holds | Shared |
|---|---|---|---|
| Personal, every project | `~/.claude/bindwright/settings.json` | Personal defaults: preferred code-research tool, which `~/.claude` extras (mods) are on, default tracker | No |
| Project | `.bindwright/project.json`, committed | The team's setup: tracker profile and ids, branch names, review gate settings, chosen rules and switches, extras the project requires or recommends | Yes, through git |
| Personal, this project | `.bindwright/local.json`, git-ignored | One person's overrides for this project | No |

`.bindwright/project.json` is the "saved answers" that Phase 2b already plans for `.bindwright/`, so nothing new is added to the repo layout. Beside it, `.bindwright/session-steps.md` holds the project's own session steps in two sections, `## Extra start steps` and `## Extra close steps`, which the global session skills run at fixed points: a board checker, a sweep of scheduled-failure issues, a visual gate, analyzer runs. The session skills read both files directly, so they work before the plugin exists and nothing moves when it lands.

## Sharing a setup with the team

Goal: a teammate clones the repo and is in sync and working in minutes, with no hand-written setup notes.

- **The repo is the share.** Everything a team needs lives in `.bindwright/` and the committed `.claude/settings.json`, which declares the Bindwright marketplace and plugin (`extraKnownMarketplaces`, `enabledPlugins`). A teammate who trusts the folder gets the plugin from it; cloud sessions do not load plugins this way and keep working from the committed rules.
- **`/bindwright:export`** writes my current effective setup into `.bindwright/project.json`: it keeps what is about the project, drops machine paths, secrets and personal identity, and asks which of my personal extras to mark as recommended for the team. It can also write the same content as a portable file or setup code, to start another repo with the same setup or to share it outside git.
- **`/bindwright:join`** runs on a teammate's machine. It compares the project's setup with theirs and walks through each difference with consent: tracker access (`gh auth status`, or the profile's CLI or MCP server), the code-research tool, recommended extras, required plugins. It ends by running `/session-start`, so the teammate sees the board and the plan right away.
- **Staying in sync.** The once-a-day SessionStart notice (already planned in Phase 2b) also says when a person's setup has drifted from the project's.
- **Safety.** A shared setup is data only: settings and the names of profiles and extras that ship with the plugin. Importing never runs code from the file, unknown keys are listed and not applied, a setup code from outside the repo is shown in full before anything applies, and personal values change only with consent through the same three-way merge as `/bindwright:update`. The format carries a schema version; a plugin older than the file says so and stops. This crosses a trust boundary, so its PR gets a deep review.

## Global-first

The two session skills become one global standard instead of a copy per project.

- **Where.** `~/.claude/skills/session-start/` and `session-close/` on this machine now; inside the Bindwright plugin once it exists. Claude Code runs a personal skill over a project skill of the same name, so installing them takes over every repo on the machine at once. That is why the install comes last (see Build order).
- **Teammates.** A skill in one person's `~/.claude` does not reach anyone else, so team setups get the skills through the plugin, declared in the repo as above. Until the plugin exists, team bundles keep rendered project copies of the same skills: one source, two ways of delivering it.
- **The rest of the setup.** Rules that do not vary per project can move to `~/.claude/rules/` the same way. That is a separate design; this one covers the hand-off, the session skills and the settings layers.

## Effect on the current workflow

Checked 2026-10-06 against this machine's hooks, mods, workflows and the four repos.

| Part | What changes | Handling |
|---|---|---|
| Skill precedence | Installing global skills silently replaces the project skills of every repo at once, including the long project-specific closes with their board and definition-of-done steps. | The global install waits until all four repos carry their `.bindwright/session-steps.md`; until then each repo runs a project copy rendered from the global source. Done in one window, with the other local sessions told first. |
| `~/.claude/skill-contracts.json` | One project's close contract requires writing and `git rm`-ing its `*-CONTEXT_*.md`; after the move it would report two missed steps every close. | That project's migration PR changes those two entries in the same window. Its board-check entry stays valid; its every-close status-update entry was removed on 2026-10-07 with the new status-update rule. |
| `issue-body-contract.py` | Already demands the issue-body shape this design uses, for two of the projects. | No change. The global skill writes bodies through `--body-file`, which the hook requires. |
| tasks, usage-guard, shared-pc mods | Their texts say "check against the hand-off" or "write the hand-off" without naming a file. | Still correct; the tasks mod's line gets one wording pass to say "the tracker". |
| compact-handoff mod | Carries work across a compaction inside one session, a different job. | No change. |
| CI | Two of the projects list `*-CONTEXT_*.md` under `paths-ignore`. | Harmless leftovers; removed later in a workflow-only PR. This repo's workflows and the canonical templates do not reference the file. |
| Templates and engine | Only the two session skills, the four bundle files and one engine default use the two switches. | Replaced by the `tracker` setting in build step 1, with the golden test updated. |
| Unattended runs | `/session-close` at the end of a run now writes to the tracker instead of opening a PR. | Fewer things to watch; no CI wait at the end. |
| Session start | A few tracker queries instead of reading one file. | Seconds. Offline, it plans from git and says so. |
| Public boards | Hand-off text lands in issues, which are public for a public repo or board. | Same exposure as the committed file today. A project whose board is public keeps its own check that only codenames land there. |

Nothing in the current workflow breaks if the build order below is kept. The one real risk is the skill swap, and the order is built around it.

## Trade-offs

- **Network and auth.** Start and close now need the tracker reachable and signed in. Offline, `/session-start` says it cannot read the tracker and plans from git alone; `/session-close` keeps the state in the chat summary and retries the writes next session.
- **State outside the repo.** A fork or a bare clone carries no hand-off. Acceptable: the state belongs to whoever runs the work.
- **More tracker writes per close** (a few `gh` calls) in exchange for no hand-off PR and no CI run.

## Rejected

- A personal layer of hand-off notes beside the shared one: the same job done twice.
- A hand-off file per branch: branch and commit churn, and the file still needs a PR to land.
- Comments as the item state: the latest state gets buried under older comments.
- A draft PR as the hand-off: the review workflow runs on drafts.
- Sharing a setup by copying `~/.claude` folders: it carries machine paths and personal settings, and nothing tells a teammate when it drifts.

## Build order

1. Canonical: tracker profiles (GitHub), the status-update rule as a canonical rule, the `tracker` setting replacing the two switches, the `.bindwright/project.json` and `session-steps.md` templates, the session skills reading them, engine golden tests updated. Deep review.
2. This repo moves its hand-off to the tracker, using a project copy of the new skills.
3. The other three projects move, one PR each, each with its `session-steps.md`; skill contracts that name a context file change in the same window.
4. With all four on the new skills, install the global copies and delete the project copies in one window.
5. The plugin carries the skills to teammates, with `/bindwright:export` and `/bindwright:join` (Phase 2b).
6. Each non-GitHub profile, after its free-account run.
