# Architecture — ECS (Entity Component System)

For games and simulations. Entities are IDs; components are plain data; systems operate on entities that have a specific component combination. The dominant architecture in modern game engines (Bevy, Unity DOTS, EnTT, flecs).

## Core ideas

- **Entity** — a unique ID. No data, no behavior. Just an identifier.
- **Component** — pure data attached to an entity (e.g., `Position { x, y, z }`, `Health { current, max }`). No methods, no behavior. Composable.
- **System** — a function that iterates over entities matching a component signature and operates on them (e.g., `MovementSystem` iterates over `(Position, Velocity)`).
- **World / Registry** — the container that holds entities + components + queries.

## Why this fits games

- **Cache locality:** components stored in contiguous arrays (archetype storage) → CPU prefetcher loves it.
- **Composability:** mix-and-match components instead of deep inheritance hierarchies.
- **Parallelism:** systems with disjoint component access can run on separate threads.
- **Editor-friendly:** components serialize trivially.

## Rules

- **Components are pure data.** No methods beyond constructors. If you find yourself adding logic to a component, that logic belongs in a system.
- **Systems are pure functions of `(query results) → mutations`.** No global state, no singletons, no `Game.instance.player`.
- **Avoid `IsX` boolean components** for things that should be archetype-defining. Prefer empty marker components (`Player`, `Enemy`) so queries can filter on archetype.
- **One responsibility per system.** `MovementSystem` updates positions from velocities. It doesn't also handle collision. Compose systems instead of building god systems.
- **Order matters.** Define system schedule explicitly (phases like `Input → Logic → Physics → Render`). Don't let order emerge implicitly.
- **Avoid `world.set<X>()` in hot loops** if X is a hot-path component — direct mutation via `get_mut<X>()` is cheaper (no command buffer overhead).

## Sparse vs dense components

- **Dense** (default): most entities have this component (`Position`, `Velocity` on every moving thing). Stored in archetype arrays.
- **Sparse** (rare, opt-in): only a small fraction of entities have it (`OnFire`, `Wounded`, `InCombat`). Use sparse storage flags (`DontFragment` in flecs, sparse-set in EnTT) to avoid archetype explosion.

Rule of thumb: if a component is present on < 10% of entities, mark it sparse.

## System scheduling phases

Map your systems to phases (engine-specific names vary):

| Phase | What runs here |
|---|---|
| `Input` / `OnLoad` | Read user input, network packets |
| `PreUpdate` | Command buffer flush, dirty-flag reset |
| `Update` | AI, gameplay logic |
| `Validate` | Collision resolution, constraint checks |
| `PostUpdate` | Coordinator-level systems (economy, scheduler) |
| `PreStore` | Prep transforms for rendering |
| `Render` / `OnStore` | Push to GPU, audio, UI |

Within a phase, system order can be inferred from data dependencies (engine schedules); across phases, order is fixed.

## What this rule will reject in review

- A component with methods beyond data accessors.
- A system that touches global state or singletons.
- An `IsPlayer` bool field on a generic `Entity` component instead of a marker component.
- Mutation of two unrelated component types from one system (split it).
- A sparse component stored as a dense archetype field (perf cliff at scale).

## See also

- Mike Acton's "Data-Oriented Design" talks for the cache-locality argument.
- Engine docs: Bevy ECS book, flecs manual, EnTT docs — all have idiomatic patterns worth following.
