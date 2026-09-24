# Code-research tool options (2026-09-23)

The slot answers "where is X, what calls Y, what breaks if I change Z" without reading whole files. Numbers are vendor-reported unless noted. Stars and dates from the GitHub API on 2026-09-23.

| Tool | What it is | Install | License | Notes |
|---|---|---|---|---|
| tokensave | Code graph plus a hook that redirects symbol-shaped Grep/Glob | Single Rust binary | MIT | 646 stars, v7.12.1 (2026-09-12), one maintainer. Hook conflicts with other grep-intercepting tools. |
| Claude Code LSP plugins | First-party code intelligence: definitions, references, call hierarchy, diagnostics after edits | `/plugin install` plus a language server per language | per server | 11 official languages. No cross-file impact graph. Heavy servers on big repos. |
| CodeGraph (colbymchenry) | SQLite code graph, one explore tool | Script or npm | MIT | 72k stars, v1.6.0 (2026-08-26). Vendor: 62% fewer tokens. |
| Serena | LSP-driven MCP server with symbol-level edits | `uv tool install` | GPL-3.0 (app) | 29.8k stars, v1.7.0. Windows setup friction reported (issues 354, 368). |
| codebase-memory-mcp | Tree-sitter graph plus LSP type resolution | Static binary, npm, pip | MIT | 44.7k stars. arXiv evaluation (2603.27277): about 10x fewer tokens at slightly lower answer quality. Installs its own grep hooks, so it cannot be combined with tokensave. |

Dropped from the slot:
- Semgrep: a lint and security scanner, not navigation.
- Sourcegraph: Enterprise-only and works on remotely indexed repos, not the local working tree.
- universal-ctags: definitions only, no maintained MCP wrapper; the LSP plugins cover it.

Offer: tokensave, LSP plugins, CodeGraph, Serena, codebase-memory-mcp, none, custom. Each option is a data profile (install command, MCP config, hook, notes), not setup prose. No head-to-head benchmark exists across these tools; a same-repo, same-queries comparison would settle the ranking.

Sources: github.com/aovestdipaperino/tokensave, code.claude.com/docs/en/discover-plugins, github.com/colbymchenry/codegraph, github.com/oraios/serena, github.com/DeusData/codebase-memory-mcp, arxiv.org/html/2603.27277v1, github.com/semgrep/mcp, sourcegraph.com/mcp, libraries.io/pypi/ctags-mcp.
