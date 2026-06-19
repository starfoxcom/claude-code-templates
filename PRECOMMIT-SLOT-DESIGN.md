# Precommit tool slot — implementation spec

> **Status:** design approved 2026-06-19. **Working/untracked** spec for the implementation session — not a committed deliverable yet. Session-close decides whether to commit (docs PR) or fold into the handoff and delete.
> **Branch to cut:** `feature/precommit-slot` off `develop`.
> **Governing procedure:** TOGGLES.md "Promoting a configurator-only slot to profile-driven" (lines 225-233).

This was produced by a design pass that extracted the `code_research` slot pattern across all 6 surfaces, researched the 4 hook managers authoritatively, and adversarially verified the change surface against the live repo (4 should-fix corrections folded in).

---

## 1. The core idea

`precommit` is **not** greenfield. Two overlapping mechanisms already exist and are fused into the same gate+manager shape `code_research` uses:

```
code_research_first   (gate: install the hook?)   ⟷   precommit_hooks_scaffold  (gate: write the config?)
tools.code_research   (which research tool?)       ⟷   tools.precommit           (which hook manager?)
```

- **`tools.precommit`** — configurator-only slot today (picks lefthook/husky/pre-commit/simple-git-hooks/none, default lefthook), generates nothing.
- **`precommit_hooks_scaffold`** — boolean gate, currently **hardcoded to lefthook**, writes `lefthook.yml` via SETUP.md **step 8e**.

**The spine:** generalize step 8e from "copy `lefthook.yml.template`" → "look up `tools.precommit` in a profile JSON, copy *that* manager's config template + emit *that* manager's activation instruction."

## 2. Load-bearing principle (already the status quo)

**The bind WRITES the config file + emits activation instructions as prose. It NEVER executes `npm`/`pip`/installs.** Step 8e does exactly this for lefthook today. This neutralizes the language-coupling problem: the user picked husky/pre-commit knowing their stack; we write the config and *tell* them how to activate — we never force Node onto a Rust repo or Python onto a JS repo.

## 3. Approved decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Generation scope | **All four managers** get full profile-driven config generation |
| D2 | Gate documentation | **Document fully** — add `precommit_hooks_scaffold` to the 4 `bundle.toggles.md` + TOGGLES.md master catalog (resolves its configurator-only anomaly) |
| D3 | Agent-facing prose | **Minimal** — one per-value block at ONE location (git.md) per manager |
| D4 | custom/Other | Ride the configurator's existing generic Other path; profile carries a hint-only `custom` entry; **no** new options-array entry (avoids the double-"Other" UX quirk) |
| D5 | Template location | Co-locate all four templates + profile under `_core/project-template/precommit/`; **move** the existing `lefthook.yml.template` there |

## 4. Per-manager generation table (from authoritative research)

| `key` | Writes | Activation instruction (emitted, not run) | `runtime_note` for hint |
|---|---|---|---|
| `lefthook` | `lefthook.yml` *(template exists, moves)* | `lefthook install` | standalone Go binary — language-agnostic |
| `husky` | `.husky/pre-commit` (POSIX sh) | `npm i -D husky && npx husky init` | Node + package.json required |
| `pre-commit` | `.pre-commit-config.yaml` | `pre-commit install` | Python required |
| `simple-git-hooks` | `.simple-git-hooks.json` | `npx simple-git-hooks` | Node required |
| `none` | nothing (short-circuit, mirrors `code_research:none`) | — | — |
| `custom` | nothing (hint-only stub; rides generic Other path) | per the tool's own docs | — |

All four config templates carry the **same `{{LINT_COMMAND}}` / `{{TYPECHECK_COMMAND}}` / `{{TEST_COMMAND}}`** placeholders the lefthook template already uses, substituted from `stack_commands`.

## 5. `precommit-profiles.json` shape (lean — NOT code_research's schema)

precommit writes a static config file, so it does **not** need code_research's `bypass_marker` / `detection_mode` / `NAME_KEBAB` / `NAME_UPPER_SNAKE` (those exist only because code_research renders an executable Python hook with a Grep-bypass marker). Lean schema:

