# Token efficiency — mandatory rules

## Read before writing

Before reading any source file to understand a symbol, first locate it through this project's code-research tool, then read only the relevant function/class — never the whole file unless context genuinely requires it.

The canonical sequence for **{{TOOLS_CODE_RESEARCH_NAME}}** lives in `.claude/skills/find/SKILL.md`. Invoke `/find` (or follow its sequence inline) before any `Read` of a file you haven't opened yet this session. The `/find` skill also documents the fallback conditions for dropping back to plain `Grep`/`Glob`/`Read`.

<!-- TOGGLE:code_research:tokensave START -->
For this project (tokensave): start with `tokensave_search <name>` for symbol lookup, fall through to `tokensave_context <natural-language query>` for fuzzy exploration, then `tokensave_body <symbol>` to read a single function instead of the whole file.
<!-- TOGGLE:code_research:tokensave END -->
<!-- TOGGLE:code_research:ast-grep START -->
For this project (ast-grep): start with `ast-grep run --pattern '<name>' --lang <lang>` for symbol lookup, then `ast-grep run --pattern '<AST pattern>' --lang <lang>` for structural search. Read sliced code via `Read <file>` with `offset`/`limit` to inspect matched ranges.
<!-- TOGGLE:code_research:ast-grep END -->
<!-- TOGGLE:code_research:sourcegraph START -->
For this project (Sourcegraph): start with `src search 'r:<repo> <name>'`. For literal lookups use `patterntype:literal`; for file-name search use `type:file f:<pattern>`. Read sliced code via `Read <file>` with `offset`/`limit`.
<!-- TOGGLE:code_research:sourcegraph END -->
<!-- TOGGLE:code_research:ctags START -->
For this project (ctags): regenerate `tags` after edits (`ctags -R -f tags .`), then look up symbols with `readtags -t tags -e -p '<prefix>'` (Universal Ctags) or `grep -E '^<name>\b' tags` (any ctags). Insert a `-` separator before `<prefix>` only if it starts with `-`. Read sliced code via `Read <file>` with `offset`/`limit`.
<!-- TOGGLE:code_research:ctags END -->
<!-- TOGGLE:code_research:semgrep START -->
For this project (Semgrep): start with `semgrep --pattern '<name>' --lang <lang>` for symbol lookup, then `semgrep --pattern '$X = $Y' --lang <lang>` for structural search. Read sliced code via `Read <file>` with `offset`/`limit`.
<!-- TOGGLE:code_research:semgrep END -->
<!-- TOGGLE:code_research:none START -->
For this project (`tools.code_research: "none"`), there is no indexer — the `/find` skill resolves to a `Grep` → `Glob` → `Read` sequence. Still invoke `/find` rather than jumping to `Grep` directly, so the discipline of "narrow before you read" stays consistent.
<!-- TOGGLE:code_research:none END -->
<!-- TOGGLE:code_research:custom START -->
For this project ({{TOOLS_CODE_RESEARCH_NAME}} — see {{TOOLS_CODE_RESEARCH_URL}}): substitute the tool's symbol-lookup + structural-search commands here. Fall through to `Grep`/`Glob`/`Read` when the tool can't answer a question.
<!-- TOGGLE:code_research:custom END -->

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
  INFLIGHT=$(gh run list --branch <branch> --limit 10 \
    --json status,headSha \
    --jq "[.[] | select(.headSha == \"$SHA\") | select(.status != \"completed\")] | length")
  [ "$INFLIGHT" = "0" ] && break
  sleep 420
done
```

**On all-green (🟢 verdict):** merge with `gh pr merge --merge` — a true merge commit. Never `--squash` or `--rebase`; merge history matters for GUI git clients.

**On any-red (🔴 verdict or workflow failure):** fetch failing logs with `gh run view <id> --log-failed`, identify the offending job + step, propose the fix in one sentence, apply it, push. The push triggers a fresh polling loop on the new SHA. Don't ask permission for routine breakages (compile errors, missing-file paths, lint, dependency-version pins) — fix and push. Ask only when the failure is genuinely ambiguous (flaky test, infra outage, behavior-change-vs-test disagreement).

<!-- TOGGLE:github_actions_paths_ignore_auto_merge START -->
### Fast-path / auto-pass PRs

When the PR's diff contains no source-extension files (typically docs-only, rules-only, `.claude/**`, manifest tweaks), the workflow fires, `triage` classifies the diff as non-reviewable (`run_review=false`), `claude-review` is skipped via its `if: needs.triage.outputs.run_review == 'true'` guard, and `evaluate-review-outcome` (which runs via `if: always()`) takes the non-reviewable-diff path: PATCHes `Claude On-Demand` to `conclusion=skipped` and exits 0. Both required checks (`Evaluate review outcome` and `Claude On-Demand`) resolve to passing states. The whole run completes in ~30 seconds.

```bash
# Background pattern — uses gh's built-in --jq; no external jq required:
until [ "$(gh run list --branch <branch> --workflow=claude-code-review.yml --limit 1 --json status --jq '.[0].status')" = "completed" ]; do
  sleep 90
done
gh pr view <pr> --json statusCheckRollup
```

After the notification:

1. **Check the gate** — `gh pr view <pr> --json statusCheckRollup`. Expect `Diff triage: SUCCESS`, `Evaluate review outcome: SUCCESS` (the job runs via `if: always()`, PATCHes `Claude On-Demand` to `skipped` for non-reviewable diffs, then exits 0), and `Claude On-Demand: SKIPPED`.
2. **Verify the PR is mergeable** — `gh pr view <pr> --json mergeable,mergeStateStatus` should report `MERGEABLE` + `CLEAN` (or `BLOCKED` only on the required-approving-review gate, which `--admin` resolves).
3. **Auto-merge** with `gh pr merge <pr> --merge --admin` (merge commit; `--admin` bypasses the required-approval gate that maintainers can self-clear).
4. **Delete branches** (local + remote) per standing authorization.

This fast path is **only** for PRs the routine reviewer skips — if `Diff triage` reports `run_review=true`, fall back to the standard 7-minute polling loop and read the verdict comment.
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

`gh run list --headSha <sha>` misses issue-comment-triggered deep reviews (the deep review's workflow run won't show under the original PR commit's SHA). Always read the 🔴/🟢 verdict line directly from the latest review comment via `gh pr view <pr> --json comments` (or `gh api "repos/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/pulls/<pr>/comments"` if you need the lower-level API with the owner/repo slug rather than the full URL stored in `{{REPO_URL}}`).
