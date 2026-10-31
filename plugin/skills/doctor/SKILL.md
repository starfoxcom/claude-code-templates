---
name: doctor
description: Check that Bindwright works in this repo and on this machine, and say in plain words what is wrong and how to fix each thing. Changes nothing.
---

# /bindwright:doctor

A read-only health check. It runs the engine's checks and the review gate's own check, then explains each problem with its fix. It changes no file and runs no fix by itself; it offers each fix and runs it only on a yes.

## 1. Run the checks

- Find the repo root with `git rev-parse --show-toplevel`. Outside a git repo, say Bindwright works inside one, and stop.
- Pick the engine as setup does: `node "${CLAUDE_PLUGIN_ROOT}/engine/cli.js"` when `node --version` works, otherwise Python 3.8 or later with `"${CLAUDE_PLUGIN_ROOT}/engine/bind.py"`. With neither, that is the first finding: setup, update and the doctor need Node or Python 3.8+.
- Run it with `--doctor <repo root>`. It prints `{"problems": N, "checks": [{"id", "ok", "say", "fix"}, ...]}` in a fixed order: the setup files, the repo's version, the guard hooks, staged files, settings, extras, the CLI. On `{"error": "..."}`, report the message as a finding.
- When `.github/scripts/setup-review-gate.sh` exists, also run `bash .github/scripts/setup-review-gate.sh --check`. Each `MISSING` line is a finding; its fix is running the script without `--check`, which sets the missing pieces up on GitHub.

## 2. Report

- No problems: say so in one line, with the plugin version from `${CLAUDE_PLUGIN_ROOT}/VERSION`.
- Otherwise, one short line per problem: what is wrong (`say`) and what to do (`fix`), most serious first: the setup files, then the guards, then the rest. Leave out the checks that passed.
- Offer to run each fix that is a command or a skill, one at a time, and only on a yes.

When a problem looks like a bug in Bindwright itself rather than in this repo (an engine error, a check that contradicts what the user sees), offer `/bindwright:report`.
