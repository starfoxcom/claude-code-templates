---
name: session-close
description: Close a work session. Verifies what is really finished, commits, opens or merges the PR, cleans up branches and hands off to the next session. Use when the maintainer asks for it, or when every task of the session is done; never just because the context is filling up.
---

# /session-close

Run the steps in order without asking between them. Stop and ask only before a force-push, deleting a branch that holds unmerged work, or rewriting history someone else has pulled. If `.claude/rules/visual.md` exists and this session changed what people see, do not push until the maintainer has confirmed the visual check.

## 1. Verify what is done

Only when this session claims a feature or milestone complete. Re-read its definition of done (ROADMAP, design doc or PR description) and mark each item:

- ✅ **verified**: seen working in the running app, with the commit, the screen or route, and a screenshot or log where it applies;
- ⚠️ **partial**: works in some cases; list the gaps;
- ❌ **unmet**: open a follow-up and stop claiming completion.

One ❌ means the feature is not complete. If an item stopped making sense mid-way, change the definition of done in its own commit first; never quietly call a gap "deferred".

## 2. Hand-off file

Write `CLAUDE-CODE-TEMPLATES-CONTEXT_YYYY-MM-DD_HH-MM.md` at the repo root and `git rm` the previous one, so exactly one exists. It holds current state only: where the work stands, decisions made and why, what the next session should do first. Rules and conventions stay in `.claude/rules/`.

For the timestamp, if a hook injects the time into each prompt (a `[session-facts]` or `[time]` line), reuse the most recent one. If none is available, read the local clock: `date '+%Y-%m-%d %H:%M'`, or `Get-Date -Format 'yyyy-MM-dd HH:mm'` in PowerShell. Never hardcode a timezone.

## 3. Derived docs

Update `README.md`, `CLAUDE.md` or a module `ROADMAP.md` when this session changed what they describe, and say which sections changed.

## 4. Code-research count

Run `python3 .claude/scripts/research-adherence.py` from the repo root (`python` on Windows). It reads the transcript and compares calls to tokensave with plain code searches that carry no bypass marker: Grep and Glob calls, and shell commands that start with a recursive search. Searches of docs, logs and data, and filters on another command's output, do not count. Report its line. Below 70% means the next session starts by finding out why.

## 5. Commit and PR

Take the first row that matches:

| Situation | Do |
|---|---|
| Branch goal not finished | Commit the work. No PR. |
| Only the hand-off file changed | Commit and open the PR; a docs-only diff passes both review checks in about 30 seconds (`review-tiers.md`). Watch the checks and merge on 🟢 like any other PR. |
| `hotfix/*` finished | PR to `main`. After it merges, open the cascade PR into `develop` (`git.md` § Cascade). Done only when the cascade merges. |
| `release/*` finished | Same as a hotfix: PR to `main`, tag the release commit, then cascade. |
| Any other branch finished | Commit, open a PR to `develop`, watch the checks, merge on 🟢. |

Commit and PR format, `--body-file`, merge style and branch cleanup are in `git.md`; watching checks is in `token-efficiency.md`. Run each post-merge command as its own call.

## Last message

> **Session closed.** Everything is committed; [PR #N merged and branches deleted | branch pushed, PR #N waiting on checks | work committed locally on `<branch>`]. Start a fresh conversation for the next session.
