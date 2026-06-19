# claude-code-templates — session handoff (2026-06-19 08:01)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Headline: `tokensave_entry_point` → `code_research_first` toggle rename SHIPPED (PR #138)

The long-standing toggle rename — listed as a v1.3.1 "Known follow-up" under the frozen v1.3.0 CHANGELOG section — is **DONE**, merged to `develop` (`62cfa37`, rename commit `6b0ea58`).

`code_research_first` is now the **canonical** toggle name everywhere it is *used*:
- Catalog (`TOGGLES.md` row + asked-during-interview entry)
- The 4 `bundles/*/bundle.toggles.md` default sets
- Configurator, all 3 mirrors: `index.html` + `redesign/data.jsx` + `redesign/bind.jsx` (toggle id, `toggleState`/`setToggle` keys, QuickRow `k`, inlined SETUP stub) and `index.legacy.html` (catalog `key` + the `files`-array `toggle:` fields)
- Canonical `_core/` block-strip markers: `_core/project-template/CLAUDE.md`, `.claude/skills/find/SKILL.md` (incl. its `:off` variant), `.claude/skills/session-close/SKILL.md`
- `_core/global-template/README.md`, and `SETUP.md`'s resolution (Phase 1 step 6) + detection (step 11) + Phase 7/7a conditionals

`tokensave_entry_point` is **retained as a deprecated backward-compat alias** — it survives ONLY in alias/legacy/historical contexts:
- `SETUP.md` Phase 1 step-4 alias-map block (now reads **present-tense/active**; the stale "until the rename ships in v1.3.x" framing and the `v1.0–v1.3.0` / `v1.3.x+` version strings were dropped — the warning text is version-agnostic so it can't re-stale)
- `TOGGLES.md` catalog-row note ("legacy name … still accepted as a backward-compat alias")
- `.claude/BIND.md` one "formerly `tokensave_entry_point`" audit note
- The configurator inlined SETUP stub's cross-check clause (byte-identical in `index.html` + `redesign/bind.jsx`) so a re-bind from a pre-rename manifest is accepted, not rejected as an unknown key
- `CHANGELOG.md` frozen dated history + the new `[Unreleased]` entry

**Alias removal stays slated for v2.0.0** (frozen v2.0.0 follow-up — time-gated, no current driver). No behavioral change to bind output beyond the emitted toggle key.

### Why this was bigger than the "mechanical" label implied
- It's a cross-cutting rename with **lockstep pairs** (`index.html` == `data.jsx` + `bind.jsx`; the lockstep arithmetic was verified: index.html 9 `code_research_first` + 1 `tokensave_entry_point` = data's 1 + bind's 8+1) and a **canonical-vs-alias** distinction that's easy to get wrong.
- The bind engine matches strip-markers by toggle id, so the **id + markers + file-map + catalog had to rename together** to stay coherent — verified by a bind-coherence audit lens.
- Verified three independent ways before landing: a 5-lens adversarial pre-commit audit (0 findings / 342k tokens), hand-checks of the two riskiest spots (JS template-literal backtick escaping; the `:off` marker pair), and the auto-fired Opus **deep review** (`needs-deep-review` label → `Claude On-Demand: SUCCESS`).

## Version-target drift — the non-obvious gotcha this session

The follow-up was labeled **v1.3.1**, but `main` already shipped **v1.4.0** — so the rename never made the v1.3.1 train and the label was overtaken. Resolution: it landed in `[Unreleased]` (`### Changed`), with the version number deferred to the next release cut, and **VERSION was NOT bumped**. The frozen v1.3.0 "Known follow-ups" entry that still says "v1.3.1" was left untouched (append-only). **Lesson for picking up any version-tagged backlog item: check `VERSION` + `git tag` first — the target may have drifted past the label; re-home to `[Unreleased]` if so.**

## Where the branches are

| Branch | State | Notes |
|---|---|---|
| `main` | `v1.4.0` @ `291ace1` | unchanged this session |
| `develop` | post-#138 @ `62cfa37` (+ this context-refresh PR) | toggle rename landed |

No stranded branches — only `main` + `develop`. No cascade owed (feature-class `refactor/* → develop`, not a hotfix/release).

---

## What's queued next

**Nearer-term roadmap (v1.4.0-line, from the v1.3.0 CHANGELOG "Known follow-ups"):**

1. **`precommit` slot wiring** — the natural next ship. First *additional* tool slot using the v1.3.0-established per-value-marker + tool-profile-JSON pattern (the same machinery this rename just touched). Options: lefthook / husky / pre-commit / simple-git-hooks / none / Other. It's a **feature** (not a rename) — touches a new profile JSON, per-value markers, a configurator slot field + 4 bundle entries, a SETUP.md resolution phase, the TOGGLES.md catalog, and canonical template blocks. Deserves a fresh context budget and likely a short design pass (what each manager installs) before code. Pattern is documented in TOGGLES.md § "Adding a new tool slot". De-risks subsequent slot wirings + Audit mode (#3).
2. **Per-tool MCP/CLI install-hint guidance** — small polish; the setup summary should add a "to install `<tool>`: see `<url>`" hint sourced from each profile's `url` field. Roadmap says it **bundles naturally with the precommit slot** — do them together, not standalone.

**Design-gated feature backlog (each needs a design decision before code; see the v1.3.0 CHANGELOG roadmap for target + open question):**

- **#3** — Audit/Optimize mode (read `.claude/BIND.md`, diff vs templates, surface drift). Targeted v1.5.0. Open Q: user-facing trigger shape. (ultracode judge-panel candidate.)
- **#5** — "I want them all" bundle-bypass + toggle-conflict detection. Targeted v1.8.0.
- **#4** — opt-in telemetry Stop hook. Targeted v1.7.0. Open Q: local-file-only vs opt-in remote.
- **#2** — community before/after metrics (opt-in, anonymized). Targeted v1.9.0. Heavy privacy design.

---

## Files for next session to read first

1. This file.
2. For the precommit slot: `TOGGLES.md` § "Adding a new tool slot" + the existing `code_research` slot as the worked example — `_core/global-template/hooks/code-research-profiles.json` (profile shape), `SETUP.md` Phase 3/7a (resolution), and the per-value markers in `_core/project-template/.claude/skills/session-close/SKILL.md` (`code_research:<value>` blocks).
3. For backlog #2–#5: the v1.3.0 CHANGELOG "Known follow-ups (with target releases)" block — target + open design question per item.
