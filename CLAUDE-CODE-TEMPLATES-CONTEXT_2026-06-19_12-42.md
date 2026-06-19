# claude-code-templates — session handoff (2026-06-19 12:42)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Headline: precommit tool-slot DESIGN PASS complete + approved — ready to implement

This session ran a design-first pass on the **precommit tool slot** (the v1.4.0-line "next ship" roadmap item) and the per-tool install-hint (#2, which bundles into it). No feature code was written — the deliverable is an approved, adversarially-verified implementation spec.

**The approved spec lives at `PRECOMMIT-SLOT-DESIGN.md`** (repo root, committed this session). Read it first for the file-by-file change surface, the lean `precommit-profiles.json` shape, lockstep constraints, and the 8-slice build order. The summary below is the pointer, not a duplicate — the design doc is the source of truth.

### The reframe (why this isn't a greenfield slot)
`precommit` is a **promotion of a configurator-only slot**, not a new one — governed by TOGGLES.md "Promoting a configurator-only slot to profile-driven" (lines 225-233). Two overlapping mechanisms already exist and get fused into the same gate+manager shape `code_research` uses:

```
code_research_first   (gate)  ⟷  precommit_hooks_scaffold  (gate: write the config?)
tools.code_research   (tool)  ⟷  tools.precommit           (which hook manager?)
```

- `tools.precommit` — configurator-only slot today (lefthook/husky/pre-commit/simple-git-hooks/none, default lefthook), generates nothing.
- `precommit_hooks_scaffold` — boolean gate, **hardcoded to lefthook**, writes `lefthook.yml` via SETUP.md **step 8e**.

**The spine:** generalize step 8e from "copy `lefthook.yml.template`" → "profile-lookup `tools.precommit` → copy that manager's config template + emit that manager's activation instruction." The load-bearing principle (**write config + instruct, never execute installs**) is already the status quo in step 8e — not a new invention, which neutralizes the language-coupling problem across the 4 managers.

### Approved decisions (the design pass's forks)
| # | Decision | Choice |
|---|---|---|
| D1 | Generation scope | **All four managers** get full profile-driven config generation |
| D2 | Gate documentation | **Document fully** — add `precommit_hooks_scaffold` to the 4 `bundle.toggles.md` + the TOGGLES.md master catalog (resolves its current configurator-only anomaly) |
| D3 | Agent-facing prose | **Minimal** — one `<!-- TOGGLE:precommit:<value> -->` block per manager at ONE location (`git.md`) |
| D4 | custom/Other | Ride the configurator's existing generic Other path; profile carries a hint-only `custom` entry; **no** new options-array entry (avoids a latent double-"Other" quirk) |
| D5 | Template location | Co-locate profile + all 4 templates under `_core/project-template/precommit/`; **move** the existing `lefthook.yml.template` there |

### How it was de-risked
6-agent pattern extraction (the `code_research` slot across all 6 surfaces) → 4-agent authoritative manager research (lefthook/husky/pre-commit/simple-git-hooks install mechanics) → 4-skeptic adversarial verification against the live repo. The verification confirmed the direction (gate+manager split is sound, key-field add is additive/safe, backward-compat holds) and caught **4 should-fix corrections** now folded into the spec — notably that `precommit_hooks_scaffold` is configurator-only (NOT in `bundle.toggles.md` as first drafted) and that Discovery detection must infer the **gate** as well as the manager.

---

## What's queued next

**Immediate — implement the precommit slot:**
- Cut **`feature/precommit-slot`** off `develop` and execute `PRECOMMIT-SLOT-DESIGN.md` slices 1→8. It's a focused feature, well-precedented by `code_research`. Deep review will auto-fire (touches `_core/` + `index.html`).
- The install-hint roadmap item (#2) ships **inside** this — the bind summary emits `{{TOOLS_PRECOMMIT_NAME}}` + `runtime_note` + `url` from the profile. No separate work.

**Design-gated feature backlog (each needs a design decision before code; see the v1.3.0 CHANGELOG roadmap for target + open question):**
- **#3** — Audit/Optimize mode (read `.claude/BIND.md`, diff vs templates, surface drift). Targeted v1.5.0. Open Q: user-facing trigger shape. (ultracode judge-panel candidate.)
- **#5** — "I want them all" bundle-bypass + toggle-conflict detection. Targeted v1.8.0.
- **#4** — opt-in telemetry Stop hook. Targeted v1.7.0. Open Q: local-file-only vs opt-in remote.
- **#2 (community metrics)** — before/after metrics (opt-in, anonymized). Targeted v1.9.0. Heavy privacy design.

---

## Where the branches are

| Branch | State | Notes |
|---|---|---|
| `main` | `v1.4.0` @ `291ace1` | unchanged this session |
| `develop` | post-#138 @ `38063c7` (+ this docs PR once merged) | toggle rename landed last session; precommit design doc lands this session |

No stranded branches. No cascade owed (docs-class `docs/* → develop`, not a hotfix/release).

**Version gotcha (carry forward):** `VERSION` is at v1.4.0; the precommit work lands in `[Unreleased]` until the next release is cut. Any version-tagged backlog item → `cat VERSION` + `git tag` first; a label may have drifted past its target.

---

## Files for next session to read first

1. This file.
2. **`PRECOMMIT-SLOT-DESIGN.md`** — the approved implementation spec (decisions, file-by-file surface, profile-JSON shape, lockstep constraints, slice order).
3. The worked example the spec mirrors: `_core/global-template/hooks/code-research-profiles.json` (profile shape — note precommit's is leaner), SETUP.md **step 8e** (the generalize target) + Phase 1.5 step 11 (Discovery), and `redesign/data.jsx` TOOL_SLOTS (`code_research` entry has `key`; `precommit` entry, lines 57-69, does not — that's a change site).
