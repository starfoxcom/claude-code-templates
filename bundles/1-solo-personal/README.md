# Bundle 1 — Solo personal

Solo dev, personal or portfolio project. No collaborators, no NDA, no client. Speed > ceremony. Self-review discipline via binary verdict.

## What this bundle ships (with defaults applied)

- Full universal core (CLAUDE.md, git.md, token-efficiency.md, review-tiers.md, skills, memory, lazy rules)
- GitHub workflows: routine Sonnet review + on-demand Opus deep review
- **Auto-merge on paths-ignore PRs** (docs, rules, CI YAML) — no 7-min poll for runs that don't fire
- DoD verification at session-close
- Permissions template pre-approving safe ops
- Memory system at `~/.claude/projects/<slug>/memory/`

## What this bundle does NOT ship

- CONTRIBUTING.md / PR template (you're the only contributor)
- CODEOWNERS (single owner)
- Confidentiality rule (your project, your data)
- Team handoff / on-call awareness sections
- Billable handoff summary

If any becomes relevant later, run the setup again with that toggle flipped ON.

## Solidity target

**Platinum** — universal core + GitHub workflows + DoD verification + auto-merge fast path.

See `bundle.toggles.md` for the full defaults + `TOGGLES.md` for the catalog.
