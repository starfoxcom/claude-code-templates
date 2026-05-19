# Token efficiency — mandatory rules

## Read before writing

Before reading any source file to understand a symbol, first:

1. If tokensave is installed, use `tokensave_search` / `tokensave_context` to locate the definition.
2. Otherwise, use `grep -rn` (via Grep tool) to find the symbol.
3. Read only the relevant function/class, not the whole file.
4. Only read the full file if context genuinely requires it.

---

## Command timeout scaling

Never retry a timed-out command with the same timeout. Each retry escalates:

| Attempt | Timeout |
|---|---|
| 1 | 420 000 ms (7 min) |
| 2 | 600 000 ms (10 min) |
| 3 | 780 000 ms (13 min) |
| 4+ | +120 000 ms per retry |

Default starting timeout for build commands (CMake, scons, cargo build, dart pub get, npm install, etc.): **420 000 ms**.

---

## CI monitoring + auto-merge

**Never use streaming log watchers** (`gh run watch`). After every push to a PR branch, poll **all** workflow runs for the branch's HEAD SHA every 7 minutes until every one reaches `status: completed`. Multiple workflows can run per push — don't accept a partial result.

Run the polling loop with `run_in_background: true` so the conversation isn't frozen on the wait. The harness notifies when the background command exits; pick up other work or wait for the user in the meantime.

> **Background shell constraint — critical:** the background Bash environment **may not** have the external `jq` binary available (it's absent on Windows Git Bash, stripped-down containers, and some sandboxed harness shells; present on `ubuntu-latest` runners, Homebrew macOS, and most devcontainer images). Piping to `jq` where it's missing produces `jq: command not found`, silently breaks the `&&` chain, and leaves the loop running forever. Use a portable extraction method instead:
> - **Preferred:** `gh`'s built-in `--jq` flag (e.g. `--jq '.[0].status'`) — no external tool, works wherever `gh` works
> - **Fallback:** `python3 -c "import sys,json; ..."` reading from stdin — guard with `command -v python3` if you need cross-platform support (Windows Git Bash often ships `python` only, minimal containers may have neither)

```bash
SHA=$(git rev-parse HEAD)
while true; do
  RUNS=$(gh run list --branch <branch> --limit 10 \
    --json databaseId,name,status,conclusion,headSha)
  INFLIGHT=$(echo "$RUNS" | python3 -c "
import sys, json
runs = [r for r in json.load(sys.stdin) if r['headSha'] == '$SHA']
print(sum(1 for r in runs if r['status'] != 'completed'))
")
  [ "$INFLIGHT" = "0" ] && break
  sleep 420
done
```

**On all-green (🟢 verdict):** merge with `gh pr merge --merge` — a true merge commit. Never `--squash` or `--rebase`; merge history matters for GUI git clients.

**On any-red (🔴 verdict or workflow failure):** fetch failing logs with `gh run view <id> --log-failed`, identify the offending job + step, propose the fix in one sentence, apply it, push. The push triggers a fresh polling loop on the new SHA. Don't ask permission for routine breakages (compile errors, missing-file paths, lint, dependency-version pins) — fix and push. Ask only when the failure is genuinely ambiguous (flaky test, infra outage, behavior-change-vs-test disagreement).

<!-- TOGGLE:github_actions_paths_ignore_auto_merge START -->
### Paths-ignore fast path — auto-merge with no CI

When the PR's diff falls **entirely** within the workflows' `paths-ignore` set (typically `**/*.md`, `docs/**`, `.claude/**`, `.github/workflows/claude*.yml`), no workflows fire. Don't sit on a 7-minute polling loop waiting for runs that will never start.

1. **Verify the diff is fully under paths-ignore** — `gh pr diff <pr> --name-only` and confirm every file matches a pattern.
2. **Sleep 90 seconds** as a grace period, then `gh run list --branch <branch> --limit 5 --json status,headSha` filtered to the PR's HEAD SHA. If still zero runs, none will start.
3. **Verify the PR is mergeable** — `gh pr view <pr> --json mergeable,mergeStateStatus` should report `MERGEABLE` + `CLEAN`.
4. **Auto-merge** with `gh pr merge <pr> --merge` (still merge commit).
5. **Delete branches** (local + remote) per standing authorization.

This fast path is **only** for PRs entirely under paths-ignore — if even one file falls outside, fall back to the standard 7-minute polling loop.
<!-- TOGGLE:github_actions_paths_ignore_auto_merge END -->

---

## Usage ceiling rule

When usage ≥ 80%: commit locally, do not push to PR (deep code review costs ~10–15% per cycle).

Present two options:

**Option 1 — Close session:** commit → regenerate context file (if you use them) → update ROADMAPs → summarize.

**Option 2 — Continue:** estimate remaining capacity:

| Operation | Approximate cost |
|---|---|
| Read small file (< 100 lines) | ~0.5% |
| Read large file (200–500 lines) | ~1–2% |
| Write / rewrite file | ~1–2% |
| Build + analyze | ~1% |
| Git commit + push | ~0.5% |
| Session close | ~3–5% |
| Deep review CI run | ~10–15% |

Always leave ≥ 5% buffer for session close.

---

## Long-session signals → cut immediately

- Context saturated (tool calls slow, responses degraded)
- Multiple `<system-reminder>` blocks accumulating
- Repeated reads of the same file
- User notices rapid token consumption

When triggered: prepare session close ritual immediately.

---

## Read review-comment verdict, not workflow conclusion

`gh run list --headSha <sha>` misses issue-comment-triggered deep reviews (the deep review's workflow run won't show under the original PR commit's SHA). Always read the 🔴/🟢 verdict line directly from the latest review comment via `gh api repos/{{REPO_URL}}/pulls/<pr>/comments` or `gh pr view <pr> --json comments`.
