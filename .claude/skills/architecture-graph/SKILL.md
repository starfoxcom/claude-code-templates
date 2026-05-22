---
name: architecture-graph
description: Generate or refresh a clickable architecture diagram (HTML viewer + JSON source-of-truth) that maps the project's modules, data paths, and call sites end-to-end. The JSON is what Claude reads in future sessions instead of grepping the codebase. Modeled on the C4 diagramming approach.
---

# /architecture-graph

A first-class artifact that captures the *actual* shape of this project — what modules exist, what depends on what, where data flows. Lives at `docs/architecture/`:

- **`docs/architecture/diagram.json`** — machine-readable source of truth. Claude reads this in future sessions for fast architectural context.
- **`docs/architecture/index.html`** — single-file interactive viewer. Open in a browser to inspect; click any node to see its connections.

## Why this exists

Reading scattered docs + grepping source for "where does X live" is expensive — both in tokens and in attention. A maintained diagram collapses that into a single artifact that's:

1. **Fast for Claude to load** — a 5KB JSON beats 50 files of source.
2. **Visual for you** — a clickable graph is easier than reading prose docs.
3. **Drift-detectable** — when the diagram doesn't match the code, that's a fact you can audit.

Maintained well, this kills the "cognitive debt" of architecture drifting silently. Architectural decisions flow through the diagram FIRST, then implementation follows.

## When to invoke

- **First-time generation:** user types `/architecture-graph` (or asks: "give me an architecture diagram of this project").
- **Refresh after structural changes:** any PR that adds a new module, splits a boundary, introduces a new external dependency, or changes a data path.
- **Before architectural work:** at the start of any session whose plan includes "add a new system" / "refactor the X boundary" / "move Y to Z" — read the current diagram, sketch the proposed change ON the diagram, then implement.

## Generation procedure (first time)

1. **Map the high-level boundaries first** — top-level directories that represent distinct subsystems (e.g., `apps/`, `packages/`, `services/`, `src/<module>/`). Use the project's code-research tool's file-listing primitive (per `.claude/skills/find/SKILL.md`), or `Glob` (with a `# TOKENSAVE_BYPASS: <reason>` bypass marker if the hook is installed and the listing is non-code). For this project (tokensave): `tokensave_files <pattern>`.
2. **Identify external boundaries** — databases, message queues, external APIs, file system, network. Read package manifests / lock files to find them.
3. **Trace data paths** through 3–5 key user-facing features. Pick the most central ones; don't try to map everything on first pass.
4. **Identify control-flow seams** — interface boundaries, event/message channels, dependency-injection seams.
5. **Write `diagram.json`** in this shape:
   ```json
   {
     "version": 1,
     "project": "<PROJECT_NAME>",
     "generated_at": "ISO-8601",
     "nodes": [
       { "id": "auth", "label": "Auth", "kind": "module|service|external|datastore", "summary": "...", "owner_path": "src/auth/" }
     ],
     "edges": [
       { "from": "web", "to": "auth", "kind": "calls|reads|writes|emits|subscribes", "label": "POST /login" }
     ],
     "groups": [
       { "id": "backend", "label": "Backend services", "members": ["auth", "billing", "notifications"] }
     ]
   }
   ```
6. **Render `index.html`** from a template (see scaffold below) that loads `diagram.json` and renders a force-directed or grid graph with click-to-highlight-connections behavior.
7. **Commit both files** atomically: `docs: scaffold architecture diagram` — no PR, just land it.

## Refresh procedure

1. Read existing `docs/architecture/diagram.json`.
2. Diff against current code reality to find new/removed modules. Use `tokensave_dsm` (dependency-structure matrix) + `tokensave_coupling` + `tokensave_files` — fast, deterministic, no whole-tree walk.
3. Update nodes / edges / groups. Bump `generated_at`.
4. Commit: `docs: refresh architecture diagram after <change>`.

## Drift detection

If you're about to make an architectural change that the diagram doesn't reflect:

1. **Update the diagram first** — propose the new node/edge/boundary.
2. Get user sign-off on the diagram change.
3. Implement the code to match the diagram, not the other way around.

This inverts the usual "code then doc" flow. The diagram becomes the spec.

## C4 model alignment (optional)

This skill is compatible with the [C4 model](https://c4model.com/) — System Context, Container, Component, Code. Map our `kind` field:
- C4 "Person" / "Software System" / "External" → `kind: "external"`
- C4 "Container" (deployable) → `kind: "service"`
- C4 "Component" (in-process module) → `kind: "module"`
- C4 "Persistence" → `kind: "datastore"`

Most projects don't need all four levels — start at Container + Component and add Context only if you have multiple external actors.

## Scaffold for `index.html`

For the first generation, write a minimal viewer that:
- Loads `diagram.json` via fetch
- Renders nodes as boxes positioned in a grid by their `groups`
- Draws SVG edges between connected nodes
- On node click: highlight that node + all directly-connected nodes/edges, dim everything else
- Dark theme matching the project's aesthetic

Use vanilla JS, no framework. The viewer is throwaway tooling, not a product.

## Costs honesty

- First generation: 30–90 minutes of Claude time on a non-trivial codebase. Worth it once.
- Refresh: 5–15 minutes after a significant structural change.
- The token cost of generating is offset by all the future sessions that read `diagram.json` instead of grepping. Break-even is usually within 3–5 sessions.
