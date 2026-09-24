---
name: find
description: Locate code before reading or editing it. Use whenever the user asks "where is X", "what calls Y", "find usages of Z", or whenever you need to find a symbol, function, type or pattern yourself.
---

# /find

The lookup sequence for this project's code-research tool, **{{TOOLS_CODE_RESEARCH_NAME}}** ({{TOOLS_CODE_RESEARCH_URL}}). Follow it in order and stop at the first useful result. Read only the range you found, never the whole file.

<!-- TOGGLE:code_research:tokensave START -->
## Sequence

1. `tokensave_search` with the symbol name: matches with file and line.
2. `tokensave_context` with a plain-English question when the name is unknown. Pass `keywords` for synonyms; `include_code: true` returns the source.
3. `tokensave_callers`, `tokensave_callees`, `tokensave_impact` to walk the call graph from a located symbol.
4. `tokensave_files` to find files by path pattern.
5. `tokensave_body` to read one symbol instead of its file.

Run `tokensave sync` after large edits so the graph matches the code. tokensave's hook redirects symbol-shaped Grep and Glob calls to these tools.
<!-- TOGGLE:code_research:tokensave END -->

<!-- TOGGLE:code_research:lsp-plugins START -->
## Sequence

The `LSP` tool answers from the language server of the file's language.

1. `workspaceSymbol` with the name to find where a symbol is defined.
2. `goToDefinition` and `findReferences` from a known position.
3. `prepareCallHierarchy`, then `incomingCalls` or `outgoingCalls`, for who calls what.
4. `goToImplementation` for interfaces and abstract methods; `documentSymbol` for a file outline.

File names are not indexed: use Glob. Cloud sessions do not start plugin language servers, so there the fallback below applies. After each edit the language server reports new errors; fix them in the same turn.
<!-- TOGGLE:code_research:lsp-plugins END -->

<!-- TOGGLE:code_research:codegraph START -->
## Sequence

1. `codegraph_explore` with the question or symbol name. It returns the relevant symbols' source, the call paths between them and what a change would affect, usually in one call.
2. `codegraph_explore` again with a file or symbol name to read it with line numbers.

The narrower tools (`codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`) are hidden by default; enable them with the `CODEGRAPH_MCP_TOOLS` variable if one-call answers run too large.
<!-- TOGGLE:code_research:codegraph END -->

<!-- TOGGLE:code_research:serena START -->
## Sequence

1. `find_symbol` with the name; add `include_body: true` to read it.
2. `get_symbols_overview` for a file outline before reading any of it.
3. `find_referencing_symbols` for callers and usages; `find_implementations` for interfaces.
4. `find_file` and `list_dir` for file names; `search_for_pattern` for text that is not a symbol.

Prefer `replace_symbol_body` and `insert_after_symbol` for edits to whole symbols; they keep line numbers out of the edit.
<!-- TOGGLE:code_research:serena END -->

<!-- TOGGLE:code_research:codebase-memory START -->
## Sequence

1. `search_graph` with a `name_pattern` to find symbols.
2. `trace_path` with a function name and direction for callers or callees (depth 1 to 5).
3. `get_code_snippet` with the qualified name to read one symbol; `get_file_outline` for a file.
4. `detect_changes` to list the symbols a working-tree diff touches.
5. `get_architecture` once per session for the overall shape.

If results look stale, check `index_status` and re-run `index_repository`.
<!-- TOGGLE:code_research:codebase-memory END -->

<!-- TOGGLE:code_research:none START -->
## Sequence

1. `Grep` for the name, scoped with `type` or `glob` to the language.
2. `Glob` for file names.
3. `Read` with `offset` and `limit` for the matched range.
4. For "what calls X", Grep for the name and read each caller's range. There is no call graph without an indexer.
<!-- TOGGLE:code_research:none END -->

<!-- TOGGLE:code_research_first START -->
## Falling back to Grep and Glob

Allowed only when:

- {{TOOLS_CODE_RESEARCH_NAME}} returned nothing usable for two differently worded queries;
- the target is not code (Markdown, config, binaries, ignored files);
- {{TOOLS_CODE_RESEARCH_NAME}} is unavailable for this scope.

Say which condition applies. For a shell `grep` or `rg`, add the comment `# {{TOOLS_CODE_RESEARCH_BYPASS_MARKER}} <reason>` to the command so the session-close count treats it as a deliberate fallback.
<!-- TOGGLE:code_research_first END -->

## Citing

Name the call that found it, in one line:

> Found `parseHeader` via `<call>` at `src/codec/header.ts:42`.
