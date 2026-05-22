---
name: find
description: Canonical code-research entry point. Use this skill whenever the user asks "where is X", "what calls Y", "find usages of Z", "show me the implementation of W" — or whenever you yourself need to locate a symbol, function, type, or pattern before reading/editing.
---

# /find

The single approved entry point for code research in this project. Replaces ad-hoc Grep/Glob/raw `grep`/`rg` reflexes — when an enforcement hook is installed (`~/.claude/hooks/tokensave-first.py`), it blocks those calls and surfaces this skill's sequence instead.

## When to invoke

- Explicitly: user types `/find <thing>` or asks "where is X / what calls Y / find Z".
- Implicitly: any time you (Claude) need to locate code before reading or editing. Don't reach for `Grep`/`Glob` first — invoke this skill's sequence below.

## Tool-specific sequence

This project's code-research tool is **tokensave** (https://github.com/aovestdipaperino/tokensave). Follow the block below in order; stop at the first useful result.

### Sequence

1. **`tokensave_search <name>`** — symbol-by-name lookup. Returns matches with file:line and short context. Fastest.
2. **`tokensave_context <natural-language query>`** — broader exploration. Returns related symbols + relationships. Use when the symbol name is unknown or fuzzy. Add `keywords: [...]` for synonym expansion.
3. **`tokensave_callers <symbol>` / `tokensave_callees <symbol>` / `tokensave_impact <symbol>`** — once a symbol is located, walk the call graph.
4. **`tokensave_files <pattern>`** — find files by name pattern.
5. **`tokensave_body <symbol>`** — pull the actual source of a single symbol when reading the whole file would be wasteful.

### Reporting

Cite the tokensave call(s) you used:

> Located `X` via `tokensave_search "X"` at `path/to/file.ext:42`.

### Why this exists

Tokensave indexes the codebase as a symbol graph; queries return seconds of work in tens of tokens. Plain Grep can require reading 5–20 candidate files at thousands of tokens each before you locate the right one. Across sessions, this compounds — session telemetry showed tokensave hit-rate trending DOWN while Bash usage grew. The hook + this skill exist to invert that.

## Fallback to Grep/Glob/raw grep

Allowed ONLY if:
- You've tried tokensave with 2+ variants and got nothing usable.
- You're searching non-code content (markdown, binaries, `.gitignored` files).
- tokensave is unavailable for the scope you need (CLI missing / index empty / instance unreachable).

The `~/.claude/hooks/tokensave-first.py` hook (installed globally — see `SETUP.md` § Phase 7a) is the gatekeeper:

- **Bash `grep`/`rg`/`ag`/`ack`** — add an inline `# TOKENSAVE_BYPASS: <reason>` comment in your command, hook lets it through.
- **Grep/Glob tools** — there's no inline escape; briefly explain the bypass to the user in chat, then re-issue the tool call.

## Citation purpose

The citation lets the user verify the path you took. It's also what the session-close adherence metric counts — calls through tokensave vs Grep/Glob fallbacks. Keep citations terse; one line is fine.
