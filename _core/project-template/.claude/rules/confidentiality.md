# Confidentiality — client / NDA work

This rule binds when the project is under NDA or has a confidentiality stake. The discipline is twofold: (1) what stays out of memory, (2) what gets logged for audit.

---

## What stays OUT of memory

Memory is at `~/.claude/projects/<slug>/memory/` — files on your laptop, not the client's. **The client doesn't see them**, but they persist forever and are easy to forget about. Apply NDA reasoning as if they were emails:

- **No client trade secrets** — algorithms, formulas, growth numbers, revenue, churn, internal codenames, unannounced products.
- **No client PII** — customer names, employee names beyond the people you directly interact with, internal emails, contact lists.
- **No verbatim copy-pastes** of client docs, contracts, or sensitive prompts.
- **No third-party-vendor secrets** the client gave you access to (API keys for vendor X, credentials, etc.).

What's OK in memory:
- Your role and the scope of work ("client X engagement, consultant role, focus on auth refactor").
- Conventions and decisions that are about HOW you work, not WHAT the client does.
- Pointers to where things live ("client uses Linear for tickets") — without the ticket contents.

When in doubt, **omit**. A memory you can't write is one less liability.

---

## What gets LOGGED for audit

Some engagements require auditable records of AI-assisted work. If the client asks for an audit trail:

- **Per session:** keep the session transcript exportable. Claude Code transcripts at `~/.claude/projects/<slug>/*.jsonl` are the source.
- **Per PR:** the PR description includes a section listing AI-assisted changes (commits touched, scope) — see the `audit_trail_commits` toggle and the matching PR-template section.
- **Per change:** if the client's policy requires identifying AI-generated commits, follow their convention (e.g., commit footer line, label, separate branch). Do NOT add `Co-Authored-By: Claude` lines unless the client explicitly requests them — most clients prefer no AI attribution in commit messages.

---

## On-machine isolation

If multiple clients are on the same workstation:

- **Per-project memory** is already isolated by Claude Code (each project gets its own `~/.claude/projects/<slug>/`).
- **Global memory** (`~/.claude/CLAUDE.md`) is shared across projects — keep client-specific facts OUT of it.
- **Permissions** (`.claude/settings.local.json`) are per-project — review what's allowed and ensure no cross-project tooling leak.
- **Tokensave index** (`.tokensave/tokensave.db`) is per-project — never commit it to the client's repo.

---

## When the engagement ends

At wrap-up:

1. **Export** any deliverables the client owns (code is in their repo; that's handled by Gitflow).
2. **Archive** the local memory directory to encrypted storage if you need it for tax / dispute reasons. Otherwise delete it.
3. **Remove** client-specific allowlist entries from `~/.claude/CLAUDE.md` and global permissions.
4. **Rotate** any client-issued credentials still in your local env.

---

## See

- `.claude/rules/git.md` for the audit trail commit convention (when `audit_trail_commits` is ON).
- The session-close skill's "Billable handoff summary" step (when `billable_handoff_summary` is ON) — what gets emailed to the client after each session.
