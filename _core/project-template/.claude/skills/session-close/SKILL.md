---
name: session-close
description: Close a work session. Verifies what is really finished, commits, opens or merges the PR, cleans up branches and hands off to the next session. Use when the maintainer asks for it, or when every task of the session is done; never just because the context is filling up.
---

# /session-close

Run the steps in order without asking between them. Stop and ask only before a force-push, deleting a branch that holds unmerged work, or rewriting history someone else has pulled. If `.claude/rules/visual.md` exists and this session changed what people see, do not push until the maintainer has confirmed the visual check.

<!-- TOGGLE:definition_of_done_verification START -->
## Verify what is done

Only when this session claims a feature or milestone complete. Re-read its definition of done (its issue, ROADMAP, design doc or PR description) and mark each item:

- ✅ **verified**: seen working in the running app, with the commit, the screen or route, and a screenshot or log where it applies;
- ⚠️ **partial**: works in some cases; list the gaps;
- ❌ **unmet**: open a follow-up and stop claiming completion.

One ❌ means the feature is not complete. If an item stopped making sense mid-way, change the definition of done in its own commit first; never quietly call a gap "deferred".

<!-- TOGGLE:definition_of_done_verification END -->
<!-- TOGGLE:tracker:file START -->
## Hand-off file

Write `{{PROJECT_NAME_UPPER}}-CONTEXT_YYYY-MM-DD_HH-MM.md` at the repo root and `git rm` the previous one, so exactly one exists. It holds current state only: where the work stands, decisions made and why, what the next session should do first. Rules and conventions stay in `.claude/rules/`.

For the timestamp, use the latest `[time]` line in the conversation if a hook provides one. Otherwise read the local clock: `date '+%Y-%m-%d %H:%M'`, or `Get-Date -Format 'yyyy-MM-dd HH:mm'` in PowerShell. Never hardcode a timezone.

The hand-off names roadmap items by id (`R4`) and never copies their text.

## Roadmap

`ROADMAP.md` lists only the work still ahead, so it cannot fill up with stale history. Create it in this shape if it is missing:

```
# Roadmap

Next id: R8

## Now
- R5 Checkout page (branch feature/checkout)

## Next
- R6 Saved carts

## Later
- R7 Gift cards
```

Edit only the lines for items this session touched:

- An item whose work started gets the branch in brackets and moves to Now. Now holds at most five items; ask which one waits when a sixth would join.
- A finished item is deleted here and added to `CHANGELOG.md` in the same commit.
- A new item takes the `Next id`, which then goes up by one. Ids are never reused.

<!-- TOGGLE:tracker:file END -->
## Derived docs

<!-- TOGGLE:tracker:file START -->
Update `README.md` or `CLAUDE.md` when this session changed what they describe, and say which sections changed.
<!-- TOGGLE:tracker:file END -->
<!-- TOGGLE:tracker:github START -->
Update `README.md` or `CLAUDE.md` when this session changed what they describe, and say which sections changed.
<!-- TOGGLE:tracker:github END -->

<!-- TOGGLE:code_research_first START -->
## Code-research count

Run `python3 .claude/scripts/research-adherence.py` from the repo root (`python` on Windows). It reads the transcript and compares calls to {{TOOLS_CODE_RESEARCH_NAME}} with plain code searches that carry no bypass marker: Grep and Glob calls, and shell commands that start with a recursive search. Searches of docs, logs and data, and filters on another command's output, do not count. Report its line. Below 70% means the next session starts by finding out why.

<!-- TOGGLE:code_research_first END -->
## Project steps

If `.bindwright/session-steps.md` lists "Extra close steps", run them now.

## Commit and PR

Take the first row that matches:

| Situation | Do |
|---|---|
| Branch goal not finished | Commit the work. No PR. |
<!-- TOGGLE:tracker:file START -->
<!-- TOGGLE:github_actions_paths_ignore_auto_merge START -->
| Only the hand-off file and `ROADMAP.md` changed | Commit and open the PR; it takes the docs-only path in `token-efficiency.md`. |
<!-- TOGGLE:github_actions_paths_ignore_auto_merge END -->
<!-- TOGGLE:github_actions_paths_ignore_auto_merge:off START -->
| Only the hand-off file and `ROADMAP.md` changed | Commit and open the PR, watch its checks per `token-efficiency.md`, and merge per `git.md` § Merging. |
<!-- TOGGLE:github_actions_paths_ignore_auto_merge:off END -->
<!-- TOGGLE:tracker:file END -->
<!-- TOGGLE:branching_model_gitflow START -->
| `hotfix/*` finished | PR to `{{MAIN_BRANCH}}`. After it merges, open the cascade PR into `{{DEV_BRANCH}}` (`git.md` § Cascade). Done only when the cascade merges. |
| `release/*` finished | Same as a hotfix: PR to `{{MAIN_BRANCH}}`, tag the release commit, then cascade. |
<!-- TOGGLE:branching_model_gitflow END -->
| Any other branch finished | Commit, open a PR to `{{DEV_BRANCH}}`, watch the checks, merge on 🟢. |

Commit and PR format, `--body-file`, merge style and branch cleanup are in `git.md`; watching checks is in `token-efficiency.md`. Run each post-merge command as its own call.

<!-- TOGGLE:tracker:github START -->
## Hand-off in the tracker

After the commit and PR, so the state records how they ended. For each issue this session worked on, rewrite its `### Current state` per `.claude/rules/tracker.md`: where the work stands, decisions made and why, what the next session should do first. Work without an issue gets one now with the "New item" command, a branch with no PR included. Rules and conventions stay in `.claude/rules/`; session figures (the code-research count, context use) stay in the chat.

Then check the three status-update triggers in `tracker.md` and post an update only when one fired.

<!-- TOGGLE:tracker:github END -->
<!-- TOGGLE:handoff_file START -->
## Hand-off file

Rewrite `.bindwright/handoff.md`. It stays on this machine: the first time, add the line `.bindwright/handoff.md` to `.git/info/exclude`. It only points at the tracker, in at most ten lines, and never restates an issue's state:

```
# Hand-off (YYYY-MM-DD HH:MM)
- Worked on: #12 (PR #40 waiting on review), #15
- Start with: #13
- Open question: <one line, or none>
```

<!-- TOGGLE:handoff_file END -->

## Last message

> **Session closed.** Everything is committed; [PR #N merged and branches deleted | branch pushed, PR #N waiting on checks | work committed locally on `<branch>`]. Start a fresh conversation for the next session.
