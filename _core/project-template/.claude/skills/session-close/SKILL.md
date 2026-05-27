---
name: session-close
description: Run the session-close ritual end-to-end — DoD verification, commit, PR, polling loop, merge (where applicable), branch cleanup, context refresh.
---

# /session-close

Run this skill at the end of every work session, or when the conversation is near saturation. Executes end-to-end — no per-step approval gate unless the next move is genuinely dangerous (force-push, force-delete with unmerged work, destructive history rewrite).

## Steps

<!-- TOGGLE:definition_of_done_verification START -->
### Definition-of-done verification (if claiming a milestone / feature complete)

Re-read the relevant DoD (from ROADMAP.md, the feature's design doc, or the PR description). For each DoD bullet:

- ✅ **verified** — reproduced in running app + commit SHA + scene/route/page + (where applicable) screenshot or log evidence path
- ⚠️ **partial** — works in some scenarios, not others — list the gaps
- ❌ **unmet** — does not work — open a follow-up branch, set milestone status to 🔄 in ROADMAP.md, STOP

If any bullet is ❌, **the milestone is not complete.** Do not generate a "milestone complete" context file or commit message.

If a DoD bullet has become unrealistic or out-of-scope mid-milestone, revise the DoD on its own commit before the verification ritual — never silently rationalize a gap as deferred.
<!-- TOGGLE:definition_of_done_verification END -->

### Commit / PR decision tree

Evaluate in order — apply the first row that matches:

| Condition | Action |
|---|---|
| No code changes (context refresh only) | Generate context file (if `context_refresh_files` is ON) + commit + PR + paths-ignore fast-path auto-merge (if enabled) + branch cleanup. |
| Changes exist, branch objective **incomplete** | Commit with work done. No PR. |
| Changes exist, branch objective **complete** | Commit (if uncommitted) + PR to `{{DEV_BRANCH}}` + standard polling loop + merge + branch cleanup. |
| Branch is `hotfix/*` and complete | Commit + PR to `{{MAIN_BRANCH}}` (merge to `{{DEV_BRANCH}}` managed from GitHub). |
| Branch is `release/*` and complete | Commit + PR to `{{MAIN_BRANCH}}` AND `{{DEV_BRANCH}}`. |

Commit and PR format per `.claude/rules/git.md`. Use **atomic Bash calls** — never `&&`-chain post-merge cleanup; permission rules match the full command string and chained calls stall on partial deny.

<!-- TOGGLE:context_refresh_files START -->
### Update context

Generate a new `{{PROJECT_NAME_UPPER}}-CONTEXT_YYYY-MM-DD_HH-MM.md` (rename the existing one with current date and time).

**Local time:**

1. **Check the conversation context first.** If the optional `UserPromptSubmit` time-injection hook is installed (see `~/.claude/CLAUDE.md` → "Time-of-day awareness"), every prompt comes prefixed with a line of the form `[time] YYYY-MM-DD HH:MM:SS <zone>`. Reuse the most recent one — it's authoritative.
2. **If no `[time]` line is available** (hook not installed, or you need to confirm against a fresh clock), fall back to terminal commands. Try in order, OS-clock only — **never hardcode a timezone**:

   ```bash
   node -e "console.log(new Date().toLocaleString('sv-SE').replace(',',' '))"
   python -c "from datetime import datetime; print(datetime.now().strftime('%Y-%m-%d %H:%M'))"
   date '+%Y-%m-%d %H:%M'
   powershell -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"
   ```

   Hardcoded IANA strings (e.g. `'America/Mazatlan'`) inherit US-DST assumptions that are wrong for non-US-DST locales; the OS clock is always the right source.

**Context file structure:** current state only — decisions and implementation details not derivable from the code. Conventions and rules already live in `.claude/rules/` — do not duplicate.

**Uniqueness rule:** exactly **one** `*-CONTEXT_*.md` must exist in the root at all times. When creating a new one, delete the previous with `git rm`.

### Model + effort outcome log

Append to the regenerated context file under a `## Session model setup` section:

- **Recommended at start:** <model> · <effort> · <archetype>
- **Used:** <model> · <effort> (note any mid-session switches with reason)
- **Outcome:** <retries needed? cleanup PR needed? wrong-branch edits? notes>

Empirical feedback loop: if `Used` diverged from `Recommended`, note why — it's signal for matrix tuning. After ~10 sessions, the session-start matrix in `.claude/skills/session-start/SKILL.md` can be tuned from real data instead of community reports. **This section sits inside the `context_refresh_files` toggle** because it appends to the file that toggle creates; disabling the toggle strips both coherently.
<!-- TOGGLE:context_refresh_files END -->

### Update derived docs

If applicable, update `CLAUDE.md`, `README.md`, and any touched module's `ROADMAP.md` with relevant changes. Clearly indicate which sections changed.

<!-- TOGGLE:dod_devlog_step START -->
### Devlog draft (only when a milestone just closed)

Triggered only when the DoD verification step just flipped a milestone to ✅. Skipped for routine sessions, hotfixes, releases, or partial-milestone sessions.

1. Create `devlog/posts/<NNNN>-<slug>/` (next sequential number; slug = milestone topic).
2. Copy from `devlog/posts/0000-template/` and fill in `post.md` from the milestone DoD checklist + new context file.
3. Commit drafts with `docs(devlog): draft post for M<N>`.
4. **Stop there.** The user reviews and publishes manually — never auto-push to external services.
<!-- TOGGLE:dod_devlog_step END -->

<!-- TOGGLE:tokensave_entry_point START -->
### Code-research adherence metric

Before signaling session close, count how often code-research happened through {{TOOLS_CODE_RESEARCH_NAME}} vs through Grep/Glob/raw-grep this session:

- **{{TOOLS_CODE_RESEARCH_NAME}} calls this session:** look at your tool-use history and count calls matching the tool's primitive shape:
  <!-- TOGGLE:code_research:tokensave START -->
  any call matching `tokensave_*` (search, context, callers, callees, impact, body, files, etc.).
  <!-- TOGGLE:code_research:tokensave END -->
  <!-- TOGGLE:code_research:ast-grep START -->
  any Bash command starting with `ast-grep run`, `ast-grep scan`, or `ast-grep test`.
  <!-- TOGGLE:code_research:ast-grep END -->
  <!-- TOGGLE:code_research:sourcegraph START -->
  any Bash command starting with `src search`, `src api`, or `src code-intel`.
  <!-- TOGGLE:code_research:sourcegraph END -->
  <!-- TOGGLE:code_research:ctags START -->
  any Bash command using `readtags`, or `grep` against a `tags` file, or `ctags -R` regeneration.
  <!-- TOGGLE:code_research:ctags END -->
  <!-- TOGGLE:code_research:semgrep START -->
  any Bash command starting with `semgrep`.
  <!-- TOGGLE:code_research:semgrep END -->
  <!-- TOGGLE:code_research:custom START -->
  any Bash command invoking the `{{TOOLS_CODE_RESEARCH_NAME}}` CLI per its documentation at {{TOOLS_CODE_RESEARCH_URL}}.
  <!-- TOGGLE:code_research:custom END -->
- **Grep + Glob calls this session:** count `Grep` + `Glob` tool calls + any Bash command containing `grep `, `rg `, `ag `, `ack `, `ripgrep ` UNLESS the command had a `# {{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` marker.
- **Adherence ratio** = `{{TOOLS_CODE_RESEARCH_NAME}}_calls / ({{TOOLS_CODE_RESEARCH_NAME}}_calls + grep_glob_calls)` — express as a percentage.

Report it like:

> **{{TOOLS_CODE_RESEARCH_NAME}} adherence this session: 7 {{TOOLS_CODE_RESEARCH_NAME}} calls / 1 grep fallback → 87%.** (Bypass reason: <if any>.)

If the ratio is under 70% AND there were no documented bypass reasons, surface that as a regression to fix next session. The hook should have prevented unjustified Grep calls; if any got through, note why.
<!-- TOGGLE:tokensave_entry_point END -->

### Signal session close

After completing the above, explicitly tell the user:

> **Session closed.** The context file is updated, all changes are committed, [PR merged + branches cleaned up | branch pushed, awaiting CI]. You can close this conversation and start a fresh one for maximum free context.
