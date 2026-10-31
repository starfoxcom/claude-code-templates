---
name: setup
description: Set up Bindwright in this repo from a setup code made on the Bindwright page. Writes the rules, session skills, guard hooks and review workflows, then fits them to the repo.
disable-model-invocation: true
argument-hint: <setup code>
---

# /bindwright:setup

The setup code is: `$ARGUMENTS`

This skill writes the files the code describes into the repo, then fits them to it, then offers extras for the user's own `~/.claude`. It never overwrites a file without the user's yes, and outside the repo it changes only what the user agrees to, one extra at a time.

## 1. Check the code and the repo

- If the code above is empty or does not start with `bw1-`, ask the user to copy the setup code from the last step of the Bindwright page and run `/bindwright:setup <code>` again. Stop.
- Find the repo root with `git rev-parse --show-toplevel`. If this is not a git repo, ask whether to run `git init` here or stop.
- If `git status --porcelain` shows uncommitted changes, say so and ask whether to continue. The setup is easier to review on a clean tree.
- If `.bindwright/pristine.json` already exists, this repo was set up before, with the answers in `.bindwright/project.json`. Say so and ask whether to start over from this code (delete both files first, so the new ones are written) or stop.
- Otherwise, if the repo has its own agent setup already (`CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, `.claude/hooks/`, or a review workflow under `.github/workflows/`), this is **adopt mode**: say so in one line. Nothing lands without a yes, file by file.
- If `.bindwright/incoming/` or `.bindwright/global/` already exists, an earlier setup stopped before it finished. Ask whether to finish its merges first (steps 3 and 6 on those files) or delete both folders and start fresh.

## 2. Write the files

Pick the engine: the first of these that runs.

1. `node --version` works: run `node "${CLAUDE_PLUGIN_ROOT}/engine/cli.js"`.
2. `python3 --version` or `python --version` reports 3.8 or later: run that interpreter with `"${CLAUDE_PLUGIN_ROOT}/engine/bind.py"`.

With neither, tell the user setup needs Node or Python 3.8+, or the zip download on the page, and stop.

Run the engine with `--code <the setup code> --write <repo root>`, adding `--adopt` in adopt mode: it then stages every file, new ones included, instead of writing them in place. It prints one line of JSON:

- `{"error": "..."}`: show the message and stop. A message starting `Invalid setup code` means the code was cut or changed while copying; ask for a fresh copy. For any other error, offer `/bindwright:report`.
- `{"written": [...], "staged": [...], "skipped": [...]}`: paths relative to the repo root.
  - `written`: new files, now in place.
  - `staged`: files the repo already had. The repo's copy is untouched; the new text is at `.bindwright/incoming/<path>`.
  - `skipped`: files whose staged copy already existed from an earlier run. Nothing was written for them.

Edits inside `.claude/` ask the user for permission even when edits are otherwise accepted. Before the first one, say that the next steps change the repo's agent settings and rules.

Fill `{{STACK_COMMANDS_ALLOWLIST}}` in `.claude/settings.local.json` now (see step 4). Until it is filled, that file is not valid JSON.

## 3. Merge what was staged

Every file under `.bindwright/incoming/` is new text for the file at the same path without that prefix. The engine always stages files a repo often has (`CLAUDE.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `.gitattributes`, `.claude/settings.json`), plus every file reported as `staged`.

For each one:

- **The repo has no file at that path:** move the staged copy into place.
- **The files are identical:** delete the staged copy.
- **Both exist and differ:** merge them. Keep everything the repo's copy says that the new text does not contradict, add what the new text brings, and where the two disagree, show both versions and ask which wins. Show the user a short summary of each merge and save it only after a yes.
  - `.claude/settings.json`: merge as JSON. Union the permission lists, append hooks the repo does not have, keep the repo's value for any other key both set.
  - `LICENSE`: never replace an existing license without an explicit yes; a license change is a legal decision.
  - `CLAUDE.md`: keep the repo's project-specific sections, and put the new rules where they read naturally rather than appending a second copy of a section.
- Delete the staged copy once its file is settled.

In adopt mode, offer every staged file without a repo copy on its own: one line on what it does, move it into place on a yes, delete the staged copy on a no. For a file both have, go through the differences one at a time rather than merging the whole file at once.

Then offer the two ways to mark parts of the repo as the project's own, which a later update never changes. In adopt mode, suggest them for whatever the user kept over the new text.

