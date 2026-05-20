# claude-code-templates — session handoff (2026-05-19 18:51)

Single source of truth for what this session left undone. `/session-start` reads this file first. Everything below is current state that isn't derivable from `git log` or open issues alone.

---

## Where the branches are

| Branch | Commit | Notes |
|---|---|---|
| `main` | `5c49621` | Carries all 4 hotfixes shipped this session (PR #44/49/51/53/58 chain after the reset). Still tagged `v1.1.0` at `9403f43` — release tag unchanged. |
| `develop` | `f7d108b` | All hotfix cascades + 4 feature PRs landed. Both branches are byte-identical on `.github/workflows/claude*.yml`. |

Both workflow files (`claude-code-review.yml` and `claude.yml`) are now byte-identical between `main` and `develop`. The 22-hour-long routing/cascade saga that left them divergent is resolved.

---

## What the working repo looks like now (state, not history)

### Review workflows on develop + main — final hardened shape

`claude-code-review.yml` (both branches):
- Two-job structure: `triage` + `evaluate-review-outcome` (the older 3-job split is gone)
- `triage` reviewable extensions regex: `\.(html|jsx|js|json|yml|yaml|py|template)$|^_core/|\.additions$|/bundle\.toggles\.md$` — catches all high-blast-radius surfaces including pure `_core/.md` rule edits and bundle toggle files
- Inside `evaluate-review-outcome`: checkout@v6 → setup-python@v6 → substantive Python pre-screen → `claude-code-action@8c196b2f` (v1 SHA pin) → Evaluate review outcome
- Pre-screen runs 6 checks: toggle marker balance, placeholder validation (`_core/project-template/**`), AI-attribution scan (regexes encoded in `ai_pats`, comment is structural to avoid self-referencing FP), JSX/HTML parity, file categorization, deep-trigger surface detection
- Action invocation: `claude_args: '--allowedTools "Bash(gh *),Read" --max-turns 50 --model claude-sonnet-4-6'`
- Verdict read: `gh api --paginate ...` (the `--paginate` was added after Opus caught the pagination gap on PRs with >30 comments)
- 25-min cutoff on verdict-comment lookup — tight enough to scope to "this run," loose enough for Sonnet at 50 max-turns on large `_core/` diffs (one Sonnet run this session hit 22 min; widening further may be needed if it climbs)

`claude.yml` (both branches):
- Triggers: `issue_comment` + `pull_request_review_comment` + `pull_request_review` (no `issues:` — that was removed)
- Job-level `if:` uses `startsWith(body, 'Claude Code is working')` for the bot-loop guard, NOT `contains` — the `contains` form silently rejected escalation comments that quoted the filter phrase later in the body (caught when an Opus escalation never fired on PR #57)
- SHA-pinned action with `claude_args: '--allowedTools "Bash(gh *),Read" --max-turns 50 --model claude-opus-4-7'`
- `allowed_bots: "claude"` opts in to bot→bot triggers (routine review's `claude[bot]` escalation needs this)
- `Evaluate deep-tier verdict` step with corrected advisory comment + `--paginate` on its `gh api` call

### Canonical templates updated

`_core/project-template/.github/workflows/*.template` mirror the live shape. `_core/project-template/.claude/rules/`:
- `git.md` updated review tier table — deep tier explicitly advisory
- `review-tiers.md` updated gate model — single required check, deep advisory
- `token-efficiency.md` has the `jq` constraint blockquote (with the `gh --jq` polling snippet that aligns with the recommendation, not a python fallback that contradicts it) AND the renamed `Fast-path / auto-pass PRs` section matching `git.md`'s cross-reference

`_core/project-template/CLAUDE.md` SESSION START §4 + "During the session" block document the task-tracking discipline using `TaskCreate` / `TaskUpdate({ taskId, addBlockedBy: [...] })`. Tool note flags that `TodoWrite` is the fallback for builds where Task tools aren't default (avoids stale-rot from hardcoded version dates).

### Live repo's own CLAUDE.md

Root `CLAUDE.md` has the version-dated task-tracking bullet (project-level file, maintained here, doesn't propagate to downstream binds) + CI polling cadence (90s/7-min, all background) + branch cleanup discipline (local AND remote after every merge) + workflow-PR admin-bypass scenario documented.

### .gitignore

`.tokensave/` is properly ignored now (was creating phantom unstaged files in every clean checkout before — added in PR #48 right after the reset).

---

## Where the v1.2.0 release stands

**Not started yet.** Task #8 is the only remaining queue item.

The release would consolidate everything shipped since v1.1.0:
- Substantive Python pre-screen on routine review
- 25-min verdict cutoff
- Triage blast-radius coverage (templates, `_core/`, additions, bundle.toggles)
- `claude.yml` cleanup (issues trigger out, advisory comment, `startsWith` guard)
- `jq` constraint documentation
- Task-tracking discipline + multi-PR pattern (with addBlockedBy chaining)
- Canonical workflow templates updated to live shape
- `--paginate` on both verdict reads
- AI-attribution scanner comment de-self-reference
- index.html toggle blurb wording fix
- `.gitignore` `.tokensave/`

The release sequence per Gitflow:
1. Cut `release/v1.2.0` from `develop`
2. Bump `VERSION` (`v1.1.0` → `v1.2.0`) + write `CHANGELOG.md` entry
3. PR `release/v1.2.0` → `main` (no workflow files change — proper Sonnet+Opus review, no admin-bypass)
4. After merge, tag `v1.2.0` on `main`
5. Cascade `main` → `develop` so the version bump + changelog land on develop too

---

## Non-obvious things future-me should remember

- **Workflow changes route through `main` first, always.** Even when bundled with feature work. The Anthropic Claude Code GitHub App validates the workflow file against the default branch (`main`) before granting an OIDC-exchanged token. A workflow change that lands on `develop` first leaves `main` stale and every subsequent PR (even non-workflow PRs) hits `Workflow validation failed`. The session learned this the hard way — `feedback_workflow_changes_are_hotfixes` memory was added.
- **Bot-loop guard must use `startsWith`, not `contains`.** The action's progress comment body STARTS with `Claude Code is working`. Legitimate escalation comments may quote the phrase later (e.g. listing the filter as an invariant for Opus to verify). `contains` rejects both; `startsWith` admits the quote.
- **Pagination matters on both verdict reads.** `gh api` defaults to `per_page=30` ascending. On PRs with >30 existing comments the verdict comment lands on a later page; without `--paginate` the gate silently fails-red (routine) or silently passes (advisory deep tier when there's actually a 🔴 to surface).
- **The pre-screen scanner self-references.** Its doc comment must NOT reproduce the patterns in `ai_pats` — otherwise every PR touching the workflow file generates phantom AI_ATTRIBUTION violations. The fix is to keep the comment structural (point at `ai_pats` below) and let the regexes be the source of truth.
- **`Claude finished` mid-body matches false-positively.** The escalation comment template references "Claude finished" in its body somewhere, so jq filters that look for `contains("Claude finished")` will match escalation comments AND Opus completion comments. Filter with `startswith("**Claude finished")` (Opus's actual prefix) when you need just real verdicts.
- **One Sonnet run took 22 minutes.** On large `_core/` diffs Sonnet at 50 max-turns can creep close to the 25-min cutoff. If we see another long run, consider widening to 35 or 40 min — or adopting Emberholm's no-cutoff approach (asked for a detailed write-up via a handoff prompt; user will paste the response next session).
- **Memory updated.** `feedback_workflow_changes_are_hotfixes.md` is the new memory; the older "always hotfixes" framing was corrected mid-session to "routing-only, branch type still reflects nature of work."

---

## Open questions / next session

- **v1.2.0 release** — only outstanding task.
- **Emberholm's no-cutoff approach** — handoff prompt sent; awaiting user's report from that session.
- **`stash/recovery-snapshot-pre-reset` branch** — still on remote. Safe to delete once the user confirms nothing else needs to be recovered from it (everything was re-applied through PRs #48, #49-50, #51-52, #53-54, #55, #56, #57, #58-59, #60).
- **`C:\Users\alexz\AppData\Local\Temp\recovery-snapshot.patch`** — same — safe to delete once confirmed.