```jsonc
{
  "_doc": "Per-manager profile for the precommit tool slot. The bind step (SETUP.md step 8e) picks the profile matching tools.precommit, copies template_ref into the project, substitutes {{LINT_COMMAND}}/{{TYPECHECK_COMMAND}}/{{TEST_COMMAND}}, and emits activation_command as a user instruction. See SETUP.md § Phase 3 step 8e.",
  "_schema_version": 1,
  "_schema": {
    "required_fields": {
      "config_filename": "string — path written into the project repo, e.g. 'lefthook.yml', '.husky/pre-commit', '.pre-commit-config.yaml', '.simple-git-hooks.json'",
      "config_format": "string — YAML | POSIX-sh | JSON",
      "template_ref": "string — path under _core/project-template/precommit/ of the config template to copy",
      "activation_command": "string — the command the USER runs to activate (emitted as instruction, never executed)",
      "url": "string|null — homepage, feeds {{TOOLS_PRECOMMIT_URL}} + the install-hint"
    },
    "optional_fields": {
      "runtime_note": "string — runtime/toolchain the user must have (shown in install-hint)",
      "_skip_install": "bool — true for 'none' (write nothing, still run gate cleanup)",
      "_uses_user_input": "bool — true for 'custom' (hint-only stub)"
    }
  },
  "lefthook": { "config_filename": "lefthook.yml", "config_format": "YAML", "template_ref": "precommit/lefthook.yml.template", "activation_command": "lefthook install", "url": "https://lefthook.dev", "runtime_note": "standalone binary (brew/scoop/winget/npm/go) — no language runtime required" },
  "husky": { "config_filename": ".husky/pre-commit", "config_format": "POSIX-sh", "template_ref": "precommit/husky-pre-commit.template", "activation_command": "npm install --save-dev husky && npx husky init", "url": "https://typicode.github.io/husky", "runtime_note": "requires Node + package.json (activation rides the npm prepare script)" },
  "pre-commit": { "config_filename": ".pre-commit-config.yaml", "config_format": "YAML", "template_ref": "precommit/pre-commit-config.yaml.template", "activation_command": "pre-commit install", "url": "https://pre-commit.com", "runtime_note": "requires Python (pipx install pre-commit)" },
  "simple-git-hooks": { "config_filename": ".simple-git-hooks.json", "config_format": "JSON", "template_ref": "precommit/simple-git-hooks.json.template", "activation_command": "npx simple-git-hooks", "url": "https://github.com/toplenboren/simple-git-hooks", "runtime_note": "requires Node (npm devDependency)" },
  "none": { "_skip_install": true, "url": null },
  "custom": { "_uses_user_input": true, "url": "{{TOOLS_PRECOMMIT_URL}}" }
}
```

> Note vs TOGGLES.md promote-procedure: that procedure literally says `_core/global-template/<slot>/<slot>-profiles.json` (generalized from code_research, which is GLOBAL). precommit is **project-local**, so the profile + templates belong under `_core/project-template/precommit/`. Add a one-line note to TOGGLES.md's promote procedure distinguishing global-hook slots from project-config slots.

## 6. File-by-file change surface (verified)

### New / moved artifacts — `_core/project-template/precommit/`
- `precommit-profiles.json` (new — §5)
- `lefthook.yml.template` — **MOVE** from `_core/project-template/lefthook.yml.template`; update SETUP.md step 8e's path reference
- `husky-pre-commit.template` (new — POSIX sh)
- `pre-commit-config.yaml.template` (new — YAML)
- `simple-git-hooks.json.template` (new — JSON)

### Configurator (lockstep mirrors)
- `redesign/data.jsx` + `index.html` — add `key` field to each precommit option (`lefthook`/`husky`/`pre-commit`/`simple-git-hooks`/`none`). **Verified additive/safe**: `buildManifest` already resolves name-OR-key (`bind.jsx:140`), render loop ignores `key`. No `custom` array entry (D4).
- **All three** mirrors (`data.jsx:191`, `index.html:847`, `index.legacy.html:1022`) — de-lefthook-ify the gate label `"Pre-commit hooks (lefthook)"` → manager-agnostic (e.g. "Pre-commit hooks (per tools.precommit)"), controls `lefthook.yml` → `<config for tools.precommit>`.
- `index.legacy.html` is a **different schema** (static `<select>`/`<option value>` + object manifest): NO `key` concept, and it ALREADY has `<option value="other">` + `none`. Its only owed edits are the label de-lefthook-ify (1022) + keeping the slot hint in sync. Do **not** treat it as a structural twin of data.jsx.
- `redesign/bind.jsx` — **verified near-no-change**: generic loop already emits `{{TOOLS_PRECOMMIT_NAME/URL}}` (`bind.jsx:144`); custom/none already handled generically; step 8e is **not** inlined in the `buildSetupMd` fallback stub. Confirm as a no-change site; don't edit unless a gate-aware control is wanted (it isn't — precommit gets no QuickRow).

