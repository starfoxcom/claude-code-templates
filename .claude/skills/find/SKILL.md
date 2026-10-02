---
name: find
description: Locate code before reading or editing it. Use whenever the user asks "where is X", "what calls Y", "find usages of Z", or whenever you need to find a symbol, function, type or pattern yourself.
---

# /find

The lookup sequence for this project's code-research tool, **tokensave** (https://github.com/aovestdipaperino/tokensave). Follow it in order and stop at the first useful result. Read only the range you found, never the whole file.

## Sequence

1. `tokensave_search` with the symbol name: matches with file and line.
2. `tokensave_context` with a plain-English question when the name is unknown. Pass `keywords` for synonyms; `include_code: true` returns the source.
3. `tokensave_callers`, `tokensave_callees`, `tokensave_impact` to walk the call graph from a located symbol.
4. `tokensave_files` to find files by path pattern.
5. `tokensave_body` to read one symbol instead of its file.

Run `tokensave sync` after large edits so the graph matches the code. tokensave's hook redirects symbol-shaped Grep and Glob calls to these tools.

## Falling back to Grep and Glob

Allowed only when:

- tokensave returned nothing usable for two differently worded queries;
- the target is not code (Markdown, config, binaries, ignored files);
- tokensave is unavailable for this scope.

Say which condition applies. For a shell `grep` or `rg`, add the comment `# TOKENSAVE_BYPASS: <reason>` to the command so the session-close count treats it as a deliberate fallback.

## Citing

Name the call that found it, in one line:

> Found `parseHeader` via `<call>` at `src/codec/header.ts:42`.
