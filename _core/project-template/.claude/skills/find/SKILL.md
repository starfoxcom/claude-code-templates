---
name: find
description: Canonical code-research entry point. Use this skill whenever the user asks "where is X", "what calls Y", "find usages of Z", "show me the implementation of W" — or whenever you yourself need to locate a symbol, function, type, or pattern before reading/editing.
---

# /find

The single approved entry point for code research in this project. Replaces ad-hoc Grep/Glob/raw `grep`/`rg` reflexes — when an enforcement hook is installed (`~/.claude/hooks/{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}-first.py`), it blocks those calls and surfaces this skill's sequence instead.

## When to invoke

- Explicitly: user types `/find <thing>` or asks "where is X / what calls Y / find Z".
- Implicitly: any time you (Claude) need to locate code before reading or editing. Don't reach for `Grep`/`Glob` first — invoke this skill's sequence below.

## Tool-specific sequence

This project's code-research tool is **{{TOOLS_CODE_RESEARCH_NAME}}** ({{TOOLS_CODE_RESEARCH_URL}}). Follow the matching block below in order; stop at the first useful result.

<!-- TOGGLE:code_research:tokensave START -->
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
<!-- TOGGLE:code_research:tokensave END -->

<!-- TOGGLE:code_research:ast-grep START -->
### Sequence

