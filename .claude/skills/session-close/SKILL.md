---
name: session-close
description: Run the session-close ritual end-to-end — DoD verification, commit, PR, polling loop, merge (where applicable), branch cleanup, context refresh, tokensave adherence metric.
---

# /session-close

Run this skill at the end of every work session, or when the conversation is near saturation. Executes end-to-end — no per-step approval gate unless the next move is genuinely dangerous (force-push, force-delete with unmerged work, destructive history rewrite).

## Steps

### Definition-of-done verification (if claiming a milestone / feature complete)

Re-read the relevant DoD (from the open issue, the feature's design doc, or the PR description). For each DoD bullet:

- ✅ **verified** — reproduced in running app + commit SHA + scene/route/page + (where applicable) screenshot or log evidence path
- ⚠️ **partial** — works in some scenarios, not others — list the gaps
- ❌ **unmet** — does not work — open a follow-up branch, set milestone status to 🔄 in the tracking issue, STOP

If any bullet is ❌, **the milestone is not complete.** Do not generate a "milestone complete" context file or commit message.

If a DoD bullet has become unrealistic or out-of-scope mid-milestone, revise the DoD on its own commit before the verification ritual — never silently rationalize a gap as deferred.

### Commit / PR decision tree

Evaluate in order — apply the first row that matches:

| Condition | Action |
|---|---|
| No code changes (context refresh only) | Generate context file + commit + PR + paths-ignore fast-path auto-merge (when review workflows are installed and ON) + branch cleanup. |
| Changes exist, branch objective **incomplete** | Commit with work done. No PR. |
| Changes exist, branch objective **complete** | Commit (if uncommitted) + PR to `develop` + standard polling loop + merge + branch cleanup. |
| Branch is `hotfix/*` and complete | Commit + PR to `main` (merge to `develop` managed from GitHub). |
| Branch is `release/*` and complete | Commit + PR to `main` AND `develop`. |

Commit and PR format per `_core/project-template/.claude/rules/git.md`. Use **atomic Bash calls** — never `&&`-chain post-merge cleanup; permission rules match the full command string and chained calls stall on partial deny.

### Update context

Generate a new `CLAUDE-CODE-TEMPLATES-CONTEXT_YYYY-MM-DD_HH-MM.md` at the repo root (rename the existing one with current date and time — `git mv` it out first so the uniqueness rule holds).

**Local time:**

1. **Check the conversation context first.** If the optional `UserPromptSubmit` time-injection hook is installed (see `~/.claude/CLAUDE.md` → "Time-of-day awareness"), every prompt comes prefixed with a line of the form `[time] YYYY-MM-DD HH:MM:SS <zone>`. Reuse the most recent one — it's authoritative.
2. **If no `[time]` line is available** (hook not installed, or you need to confirm against a fresh clock), fall back to terminal commands. Try in order, OS-clock only — **never hardcode a timezone**:

   ```bash
   powershell -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm'"
   node -e "console.log(new Date().toLocaleString('sv-SE').replace(',',' '))"
   python -c "from datetime import datetime; print(datetime.now().strftime('%Y-%m-%d_%H-%M'))"
   date '+%Y-%m-%d_%H-%M'
   ```

   Hardcoded IANA strings (e.g. `'America/Mazatlan'`) inherit US-DST assumptions that are wrong for non-US-DST locales; the OS clock is always the right source.

**Context file structure:** current state only — decisions and implementation details not derivable from the code, open issues, or git log. Conventions and rules already live in `_core/project-template/.claude/rules/` (referenced from this repo's CLAUDE.md) — do not duplicate.

**Uniqueness rule:** exactly **one** `CLAUDE-CODE-TEMPLATES-CONTEXT_*.md` must exist in the root at all times. When creating a new one, delete the previous with `git rm`.

### Update derived docs

If applicable, update `CLAUDE.md`, `README.md`, `CHANGELOG.md`, or the touched bundle's `bundle.toggles.md`/README with relevant changes. Clearly indicate which sections changed.

### Code-research adherence metric

Before signaling session close, count how often code-research happened through tokensave vs through Grep/Glob/raw-grep this session:

- **tokensave calls this session:** look at your tool-use history and count any call matching `tokensave_*` (search, context, callers, callees, impact, body, files, read, outline, etc.).
- **Grep + Glob calls this session:** count `Grep` + `Glob` tool calls + any Bash command containing `grep `, `rg `, `ag `, `ack `, `ripgrep ` UNLESS the command had a `# TOKENSAVE_BYPASS:` marker.
- **Adherence ratio** = `tokensave_calls / (tokensave_calls + grep_glob_calls)` — express as a percentage.

Report it like:

> **tokensave adherence this session: 7 tokensave calls / 1 grep fallback → 87%.** (Bypass reason: <if any>.)

If the ratio is under 70% AND there were no documented bypass reasons, surface that as a regression to fix next session. The hook should have prevented unjustified Grep calls; if any got through, note why.

### Signal session close

After completing the above, explicitly tell the user:

> **Session closed.** The context file is updated, all changes are committed, [PR merged + branches cleaned up | branch pushed, awaiting CI]. You can close this conversation and start a fresh one for maximum free context.
