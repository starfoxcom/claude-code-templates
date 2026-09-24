# Adoption impact: would v2 help or hurt the source projects? (2026-09-24)

Each source project's session compared its live setup with `_core/project-template` on `develop` (9d7ea94) and `docs/v2/PLAN.md`, read-only. Phase 2 (gate v2) and Phase 2b (plugin lifecycle) were judged from the plan.

## Stockra

**Verdict:** adopting v2 as-is would degrade Stockra. Stay on its own setup, cherry-pick pieces, keep feeding learnings back. Re-evaluate the single-check gate once it has run on real PRs and covers the extension points below.

### Would lose
- **Board integration** (largest): org project queue (Row IDs, Queue Order, Blocked By), issue-body contract hook, `board_check.py --fix` at close, `board_link_pr.py`, slice sub-issues at the 10-link cap, per-session status update, milestone done-checks. v2 session-start/close are `ROADMAP.md`-driven; Stockra archived its ROADMAPs.
- **Stack rules and skills** with no v2 equivalent (path-scoped Dart/SQL rules, six `review-*.md` files, business-rules/i18n/sandbox skills) and CLAUDE.md non-negotiables (int-cents money, dependency direction, RLS on every table, ARB keys, `business_id` filter, 4-file SQL sync). Setup's CLAUDE.md merge must keep these verbatim.
- **Review gate depth:** Flutter-specific pre-screen (analyze per package, size check with baseline and exceptions ledgers, sandbox scan, ARB parity, path/regex auto-escalation), domain escalation list, subagent ban, usage-limit and plan-cap detection, routine-tier fallback model, `--max-turns 120`, reviewer `git diff/log/show` access (`gh pr diff` fails past 300 files), calibration and model A/B tooling built on two tiers.
- **Deny list:** about 75 committed denies vs v2's 8 in a local-only file (e.g. `--no-verify`, `commit --amend`, interactive rebase, direct pushes, `gh api` PUT/DELETE, secrets, publishing, `rm`, `sudo`, `curl|sh`, global git config, `filter-branch`).
- **Mechanical size enforcement** in CI (v2 is reviewer judgment only; v2's 1.5x test-file allowance is looser than Stockra's).
- **Stack-specific testing and visual detail** (manual fakes, logger/store recipe, named mutant kill tests, viewport tests and goldens, "run go" hand-off).
- **Token-efficiency extras:** model-seat table, rule-corpus audit cadence, MCP enable/disable rules, usage-window signals.

