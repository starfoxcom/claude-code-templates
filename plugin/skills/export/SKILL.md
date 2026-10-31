---
name: export
description: Share this repo's Bindwright setup with the team. Records which ~/.claude extras the project requires or recommends, and which settings no one may override, in .bindwright/project.json.
disable-model-invocation: true
---

# /bindwright:export

This skill writes the team's half of the setup into `.bindwright/project.json`, so a teammate's `/bindwright:join` can bring their machine in line. It records only names and ratings from Bindwright's own lists: never machine paths, secrets, user names or anything that runs. Nothing is committed.

## 1. Check the repo

- Find the repo root with `git rev-parse --show-toplevel`.
- If `.bindwright/project.json` is missing, this repo was not set up with Bindwright: tell the user to run `/bindwright:setup` first, and stop.

## 2. Read the current setup

Pick the engine as setup does: `node "${CLAUDE_PLUGIN_ROOT}/engine/cli.js"` when `node --version` works, otherwise Python 3.8 or later with `"${CLAUDE_PLUGIN_ROOT}/engine/bind.py"`. With neither, say the export needs Node or Python 3.8+, and stop.

Run it with `--settings <repo root>`. It prints one line of JSON: `settings` (each with its `value`, the layer it came `from`, and whether the project `required` it), `extras` (each with the project's rating and this person's choice), `installed` (which extras this machine has), `drift` and `ignored`. On `{"error": "..."}`, show the message and stop.

If `ignored` is not empty, list it in plain words: those values in someone's settings files are not used.

## 3. Ask what to share

Ask in one message, with a short line on what each extra does (from `${CLAUDE_PLUGIN_ROOT}/_core/global-template/mods/README.md` for the mods; `push-guard` blocks force pushes and direct pushes to the main branches; `attribution-guard` blocks AI credit lines in commits and PRs):

- **Extras:** for each extra this machine has installed, and each one the project already rates, whether teammates should be told it is `required`, `recommended`, or nothing. Suggest `recommended` by default; `required` only for something the team's workflow depends on, since `/bindwright:join` then installs it without the choice to skip.
- **Settings to lock:** whether the code-research tool (now `<value>`) and the tracker (now `<value>`) should be `required`, so no one's personal settings can change them for this project.

## 4. Write it

Pass the answers on standard input to `--export <repo root>`, as `{"extras": {"<extra>": "required" | "recommended", ...}, "required": ["codeResearch", "tracker"]}` (leave out what the user chose nothing for). It replaces the project's whole `setup` object; empty lists remove it. On `{"error": "Cannot export: ..."}`, the message names each value it refused; fix the choice and run it again.

Then show the change with `git diff -- .bindwright/project.json`, and say that teammates get it with the next pull and `/bindwright:join`. Do not commit or push.

## 5. Elsewhere

To start another repo with the same setup, that repo runs `/bindwright:setup` with a setup code from the Bindwright page, then the user runs this skill there with the same choices.
