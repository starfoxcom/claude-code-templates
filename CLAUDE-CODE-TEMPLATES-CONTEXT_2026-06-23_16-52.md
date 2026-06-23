# claude-code-templates — session handoff (2026-06-23 16:52)

Single source of truth for what this session left undone. `/session-start` reads this first. Everything below is current state that isn't derivable from `git log`, open issues, or the CHANGELOG alone.

---

## Headline: precommit tool slot SHIPPED to `develop`

The v1.4.0-line "next ship" roadmap item — promoting the **`precommit` tool slot** from configurator-only to **profile-driven config generation** (mirroring `code_research`, but project-local) — is implemented, reviewed (routine 🟢 + deep 🟢), and merged.

- **Feature PR #143** → merged to `develop` (merge commit `2dfedbb`).
- The approved design spec `PRECOMMIT-SLOT-DESIGN.md` was **deleted** this session — it had served its purpose and become a stale parallel mirror.

### What landed (the slot, end to end)
- `_core/project-template/precommit/`: new `precommit-profiles.json` (lean per-manager profile) + config templates for **husky** (`.husky/pre-commit`), **pre-commit** (`.pre-commit-config.yaml`), **simple-git-hooks** (`.simple-git-hooks.json`); the existing `lefthook.yml.template` moved in. All four carry `{{LINT_COMMAND}}`/`{{TYPECHECK_COMMAND}}`/`{{TEST_COMMAND}}`.
- **SETUP.md**: step 8e generalized from a hardcoded lefthook copy → `tools.precommit` profile lookup (copy `template_ref` → `config_filename`, substitute commands, emit `activation_command`; `none`/`custom` short-circuit). Phase 1.5 Discovery infers tool+gate. Phase 1 step-4 validation covers the precommit profile + universal `custom`.
- **Configurator**: manager `key` per precommit option in `data.jsx` + `index.html` (legacy stays keyless); gate label de-lefthook-ified across all 3 mirrors. The generic `<option>Other</option>` (index.html:2124) makes `custom` reachable without a double-Other entry (design decision D4).
- **Bundles + catalog**: `precommit_hooks_scaffold` added to the 4 `bundle.toggles.md` (OFF/ON/OFF/ON) + the `TOGGLES.md` master catalog, at a uniform ordinal.
- **git.md**: a `## Pre-commit hooks` section with per-manager `<!-- TOGGLE:precommit:<value> -->` blocks **nested inside** a `precommit_hooks_scaffold` boolean gate. Resolves correctly because SETUP.md step 3a (per-value) runs before 3b (boolean) — the nesting needs no special-case. This is the first nested boolean-around-per-value toggle in the canonical templates.
- **This repo's own bind**: `precommit_hooks_scaffold` resolves **OFF** (recorded in `.claude/BIND.md`) — no build/lint/test toolchain here, mirroring the `architecture_rules_scaffold: none` reasoning. So the live `.claude/rules/git.md` correctly has no precommit section.

