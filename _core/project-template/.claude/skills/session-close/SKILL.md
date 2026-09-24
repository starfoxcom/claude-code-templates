---
name: session-close
description: Close a work session. Verifies what is really finished, commits, opens or merges the PR, cleans up branches and hands off to the next session. Use at the end of every session or when the conversation is near its context limit.
---

# /session-close

Run the steps in order without asking between them. Stop and ask only before a force-push, deleting a branch that holds unmerged work, or rewriting history someone else has pulled. If `.claude/rules/visual.md` exists and this session changed what people see, do not push until the maintainer has confirmed the visual check.

<!-- TOGGLE:definition_of_done_verification START -->
## 1. Verify what is done

Only when this session claims a feature or milestone complete. Re-read its definition of done (ROADMAP, design doc or PR description) and mark each item:

- ✅ **verified**: seen working in the running app, with the commit, the screen or route, and a screenshot or log where it applies;
- ⚠️ **partial**: works in some cases; list the gaps;
- ❌ **unmet**: open a follow-up and stop claiming completion.

One ❌ means the feature is not complete. If an item stopped making sense mid-way, change the definition of done in its own commit first; never quietly call a gap "deferred".

<!-- TOGGLE:definition_of_done_verification END -->
<!-- TOGGLE:context_refresh_files START -->
## 2. Hand-off file

Write `{{PROJECT_NAME_UPPER}}-CONTEXT_YYYY-MM-DD_HH-MM.md` at the repo root and `git rm` the previous one, so exactly one exists. It holds current state only: where the work stands, decisions made and why, what the next session should do first. Rules and conventions stay in `.claude/rules/`.

For the timestamp, use the latest `[time]` line in the conversation if a hook provides one. Otherwise read the local clock: `date '+%Y-%m-%d %H:%M'`, or `Get-Date -Format 'yyyy-MM-dd HH:mm'` in PowerShell. Never hardcode a timezone.

<!-- TOGGLE:context_refresh_files END -->
## 3. Derived docs

Update `README.md`, `CLAUDE.md` or a module `ROADMAP.md` when this session changed what they describe, and say which sections changed.

<!-- TOGGLE:code_research_first START -->
## 4. Code-research count

Run `python3 .claude/scripts/research-adherence.py` from the repo root (`python` on Windows). It reads the transcript and compares calls to {{TOOLS_CODE_RESEARCH_NAME}} with unmarked Grep and Glob calls. Report its line. Below 70% means the next session starts by finding out why.

<!-- TOGGLE:code_research_first END -->
## 5. Commit and PR

Take the first row that matches:

| Situation | Do |
|---|---|
| Branch goal not finished | Commit the work. No PR. |
<!-- TOGGLE:context_refresh_files START -->
| Only the hand-off file changed | Commit and open the PR; it takes the docs-only path in `token-efficiency.md`. |
<!-- TOGGLE:context_refresh_files END -->
<!-- TOGGLE:branching_model_gitflow START -->
| `hotfix/*` finished | PR to `{{MAIN_BRANCH}}`. After it merges, open the cascade PR into `{{DEV_BRANCH}}` (`git.md` § Cascade). Done only when the cascade merges. |
| `release/*` finished | Same as a hotfix: PR to `{{MAIN_BRANCH}}`, tag the release commit, then cascade. |
<!-- TOGGLE:branching_model_gitflow END -->
| Any other branch finished | Commit, open a PR to `{{DEV_BRANCH}}`, watch the checks, merge on 🟢. |

Commit and PR format, `--body-file`, merge style and branch cleanup are in `git.md`; watching checks is in `token-efficiency.md`. Run each post-merge command as its own call.

## Last message

> **Session closed.** Everything is committed; [PR #N merged and branches deleted | branch pushed, PR #N waiting on checks | work committed locally on `<branch>`]. Start a fresh conversation for the next session.
