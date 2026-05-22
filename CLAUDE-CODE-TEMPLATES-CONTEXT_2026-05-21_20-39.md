# claude-code-templates — session handoff (2026-05-21 20:39)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Where the branches are

| Branch | Commit | Tag | Notes |
|---|---|---|---|
| `main` | `1dbfa83` | `v1.2.1` @ `1dbfa83` | Unchanged this session — still carries v1.2.0 + v1.2.1 HEAD-SHA gate fix. |
| `develop` | `73f7d2d` | — | v1.3.0 merged via PR #72. Leads main by the agnostification commit chain. |

Tag the v1.3.0 release commit (`73f7d2d`) on `main` next session after cascading develop → main via release PR. The v1.3.0 work is fully merged into develop; promoting to main is the remaining step before the public toolkit shows v1.3.0.

---

## What v1.3.0 actually changed (architectural shifts)

The CHANGELOG entry covers the bullet list. What matters for the next session that isn't in the diff:

### Per-value toggle marker syntax is the new extension primitive

`<!-- TOGGLE:<slot>:<value> START/END -->` is symmetric with the existing `:off` marker — same binder logic, parameterised by what to match against. Slot-aware: `<slot>` is one of `code_research` / `precommit` / `ci` / `ai_reviewer` / `issue_tracker`. `<value>` is the resolved `tools.<slot>` key (lowercase, profile-lookup-safe).

This is the canonical mechanism for any future per-tool prose variation. **Don't invent a parallel mechanism for the other 4 slots** — the v1.4.0/v1.5.0/v1.6.0/v1.8.0 roadmap rolls them out following this pattern. TOGGLES.md § "Adding a new value to an existing tool slot" + § "Adding a new tool slot" document the contract end-to-end with verification checklists.

### Tool profile JSON + hook template separation

`_core/global-template/hooks/code-research-first.py.template` is rendered against one of seven profiles in `code-research-profiles.json` at bind time. Old hand-coded `tokensave-first.py` deleted — the rendered output is now the only canonical hook. The profile JSON has a `_schema` field documenting required + optional fields + `detection_mode` enum (`walk_up` | `cli_available`) + `bypass_marker` regex pattern.

For new slots in v1.4.0+, build `_core/global-template/<slot>/<slot>-profiles.json` + `<slot>-first.<ext>.template` following this precedent.

### Phase 7a-Cleanup / Phase 7a-Install structural split

`SETUP.md` Phase 7a is now two sub-phases. **Cleanup runs unconditionally** (removes stale `*-first.py` matcher entries + orphan files from prior binds with different `tools.code_research` choices). **Install runs only when `tokensave_entry_point` is ON AND `tools.code_research !== "none"`**. The pre-W4 structure nested Cleanup inside the Install guard — switch-to-`none` re-binds skipped cleanup entirely. Don't undo this split.

### Atomic write contract for `~/.claude/` global config

All writes to `~/.claude/hooks/*-first.py` AND `~/.claude/settings.json` use `.tmp → fsync → os.replace`. Settings.json gets a `.bak` snapshot via `shutil.copy2` (preserves mode bits). Pre-write shape normalization handles `{}`, `{"hooks": null}`, `{"hooks": {"PreToolUse": null}}` — coerces to canonical without clobbering sibling keys. Missing-settings.json case creates baseline.

### Configurator emits `key`, not `name`, in `tools.<slot>`

`TOOL_SLOTS[<slot>].options[]` carries both a `key` (lowercase, profile-lookup-safe) and a `name` (brand-cased display). `buildManifest()` resolves to `key`. The `name === picked` fallback is for backward compat with pre-v1.3.0 manifest states; new code should always emit `key`. Profile JSON lookups + per-value marker `:<value>` blocks both join on `key`, never `name`.

### Manifest schema gained two new top-level fields

`tools` carries the resolved `key`. `tool_names` (NEW) carries the human-readable display name. `tool_urls` (NEW + behavior-changed) emits URLs for ALL picks, not just `"Other"`. Phase 3 step 2's placeholder substitution rules now reference these three fields.

### The 7th `code_research` option finally landed

`"Other (specify)"` with `key: "custom"`. v1.0.0 promised it; v1.3.0 actually wired it. The `custom` profile uses nested `{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}` / `_UPPER_SNAKE` / `_URL` placeholders that the bind step resolves BEFORE substituting into the hook template (resolution order: a) compute kebab/upper-snake/URL → b) substitute into profile data → c) substitute into hook template).

---

## Policy correction from this session

**Deep review is advisory, not a blanket merge gate.** Memory saved at `feedback_deep_review_not_mandatory`. The routine review's 🟢/🔴 IS the gate. Deep review is Sonnet's uncertainty-escalation mechanism — read its findings as additional input, but merge on the routine verdict.

This contradicts the current `mandatory_deep_review_before_merge: true` toggle default in the OSS bundle + this project's `.claude/BIND.md` (line 41). **v1.3.1 must flip this toggle to `false` for both the OSS bundle default + this project's bind**, and rewrite the `mandatory deep review` section of `_core/project-template/.claude/rules/review-tiers.md` + `git.md` to reflect the corrected semantics (Sonnet-driven escalation vs blanket gate).

---

## Roadmap (v1.3.1 onward)

CHANGELOG `Known follow-ups` is the canonical roadmap with target versions + design questions per item. Summary for quick reference:

