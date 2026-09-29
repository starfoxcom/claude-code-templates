# claude-code-templates — session handoff (2026-09-29 02:04)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show.

---

## Headline: the deny list ships in two profiles

- **The deny list lives in the committed `.claude/settings.json`** (PR #179). `settings.local.json.template` keeps only the allow list. Engine switch `denyProfile`: `standard` (default) or `strict`. The engine README, CHANGELOG `[Unreleased]` and PLAN.md describe both lists.
- **This repo's `.claude/settings.json` carries the resolved standard list** (gitflow, `main`/`develop`). Re-resolve it from the template whenever the deny rules change; nothing checks the two for drift yet.
- **Protected-branch rules are anchored on the branch name.** Every spelling (`main`, `HEAD:main`, `refs/heads/main`, `:refs/heads/main`, `--delete`) ends at the name or at a following space, so `main-fix` and `mainline` stay pushable. Both review tiers verified the semantics against the `toRegex` model in `engine/test/bind.test.js`.
- **Standard dropped three rules the old default had:** `git reset --hard`, `git clean -f` and `git branch -D main`/`develop` now come only with `strict` (maintainer-approved plan, flagged again at merge). `git branch -D master` is gone.

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`; maintainer decision 2026-09-29, PR #181). Squash flattened the history graph, and the graph matters to the maintainer. The engine's default `mergeStyle` is `merge`; squash and rebase stay options. The `develop` ruleset now allows only merge commits (`main` already did). GameProject and Stockra switched back the same night. PRs #179 and #180 stay squashed; un-squashing would rewrite `develop`.
- **Work stays local; the cloud is retired.** The cloud connector appends an attribution footer to PR bodies that survives in GitHub's edit history.
- **Attribution guard is opt-out, and its rule is "no attribution", not "no mention".** The maintainer's own home-folder guard stays stricter by choice. It reads any `--body-file` before the command runs, so write the body file in its own step first.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches are not added to `TOGGLES.md`, the bundle files or the v1 page** (precedent: `devIsDefault`, `hookLocation`, `attributionGuard`, now `denyProfile`). The v1 SETUP.md path never renders `settings.json.template`, so its toggle markers do not reach v1 users.
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files.** Tests build it from pieces (`DEEP_TRIGGER` in `tools/test_guard_hooks.py`).

---

## Open work

The previous handoff numbered these items (#10, #11, #22…); those were session task labels, not GitHub issues. The unchecked boxes in `docs/v2/PLAN.md` are the backlog. Next in Phase 1:

- Shipped-text scope as a per-project list of globs.
- Python twin of the engine with a golden test.
- Code-research tool profiles (data file) and the plugin skeleton with `/bindwright:setup`.

Other items:

- **Local test crash (small fix, own PR).** `the push guard blocks force pushes in any flag bundle` in `engine/test/bind.test.js` crashes Node 20 on the maintainer's Windows PC (`AssignProcessToJobObject: (87)`), on `develop` too. It spawns `sys.executable`, the WindowsApps alias path, which the test file's own comment warns about. CI on Linux passes. Until fixed, run the rest locally with `node --test --test-name-pattern=...`.
- Receipts "session stories" for the Phase 3 evidence section (session logs exist only on the maintainer's PC).
- Phase 2 notes: `setup-review-gate.sh` merge-commit title/body settings; develop and main rulesets `[merge]`.
- The maintainer retires the GameProject-only workflow-off-main hook (maintainer-owned).
- A deep-tier run noted it cannot execute `node --test` (Bash approval denied in the action). Adding `Bash(node --test:*)` to the review workflows' allowed tools would let reviewers run the suite; that is a workflow-only change (hotfix to `main`, then cascade).
