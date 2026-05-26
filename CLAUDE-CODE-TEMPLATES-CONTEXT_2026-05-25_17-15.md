# claude-code-templates — session handoff (2026-05-25 17:15)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `285a300` | `v1.2.1` @ `1dbfa83` | Unchanged this session. Still has the 4 hardening invariants gap (Priority 1 from prior handoff). v1.3.0 still NOT tagged. |
| `develop` | `f42918d` | — | Advanced via PR #94 — session-start model+effort analyzer + session-close outcome log. The new context-refresh PR for THIS close (PR pending) will land on top. |
| `release/v1.3.0` | `8e0f17f` | — | Still stale. No movement this session. |

---

## What this session shipped — session-start model+effort analyzer + session-close outcome log (PR #94)

**Triggered by maintainer concern**: are we on the right model/effort for this repo's workload, or could we benefit from `opusplan` mode? Deep research surfaced documented Opus 4.7 regressions (multi-step instruction following / long-context retrieval / +32–34% tokenizer inflation on code & structured data) per anthropics/claude-code#58369. Workload shape of this repo (workflow YAML state-machine surgery, lockstep canonical+live edits, bind resolution) maps directly to the regression dimensions — Opus 4.6 is a better default for most session work here than 4.7.

**Architecture** (Emberholm pattern adapted to this repo):

1. Session-start ends with a `## Recommended setup for this session` block that picks model+effort from a session-shape matrix (archetype → model + effort), emitted BEFORE the approval gate so plan and setup are approved together.
2. Session-close appends a `## Session model setup` block (`Recommended / Used / Outcome`) to the regenerated context file. Empirical feedback loop for matrix tuning after ~10 sessions.

**Canonical-vs-live split** (load-bearing decision after deep-review findings):

- **Canonical** (`_core/project-template/.claude/skills/session-*/SKILL.md` + `_core/.../CLAUDE.md`) uses bare model IDs (`claude-opus-4-6`, not `claude-opus-4-6[1m]`), generic archetype rows marked as "starting point, not permanent answer", no version-specific evidence — ages well across model updates. Tells downstream maintainers to tune from their own session-close outcome log.
- **Live** (`.claude/skills/session-*/SKILL.md`) uses project-specific archetypes (workflow YAML surgery / lockstep / bind resolution / multi-PR cascade), `[1m]` suffix on Opus rows (this repo is on Max — auto-included), embeds the #58369 citation + MRCR / tokenizer-cost numbers in the rationale.

**Outcome log toggle coupling** (Round-3 deep-review fix): the `### Model + effort outcome log` section sits INSIDE the `<!-- TOGGLE:context_refresh_files START/END -->` block because it appends to the file that toggle creates. Disabling the toggle strips both coherently.

**Step ordering** (Round-2 deep-review fix): in canonical CLAUDE.md SESSION START prose, `Session steps as a task list` is step 4 and `Recommended model + effort` is step 5 — the archetype match needs the enumerated step list as input, not just the module set from step 3. The canonical SKILL.md has the same ordering (session steps → model recommendation). Both files now align.

**Follow-up issue #95** — bind-time `plan_tier` selector: today the matrix's concrete IDs work on every Claude Code subscription tier, but cost and 1M-context availability vary substantially (Pro pays usage credits for `[1m]`; Max/Team/Enterprise gets it auto for Opus; API pay-as-you-go is uncapped). A bind-time `plan_tier` selector that filters/annotates matrix rows is scoped in #95 but deferred to v1.4 / v1.5 — touches `redesign/data.jsx` + bind logic + canonical placeholder + 4 bundle defaults + `BIND.md` schema; too much for this PR. Canonical's "Tuning for your plan tier" subsection (cite to https://code.claude.com/docs/en/model-config) is the manual workaround until the selector lands.

