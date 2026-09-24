# Confidentiality

Applies to client or NDA work. Two jobs: keep client secrets out of memory, and keep a record the client can audit.

## Keep out of memory

Memory files under `~/.claude/projects/<slug>/memory/` live on your machine and persist indefinitely. Treat them like email:

- No client trade secrets: algorithms, formulas, revenue or growth numbers, internal codenames, unannounced products.
- No personal data: customer names, employee names beyond your direct contacts, internal emails.
- No verbatim copies of client documents, contracts or prompts.
- No credentials or vendor keys the client gave you.

Fine to keep: your role and scope, how you work with this client, and pointers to where things live ("tickets are in Linear") without their contents. When unsure, leave it out.

## Audit trail

If the client needs a record of AI-assisted work:

- Session transcripts under `~/.claude/projects/<slug>/*.jsonl` are the source; keep them exportable.
- Each PR lists the AI-assisted changes in its description (the PR template has the section).
- Follow the client's own convention for marking AI-generated commits. Add no attribution lines unless the client asks for them.

## One machine, several clients

- Keep client facts out of `~/.claude/CLAUDE.md`, which every project shares.
- Review `.claude/settings.json` permissions so no tooling allowed for one client leaks into another.
- Keep code-research indexes and caches out of the client's repo: add them to `.gitignore`.

## When the engagement ends

1. Confirm every deliverable is in the client's repo.
2. Archive the project's memory folder to encrypted storage if you need it for tax or dispute reasons; otherwise delete it.
3. Remove client-specific entries from global config and permissions.
4. Rotate any client credentials still on your machine.
