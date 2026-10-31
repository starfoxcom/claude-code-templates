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

`advanced.publicRoadmap` in `.bindwright/project.json` names a public repo that mirrors chosen items of this roadmap for outsiders. `.github/scripts/public_roadmap.py` writes every public item from its private issue; nobody edits one by hand.

- An issue goes public only when its body has a `### Public summary` section, written for outsiders. That section becomes the public body under the same number, and the title goes with it. Every other issue stays private.
- GitHub never reuses an issue number, and the public side skips each private number below its newest item. So give an issue its summary before a later issue goes public; afterwards `check` reports it as unable to go public.
- The public text carries no history, code, file paths, links, commit hashes, references to other repos, @mentions, branch or pull request references, identifiers, tuning constants, links to private issues, or wording about AI models and code review. The tool refuses such text, but its patterns are a safety net, not a review: write each summary for outsiders from scratch instead of pasting internal notes.
- The tool ends every body it writes with a hidden `<!-- public-roadmap -->` line and a `public-roadmap` label, and edits only issues that carry both. Only people with triage or write access can label an issue, so teammates share the mirror and other people's issues stay untouched; keep that label out of the public repo's issue templates, which would let anyone apply it. Anyone can open issues, pull requests and discussions in a public repo, though, and each takes a number: `check` reports a private item whose number is taken, which then needs a new issue.
- Deleting an issue's public summary withdraws it: the public item is blanked and closed.
- `.github/public-roadmap.json` holds the rest: `rename` maps internal names to public ones, `hidden` lists names that must never appear, `allowed` lists public words the checks would take for code or a path (such as `iOS` or `Node.js`), `project` is the public board's number (or `null` for none), and `fields` names the board fields copied from the private board.

At session close, after the issues are updated, run `python3 .github/scripts/public_roadmap.py check` (`python` on Windows). Fix what it lists in the public summaries, then run it with `push`. `push` refuses while `check` reports anything, and needs admin rights on the public repo: it deletes the placeholders that keep the numbers matched.

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