**PR #94 review chain — 4 cycles**:
- Round 1 → flagged `[1m]` notation + canonical evidence embedding → fix: bare IDs in canonical + `Note on extended context` + evidence-neutral framing.
- Round 2 → caught CLAUDE.md vs SKILL.md step ordering inversion → fix: swap CLAUDE.md steps 4 ↔ 5.
- Round 3 → caught the outcome log / `context_refresh_files` toggle coupling → fix: nest outcome log inside toggle + add the `[1m]` docs link the maintainer surfaced from official docs.
- Round 4 → 🟢 LGTM both tiers. Admin-merged (maintainer's own PR; required-approval gate self-cleared per `git.md`).

**Commits landed in PR #94 (5 atomic)**:
- `f450c66 feat(skills): add model+effort analyzer + outcome log to lifecycle`
- `208ac4d fix(skills): make canonical evidence-neutral + portable model IDs`
- `793f6fb fix(skills): session steps precede model recommendation in CLAUDE.md`
- `2c3c89f fix(skills): nest outcome log inside context_refresh_files toggle`
- `9b2fc64 docs(skills): cite [1m] notation + plan-tier tuning guidance`

---

## Operational lessons from this session

### `[1m]` is the documented Claude Code suffix for the 1M-context variant

`claude-opus-4-6[1m]`, `opus[1m]`, `sonnet[1m]` are all valid `/model` arguments per official docs (https://code.claude.com/docs/en/model-config#extended-context — alias form AND full-name form both accepted). Routine reviewer's Round-1 finding to the contrary was wrong (reviewer doesn't have access to those docs at review time). The fix that landed — bare IDs in canonical + `Note on extended context` — is still correct for canonical portability reasons:
- The canonical's bare IDs work universally regardless of plan tier.
- `[1m]` is plan-dependent (auto on Max / Team / Enterprise for Opus; usage credits on Pro).
- The Note + tuning subsection documents the variant + cites the official docs so future reviewers don't re-litigate.

The live SKILL.md uses `[1m]` directly because this repo is on Max (auto-included).

### Canonical templates should ship evidence-neutral; project-local files carry the specific evidence

When v1 of PR #94 landed with `Why default is 4.6, not 4.7: MRCR v2 91.9% → 59.2%, +32–34% tokenizer inflation, anthropics/claude-code#58369` baked into the canonical CLAUDE.md and SKILL.md, the Round-1 deep review correctly flagged: those specific numbers + the issue link are baked into files that ship verbatim downstream with no update mechanism. When Anthropic patches 4.7, downstream users keep inheriting a stale claim. Fix: canonical = generic framing ("community evidence — evolving — suggests version-specific tradeoffs ... tune from your outcome log"); project-local = keeps the specific numbers + #58369. This is the same canonical-vs-project-local split that the matrix archetypes already use.

### Toggle coherence is a load-bearing canonical contract

The Round-3 deep review flagged that a new always-on section sitting OUTSIDE a toggle but referencing the file the toggle creates is a real coherence defect, not a hypothetical — the toggle resolution produces an incoherent output when set to OFF. Fix is to nest the new section inside the toggle. Worth remembering: when adding a new always-on section in a canonical SKILL.md, audit which toggles its content depends on and nest accordingly. Don't trust "the default bundles all have the toggle ON" as an argument — the canonical ships to projects that TUNE.

### CLAUDE.md step ordering = SKILL.md step ordering — both are canonical, both ship

Round-2 deep review caught that CLAUDE.md had `Recommended model + effort` at step 4 (before session steps at step 5) while SKILL.md had it at step 6 (after session steps at step 5). Both files ship verbatim downstream; both prescribe the same ritual. Different orderings = users get two different contracts for the same operation. Fix: align CLAUDE.md to SKILL.md (steps before model — the archetype match needs the planned step list as input). When mirroring a new ritual step into CLAUDE.md prose, the ordering must match the SKILL.md ordering OR the divergence must be deliberate and documented.

### The session-close outcome log + session-start analyzer is a feedback loop, not a one-shot

Per the matrix's own "starting point, not permanent answer" framing — the loop only closes when the user actually USES the outcome log to tune. After ~10 sessions, tune the matrix from real `Used vs Recommended + Outcome` data. The empirical feedback loop is the durable value-add; the seeded matrix is just the starting point.

---

## What's queued next (priority order, updated from prior handoff)

**Priority 1 — Task #14 follow-up live hotfix** (carried over): apply 4 hardening invariants to live `.github/workflows/claude-code-review.yml` + `claude.yml`. Single hotfix from `main`, cascade to `develop`. Workflow-touching → admin-merge (only `claude-code-review.yml` portion trips OIDC; `claude.yml` changes don't). The fixes already exist verbatim in the canonical templates — lift them across.

**Priority 2 — Phase 3 v1.3.0 release** (carried over):

1. Merge `main` into `release/v1.3.0` (brings in PRs #76, #78, #83, #87, #89, #90; note #92 cascade landed via #88/#91; PR #94 went straight to `develop`, NOT to `main`, so it's NOT in the v1.3.0 release — would land in v1.4.0 if minor-bumped for the analyzer feature).
2. Address deep-review findings from prior PR #77 (now closed): SETUP.md Phase 7a validate-vs-resolve ordering for `custom` profile; `/find` skill ctags block missing `# CTAGS_BYPASS:` marker example.
3. Reopen the release PR (`release/v1.3.0` → `main`).
4. Merge on full 🟢. Tag `v1.3.0`. Cascade `main` → `develop`.

**Priority 3 — Emberholm port** (carried over): the `EMBERHOLM-TWO-CHECK-PROMPT.md` user has from the prior session. Out-of-band; fresh Emberholm session.

**Priority 4 — Issue #1** (carried over): routine + deep review workflows installed. Remaining scope on #1 needs review.

**Priority 5 — NEW: Issue #95 (v1.4 / v1.5)** — bind-time `plan_tier` selector for the session-start matrix. Scoped in #95 with full implementation surface. Not blocking anything; the canonical's "Tuning for your plan tier" subsection is the manual workaround. Pick up when bind UI is being touched anyway, or when plan-tier-aware filtering is genuinely missed.

**Priority 6 — NEW: decide release scope for analyzer feature**: PR #94 added new behavior to canonical templates. If v1.3.0 release ships next (Priority 2), the analyzer feature should land in v1.4.0 (minor bump — new feature, no break). Alternatively bundle into a hypothetical v1.3.1 if intentionally framed as a patch (atypical for a feature add). Decide at v1.3.0 cut.

---

## Session model setup

- **Recommended at start:** N/A — this session pre-dates analyzer adoption; the feature is what the session shipped.
- **Used:** `claude-opus-4-7[1m]` · default (`high`) effort.
- **Outcome:** Feature shipped end-to-end via PR #94. 4 review rounds, 3 fix-cycle pushes after initial. Followed project rules cleanly: branch verification before edit, atomic commits, no AI attribution, lockstep canonical+live, deep-review findings addressed verbatim rather than pushed back on. One sub-issue: Round-1 reviewer flagged `[1m]` notation as invalid (actually valid per official docs the maintainer pointed to); the fix that landed was still correct for canonical portability. No wrong-branch edits, no admin-merge bypass on non-workflow PRs (admin-merge was justified here as maintainer's own PR clearing the required-approval gate), no cleanup PRs needed. Issue #95 opened cleanly for follow-up plan-tier scope.

**Note for the analyzer's first real run** (next session): the matrix WILL fire at session-start. Pick the right row from the project-local matrix in `.claude/skills/session-start/SKILL.md` based on what next session actually does (likely Priority 1 = workflow YAML state-machine surgery row → `claude-opus-4-6[1m]` + `xhigh`). Switch BEFORE code work — switching after context loads pays a full re-read.

---

## Files for next session to read first

1. This file.
2. `.claude/skills/session-start/SKILL.md` — for the new analyzer step + this repo's session-shape matrix (will fire on next session-start).
3. `.claude/skills/session-close/SKILL.md` — for the outcome log step + the rules around model setup logging.
4. `_core/project-template/.github/workflows/claude-code-review.yml.template` — canonical workflow with all 4 hardening invariants. Diff vs live `.github/workflows/claude-code-review.yml` shows what Priority 1 (Task #14) must port.
5. `_core/project-template/.github/workflows/claude.yml.template` — same, deep tier.
6. `MEMORY.md` index — `feedback_model_default_opus_4_6` + (potentially) 3 new principles from this session's deep-review cycle (canonical-evidence-neutral split, toggle coherence on always-on additions, CLAUDE.md ↔ SKILL.md step alignment) — see if they landed.
