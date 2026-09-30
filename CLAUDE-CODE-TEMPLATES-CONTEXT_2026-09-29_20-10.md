# claude-code-templates — session handoff (2026-09-29 20:10)

Single source of truth for what this session left undone. `/session-start` reads this first. It records only current state that `git log`, open issues, the CHANGELOG and `docs/v2/PLAN.md` don't already show.

---

## Headline: the engine and hook tests are a required check on `develop`

- **`.github/workflows/tests.yml`** runs every `engine/test/*.test.js` file and the Python tests in `tools/` on every pull request into `develop` or `main`, and on pushes to `develop` that touch tested files. It fails on a failing test, a skipped test, a run with no tests, or a file pattern that matches nothing. Latest full run: 41 of 41 Node tests on Node 22, 53 of 53 Python tests on Python 3.12.
- **`Engine and hook tests` is required on `develop`** (maintainer decision 2026-09-29, ruleset `develop-protection`, integration 15368), next to `Evaluate review outcome` and `Claude On-Demand`. Pull requests run it whatever they change, because a path-filtered required check would wait forever on a docs-only PR. Not required on `main` yet: `main` has no engine until v2.0.0, and the job only posts a notice there. Revisit at the v2.0.0 release.
- **It runs its tests wherever `engine/package.json` exists**, so hotfixes into `main` are tested once the engine ships there. On `develop` a missing engine is an error.
- **Python twin of the engine** (`engine/model.py`, `render.py`, `bind.py`): every engine change lands in both in the same PR; `engine/test/golden.test.js` fails on any byte of difference or differing error message. `python engine/bind.py < answers.json` is the entry point `/bindwright:setup` can call.
- **`shippedTextPaths`**: a project's glob list for the writing rule, swapped into the rule's frontmatter after rendering.
- **The Windows test crash is fixed** (PR #189). Cause: once a Node 20 process starts Python through a Windows App Execution Alias (`WindowsApps\python.exe`), its next start of an interpreter by full path aborts with `AssignProcessToJobObject: (87)`. The tests now find the interpreter's full path in a throwaway Node process and start Python by full path only. It was never about the checkout's location.

---

## Decisions still in force

- **Every PR merges with a merge commit** (`gh pr merge <pr> --merge`). The engine's default `mergeStyle` is `merge`; squash and rebase stay options.
- **Work stays local; the cloud is retired.** The cloud connector appends an attribution footer to PR bodies that survives in GitHub's edit history.
- **Attribution guard is opt-out, and its rule is "no attribution", not "no mention".** The maintainer's home-folder guard reads any `--body-file` before the command runs, so write the body file in its own step first.
- **The current page gets no visual gate** until the Bindwright UI/UX overhaul lands.
- **Engine-only switches are not added to `TOGGLES.md`, the bundle files or the v1 page** (`devIsDefault`, `hookLocation`, `attributionGuard`, `denyProfile`, `shippedTextPaths`).
- **No interim release.** `main` stays on v1.4.0 until v2.0.0.
- **Never write the whole deep-review trigger phrase into a PR's files** (tests build it from pieces).
- **Run the engine tests with plain `node --test` from `engine/`** (or `npm test`). Node 22 and later read a folder argument (`node --test test/`) as a module path and fail.
- **In the tests, never start Python through the `python` alias and then by full path in the same Node process** (see the crash above).
- **Workflow-only PRs from our sessions:** two fresh local subagent reviews per round on the head SHA, a PR comment recording both verdicts, merge with `--match-head-commit`. Tell the reviewers the shared-PC limits.
- **Track every session item in the task list** (`TaskCreate`/`TaskUpdate`), including cleanup, review rounds and the handoff, and never mark an item done that was only "could not reproduce". The maintainer called this out on 2026-09-29.

---

## Open work

Next in Phase 1 (`docs/v2/PLAN.md`):

- Code-research tool profiles (data file) replacing the SETUP.md hook-install prose.
- Plugin skeleton with `/bindwright:setup`.

Other items:

- **Tokensave adherence was 0% on 2026-09-29**: code research used `grep` in Bash and the tokensave-first hook did not stop it. Start code research with `tokensave_search`/`tokensave_context`.
- At v2.0.0: decide whether `Engine and hook tests` becomes required on `main` too.
- Receipts "session stories" for the Phase 3 evidence section (session logs exist only on the maintainer's PC).
- Phase 2 notes: `setup-review-gate.sh` merge-commit title/body settings; develop and main rulesets `[merge]`.
- The maintainer retires the GameProject-only workflow-off-main hook (maintainer-owned).
