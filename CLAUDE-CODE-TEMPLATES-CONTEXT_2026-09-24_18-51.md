# claude-code-templates — session handoff (2026-09-24 18:51)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues and the CHANGELOG don't already show.

---

## Headline: PR #163 replaces the push guard's shell parser with a text guard

**Branch:** `fix/push-guard-block-only`. Before this PR is pushed, it goes through the local review loop: two subagents run the exact routine and deep review prompts, until both give 🟢. That is the maintainer's standing order.

### Why the rewrite
- The block-only parser guard went through about 20 CI review rounds. Each round found new shell-grammar corners, and every round cost Actions minutes.
- For three of those rounds only the routine comment was answered, so the deep-review findings were missed. **Always read both the routine and the deep comment.**
- The maintainer approved replacing the parser with a text guard, `_core/global-template/hooks/push-guard.py`. Its module docstring is the contract: what it reads, what it blocks, and what is out of reach.
  - SETUP.md Phase 7c's `[y/N]` and `[Y/n]` consent texts must list the same out-of-reach set.
  - `engine/test/bind.test.js` has a probe for each item.
- **Accepted trade-off:** text that only mentions a force push is blocked too. The block message says to pass such text in a file.
- **Linear-time invariant:** every step must stay linear up to MAX_COMMAND. When changing a pattern, run a brute-force timing sweep over short repeating units, not just hand-picked shapes. Round 3 of the local review found a 42-second pattern that the hand-picked shapes missed.

### After #163 merges
1. Merge with `gh pr merge 163 --squash --delete-branch`, then `git branch -D fix/push-guard-block-only`.
2. **Reinstall the global guard and replay.** The installed `~/.claude/hooks/push-guard.py` is still the old parser version. Copy the merged file into place, then replay recent session transcripts through `check()` in process. Expect blocks only on commands that were developing the guard itself.

---

## Other open work (task list)
- #30: align the branch-cleanup rule text (live and canonical) with the `gh pr merge --delete-branch` + `git branch -D` sequence.
- #28: review verdicts should name the model that actually ran.
- #22/#23: the `tools/receipts.py` metrics script. It is untracked in `tools/` on this branch and belongs on its own develop branch.
- #10/#11/#15: Bindwright P1c/P1d (tool profiles, plugin skeleton, repo-level hooks).
- #19: the maintainer retires the Emberholm-only workflow-off-main hook.
- #20: phase 2 notes from the Stockra/Emberholm switch.
- #4: cloud-session fit for this repo.
