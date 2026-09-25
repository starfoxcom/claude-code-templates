# claude-code-templates — session handoff (2026-09-24 18:51)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues and the CHANGELOG don't already show.

---

## Headline: PR #163 (push guard) is mid-rewrite and must not be pushed yet

**Branch:** `fix/push-guard-block-only`.
- **Remote and PR #163:** head `b818f32`, which is the old hand-written shell-parser guard.
- **Local branch:** 2 commits ahead of the remote:
  - `fba6477` rewrites the guard as a text guard;
  - this session-close commit adds the handoff file.
- **Do not push** until the local review loop below reaches 🟢 on both tiers. That is the maintainer's standing order.

### Why the rewrite
- The block-only parser guard went through about 20 review rounds, and each round found new shell-grammar corners. It could not converge, and every round cost Actions minutes.
- For three of those rounds, only the routine comment was answered, so the deep-review findings were missed. **Always read both the routine and the deep comment.**
- The maintainer approved replacing the parser with a text guard of about 230 lines, `_core/global-template/hooks/push-guard.py`. It works in four steps:
  1. It strips quoting: Bash `$'...'` escapes, PowerShell `` `u{} ``, quotes, backslashes and backticks.
  2. It cuts out substitutions to be read separately: `$(...)`, `${...}`, Bash backticks, and PowerShell `(...)`.
  3. It splits into statements at `\n ; | &`, plus a lone CR in PowerShell.
  4. It blocks a git push word followed by a force flag in the same statement: `-f` bundle, `--force`, a `--mirror` prefix, `+ref`, a forcing `-c remote.*` setting, or a `-c alias.x=push` alias.
- **Accepted trade-off:** text that only mentions a force push is blocked too, and the block message says to pass that text in a file.
  - The replay over 13,369 real session commands blocked 30, all from developing the guard itself, with 0 errors and nothing slow.
  - The earlier "a branch deleted and then pushed again" block is dropped. It's now listed as out of reach.
- `engine/test/bind.test.js` has been reworked around the new contract, with a new `mentions` table and rows moved between `hidden` and `unguarded`. It passes 34/34 locally.

### Next steps, in order
1. **Update the docs that still describe the parser:**
   - SETUP.md Phase 7c: the `[y/N]` and `[Y/n]` consent lists;
   - the CHANGELOG `[Unreleased]` #158 guard entry;
   - `_core/global-template/README.md` §4b.
   They must match the text-guard docstring: what it blocks, the mention trade-off, and what is out of reach.
2. **Run the local review loop (maintainer order):** 2 subagents.
   - One follows the exact routine-review prompt in `.github/workflows/claude-code-review.yml`.
   - One follows the exact deep-review prompt in `.github/workflows/claude.yml`.
   - Fix what they find, and repeat until both give 🟢 locally.
3. **Push once.** Watch CI with the Monitor tool, and read both review comments.
4. **Merge** with `gh pr merge 163 --squash --delete-branch`, then `git branch -D fix/push-guard-block-only`.
5. **Reinstall the global guard and replay.** The installed `~/.claude/hooks/push-guard.py` is still the parser version `b818f32`. Use the scratchpad `install_guard.py` / `replay_inproc.py` approach again (in process, calling `check()`).

---

## Other open work (task list)
- #30: align the branch-cleanup rule text (live and canonical) with the `gh pr merge --delete-branch` + `git branch -D` sequence.
- #28: review verdicts should name the model that actually ran.
- #22/#23: the `tools/receipts.py` metrics script. It is untracked in `tools/` on this branch and belongs on its own develop branch.
- #10/#11/#15: Bindwright P1c/P1d (tool profiles, plugin skeleton, repo-level hooks).
- #19: the maintainer retires the Emberholm-only workflow-off-main hook.
- #20: phase 2 notes from the Stockra/Emberholm switch.
- #4: cloud-session fit for this repo.