| Version | Items | Design questions |
|---|---|---|
| **v1.3.1** | toggle rename `tokensave_entry_point` → `code_research_first` (with alias) + flip `mandatory_deep_review_before_merge` to false + rewrite review-tiers.md mandatory section | None — mechanical |
| v1.4.0 | precommit slot wiring + per-tool CLI install hints | None |
| v1.5.0 | Audit/Optimize mode (#3) | Trigger UX (re-paste with `mode: audit`? auto-detect from `.claude/BIND.md`?) |
| v1.6.0 | ci slot wiring | YAML strategy for non-GH-Actions vendors? |
| v1.7.0 | Telemetry Stop hook (#4) | Local-only vs opt-in remote endpoint? |
| v1.8.0 | ai_reviewer + issue_tracker slots + bundle bypass (#5) | Conflict-detection hard-error or warn? |
| v1.9.0 | Community metrics (#2) | Schema, transport, privacy review |
| v1.9.x+ | manifest.json build script | None |
| v2.0.0 | Drop `tokensave_entry_point` alias | Time-gated — wait for migration cycle |
| Out-of-band | Routine + deep review workflows install in this repo (#1) | Branches from `main` per workflow-changes-are-hotfixes |

---

## Operational lessons from this session

### Multi-wave review fan-out caught real bugs the inline self-verify missed

5 review waves (20 + 10 + 8 + 6 reviewer agents = 44 review passes total, plus the standalone adversarial wave) found **11 blockers** + ~30 highs/mediums across the agnostification work. The adversarial-pass agents (W4 + W5) caught 3 BLOCKER bugs every prior reviewer missed (Phase 7a gating contradiction, unknown-value literal-placeholder leak, settings.json FileNotFoundError + shape normalization). **Keep the adversarial-pass pattern** — fire one explicitly with the "try to break it; find what others missed" framing on any release that touches risk surface.

The review waves are token-expensive but the comparison case is shipping bugs to community users — much higher cost. Treat the fan-out as load-bearing for `_core/`-touching work.

### `redesign/bind.jsx` ↔ `index.html` lockstep is real

The configurator has TWO sources: `redesign/bind.jsx` (modular source) and `index.html` (production-deployed inlined bundle). Every change to `bind.jsx` needs a mirror in `index.html` or the deployed page silently drifts. The W2 review caught this when `bind.jsx` had the v1.3 `buildSetupMd()` stub but `index.html` still had the pre-v1.3 stub — file:// fallback users would have gotten broken setup instructions.

**The discipline:** any `redesign/*.jsx` edit gets a matching `index.html` edit in the same commit. Run `diff` mentally between the two before pushing.

### File:// fallback path of `buildSetupMd()` matters

`bindAndDownload()` tries `fetch("./SETUP.md")` to ship the canonical, but falls back to the inline stub if fetch fails (file://, offline, CORS). Real downstream users running `index.html` locally hit the stub path. The stub MUST stay in lockstep with the canonical SETUP.md contract — not just current at v1.3 but updated with every meaningful canonical change.

### Adversarial review = the most reliable bug finder for shipping templates

W4's adversarial agent caught 3 blockers (gating contradiction, unknown-value placeholder leak, FileNotFoundError); W5's adversarial agent caught 1 more (settings.json shape coercion gap). The non-adversarial review tiers consistently missed these. **For risk-surface releases, always include at least one explicitly-adversarial reviewer in the wave** with prompt framing like "try to break it; find what others missed."

---

## What's intentionally NOT done

- **Tag v1.3.0 on `main`.** The merge landed on `develop`. To ship v1.3.0 as a public release, next session needs to cascade develop → main via release PR + tag `v1.3.0` at the merge commit on main.
- **`mandatory_deep_review_before_merge` toggle default flip.** Tracked for v1.3.1. The policy correction landed in memory; the toggle catalog + rule text update is mechanical follow-up work.
- **Toggle rename `tokensave_entry_point` → `code_research_first` with alias.** Tracked for v1.3.1. Alias-resolution shape pre-committed in `SETUP.md` Phase 1 step 4.
- **Other 4 tool slots' parametrisation.** Tracked v1.4.0 / v1.5.0 / v1.6.0 / v1.8.0 per roadmap.
- **Workflow installation in this repo (#1).** Still hand-authored variants on this repo's `.github/workflows/` rather than rendered from `_core/project-template/.github/workflows/`. Per the workflow-changes-are-hotfixes discipline, this branches from main, not develop. Independent of the public-toolkit version cadence.
- **`stash/recovery-snapshot-pre-reset` branch** — still on remote per prior session's context. Safe to delete; previous session's recovery state is fully captured in committed history now.

---

## Open questions / next session

The roadmap table above is the prioritized list. The fastest-win next is **v1.3.1**:
1. Flip `mandatory_deep_review_before_merge: false` for OSS bundle + this project's `.claude/BIND.md`.
2. Rewrite `mandatory deep review before merge` section of `_core/project-template/.claude/rules/review-tiers.md` + `git.md` to describe deep review as Sonnet's uncertainty escalation, not a blanket gate.
3. Rename `tokensave_entry_point` → `code_research_first` across catalog + configurator + canonical templates + bundle defaults.
4. Add Phase 1 step 4 alias-resolution code (shape pre-committed; just implement).
5. Tag + cut v1.3.1 patch.

Single focused session, mostly mechanical. Then on to v1.4.0 (precommit slot + CLI install hints) which is also light.
