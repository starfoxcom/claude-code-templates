# Bundle 4 — Client-team

Team working on a client codebase under NDA. All of `client-solo` + team coordination + CODEOWNERS + mandatory deep review on architectural surface.

## What this bundle ships (with defaults applied)

- Full universal core
- `.claude/rules/confidentiality.md` — NDA-aware memory
- `.claude/rules/collaboration.md` — PR etiquette for team work
- `CODEOWNERS` — distributed review responsibility
- `CONTRIBUTING.md` — internal team onboarding guide
- PR template with **audit-trail fields**
- Session-close emits **team handoff notes** the next member reads at session-start
- DoD verification + auto-firing deep review + strict branch protection

## What this bundle asks during setup

- **On-call awareness section** — only relevant if the team has a rotation
- **Tokensave** — only if installed

## What this bundle does NOT ship by default

- `billable_handoff_summary: false` — team engagements usually bill by deliverable, not by session. Flip ON if your team bills hourly.
- Devlog (client work is confidential)

## Solidity target

**Diamond** — Platinum + confidentiality + audit + team coordination + mandatory deep review.

See `bundle.toggles.md` for full defaults.
