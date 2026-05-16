# Bundle 3 — Client-solo

Solo consultant on a client codebase, under NDA. Confidentiality, audit trail, billable handoff.

## What this bundle ships (with defaults applied)

- Full universal core
- `.claude/rules/confidentiality.md` — NDA-aware memory + on-machine isolation rules
- `.claude/rules/git.md` with **audit-trail commits** section enabled
- PR template with **audit-trail fields** (ticket, reviewer, environment, rollback plan)
- Session-close skill emits a **billable handoff summary** (scope, deliverables, time spent)
- DoD verification at session-close

## What this bundle asks during setup

- **GitHub workflows** — client's CI policy decides; don't override
- **Branch protection** — same
- **CODEOWNERS** — usually no for solo consultant

## What this bundle does NOT ship

- CONTRIBUTING.md (consultant doesn't author public contributor guides for the client)
- Team handoff sections (you're solo on this engagement)
- Devlog drafts (client work is confidential)

## Solidity target

**Diamond minus team** — Platinum + confidentiality + audit. Promote to bundle 4 if a colleague joins.

See `bundle.toggles.md` for full defaults.
