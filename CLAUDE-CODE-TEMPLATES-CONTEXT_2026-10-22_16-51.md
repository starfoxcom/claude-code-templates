# Hand-off — 2026-10-22 16:51

Closed at the maintainer's request, to leave plan usage for another project. No PR is open other than this hand-off; `develop` is clean apart from untracked strays (see On hold).

## Shipped since the last hand-off (gate fixes, this session's tail)
- #429 (main): the light gate checkouts (Diff triage, Evaluate review outcome) use their own `.review-gate/` folder, cleared before each checkout, so a self-hosted runner's shared workspace cannot empty or redirect them.
- #430 (main): full checkouts also start fresh from a sparse clone; claude.yml header and prompt wording.
- #432 (main): the deep review action attempts fetch the PR branch from a local bare repo in `$RUNNER_TEMP` (objects shared through alternates, refs at the head SHA for the branch and `refs/pull/N/head`), detached before each attempt, origin pointed back at GitHub in an `always()` step. Replaces #430's git login: the action revokes its token after each attempt, so retries fetched with a dead token on every repo. Pin-check wording no longer assumes mod tests.
- #431 (cascade to develop): all three, with the templates copied byte-identical.
- Verified live: deep run 39873970736 served the first attempt from the local repo and restored origin. The retry and fallback path is only tested locally so far.
- Earlier today: #423 (`.bindwright/project.json` + `pristine.json` on every bind), #428 (`--adopt`, `.bindwright/owned`, keep markers), #427 (usage-ceiling line removed).

## Decisions
- No workflow token in `.git/config` during the deep attempts, even though the pinned action deletes the header before the reviewer starts: the safety should not rest on the action's internal order.
- The update base for v2 stays the pristine render, not adopted files.

## On hold
- Untracked strays at the repo root and in `_core/project-template/` (an odd-named hooks folder with a git-lfs key, `a?b.md`, `nxe9.md`, `sub/`, `inject.txt`): waits on the maintainer's yes to delete and whether the key needs revoking. Never `git add -A`.
- #337 and #338 close once the downstream ports merge; three downstream ports wait on the maintainer's go.
- Name purge backups: wait on the GitHub Support reply.
- #339: rotate the API key in December.
- New follow-ups on the board: #433 (verdict time floor from the runner clock), #434 (Evaluate's checkout failure should fail the gate clearly).

## First steps next session
1. Watch the first deep review that needs a retry or fallback: the "Serve the PR branch locally again / for the fallback" steps should succeed and the attempt fetch from the local repo.
2. Code-research count was 54% (18 tokensave, 15 plain): most plain searches were greps of workflow YAML and the action's downloaded source outside the index. Check whether workflow files should be indexed or the greps marked.
3. Continue board 6 "Bindwright" in order: #340's split (#417 onward; #419 waits on the maintainer's sign-off on `docs/v2/HANDOFF.md`).
