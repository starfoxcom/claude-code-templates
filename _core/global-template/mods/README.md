# Mods — function-hook plugins for `~/.claude`

A mod is a small Claude Code plugin made of **function hooks**: a TypeScript module whose `register(on, options)` function hooks engine events (`session.start`, `prompt.submit`, `tool.call`, `turn.complete`, `ui.render`, …) and reaches the engine through the `$` interface. Mods run inside the Claude Code process, so they can read a command before it runs, add a line to a prompt, draw a band above the prompt, register a slash command or a tool, or wake a session once.

**Requirements:** Claude Code **2.1.287 or newer** (the function-hook API is early access; older builds ignore these folders), and `node` on `PATH` (several mods run a small Node helper for file work the hook sandbox cannot do). The mods run in the terminal CLI and in the Code tab of the Claude Desktop app; both load them the same way (see [Install](#install)).

Every mod is optional and independent, with one exception noted in the table (shared-pc and usage-guard cooperate when both are on). The rows above the prompt replace a status line; see [Rows in place of a status line](#rows-in-place-of-a-status-line).

---

## The mods

| Mod | What it does | Default |
|---|---|---|
| `session-facts` | Adds one line to every prompt, for the model only: the exact local time, how full the context is measured against the **compaction** window, and plan usage per window. A fresh session has no plan figures of its own before its first reply, so its first line borrows the newest ones another session recorded in the last 30 minutes (naming that session's time), and once its own figures arrive, or the line is ten minutes old in a long turn, a newer line rides on the next tool result. Also draws the budgets row above the prompt: context fill to compaction, plan usage per window with the reset time once a window passes the warning level (red at `usage-guard`'s wrap-up level), the `usage-guard` pause, and the prompt cache: a countdown in its last minutes naming the cold start (what the next request writes to the cache again if it expires), or the time of Claude Code's own idle compaction when the conversation is big enough for one (200k tokens, or `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`), and for a quarter hour after a confirmed miss what happened and what it resent, read from the API's own cache counts on the first request after each prompt. The cache's lifetime comes from the session transcript, and the last reply's time is kept in `mods-data/session-facts/<session>.json` so the countdown survives a reload (files older than two days are swept). Replaces the older `[time]` hook snippet. | **Recommended on** |
| `compact-handoff` | Turns compaction into a focused hand-off: your own messages kept word for word (within a budget), a structured hand-off written by the summarizer (doing, where we are, decided, dead ends, read next, reference, live state, owed), and a `recall` tool that searches the full transcript afterwards. | Opt-in; mode `on` |
| `ci-watch` | After a `git push` or `gh pr create`, or when the model calls its `watch` tool, watches that PR's checks locally with `gh` (no plan usage while waiting) and wakes the session **once**, only after every check and workflow has finished (a fix pushed mid-run would restart the rest): all passed, failed, or stuck past the time limit. When checks are still pending 15 minutes in, it also reads githubstatus.com (at most every 5 minutes) and, if GitHub reports an open Actions incident, wakes the session once early with the incident's name and shows it on the row. Draws one row per watched PR above the prompt: its progress, a link to it, a button that lists each check, and a stop button. `/ci-watch` lists watches, `/ci-watch stop` clears them. | Opt-in |
| `guards` | Reads each Bash and PowerShell command (quotes, here-docs, body files, `gh api` fields) and checks only the text that reaches history: commit, tag and merge messages, PR/issue/release text, new branch names, and lines a commit adds. Blocks AI credit lines everywhere (and, if you narrow `mentionRepos`, the plain product name outside the repos you list), the streaming `gh run watch`, and the routes the shipped attribution hook refuses outright: history rewrites (`git filter-repo`, `git filter-branch`), skipped git hooks (`--no-verify`, `-n`, `core.hooksPath`, lefthook switched off), `--trailer`, a reused commit message and `eval`. Opt-in per repo, it also holds PR bodies to the PR format (see [PR-body contract](#pr-body-contract-guards-opt-in)). With the `helpers` setting at `block`, it also stops helper agents. `/guards` shows the mode, where the product may be named, the helper setting, and what it checked and caught today and over the last 7 days. | Opt-in; starts in `shadow` mode |
| `shared-pc` | For several sessions on one machine: one session at a time holds "the seat" for heavy work (builds, full test suites, local CI); the rest wait in a visible line in a band above the prompt. Heavy commands queue by themselves; `/pc` (and the `pc` tool) can hold the seat for a measurement window, release it, or ask to go next. Starts no new heavy work while usage-guard has paused sessions. | Opt-in |
| `skill-check` | Checks that a skill's run shows the steps its contract requires. When the turn that ran the skill ends with steps unseen, one follow-up turn names them, asking to do them or say why they do not apply. No contract, no effect. | Opt-in |
| `tasks` | Keeps the task list honest: one task in progress at a time, finished work marked done, a list that survives compaction and completion, reminders that name the stale task, and a nudge to make a list after several tool calls with none, and a prompt to carry on when a turn ends while a task that is not on hold is left and nothing else will wake the session. Draws its own list (a band and a pane) in place of the built-in panel for the main session. | Opt-in |
| `usage-guard` | Near a plan usage limit, every session saves its work once (`/session-close`, local only), each project's background work is stopped once by your per-project stop commands, and sessions wait; after the limit resets, each session that saved work gets a prompt to continue it right away, with no plan approval to wait for (never `/session-start`, whose plan would wait for an OK); a session that saved none is only told the limits reset, so two sessions never pick up the same hand-off. A card above the prompt shows the pause, with "Cancel auto-resume". `/usage-guard cancel` cancels it. `/usage-guard arm 5h` (or `week`) has this session alone resume after that reset at any usage level, with no wrap-up and nothing shared; `/usage-guard arm 21:05` resumes it at that time of day instead (24-hour only: `9pm` is refused with its 24-hour spelling), the next time the clock reads it. Add `compact` to compact the session first, and a reason in double quotes (`/usage-guard arm 09:05 "read the trial results"`) for the wake to hand the session; the quotes mark where it starts and ends. The answer gives the wake's full date and how far off it is, and a new arm replaces the standing one. Claude can set the same arm with the `arm` tool when you ask it for a wake-up. A slim line above the prompt shows a standing arm, with Disarm. The arm survives a `/clear` and a restart: a session started again within `catchUpMinutes` of a missed wake resumes at once, later it only says what it missed. A missed arm whose session stays closed is offered to the next session in the same project (within a day of the wake): a card asks "Resume it here?", or `/usage-guard adopt` (`adopt drop` forgets it) from the phone; one claim keeps it to a single resume. With no open task in the tasks mod's list and no reason, the arm asks to keep it or cancel the resume, and its wake only says it came. `/usage-guard disarm` drops it, and so does a cancel made in that session (a cancel from another session leaves it). The session can compact before a pause too (`compactAbovePercent`). `/usage-guard phone` gives the status as plain text, as a bare `/usage-guard` does over Remote Control. | Opt-in |
| `session-info` | One row above the prompt: model and effort, project, and git branch with `*` when it has changes, commits ahead and behind its upstream, and a button that lists the changed files. Rereads git after each turn, after shell commands and on a timer. | Opt-in |
| `runners` | One row above the prompt per local CI runner set listed in `runners/hooks/rules.ts` or in `~/.claude/mods-data/runners/runners.json` (the same entries as JSON, kept through template updates): on or off (every listed process running), runners online and busy, queued runs and the next scheduled run on the repo's default branch in your local time (all through `gh`), with Start and Stop buttons running your own commands. Stop asks once more while a runner is busy. Draws nothing until you list a runner: `/runners add <name> <program>[,<program>...] [owner/repo]` adds one to the list file and draws its row at once (Start and Stop commands go in the file by hand). `/runners` prints each runner's last reading, or how to add one. | Opt-in |
| `mods` | `/mods` opens a pane listing every mod in `CLAUDE_CODE_PLUGIN_DIRS`, what each one does (from its `plugin.json`), and the slash commands the plugins add. A command named after a mod is listed under it; the rest (`/pc`, `/task-list`) are listed together below. | Opt-in |

"Recommended on" means we suggest installing it with every setup; "opt-in" means install it only when you want what it does. Installing is manual for now (see Install below).

### Options

Options are `userConfig` fields in each mod's `.claude-plugin/plugin.json`: those are the defaults. Each mod keeps the values you change in a file of its own, `mods-data/<mod>/settings.json`, over those defaults. Change them in the mod's settings pane, `/<mod> settings` (`/task-list settings` for `tasks`), which edits them in the terminal and the Desktop app alike, or with `/<mod> set <name> <value>` from the phone (`/<mod> set` alone lists them). The file is read at each session's start and once a minute after its first tool call or command, so every running session picks a change up within a minute; a new check interval takes over at the next tick of the old one. The Desktop app lists no mod rows in `/config`, so each mod hides its rows there; a value set in `/config` or in `~/.claude/settings.json` under `pluginConfigs.<mod>.options` before still counts until the file sets that field.

| Mod | Option | Default | Meaning |
|---|---|---|---|
| `ci-watch` | `pollSeconds` | `30` | How often the PR checks are read with `gh`. |
| `ci-watch` | `timeoutMinutes` | `60` | A watch still pending after this long wakes the session with what is stuck. |
| `compact-handoff` | `mode` | `on` | `off`: stock compaction. `shadow`: stock compaction plus the hand-off written beside it for comparison (double work on every compaction; use only for A/B runs). `on`: the hand-off replaces the stock summary. |
| `guards` | `mode` | `shadow` | `shadow` never blocks: it logs what it would block, and what any guard script registered beside it blocked, to `mods-data/guards/decisions.jsonl`. `enforce` blocks. Switch to `enforce` after a shadow period shows the mod agrees with your scripts. When the check itself fails (an error, or running past the engine's time limit) before the command ran, `shadow` lets the command run and `enforce` refuses it; both log the error. |
| `guards` | `mentionRepos` | `"*"` | Comma-separated repo folder names whose subject is Claude Code itself, so commit, PR and branch text there may name the product. `"*"` (default): mentions are allowed everywhere, matching the shipped attribution hook. A list narrows it to those repos; empty blocks the name in every repo. AI credit lines stay blocked everywhere. |
| `guards` | `helpers` | `allow` | `allow` leaves helper agents alone. `block` stops the Agent and Workflow tools (subagents, forks, teammates, workflow runs), refused in `enforce` mode and logged in `shadow`, for setups where all work stays in the main session. `/guards helpers allow` lifts the block for the rest of that session when the person asks for a helper; `/guards helpers block` puts it back. A mod's own agents are never touched. |
| `tasks` | `nudgeAfterTools` | `3` | Tool calls in one turn with no task list before the model is asked to make one. `0` turns the nudge off. |
| `tasks` | `keepGoing` | `true` | When a turn ends with an open task that is not on hold (nor waiting on another open task), and no CI watch or plan-limit pause will wake the session (nor was such a pause's automatic resume cancelled before its reset), the model is prompted a few seconds later to carry on. Never after an interrupted turn; stops after two prompts in a row that change nothing on the list, until the next prompt of your own. |
| `usage-guard` | `wrapUpAt` | `90` | Percentage of any plan window (5-hour, weekly) at which sessions wrap up. |
| `usage-guard` | `wakeDelayMinutes` | `2` | How long after the reset sessions resume. |
| `usage-guard` | `compactAbovePercent` | `25` | A session that will resume on its own compacts after its wrap-up when its context is above this share and the reset is more than an hour away. `0` turns it off. |
| `usage-guard` | `catchUpMinutes` | `30` | A session armed to resume that was closed at its wake resumes when it starts again within this many minutes of the wake; later, it only says what it missed. `0` never catches up. |
| `session-facts` | `planWarnAt` | `75` | Plan usage (%) at which a window turns yellow and shows when it resets; it turns red at `usage-guard`'s `wrapUpAt`. |
| `session-facts` | `cacheWarnMinutes` | `10` | The prompt-cache countdown shows once this few minutes are left. |
| `session-facts` | `cacheTtlMinutes` | `60` | The prompt-cache lifetime to assume until it is read from the session transcript after each reply (the API records which lifetime each cache write used: 60 minutes on a plan within its included usage, 5 past it or on an API key), and whenever the transcript cannot be read. In that fallback, a miss between 5 minutes and this lifetime switches the countdown to 5 minutes until a warm request outlives them. |
| `session-info` | `refreshSeconds` | `30` | How often git is reread between turns, to catch a branch switch or an edit made outside the session. `0` rereads only after turns and shell commands. |
| `session-info` | `maxFiles` | `8` | How many changed files the expanded row lists before it says how many more. |
| `runners` | `checkSeconds` | `60` | How often processes, runners, queued runs and schedules are read (schedules at most once an hour). |

`shared-pc` and `skill-check` have no options. Three mods keep a user-editable list in code instead, because the entries are regular expressions and argv lists:

- `shared-pc/hooks/rules.ts`: what counts as heavy work. Global light and heavy lists ship filled in; `projects` ships empty, with a commented example of a per-project entry.
- `usage-guard/hooks/rules.ts`: `STOP_COMMANDS`, the commands that stop a project's background work at wrap-up. Ships empty, with a commented example.
- `runners/hooks/rules.ts`: `RUNNERS`, each runner set's label, process names, repo, and Start and Stop commands. Ships empty, with a commented example.

`skill-check` reads its contracts from `~/.claude/skill-contracts.json`. Start from `skill-check/skill-contracts.example.json`, which holds contracts for this toolkit's `/session-start` and `/session-close` skills; remove any step whose feature you turned off at bind time.

### PR-body contract (guards, opt-in)

Write `mods-data/guards/pr-body.json` to make `guards` check pull request bodies in the repos it lists. Each key matches every repo whose folder name (or `--repo` name) contains it, case-insensitive:

```json
{ "repos": { "my-game": { "row": "^(Resolves|Part of) #\\d+\\s*$", "noRow": "^(docs|chore)\\(" } } }
```

There, `gh pr create` and `gh pr edit` must pass the body as a file (`--body-file`, never inline `--body`, `--fill` or `--web`), and the body needs `## What` with a bullet, `## Why` with text, and `## Notes` only when it is filled. `row` (optional) matches a whole line every PR body carries, such as its issue link, and that line also ends the section above it; titles matching `noRow` carry none, and a PR edited without `--title` is not held to the row. A body is checked only when the PR call is the whole command and is written out in full: one statement starting with `gh`, after nothing but `cd`s to literal folders (no `cd` to a folder built at run time, variable, subshell or `bash -c` before or around it, and a PR named by number, not by URL), every flag spelled on its own (`-d -F b.md`, not `-dF b.md`), no word the shell changes (no `$`, `$'...'`, `$(...)` or backtick anywhere in it), one `--body-file`, and the body in that file, already on disk, or in one literal here-doc on stdin. Anything else, and any repo whose patterns do not compile, is logged as unread in `decisions.jsonl`, never blocked. Of keys that overlap, the longest match wins. Without the file, no PR body is checked.

### Banned names (guards, opt-in)

Write `mods-data/guards/names.json` to keep names out of a repo's history, such as the titles a clean-room project must never mention. Keys match repo names as in `pr-body.json`:

```json
{ "repos": { "my-game": { "names": ["oldkeep", "Lantern Studio"], "words": ["OK"] } } }
```

`names` match anywhere and in any case (`oldkeep` catches `OldkeepPLUS`), and a name of several words matches across spaces and line breaks. `words` match only as whole words, in the case written (`OK` catches `OK-normal`, never `BOOK` or `ok`). Both are checked in the messages and titles `guards` reads from git and gh writes (commits, PRs, issues), in body files, and in new branch names; lines added to project files stay the project's own CI check. In shadow mode a hit is logged, in enforce mode it is blocked. A file whose lists are not strings is ignored. Without the file, no name is checked.

### What guards cannot see

`guards` is a safety net for commands written the ordinary way, not a sandbox. It reads git and gh where people and agents really put them: behind `if`/`then`/`do`/`{`/`(`/`!`, behind `sudo`, `env`, `time`, `timeout`, `nohup`, `command`, `xargs`, inside `$(...)`, `bash -c`, `powershell -Command` and `cmd /c` (or `//c` from Git Bash, with the command split or as one quoted word), with `gh -R owner/name` before the subcommand. It reads messages from variables set earlier in the same command, here-docs, here-strings, `< file`, a pipe from `echo`/`printf`/`cat`, and files the command writes itself with `>`. A quoted value that starts with `<` or `>` is read as text, and `<(...)` as a file built at run time. On top of that reading, the whole text of every git or gh write is checked for AI credit lines, as the shipped attribution hook does, so a spelling the reading misses still cannot carry one into history. When a message exists but is made by something it cannot follow, it names that message as **unread** in `decisions.jsonl` instead of passing it silently. Out of its reach:

- commands run from a script file, an alias or shell function, a git alias (`git ci -m ...`), `eval`, `ssh host ...`, a program named through a variable (`$GIT commit`), or any other program that writes to GitHub on its own (a Python script, an SDK);
- a body file another program writes in the same command (`Set-Content`, `Out-File`, `tee`): the file does not exist yet when the guard looks, so it reports that it could not read it. One that script code written in the command may write (`python - <<EOF`, `python -c`, `node -e`) is named unread instead and the command runs: that code is checked only for AI credit, as part of the command text. A script file on disk (`python gen.py`), or code the shell builds at run time (`python -c "$(cat gen.py)"`, `-c "$CODE"`, an unquoted here-doc with an expansion), gives no such pass. Inline code that itself loads another file (`exec(open('gen.py').read())`) is checked only as typed;
- the output of another program used as a message (`git log --format=%B | git commit -F -`, a variable set from outside the command): named unread, its text never checked;
- AI credit hidden on purpose (assembled from pieces, encoded, fetched at run time): out of scope;
- with `mentionRepos` narrowed, the plain product name only as a whole word: written with letters, zero-width characters or `-_.*` between them, and no letter right before or after. The name spread across spaces or line breaks, or run into another word, passes, so ordinary words that contain it ("philanthropic", "the critic lauded") are never blocked.

---

## Install

1. Copy the mod folders you want to `~/.claude/mods/<mod>/` (keep each folder whole).
2. List each one in `~/.claude/settings.json` under `env.CLAUDE_CODE_PLUGIN_DIRS`, as absolute paths (`~` is allowed) joined by the platform's path-list separator:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "C:/Users/<you>/.claude/mods/session-facts;C:/Users/<you>/.claude/mods/ci-watch"
     }
   }
   ```

   On Windows the separator is `;` (verified). On macOS and Linux it is `:` (`~/.claude/mods/session-facts:~/.claude/mods/ci-watch`), per the CLI's plugin reference; not yet verified on those systems.
3. **Fully restart** Claude Code. The variable is read at start, so a new entry needs a restart. Editing a mod that is already loaded reloads it in running terminal sessions when one of its files is saved.
4. **Desktop app:** it reads the same `~/.claude/settings.json` and its `env` block, so steps 1 to 3 cover it. Keep the variables in that file: on Windows the app also inherits user and system environment variables but never reads a PowerShell profile. The mods run only in **local** Desktop sessions; plugins are not loaded in WSL or cloud sessions. Desktop sessions are not interactive terminal sessions, and the CLI watches mod folders by default only in those, so in Desktop an edited mod loads at the next session start. To reload on save there too, add `"CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"` to the same `env` block; it is optional and only matters while you edit mods. An older Desktop build that places no panes leaves the `tasks` list pane unopened; its band still draws.
5. Optional: copy `skill-check/skill-contracts.example.json` to `~/.claude/skill-contracts.json`.

Load each mod once. A folder enabled for hot reload elsewhere (a development copy) loads again on restart, so remove a development copy once the mod is installed.

## Where data lives

Each mod keeps its files under `~/.claude/mods-data/<mod>/` (or under `$CLAUDE_CONFIG_DIR/mods-data/` when that is set), with hard caps and its own cleanup:

| Mod | Files |
|---|---|
| `compact-handoff` | hand-off files: one per session in `on` mode, plus `<session>-precompute.md` when the engine writes a summary ahead of time; newest 20, at most 14 days, in `shadow` mode |
| `ci-watch` | `<session>.json` (the watches) and `<session>.owner` (which loaded copy of the mod polls); a settled watch is dropped after an hour, or at once when the PR is merged or closed; both files are swept two days after their session last wrote them |
| `guards` | `decisions.jsonl` (256 KB, one rotation), `stats.json` (per-day totals, last 30 days), `loaded.json`; `pr-body.json` and `names.json` are yours to write (see [PR-body contract](#pr-body-contract-guards-opt-in) and [Banned names](#banned-names-guards-opt-in)) |
| `shared-pc` | the seat, line and requests, changed only through `bin/pcctl.cjs` under a lock |
| `tasks` | `<session>.json`, the task list mirror (50 tasks kept; files older than 14 days swept) |
| `usage-guard` | `pause.json` (the shared pause), `card.json` (the card every session draws), `claims/` (one empty folder per session and per project per pause, so each wraps up and each project stops once; swept after 14 days), `settings.json` (its settings, written by its pane and `/usage-guard set`), `arms/<session>.json` (a session's standing arm, kept for a restart; `null` once disarmed or run) |
| `runners` | `runners.json` (optional): your own runner list, read at session start; the last reading lives in the session |
| `session-facts` | `<session>.json`: the last reply's time, the prompt-cache lifetime and the last cache check, so the countdown survives a reload; files of other sessions are swept two days after they were last written. `plan.json`: the newest plan figures any session recorded, for a fresh session's first line |

## Rows in place of a status line

Four mods each draw one row above the prompt: `session-info` (the session), `ci-watch` (CI), `runners` (local runners) and `session-facts` (budgets). Together they show what a command status line would, with buttons and details a status line cannot have, and they draw in the terminal and in the Desktop app alike; the Desktop app does not draw a command status line. These templates ship no status line any more. If `~/.claude/settings.json` still has a `statusLine` block from an older setup, remove it once the rows are installed, so the terminal does not show the same facts twice. The older `statusline.js` left files under `~/.claude/mods-data/statusline/`, which can be deleted. Its per-session window files in `~/.claude/mods-data/session-facts/` are swept by `session-facts` itself after two days; keep that folder, it holds the mod's own files now.

---

## Test and validate

From the folder that holds the mods:

```bash
claude plugin validate <mod>   # reads the manifest and hooks module as the engine will; lists hooks, calls and env reads
claude plugin test <mod>       # runs every *.test.ts / *.test.tsx under the mod against the engine
node --test shared-pc/test-helper/pcctl.spec.cjs   # shared-pc's Node helper
node --test compact-handoff/test-helper/helper.spec.cjs   # compact-handoff's Node helper
```

Validation reports one warning per mod (no `author` field); that is expected.

### Editor typings

Each mod's `tsconfig.json` extends `./.claude-plugin/types/tsconfig.json`. That folder is **generated by the engine**, not shipped: every time Claude Code loads the mod from a folder you own (a `CLAUDE_CODE_PLUGIN_DIRS` entry, `claude --plugin-dir <mod>`, or a hot-reloaded development folder), it writes `.claude-plugin/types/` with the API (`claude-code/index.d.ts`), this build's built-in tools, the MCP tools connected at the last reload, and a `tsconfig.json`; it also writes a `.gitignore` there that ignores the whole folder. There is no command to run, and neither `claude plugin validate` nor `claude plugin test` needs it. After the first load, `tsc -p <mod>` type-checks the mod. The `types/index.d.ts` some mods ship is different: it is the mod's own contract for the values it keeps in `$.state`, named in `plugin.json` under `"types"`.

---

## Writing or changing a mod

Lessons from building these, for the current function-hook API:

- **One hooks module per plugin.** `hooks/hooks.json` names a single entry file; split code by importing into it. `$` never crosses an import: a function that takes `$` must live in the file that calls it, as a top-level declaration, and no parameter may share a name with such a function (the validator refuses it).
- **One hook per event**, unless the later hooks carry a matcher: `on('session.start', { isInteractive: true }, …)` can sit beside an unmatched `session.start` hook.
- **Hot reload watches only the entry file.** After editing a file it imports, also change the entry file, or running sessions keep the old code. A session in the middle of a turn keeps the old code until that turn ends. A change to `CLAUDE_CODE_PLUGIN_DIRS` still needs a full restart.
- **Set up lazily.** A hot reload starts the module's own variables over but does not re-run `session.start` in a running session, so do first-use setup on the first event that needs it too.
- **No missing folders, no deletes.** `$.fs.write` creates no parent folders and the sandbox has no delete; do both through a short Node helper run with `$.process.run`.
- **Render hooks are pure.** Writing state from `ui.render` is refused and the hook is skipped; start timers and fill state from another event.
- **Name clashes:** a variable named `h` shadows the JSX factory ("h is not a function"), and the validator does not catch it.
- **Budget:** a hook has 10 seconds. `$.clock.sleep` counts against it; waiting on `$` calls does not, but a slow `$.process.spawn` inside `tool.call` still holds the command up.
- **Drawing:** a card positioned absolutely above the prompt band is clipped; draw cards inside the band. Build every element through `$.ui.resolve(e)` and keep to the elements both surfaces have (`Box`, `Text`, `Button` and the like; `Raster` and `Image` are terminal-only), and run each mounting test over `['terminal', 'desktop'] as const` so a Desktop break shows in `claude plugin test`. Every `AbovePrompt` hook calls `next(e)` and keeps its own tree, so cards from several mods stack.
- **Notifications:** do not rely on `$.ui.toast` (gone in seconds, no styling), `$.audio.play` (silent in some terminals) or OS notifications (may be off). Anything a person must see is a card in the band that stays until dismissed or answered. Colors: yellow when the person must or may act, blue for information, green for good news, red for an error.
- **Waking a session:** `$.session.append` notes do not wake an idle session; `$.prompt.submit` does, for one turn. Wake once per event.
- **Tests** (`import { test, expect, mock } from 'claude-code/testing'`): `$` in a test has no real file system (hook `fs.read` / `fs.write` yourself; paths arrive with Windows backslashes); there is no `session.append`; `op` events answer `{ value }`; call `$.session.start({ cwd })` and `mock.clock(on)` before mounting a band; a hook's refusal reaches the test's `$.tool.call` as `{ isError, text }`. A `key` on a `Text` fails validation (the engine draws its own component), so key a `Box`; mount a pane with `requestId: <pane id>` and the pane props. The mod under test loads its own copy of its modules, so a test cannot change the mod's behaviour by mutating an imported value; test such tables through an exported pure function instead.
- **Settings pane:** copy `ci-watch/hooks/settings.tsx` (not `usage-guard`'s, which keeps its own settings file), change its `PLUGIN`, `TITLE` and the atom's literal plugin name (the engine reads state names only from literals), call its `register` from the entry module, and open `SETTINGS_PANE` from the mod's command. It reads the mod's rows from `$.config.list()` on every draw and writes through `$.config.set`, so `/config` stays the one store. In tests, answer `config.list` with `on('config.list', () => ({ value: rows }))`, capture writes with a `config.set` hook, mount the pane once and type with `ui.input({ key, text })`.
- **Keep it light:** hard caps on every file a mod writes, cleanup of old files, and injected text that scales to the context window.
