# Tracker

The work state lives in GitHub issues, not in the repo. The repo holds the rules; the issues hold where each piece of work stands.

The board is `advanced.trackerProject` in `.bindwright/project.json`, written `"<owner>/<number>"`. `null` means the project has no board: issues alone, with project status in a pinned issue (see Project status updates).

## Work items

Every piece of work has an issue. Work found during a session gets a new one at once, from `.github/ISSUE_TEMPLATE/work-item.md`, linked to its parent with a `Part of #N` line.

The issue body, not a comment thread, carries the state, so the latest state sits at the top of one page:

- `### Current state`: where the work stands, the next step, measurements and dead ends, newest first.
- When it grows long, older detail moves into the `Full history` block at the end of the body.
- An item on hold says so in a `Waits on:` line under its current state.

A PR body carries only its `Resolves #N` or `Part of #N` line and the usual What and Why. It never holds hand-off state.

## Project status updates

A status update says the project's state changed. It is not a session log. Post one only when:

1. A milestone, or a major arc of one, completes: health `COMPLETE`, with a short recap naming the issues and PRs, up to 150 words.
2. The health colour changes between `ON TRACK`, `AT RISK` and `OFF TRACK`.
3. The plan changes: a milestone goal is redefined, a date moves, or a direction call is made.

Most sessions post none. Shape, about 60 to 100 words:

```
## <headline> (<YYYY-MM-DD>)
- Health: <ON TRACK | AT RISK | OFF TRACK | COMPLETE>, <why: required for AT RISK and OFF TRACK>
- Plan: <what changed in the plan, or "unchanged">
```

The update's own status field matches its Health line. Root causes, file names and dead ends stay on the issues.

<!-- TOGGLE:public_roadmap START -->
## Public roadmap

`advanced.publicRoadmap` in `.bindwright/project.json` names a public repo that mirrors this roadmap for outsiders. Every public item is generated from its private item and never edited by hand:

- Only the private issue's `### Public summary` section goes public, under the same number. An issue without one stays private and `check` lists it.
- The public side carries no history, comments, PR numbers, file paths, code names, tuning constants, or text that names AI models or code review. The sync refuses such text, and so does a hook that guards issue bodies, when one is installed.
- Items on the exclude list in `.bindwright/public-roadmap.json` (internal process, tooling) never go public.

At session close, after the issues are updated, run `python3 .github/scripts/public_roadmap.py check` (`python` on Windows). Fix what it lists in the private issues' public summaries, then run it with `push`. `push` refuses while `check` reports anything.

<!-- TOGGLE:public_roadmap END -->
## Commands

Board commands need the `project` scope: `gh auth refresh -s project` adds it. Write every body to a file first and pass it with `--body-file`, or `-F body=@<file>` for `gh api`.

| Job | With a board | Without one |
|---|---|---|
| Open items | `gh project item-list <number> --owner <owner> --format json --limit 200`, in board order; when its `totalCount` is larger than the items it returned, run it again with a `--limit` above that count. Skip items whose `status` is `Done`, those whose `content.type` is not `Issue` (pull requests, drafts), those whose `content.repository` is not this repo (`gh repo view --json nameWithOwner -q .nameWithOwner`; a board can span repos, and the commands below act on this one), and issues the read below shows closed | `gh issue list --state open --assignee @me --limit 1000` (without `--limit` it stops at 30); when it returns exactly 1000, run it again with a higher `--limit` |
| Read an item | `gh issue view <n> --json title,state,body,labels` | Same |
| Update its state | `gh issue edit <n> --body-file <file>` | Same |
| New item | `gh issue create --assignee @me --title <title> --body-file <file>`, then `gh project item-add <number> --owner <owner> --url <issue url>` | The same `gh issue create`; the `--assignee @me` is what lets the open-items list find it |
| Newest status update | `gh api graphql -f query='query($o:String!,$n:Int!){repositoryOwner(login:$o){... on ProjectV2Owner{projectV2(number:$n){id statusUpdates(first:1,orderBy:{field:CREATED_AT,direction:DESC}){nodes{createdAt status body}}}}}}' -f o=<owner> -F n=<number>`; the order must be explicit, since `last:1` without it returns the oldest | The newest comment on the pinned `Project status` issue |
| Post a status update | The query above gives the board's `id`; then `gh api graphql -f query='mutation($p:ID!,$s:ProjectV2StatusUpdateStatus!,$b:String!){createProjectV2StatusUpdate(input:{projectId:$p,status:$s,body:$b}){statusUpdate{id}}}' -f p=<id> -f s=<ON_TRACK, AT_RISK, OFF_TRACK or COMPLETE> -F b=@<file>` | `gh issue comment <status issue> --body-file <file>`; create and pin the issue (`gh issue pin`) the first time |

Offline or signed out, say the tracker cannot be read and plan from git alone. At close, write what could not be posted (each issue's new current state, any status update) to `.bindwright/pending-tracker.md` and leave it out of every commit; the next `/session-start` posts it once the tracker answers, then deletes the file.