### Would gain
- `research-adherence.py` (Stockra cites an adherence metric nothing computes).
- Repo-committed guard hooks (Stockra's live only in `~/.claude`, so cloud sessions run without them).
- `/bindwright:update` three-way merge and `/bindwright:audit`.
- Single "Review gate" check with a testable shared parser (once it has the features above).
- code-size complexity and closure rows; testing seeded sweeps and flaky quarantine; visual build ladder and reuse-first; check-branch-before-edit; Monitor fallback; one task per PR with `addBlockedBy`.

### Conflicts
- **Admin bypass:** v2 tells the agent to use admin rights in `review-tiers.md`, the `token-efficiency.md` fast path and the `git.md` hotfix caveat. Stockra has no bypass actors by design; its rule is "release first". (Confirmed in templates 2026-09-24.)
- **Force-push:** v2's deny `Bash(git push --force:*)` is a prefix match that also blocks `--force-with-lease`, which v2's own stacked-branch recipe needs. Stockra denies `git push --force` and `git push --force *` and allows `--force-with-lease`. (Confirmed 2026-09-24.) **Correction, 2026-09-24:** the permission docs say a trailing `:*` equals a trailing ` *`, which needs a space, so the old rule never blocked `--force-with-lease`. The real gap was the other way: it missed `--force` after other arguments and `-f` inside a flag bundle (`-fu`, `-qf`). #158 fixes that with position-independent deny rules and a global push guard.
- Tracking (ROADMAP vs board), review check names (one vs two), per-package scope table and "feature complete" bar, commit title target (50 vs 72), same-named files with different content, context-file branch policy (own PR vs rides the active branch).

### Options v2 must add
1. "No bypass actors" mode: every admin instruction becomes "release first / fix the gate"; setup reads the ruleset to choose.
2. Tracker adapter: GitHub Project board hooks for session start and close instead of `ROADMAP.md`.
3. Gate extension points: project pre-screen script, project escalation triggers with path/regex auto-escalation, reviewer Bash allowlist, max-turns, fallback model chain with plan-cap detection, configurable check names or a ruleset migration script.
4. Project-owned files: a manifest `/bindwright:update` never touches, plus "keep this section" markers in shared files.
5. Deny-list profiles (standard and strict), committed `.claude/settings.json`, and the force-with-lease fix.
6. Optional mechanical size enforcement (script plus baseline and exceptions ledgers in CI).
7. Keep the two-tier deep review available even if one check is the default.
8. Context-file branch policy option.

## Emberholm

**Verdict:** do not adopt as a whole; port selected pieces by hand. Reconsider after Phase 2 has run on real PRs.

### Would lose
- **Review workflow hardening** (1342 lines vs the 644-line template): fail-closed triage, subagent ban, Fable to Opus fallback, stale-verdict floor, terminal-state guard with self-heal, three-tier verdict parsing, self-hosted runners.
- **17 project pre-screen checks** (threading and logging primitives, typed GDScript, input reads, doc pointers and XML parity, hardcoded non-English strings, reference-title names and abbreviations, dead members, glyph checks, ARB parity, size ratchet). v2's single identical workflow has nowhere to put them.
- **Code size:** shipped checker with an empty-ledger ratchet (any new breach fails), rows for class member count, header-only kernels and test functions, exemptions for engine binding methods and bound-API facades.
- **Board machinery:** PROJECT BOARD section, `board_check.py`, issue-body and PR-body contract hooks with `Resolves owner/repo#N`.
- **Shipped-text scope:** every shipped file type (scripts, shaders, manifests, doc XML, scenes, ARB); `docs/` is internal there, so v2's globs check the wrong files.
- **Clean-room extras:** abbreviation greps, a CI check, "the board is a shipped artifact".
- **Visual:** debug toggle from line one, the ~150-line slice cap, shader sequencing.
- **Session skill steps:** board read and check, runner health and power policy, scheduled-CI failures, mod ROADMAPs, a tokensave affected/test-risk/dead-code gate, board sweep and status update, devlog draft, runners on before push.

### Would gain
- Explicit cascade PR procedure (its session-close still says "managed from GitHub").
- Branch check before the first edit, whole-workflow re-run, fix every copy after a 🔴.
- Monitor fallback for cloud sessions; `research-adherence.py`.
- visual: "silence is not approval", the "Visual check confirmed" PR note, reuse before building.
- Repo hooks and committed attribution-off for cloud sessions.
- `/bindwright:audit` would catch drift (example: its session-close still links every PR by hand, stale since `develop` became default).

### Conflicts
- **Hooks location:** Emberholm bans project-local hooks (a tokensave settings-corruption bug); global plus repo copies would double-fire.
- Review gate: one check vs two required checks with a deep-tier state machine.
- Code size: test-file allowance looser than Emberholm's; v2 forbids hot loops past hard where Emberholm allows an allowlisted claim.
- Docs fast path: v2 allows `--admin` on BLOCKED; Emberholm requires CLEAN.
- CLAUDE.md: about 300 locked lines vs a 50-line template with no pristine base, so the first update cannot be a true three-way merge.
- Deep-review triggers omit engine-specific entries; the lists must stay in sync.

### Options v2 must add
1. Project pre-screen directory (e.g. `.github/review-checks/`).
2. Gate options: two checks or a deep-tier status inside one, configurable `runs-on`, custom reviewable extensions and deep triggers.
3. Code size: shipped checker with baseline ratchet, extra rows, facade exemption, strict-ledger mode.
4. Shipped-text scope as a per-project glob list.
5. Hooks installable globally or in the repo, with duplicate detection.
6. Tracker add-on: issue line in the PR contract, issue-body hook, board check template.
7. Extension points in session start and close; project-owned rules `/bindwright:update` never touches.
8. Clean-room extras: abbreviation patterns, extra shipped artifacts.
9. First-adoption mode that only proposes a diff and never overwrites.

## Synthesis

Both projects reach the same verdict independently: v2 is a strong starting kit, but a mature setup loses more than it gains from a whole install. Shared requirements:

- **Adopt mode:** first run on a repo with an existing setup proposes diffs piece by piece and never overwrites; the adopted state becomes the pristine base for later three-way updates.
- **Project-owned files and sections:** a manifest `/bindwright:update` never touches, plus keep markers inside shared files.
- **Extension points:** project pre-screen checks and escalation triggers in the gate; hook points in the session skills.
- **Gate options:** one or two checks, runner label, reviewer tool allowlist, max turns, fallback model chain.
- **Tracker add-on:** GitHub Project board as an alternative to `ROADMAP.md`.
- **Code-size add-on:** mechanical checker with a baseline ratchet; configurable test-file allowance and rows.
- **Merge policy switch:** whether admin bypass exists; when it does not, every admin instruction becomes "release first" or "fix the gate".
- **Hooks location switch:** repo or global, with duplicate detection.
- **Per-project scopes:** shipped-text globs, clean-room patterns.
- **Bugs to fix now:** the force-push deny misses `--force` after other arguments and `-f` inside a flag bundle (corrected 2026-09-24; it never blocked `--force-with-lease`).
