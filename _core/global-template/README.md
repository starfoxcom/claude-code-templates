# Global template — merge into `~/.claude/`

These files live OUTSIDE your project repo, in your home Claude config. They apply to **every** Claude Code session on your machine, not just this project.

## Files in this folder

```
global-template/
├── README.md                  # (this file)
├── CLAUDE.md.additions        # Append to ~/.claude/CLAUDE.md
└── memory-template/
    ├── README.md              # How the memory system works
    └── MEMORY.md              # Empty index — copy to the per-project memory dir
```

---

## 1. Merge `CLAUDE.md.additions` into `~/.claude/CLAUDE.md`

`~/.claude/CLAUDE.md` is your private global instruction file. Claude Code loads it into every session as system context. If you don't have one yet, just `cp CLAUDE.md.additions ~/.claude/CLAUDE.md`.

If you DO have one, append the contents of `CLAUDE.md.additions` (or have Claude do it during SETUP — it checks for conflicts and asks before overwriting).

The additions include:

- **Tokensave-first rule** — overrides any skill recommendation to use `Agent(subagent_type=Explore)` for code research when tokensave is available. Hard rule, no exceptions.
- **Memory system instructions** — the four memory types, when to save each, when to access, how MEMORY.md works as an index.

These are project-agnostic — they're useful for any project, which is why they live in the global config.

---

## 2. Set up the memory system

The per-project memory home is:

```
~/.claude/projects/<project-slug>/memory/
```

where `<project-slug>` is what Claude Code auto-derives from your project's working-directory path (you can find it via `~/.claude/projects/`).

After SETUP determines the slug:

1. Copy `memory-template/MEMORY.md` to `~/.claude/projects/<project-slug>/memory/MEMORY.md` (if it doesn't already exist).
2. Read `memory-template/README.md` for the four memory types + when to save each + the body structure for feedback / project memories (the `**Why:**` + `**How to apply:**` lines).

Claude will start populating memory entries during your normal sessions — you don't need to pre-fill anything beyond the empty MEMORY.md index.

---

## 3. Verify

After merging, start a fresh Claude Code session in any project and ask:

> "What's the tokensave-first rule and where is per-project memory stored?"

Claude should answer from the global `~/.claude/CLAUDE.md`, not by reading files. If it answers correctly, the global setup is good.
