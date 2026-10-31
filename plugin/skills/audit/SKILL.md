---
name: audit
description: Measure how this repo's rules held up in its recent Claude Code sessions, from the session logs, and propose exact rule edits that apply only on a yes.
disable-model-invocation: true
---

# /bindwright:audit

This skill counts, from the session logs Claude Code keeps on this machine, how often the repo's rules applied and how often they were broken, then proposes exact edits for the rules that did not hold. Nothing changes without a yes.

It covers only what the logs can show. The built-in `/doctor prompt-audit` already checks instruction files for outdated advice, stale paths and commands, and contradictions; point the user there for those.

## 1. Measure

- Find the repo root with `git rev-parse --show-toplevel`. Outside a git repo, say the audit works inside one, and stop.
- Pick the engine as setup does: `node "${CLAUDE_PLUGIN_ROOT}/engine/cli.js"` when `node --version` works, otherwise Python 3.8 or later with `"${CLAUDE_PLUGIN_ROOT}/engine/bind.py"`.
- Run it with `--audit <repo root>`. It prints `{"logs": {"folder", "sessions", "from", "to"}, "checks": [...], "skipped": [...]}`. Each check is `{"id", "rule", "seen", "broken", "examples": [{"session", "when", "text"}]}`: `rule` is the file holding the rule, `seen` how often it applied, `broken` how often it was broken, and up to three examples from the newest sessions. On `{"error": "..."}`, show the message and offer `/bindwright:report`.
- `logs.sessions` is 0 when this machine has no logs for the repo (Claude Code deletes logs after its cleanup period, 30 days by default). Say so and stop.

What each check counts:

| id | Applies to | Broken when |
|---|---|---|
| `commit-format` | each `git commit -m` | the first line is not `<type>(<scope>): <description>` within 72 characters (merges excepted) |
| `attribution` | each `git commit` and `gh pr`/`gh issue` create, edit or comment | the attribution guard blocked it |
| `code-research` | each call to the project's code-research tool, and each Grep or Glob on code | it was a Grep or Glob |
| `task-tracking` | each session with three or more file edits | it made no task list |
| `ci-watch` | each `gh run` watch, list or view, and `gh pr checks` | it was `gh run watch` |

## 2. Report

One line per check, most broken first: the rule in plain words, `broken` of `seen`, and the share as a percentage. Then the checks that held (`broken` is 0) in one line, and the `skipped` ones with their reason. A check with `seen` 0 had nothing to measure; say so instead of calling it held. Say how many sessions were read and between which dates.

For each check that did not hold, show its examples and say what they have in common. Read them before judging:

- An `attribution` block can be the guard refusing a body file it could not read rather than a credit line; only real credit lines count against the rule.
- A `code-research` Grep can be right when the tool cannot answer, which `/find` allows; read the rule file before calling it a miss.

## 3. Propose edits

For each check where the examples show a real pattern, propose one exact edit to its `rule` file: the lines as they are and the lines as they would be. Aim at the cause the examples show (the rule is buried, vague, or missing the case that broke), keep the file's style, and add no new rules. One proposal at a time; apply it with the Edit tool only on a yes, and show the next only after the answer.

Edits to files Bindwright wrote are kept: `/bindwright:update` merges them with later templates.

Do not commit or push. Change only what the user said yes to.