- **Whole files:** `.bindwright/owned`, one repo path or pattern per line (`*` within a folder, `**` across folders, a trailing `/` for a whole folder, `#` for comments), for example the project's own review workflow.
- **Sections of shared files:** a line holding `bindwright:keep` and a later one holding `bindwright:end-keep`, written in the file's own comment style (`<!-- bindwright:keep -->` in Markdown, `# bindwright:keep` in YAML or Python). Markers do not nest.

Remove `.bindwright/incoming/` when it is empty. Mention any `skipped` paths: their staged copies came from an earlier run, and the user decides whether to merge or delete them.

## 4. Fill what the page could not know

Search the repo's new and merged files for these placeholders and replace each one. Read the repo first; ask the user only what the repo cannot answer, all in one question.

| Placeholder | Where to find it |
|---|---|
| `{{ONE_LINE_DESCRIPTION}}` | The README's opening or the package manifest's description |
| `{{LANGUAGE_AND_FRAMEWORK}}` | Manifests and lockfiles (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `*.csproj`, `project.godot`, ...) |
| `{{LINT_COMMAND}}`, `{{TYPECHECK_COMMAND}}`, `{{TEST_COMMAND}}` | Package scripts, Makefile targets, tool config and the CI workflows. Run each once when it is quick, to check it works |
| `{{CONVERSATION_LANGUAGE}}` | The language the user writes to you in |
| `{{CODE_LANGUAGE}}` | The language of the existing code comments and docs; English for a new repo |
| `{{STACK_COMMANDS_ALLOWLIST}}` | The commands above as permission entries, each written `,` then a new line and `"Bash(<command>:*)"`, matching the list it sits in; nothing when there are none. Never add a rule for `git push` or a bare `git`: either would approve force pushes. When a command runs other commands (`npm run`, `npx`, `make`, `uv`, `poetry`, `bundle exec`, `docker run`), tell the user its rule approves whatever runs through it |
| `{{TEAM_OR_USER}}`, `{{LEAD_USER}}` | The GitHub team or user who owns the repo (from `git remote get-url origin`, or ask) |

When the project has no such command (no type checker, no tests yet), remove that part of the sentence or the hook entry instead of inventing a command, and tell the user what was left out.

## 5. Fit the rules to the repo

- `.claude/rules/code-size.md`: keep only the per-language rows for languages the repo contains (count files by extension, ignoring vendored and generated folders), plus `Other` when the repo has languages the table does not list. Narrow its `paths:` globs to the same languages.
- **Size check:** when `.github/scripts/size_check.py` was written, record the breaches the repo already has, after trimming the code-size rule above. It needs lizard, the version the workflow pins: show `python -m pip install --user lizard==1.24.3` (or a virtual environment the user prefers) and run it only on a yes. The script measures only files git tracks, and nothing setup wrote is committed yet, so first run `git add -N` on every file the repo will keep (the written and merged ones; it stages no content). Then run `python .github/scripts/size_check.py --write-baseline` and say how many breaches it recorded in `.github/size-check/baseline.txt`, which belongs in the commit. Without lizard, leave the baseline out and tell the user the check fails until they write it. Mention that the `Size check` job can be made a required check in the branch rules.
- `.gitignore`: `.claude/settings.local.json` is personal. If `git check-ignore -q .claude/settings.local.json` fails, add that path to `.gitignore` (create the file if needed).
- **Tracker:** when `.claude/rules/tracker.md` was written, the work state lives in GitHub issues. Check `git remote get-url origin` points at GitHub and `gh auth status` works; if either fails, say so and offer to start over with the `file` tracker on the page. With a board (`advanced.trackerProject` in `.bindwright/project.json`), check `gh project view <number> --owner <owner>` reaches it; a scope error means `gh auth refresh -s project`. Without one, offer to create and pin the `Project status` issue that `tracker.md` describes. With a public roadmap (`advanced.publicRoadmap`), check `gh api "repos/<public repo>/issues?state=all&per_page=1"` reaches it and returns `[]`: the tool keeps public numbers equal to private ones, so the public repo must start with no issues, pull requests or discussions, which share the numbers; check discussions on the repo's page. Then offer to turn any `ROADMAP.md` items or hand-off file the repo already has into issues, one at a time, with the "New item" command in `tracker.md`; the old files stay until the user removes them.
- `.claude/rules/git.md` names the branches work lands on. If it names a development branch the repo does not have (`git branch --list <name>`), offer to create it from the current branch, locally only.
- Check that every command and path the new files name exists in the repo. Fix what you can; list the rest for the user.

## 6. Offer the extras for `~/.claude`

