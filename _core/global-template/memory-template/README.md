# Memory system — how it works

The single highest-leverage Claude Code feature for long-running projects. Memory persists across conversations so future sessions don't need to re-learn who you are or what the project state is.

---

## Where it lives

```
~/.claude/projects/<project-slug>/memory/
├── MEMORY.md                   # The index — always loaded into context
├── user_*.md                   # User memories
├── feedback_*.md               # Feedback memories
├── project_*.md                # Project memories
└── reference_*.md              # Reference memories
```

`<project-slug>` is auto-derived by Claude Code from the project's working-directory path. Find it via `~/.claude/projects/`.

`MEMORY.md` is the index — Claude reads it on every session start. Keep it terse (lines after 200 are truncated). Each line in MEMORY.md is one memory pointer.

---

## The four memory types

### `user` — who you are, how you work

User's role, goals, responsibilities, knowledge level, preferred collaboration style.

**Save when:** you learn anything that should change how Claude tailors responses (role, seniority in a stack, preferred terseness, what they already know).

**Use when:** framing explanations, choosing analogies, deciding response length.

**Don't save:** anything judgmental ("user is slow") or anything that's just a transient mood.

---

### `feedback` — guidance on approach (corrections AND validations)

Guidance the user has given about how to approach work — both what to avoid and what to keep doing. The most important type to read AND write.

**Save when:**
- The user corrects you ("no, not that", "stop doing X")
- The user confirms a non-obvious choice ("yes exactly, keep doing that")

Corrections are easy to notice; confirmations are quieter — watch for them too. If you only save corrections, you'll avoid past mistakes but drift away from approaches that already work.

**Body structure (mandatory):**

```markdown
{The rule itself, one line at the top.}

**Why:** {the reason the user gave, usually a past incident or strong preference}
**How to apply:** {when/where this guidance kicks in}
```

The `Why` line lets future-you judge edge cases instead of mechanically following the rule.

**Use when:** about to make a similar judgment call. Search by topic.

---

### `project` — what's happening, who's doing it, by when

Ongoing work, goals, initiatives, bugs, decisions, deadlines NOT derivable from the code or git history.

**Save when:** you learn who is doing what, why, or by when. Always convert relative dates to absolute (`Thursday` → `2026-05-15`).

**Body structure (mandatory):**

```markdown
{The fact or decision, one line at the top.}

**Why:** {the motivation — usually a constraint, deadline, stakeholder ask}
**How to apply:** {how this should shape your suggestions}
```

Project memories decay fast. The `Why` helps you judge whether the memory is still load-bearing.

**Use when:** about to suggest something that touches the project's plans or priorities.

---

### `reference` — pointers to external systems

Where information lives outside the repo: Linear projects, Slack channels, Grafana dashboards, Notion docs, design files.

**Save when:** the user names an external resource and its purpose.

**Body:** one short paragraph naming the resource, its URL or identifier, and what it's for.

**Use when:** the user references something that might live in an external system, or you need data outside the repo.

---

## When NOT to save

These exclusions apply even when the user explicitly asks you to save:

- **Code patterns / architecture / file paths** — derivable from the current code.
- **Git history / recent changes / who changed what** — `git log` is authoritative.
- **Debugging solutions / fix recipes** — the fix is in the code; the commit message has context.
- **Anything already in CLAUDE.md.**
- **Ephemeral task state** — in-progress work, current conversation context.

If the user asks you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that's the part worth keeping.

---

## How to write a memory file

```markdown
---
name: short-kebab-case-slug
description: one-line summary — used to decide relevance in future conversations
metadata:
  type: user | feedback | project | reference
---

{Body. For feedback/project, use the **Why:** + **How to apply:** structure above. Link related memories with [[their-name]].}
```

Then add a one-line pointer to `MEMORY.md`:

```markdown
- [Title](file.md) — one-line hook
```

---

## Before recommending from memory

A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. Before recommending: verify the file/symbol still exists. If the user is about to act on your recommendation (not just asking about history), **verify first**.

"The memory says X exists" is not the same as "X exists now."

---

## Maintenance

- Update memories that become wrong. Don't accumulate stale entries.
- Remove memories that turn out to be incorrect.
- Don't write duplicate memories — check for an existing entry to update first.
- Organize semantically by topic, not chronologically.
