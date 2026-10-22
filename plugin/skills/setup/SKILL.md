---
name: setup
description: Set up Bindwright in this repo from a setup code made on the Bindwright page. Writes the rules, session skills, guard hooks and review workflows, then fits them to the repo.
disable-model-invocation: true
argument-hint: <setup code>
---

# /bindwright:setup

The setup code is: `$ARGUMENTS`

This skill writes the files the code describes into the repo, then fits them to it. It never overwrites a file without the user's yes, and it changes nothing outside the repo.

## 1. Check the code and the repo

- If the code above is empty or does not start with `bw1-`, ask the user to copy the setup code from the last step of the Bindwright page and run `/bindwright:setup <code>` again. Stop.
- Find the repo root with `git rev-parse --show-toplevel`. If this is not a git repo, ask whether to run `git init` here or stop.
- If `git status --porcelain` shows uncommitted changes, say so and ask whether to continue. The setup is easier to review on a clean tree.

## 2. Write the files

Pick the engine: the first of these that runs.

1. `node --version` works: run `node "${CLAUDE_PLUGIN_ROOT}/engine/cli.js"`.
2. `python3 --version` or `python --version` reports 3.8 or later: run that interpreter with `"${CLAUDE_PLUGIN_ROOT}/engine/bind.py"`.

With neither, tell the user setup needs Node or Python 3.8+, or the zip download on the page, and stop.

Run the engine with `--code <the setup code> --write <repo root>`. It prints one line of JSON:

- `{"error": "..."}`: show the message and stop. A message starting `Invalid setup code` means the code was cut or changed while copying; ask for a fresh copy.
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

Remove `.bindwright/incoming/` when it is empty, and `.bindwright/` if nothing else is in it. Mention any `skipped` paths: their staged copies came from an earlier run, and the user decides whether to merge or delete them.

## 4. Fill what the page could not know

Search the repo's new and merged files for these placeholders and replace each one. Read the repo first; ask the user only what the repo cannot answer, all in one question.

| Placeholder | Where to find it |
|---|---|
| `{{ONE_LINE_DESCRIPTION}}` | The README's opening or the package manifest's description |
| `{{LANGUAGE_AND_FRAMEWORK}}` | Manifests and lockfiles (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `*.csproj`, `project.godot`, ...) |
| `{{LINT_COMMAND}}`, `{{TYPECHECK_COMMAND}}`, `{{TEST_COMMAND}}` | Package scripts, Makefile targets, tool config and the CI workflows. Run each once when it is quick, to check it works |
| `{{CONVERSATION_LANGUAGE}}` | The language the user writes to you in |
| `{{CODE_LANGUAGE}}` | The language of the existing code comments and docs; English for a new repo |
| `{{STACK_COMMANDS_ALLOWLIST}}` | The commands above as permission entries, each written `,` then a new line and `"Bash(<command>:*)"`, matching the list it sits in; nothing when there are none |
| `{{TEAM_OR_USER}}`, `{{LEAD_USER}}` | The GitHub team or user who owns the repo (from `git remote get-url origin`, or ask) |

When the project has no such command (no type checker, no tests yet), remove that part of the sentence or the hook entry instead of inventing a command, and tell the user what was left out.

## 5. Fit the rules to the repo

- `.claude/rules/code-size.md`: keep only the per-language rows for languages the repo contains (count files by extension, ignoring vendored and generated folders), plus `Other` when the repo has languages the table does not list. Narrow its `paths:` globs to the same languages.
- `.gitignore`: `.claude/settings.local.json` is personal. If `git check-ignore -q .claude/settings.local.json` fails, add that path to `.gitignore` (create the file if needed).
- `.claude/rules/git.md` names the branches work lands on. If it names a development branch the repo does not have (`git branch --list <name>`), offer to create it from the current branch, locally only.
- Check that every command and path the new files name exists in the repo. Fix what you can; list the rest for the user.

## 6. Finish

Tell the user, in plain words:

- What was written, merged and left out, grouped by kind (rules, skills, hooks, workflows, docs), not file by file.
- What still needs them: for a repo with AI review workflows, the repository secret and branch rules those workflows describe.
- That nothing is committed yet: they can read the changes with `git diff` and `git status`, and commit when happy.

Do not commit, push or change anything outside the repo.