`.bindwright/global/` holds files for the user's own `~/.claude`, which every project on this machine shares. Offer each extra below on its own: say in one or two sentences what it does, and install it only on a yes. Changes go through `python "${CLAUDE_PLUGIN_ROOT}/engine/home.py" <command>` (any Python 3.8+ can run it). It backs up `~/.claude/settings.json` before each change, refuses a settings file that is not valid JSON, and prints one line of JSON; on `{"error": ...}`, show the message and skip that extra.

The hooks need a system Python: run `home.py find-python` once. On an error, skip every hook below, and tell the user why and that a later run can add them.

- **Global instructions** (recommended): merge `CLAUDE.md.additions` into `~/.claude/CLAUDE.md`, everything from its first `---` line on. Create the file when it is missing. Never add a section the file already has; where the two differ, show both and ask.
- **Project memory** (recommended): copy `memory/MEMORY.md` to `~/.claude/projects/<folder>/memory/MEMORY.md`, only when no index is there yet. `<folder>` is this repo's folder under `~/.claude/projects/`: the CLI names it after the repo's full path, with every character other than a letter or digit turned into `-`.
- **Code-research tool:** `${CLAUDE_PLUGIN_ROOT}/_core/global-template/hooks/code-research-profiles.json` has the chosen tool's install command per system, the step that wires it into the agent, and its indexing step. Show each command, run it only on a yes, and stop at the first failure.
- **Code-research hook:** when `hooks/` holds a `*-first.py`, install it with `home.py install-hook <that file> --python <found> --matcher "Grep|Glob|Bash"`. If `~/.claude/hooks/` already has a different copy, show the difference first. Then `home.py list-hooks`: offer to remove any other `*-first.py` with `home.py remove-hook <name>`, since two of them would fight over every search. Warn that the hook blocks searches only while the tool is available.
- **Push guard:** recommended when the repo has no `.claude/hooks/push-guard.py`; otherwise the repo's own copy already guards this project, and the global one only adds the other projects on this machine. `home.py install-hook hooks/push-guard.py --python <found> --matcher "Bash|PowerShell"`. It only ever blocks, so it needs no other change. Then ask separately: "Let every `git push` run without a prompt in every project on this machine? The guard blocks force pushes written the ordinary way; it cannot see one built at run time, set in git config, or run by another program." On a yes, `home.py allow "Bash(git push:*)"`. If that rule is already there, ask whether to keep it, and remove it with `home.py disallow` on a no.
- **Attribution guard:** when `hooks/` holds `no-ai-attribution.py`, install it the same way with `--matcher "Bash|PowerShell"`, then run `home.py attribution-off`, which stops the CLI adding its own credit lines.
- **Mods:** they need CLI 2.1.287 or later and Node. Take the version this session runs from the `AI_AGENT` environment variable (`claude-code_2-1-316_agent` is 2.1.316), not from `claude --version`: the desktop app runs its own copy of the CLI, which can be older than the one on the PATH. Only when `AI_AGENT` is unset, use `claude --version`. When the version is older or Node is missing, skip the mods and say why in one line (for example "Mods skipped: they need CLI 2.1.287 or later, and this session runs 2.1.286."). Otherwise read the table in `${CLAUDE_PLUGIN_ROOT}/_core/global-template/mods/README.md` and offer `session-facts` as recommended and the rest as opt-in, one line each. Install each chosen one with `home.py add-mod "${CLAUDE_PLUGIN_ROOT}/_core/global-template/mods/<name>"`. A mod already installed keeps its copy (`"kept_existing": true`), since it may hold the user's edits. Mods load at start-up, so the user restarts the CLI after. The CLI's built-in "You should know" mod stays off: say in one line that it reviews each session with an extra model call and needs telemetry, and that the user can turn it on later.

After a hook install, check it works: pipe `{"tool_name": "Bash", "tool_input": {"command": "git push -qf origin main"}}` into the registered command and arguments on standard input, writing no file (`home.py` printed the settings path; the entry is the last one under `hooks.PreToolUse`). The push guard must exit 2.

Delete `.bindwright/global/`.

## 7. Finish

Tell the user, in plain words:

- What was written, merged and left out, grouped by kind (rules, skills, hooks, workflows, docs), not file by file.
- Which extras went into `~/.claude` and which were declined, and that `~/.claude/settings.json.bak` holds the settings from before the last change.
- What still needs them: for a repo with AI review workflows, the repository secret and branch rules those workflows describe.
- That `.bindwright/project.json` (their answers) and `.bindwright/pristine.json` (the files as generated, before any merge or fill) belong in the commit and are not edited by hand: later updates merge against them, so the repo's own edits survive.
- That nothing is committed yet: they can read the changes with `git diff` and `git status`, and commit when happy.

Do not commit or push. Outside the repo, change only what the user said yes to in step 6.
