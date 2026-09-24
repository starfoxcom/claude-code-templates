# Token efficiency

## Find before you read

Locate a symbol before opening a file, then read only the function or section you need. `/find` (`.claude/skills/find/SKILL.md`) holds the lookup sequence for this project's code-research tool, **{{TOOLS_CODE_RESEARCH_NAME}}**, and when to fall back to Grep, Glob and Read.

Enable an MCP server only while the work needs it. Every enabled server adds its tool definitions to every message.

## Shell commands

- One command per call where you can. Permission rules match the whole command string, so `&&` chains prompt more and fail in confusing ways.
- Never retry a timed-out command with the same timeout. Builds and installs start at 420 000 ms; each retry adds 180 000 ms (600 000, 780 000, then +120 000 per retry after that).

## Watching CI

After every push, watch the PR's checks with the **Monitor tool** where it exists; never use `gh run watch`:

- One monitor per PR, timeout one hour, so a stuck check becomes a loud timeout instead of a silent wait.
- Inside it, poll `gh pr checks <pr> --json name,bucket` about every 60 seconds. Filter on the `bucket` field with `gh`'s own `--jq` (the standalone `jq` binary is missing on some shells, and an empty result looks exactly like "still running").
- Print each check as it settles and finish with an explicit "all checks settled" line.
- On a new push to the same PR, stop the old monitor and start a new one.

Monitor is missing on some cloud providers and when non-essential traffic is disabled. Without it, run this as one Bash call with `run_in_background` and act when it exits. It stops after about nine minutes; if checks are still pending, run it again.

```bash
sleep 45
for i in $(seq 8); do
  state=$(gh pr checks <pr> --json bucket --jq 'if length == 0 then "none" else ([.[] | select(.bucket == "pending")] | length | tostring) end')
  [ "$state" = "0" ] && break
  sleep 60
done
gh pr checks <pr> --json name,bucket --jq '.[] | "\(.name): \(.bucket)"'
```

When everything is green, merge per `git.md` § Merging. On a red check, read the failing log (`gh run view <id> --log-failed`), fix it on the branch and push. Ask first only when the failure is ambiguous (flaky test, infrastructure outage, or the test and the change disagree about intended behavior).

<!-- TOGGLE:github_actions_paths_ignore_auto_merge START -->
### Fast path for docs-only PRs

Diffs with no source files (docs, rules, `.claude/**`) pass both review checks in about 30 seconds. Skip the monitor: wait about 90 seconds, check `gh pr view <pr> --json mergeable,mergeStateStatus`, then merge per `git.md` § Merging:

- `MERGEABLE` and `CLEAN`: merge.
- Anything else, including `BLOCKED`: stop and report the state. Never merge past a rule.

Approval to open the PR covers this merge.
<!-- TOGGLE:github_actions_paths_ignore_auto_merge END -->

## Long sessions

Cut to the session-close ritual when responses slow down or degrade, the same file keeps getting re-read, or system reminders pile up. Leave room to finish the close cleanly.
