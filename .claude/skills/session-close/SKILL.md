---
name: session-close
description: Close a work session. Verifies what is really finished, commits, opens or merges the PR, cleans up branches and hands off to the next session. Use when the maintainer asks for it, or when every task of the session is done; never just because the context is filling up.
---

# /session-close

Run the steps in order without asking between them. Stop and ask only before a force-push, deleting a branch that holds unmerged work, or rewriting history someone else has pulled. If `.claude/rules/visual.md` exists and this session changed what people see, do not push until the maintainer has confirmed the visual check.

## Verify what is done

Only when this session claims a feature or milestone complete. Re-read its definition of done (its issue, ROADMAP, design doc or PR description) and mark each item:

- ✅ **verified**: seen working in the running app, with the commit, the screen or route, and a screenshot or log where it applies;
- ⚠️ **partial**: works in some cases; list the gaps;
- ❌ **unmet**: open a follow-up and stop claiming completion.

One ❌ means the feature is not complete. If an item stopped making sense mid-way, change the definition of done in its own commit first; never quietly call a gap "deferred".

## Derived docs

Update `README.md` or `CLAUDE.md` when this session changed what they describe, and say which sections changed.

Then check the living docs are still current: for each behaviour, name, path, command or number the session's diff changed, search `README.md`, `CLAUDE.md`, `docs/` and `.claude/rules/` for the old wording, and fix every claim that no longer holds. Dated records (released changelog entries, dated notes) stay as written. `docs/docs-audit.md` covers a full sweep.

## Code-research count

Run `python3 .claude/scripts/research-adherence.py` from the repo root (`python` on Windows). It reads the transcript and compares calls to tokensave with plain code searches that carry no bypass marker: Grep and Glob calls, and shell commands that start with a recursive search. Searches of docs, logs and data, and filters on another command's output, do not count. Report its line. Below 70% means the next session starts by finding out why.

## Project steps

If `.bindwright/session-steps.md` lists "Extra close steps", run them now.

## Commit and PR

Take the first row that matches:

| Situation | Do |
|---|---|
| Branch goal not finished | Commit the work. No PR. |
| `hotfix/*` finished | PR to `main`. After it merges, open the cascade PR into `develop` (`git.md` § Cascade). Done only when the cascade merges. |
| `release/*` finished | Same as a hotfix: PR to `main`, tag the release commit, then cascade. |
| Any other branch finished | Commit, open a PR to `develop`, watch the checks, merge on 🟢. |

Commit and PR format, `--body-file`, merge style and branch cleanup are in `git.md`; watching checks is in `token-efficiency.md`. Run each post-merge command as its own call.

## Hand-off in the tracker

After the commit and PR, so the state records how they ended. For each issue this session worked on, rewrite its `### Current state` per `.claude/rules/tracker.md`: where the work stands, decisions made and why, what the next session should do first. Work without an issue gets one now with the "New item" command, a branch with no PR included. Rules and conventions stay in `.claude/rules/`; session figures (the code-research count, context use) stay in the chat.

Then check the three status-update triggers in `tracker.md` and post an update only when one fired.

## Hand-off file

Rewrite `.bindwright/handoff.md`. It stays in this checkout, out of git: the first time, add the line `.bindwright/handoff.md` to the file `git rev-parse --git-path info/exclude` prints (a worktree shares it with its main checkout, but keeps its own hand-off file). It only points at the tracker, in at most ten lines, and never restates an issue's state:

```
# Hand-off (YYYY-MM-DD HH:MM)
- Worked on: #12 (PR #40 waiting on review), #15
- Start with: #13
- Open question: <one line, or none>
```

## Last message

> **Session closed.** Everything is committed; [PR #N merged and branches deleted | branch pushed, PR #N waiting on checks | work committed locally on `<branch>`]. Start a fresh conversation for the next session.