### Load-bearing contract
The bind **writes config + emits the activation command as an instruction — it never runs installs**. The install-hint (roadmap #2) ships inside this: the bind surfaces `runtime_note` + `url` from the profile.

---

## Prerequisite that landed first (workflow-allowlist lockstep)

The slot's config templates use `{{LINT_COMMAND}}`/`{{TYPECHECK_COMMAND}}`/`{{TEST_COMMAND}}` + `{{TOOLS_PRECOMMIT_NAME/URL}}`, none of which were in the `claude-code-review.yml` `UNKNOWN_PLACEHOLDER` canonical allowlist. Per the placeholder→allowlist + workflow-hotfix discipline:

- **Hotfix #141** (allowlist) → `main` (admin-merged on the confirmed OIDC byte-identity trip). `main` is now `v1.4.0` + this hotfix (`bab6e9b`).
- **Cascade #142** → `develop` (its routine review auto-escalated to a deep review on the placeholder naming, which came back 🟢).
- Then the feature branch merged `develop` for OIDC + allowlist parity before its own PR.

No further cascade owed (feature → develop is the terminal merge).

---

## Review story — 5 rounds, all real

The feature PR went through five 🔴→fix cycles before 🟢/🟢. Each found genuine defects the prior round missed (the recurring species: **cross-mirror drift** — one fact in 4–7 places — and **reachable-state falsehoods**):
1. `template_ref` schema description contradicted the resolver.
2. husky `activation_command` used `npx husky init`, which **clobbers** the bind-written `.husky/pre-commit` → switched to `npm pkg set scripts.prepare=husky && npm run prepare` (sets `core.hooksPath` without scaffolding a sample).
3. git.md intro false for `none`+ON; a 4th husky-init mirror in SETUP.md's step-8e example.
4. (pre-push consistency-audit workflow, ran before round 4) git.md intro still false for `none`/`custom`; husky honestly ships only the pre-commit gate (commit-msg/test are opt-in siblings) → coverage claims qualified; husky v9 desc fixed; lefthook `data`-type comment fixed.
5. profile `_schema.required_fields` vs the field-omitting `none`/`custom` entries → added a `_note` documenting the exemption.

**A false-positive worth remembering:** the pre-push audit claimed simple-git-hooks `commit-msg "$1"` is broken (empty arg → rejects every commit). Verified against the source (`PREPEND_SCRIPT + command` is **inlined**, not `sh -c`) + a real hook invocation: it **works** (the inlined command shares git's `$1`). The agent had tested it without the arg git always passes. Lesson reinforced: verify tool-behavior claims against source + a real run before acting on a single agent's simulation.

---

## What's queued next (unchanged — design-gated backlog)

Each needs a design decision before code (see the v1.3.0 CHANGELOG roadmap for target + open question):
- **#3** — Audit/Optimize mode (read `.claude/BIND.md`, diff vs templates, surface drift). Targeted v1.5.0. Open Q: user-facing trigger shape. (This session's BIND.md update + the re-bind-when-canonical-evolves friction make this more valuable.)
- **#5** — "I want them all" bundle-bypass + toggle-conflict detection. Targeted v1.8.0.
- **#4** — opt-in telemetry Stop hook. Targeted v1.7.0.
- **#2 (community metrics)** — before/after metrics (opt-in, anonymized). Targeted v1.9.0.

The TOGGLES.md "Promoting a configurator-only slot to profile-driven" procedure now names `precommit` as the worked **project-local** exemplar (vs `code_research`'s global-hook example) — the next slot promotion (`ci` / `ai_reviewer` / `issue_tracker`) can follow it.

---

## Where the branches are

| Branch | State | Notes |
|---|---|---|
| `main` | `v1.4.0` + allowlist hotfix @ `bab6e9b` | `v1.4.0-4-gbab6e9b`; ahead of the v1.4.0 tag by the #141 hotfix |
| `develop` | post-#143 @ `2dfedbb` | precommit slot + allowlist cascade |

No stranded branches. No cascade owed.

**Version gotcha (carry forward):** `VERSION` is `v1.4.0`; the precommit slot + the allowlist registration live in CHANGELOG `[Unreleased]` until the next release is cut. Any version-tagged backlog item → `cat VERSION` + `git tag` first.

---

## Files for next session to read first

1. This file.
2. `_core/project-template/precommit/precommit-profiles.json` — the profile shape (lean: `config_filename`/`config_format`/`template_ref`/`activation_command`/`url`/`runtime_note`; `none`/`custom` are field-exempt per the `_schema._note`).
3. `SETUP.md` step 8e (the generalized profile-lookup copy) + Phase 1.5 step 12 (Discovery) + Phase 1 step 4 (validation).
4. `_core/project-template/.claude/rules/git.md` `## Pre-commit hooks` — the nested-toggle pattern (boolean gate wrapping per-value blocks); confirm step 3a-before-3b resolution if extending.