### SETUP.md
- **Step 8e** — generalize: profile-lookup by `tools.precommit` → copy `template_ref`, substitute the 3 commands, emit `activation_command`. Handle `tools.precommit === "none"` → write nothing even if gate ON. Update the moved `lefthook.yml.template` path.
- **Phase 1.5 step 11 (Discovery)** — add precommit detection inferring **BOTH** `tools.precommit` AND `precommit_hooks_scaffold = true` when a config is found (mirrors how code_research detection sets tool + gate together). Signals: `lefthook.yml` → lefthook; `.husky/` → husky; `.pre-commit-config.yaml` → pre-commit; `.simple-git-hooks.json` or `package.json` `simple-git-hooks` key → simple-git-hooks.
- Phase 3 step 2 placeholders (`{{TOOLS_PRECOMMIT_NAME/URL}}`) already covered by the generic 5-slot enumeration — confirm only.

### Bundles + catalog (D2)
- `bundles/{1,2,3,4}/bundle.toggles.md` — add `"precommit_hooks_scaffold": <bool>` (OFF / ON / OFF / ON — matching the configurator `TG([OFF,ON,OFF,ON])`), at the same ordinal position in all four (key-set uniformity invariant). `tools.precommit` default stays in the configurator (not bundles — mirrors `tools.code_research`).
- `TOGGLES.md` master catalog — add the `precommit_hooks_scaffold` boolean row (currently absent).

### Docs
- `TOGGLES.md` — expand the precommit "analogous" placeholder rows to explicit; flip the slot's "configurator-only" status note to profile-driven; add the project-local-vs-global path note (§5).
- `COMPARISON.md:82` — **stale prose**: "Pre-commit hooks … but not bundled because they vary by ecosystem" becomes false post-promotion. Update.
- `CHANGELOG.md` `[Unreleased]` — entry framed as "extends the configurator-only precommit slot to profile-driven config generation, following the `code_research` precedent" (don't over-claim full parity — prose is minimal per D3).

### Agent-facing prose (D3 — minimal)
- One location (recommend `_core/project-template/.claude/rules/git.md`): per-manager `<!-- TOGGLE:precommit:<value> START/END -->` block, e.g.:
  ```
  Pre-commit gate: {{TOOLS_PRECOMMIT_NAME}} ({config_filename}). Activate: `{activation_command}`.
  Bypass one commit: `git commit --no-verify`.
  ```
  Plus `:none` (no gate) and `:custom` blocks. ONE file only — not the code_research 5-file spread.

## 7. Lockstep constraints (don't break these)
- Option `key` == profile JSON key == `:<value>` block suffix, **verbatim**: `lefthook` / `husky` / `pre-commit` / `simple-git-hooks` / `none`. (`pick.name.toLowerCase()` already yields these, so the key-add is for consistency, not a behavioral diff.)
- `index.html` precommit slot must stay byte-identical to `data.jsx` (it's the inlined concatenation).
- The 4 `bundle.toggles.md` `toggles` objects must keep an identical key-set in identical order.
- Deep review **auto-fires** (PR touches `_core/` + `index.html`) — expect `Claude On-Demand`.

## 8. Roadmap item #2 (install-hint) — bundles in here
The bind summary emits, for the chosen manager: `To install {{TOOLS_PRECOMMIT_NAME}}: {runtime_note} — see {url}`. Sourced entirely from the profile. No separate work; ships with this slot.

## 9. Suggested slice order (visual-discipline-friendly)
1. Artifacts: `precommit-profiles.json` + move lefthook template + 3 new config templates (no behavior yet).
2. SETUP.md step 8e generalization + none-handling + path update.
3. SETUP.md Phase 1.5 Discovery detection (tool + gate).
4. Configurator: `key` fields (data.jsx + index.html) + label de-lefthook-ify (3 mirrors).
5. Bundles + TOGGLES.md catalog (D2).
6. Agent-facing per-value block in git.md (D3).
7. Docs: COMPARISON.md fix, TOGGLES.md placeholder/status, CHANGELOG.
8. Dogfood-bind `_core/project-template/CLAUDE.md` (and git.md) against ≥3 managers incl. `none` + `custom`; verify zero orphan `{{` / `TOGGLE:` markers.