1. **`ast-grep run --pattern '<name>' --lang <lang>`** — symbol-by-name lookup. `<lang>` accepts the canonical CLI aliases — lowercase forms like `typescript`, `tsx`, `javascript`, `python`, `rust`, `go`, `java`, `kotlin`, `swift`, `csharp`. (PascalCase forms like `TypeScript` / `CSharp` are the enum names used inside YAML rule files, not the CLI flag — see https://ast-grep.github.io/reference/languages.html.) Run `ast-grep --help` to see the list supported by your installed version.
2. **`ast-grep run --pattern '<AST pattern>' --lang <lang>`** — structural search. Use metavariables (`$X`, `$$$`) to capture parts of the AST. Example: `function $NAME($_) { $$$ }` matches any single-arg function.
3. **`ast-grep scan --rule <rules.yml>`** — rule-based scan when you've packaged a recurring pattern as a rule file.
4. **`ast-grep run --pattern '...' --globs '<file-pattern>'`** — scope a pattern to specific files.
5. After matching, use `Read <file>` with `offset`/`limit` to inspect the matched range without re-reading the whole file.

Reference: https://ast-grep.github.io/guide/pattern-syntax.html

### Reporting

Cite the ast-grep call(s) you used:

> Located `X` via `ast-grep run --pattern 'X' --lang ts` at `src/auth/login.ts:42`.

### Why this exists

ast-grep matches structural patterns over the AST, so a single query finds "all functions with this signature" or "all calls of `foo(_, _)`" without false positives from comments or strings that happen to mention the symbol. Plain Grep gives you text matches that are mostly noise on common identifiers. The hook + this skill default research to structural before text.
<!-- TOGGLE:code_research:ast-grep END -->

<!-- TOGGLE:code_research:sourcegraph START -->
### Sequence

1. **`src search 'r:<repo> <name>'`** — symbol-by-name against your configured Sourcegraph instance.
2. **`src search 'r:<repo> patterntype:literal <name>'`** — exact-literal search when regex matching would over-match common identifiers.
3. **`src search 'r:.* <name>'`** — cross-repo search. Use sparingly; expensive on large instances.
4. **`src search 'r:<repo> type:file f:<pattern>'`** — file-name search.
5. For instances with LSIF/SCIP code intelligence enabled, `src api` is a generic GraphQL passthrough — go-to-definition and find-references are accessible via raw GraphQL queries through it (no dedicated subcommand). See your Sourcegraph instance's docs for the exact query shapes.

Reference: https://sourcegraph.com/docs/cli

### Reporting

Cite the src search you ran:

> Located `X` via `src search 'r:<repo> X'` at `path/to/file.ext:42` (Sourcegraph URL: `<url>`).

### Why this exists

Sourcegraph's strength is cross-repo + cross-language search with semantic understanding. For monorepos and multi-repo orgs, a single `src search` query replaces dozens of `Grep` invocations across cloned repos. The hook + this skill exist to default research through your Sourcegraph instance rather than local-only Grep.
<!-- TOGGLE:code_research:sourcegraph END -->

<!-- TOGGLE:code_research:ctags START -->
### Sequence

1. **Generate the tags file** (once per session, regenerate after edits): `ctags -R -f tags .`. Cheap — runs in seconds for medium repos.
2. **Symbol lookup**: `grep -E '^<name>\b' tags` (the `tags` file has one line per symbol, name-prefixed). For Universal Ctags, prefer `readtags -t tags -e -p '<prefix>'` — more structured output. (If your prefix starts with `-`, insert a `-` separator before it — `readtags -t tags -e -p - '-prefix'` — to terminate option parsing. For ordinary prefixes the separator isn't needed.)
3. **Editor integrations**: vim `:tag <name>` / `<C-]>`; emacs `M-.`; VS Code "Go to Symbol" via the ctags extension. These use the same `tags` file.
4. **File-name search**: ctags doesn't index file names — use `Glob <pattern>`.

Reference: https://docs.ctags.io

### Reporting

Cite the ctags lookup:

> Located `X` via `readtags -t tags -e -p X` at `src/auth/login.c:42`.

### Why this exists

ctags is the universal least-common-denominator code index — works for ~70 languages, no daemon, no service. The hook + this skill exist so research routes through the tags file rather than re-scanning the source tree with Grep every time.
<!-- TOGGLE:code_research:ctags END -->

<!-- TOGGLE:code_research:semgrep START -->
### Sequence

1. **`semgrep --pattern '<name>' --lang <lang>`** — symbol-by-name. `<lang>` is `python`, `javascript`, `typescript`, `go`, `java`, `kotlin`, etc.
2. **`semgrep --pattern '$X = $Y' --lang <lang>`** — AST-aware structural search with metavariables.
3. **`semgrep --config <rules.yml>`** — apply a rule pack.
4. **`semgrep --config auto`** — auto-download the relevant rule pack for your detected stack (useful for security-style discovery).
5. **File-name search**: Semgrep doesn't index file names — use `Glob <pattern>`.

Reference: https://semgrep.dev/docs

### Reporting

Cite the semgrep call:

> Located `X` via `semgrep --pattern 'X' --lang python` at `app/auth.py:42`.

### Why this exists

Semgrep started as a security-focused AST-aware scanner but its pattern language doubles as a structural code search. The hook + this skill exist so research routes through semgrep's AST matching rather than plain text Grep — fewer false positives on common identifiers.
<!-- TOGGLE:code_research:semgrep END -->

<!-- TOGGLE:code_research:none START -->
### Sequence

1. **`Grep <pattern>`** — search file contents. Scope by language with `type: <lang>` (`type: ts`, `type: py`, etc.). Returns matching files + line numbers.
2. **`Glob <pattern>`** — locate files by name pattern (e.g., `src/**/*.tsx`, `**/auth/*.go`).
3. **`Read <file>`** with `offset`/`limit` — open the specific range; don't read whole files when only a function is in scope.
4. For call-graph questions ("what calls X / what does X call"), follow up the initial `Grep <symbol-name>` hit with targeted `Read`s of each caller — there's no graph traversal primitive available, so this is the manual path.

### Reporting

Cite the search you ran:

> Located `X` via `Grep "X" type:ts` at `src/auth/login.ts:42`.

### Why this exists

Without a dedicated indexer, code research is the most common source of token waste: reading 5–20 candidate files at thousands of tokens each before locating the right one. The canonical sequence + "stop at first useful result" discipline cuts that to one or two well-targeted searches. If you later adopt a code-graph indexer, re-run setup with a different `tools.code_research` value to swap this skill's body for the indexer-aware version.
<!-- TOGGLE:code_research:none END -->

<!-- TOGGLE:code_research:custom START -->
### Sequence

This project uses a custom code-research tool (`{{TOOLS_CODE_RESEARCH_NAME}}`). Substitute the appropriate command shapes for the sequence below; refer to {{TOOLS_CODE_RESEARCH_URL}} for the canonical command surface.

1. **Symbol-by-name search** — `<symbol-name lookup command>`
2. **Fuzzy / contextual search** — `<broader exploration command>`
3. **Call-graph / cross-reference** — `<caller/callee command>` (or note "manual via repeated symbol search" if not supported)
4. **File-name search** — `<file-pattern command>` (or fall back to `Glob` if the tool doesn't index file names)
5. **Snippet read** — `<single-symbol body command>` (or fall back to `Read <file>` with `offset`/`limit`)

> _The bullets above are stubs. After onboarding, replace them with the actual command sequence for {{TOOLS_CODE_RESEARCH_NAME}}, then update `~/.claude/hooks/{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}-first.py`'s `SEQUENCE_BULLETS` constant to match (or re-run setup so the bind step regenerates the hook from a refined profile)._

### Reporting

Cite the {{TOOLS_CODE_RESEARCH_NAME}} call you ran:

> Located `X` via `<command>` at `path/to/file.ext:42`.

### Why this exists

You picked a custom code-research tool — presumably because {{TOOLS_CODE_RESEARCH_URL}} fits your stack better than the canonical options. The skill + hook exist so research routes through {{TOOLS_CODE_RESEARCH_NAME}} rather than ad-hoc Grep/Glob. The discipline matters more than the specific tool.
<!-- TOGGLE:code_research:custom END -->

## Fallback to Grep/Glob/raw grep

Allowed ONLY if:
- You've tried {{TOOLS_CODE_RESEARCH_NAME}} with 2+ variants and got nothing usable.
- You're searching non-code content (markdown, binaries, `.gitignored` files).
- {{TOOLS_CODE_RESEARCH_NAME}} is unavailable for the scope you need (CLI missing / index empty / instance unreachable).

<!-- TOGGLE:tokensave_entry_point START -->
The `~/.claude/hooks/{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}-first.py` hook (installed globally — see `SETUP.md` § Phase 7a) is the gatekeeper:

- **Bash `grep`/`rg`/`ag`/`ack`** — add an inline `# {{TOOLS_CODE_RESEARCH_BYPASS_MARKER}} <reason>` comment in your command, hook lets it through.
- **Grep/Glob tools** — there's no inline escape; briefly explain the bypass to the user in chat, then re-issue the tool call.
<!-- TOGGLE:tokensave_entry_point END -->
<!-- TOGGLE:tokensave_entry_point:off START -->
No code-research-first hook is installed for this project. Use Grep/Glob directly when you've exhausted {{TOOLS_CODE_RESEARCH_NAME}} or the case fits one of the fallback conditions above. The session-close adherence metric still counts the ratio — keep the discipline even without enforcement.
<!-- TOGGLE:tokensave_entry_point:off END -->

## Citation purpose

The citation lets the user verify the path you took. It's also what the session-close adherence metric counts — calls through {{TOOLS_CODE_RESEARCH_NAME}} vs Grep/Glob fallbacks. Keep citations terse; one line is fine.
