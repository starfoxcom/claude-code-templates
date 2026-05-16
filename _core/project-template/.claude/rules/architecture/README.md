# Architecture rule pool

This directory holds one Markdown rule per supported architectural pattern. During SETUP, Claude reads the user's chosen pattern from the JSON command and copies the matching file as `.claude/rules/architecture.md` in the project root.

## Available patterns

| Pattern | File | Best for |
|---|---|---|
| **Clean Architecture** | `clean.md` | Concentric layers, dependency inversion. Long-lived business apps. |
| **Hexagonal / Ports & Adapters** | `hexagonal.md` | Multiple driving inputs (HTTP + queue + CLI) and/or swappable adapters. |
| **Layered (3-tier)** | `layered.md` | CRUD-heavy services with thin business logic. Don't over-engineer. |
| **Feature-based / Vertical Slice** | `feature-based.md` | Product apps with clear features; multiple teams; future microservices. |
| **MVC** | `mvc.md` | Server-rendered web apps (Rails, Django, Laravel, ASP.NET MVC). |
| **DDD (Domain-Driven Design)** | `ddd.md` | Complex business domains with rich invariants and bounded contexts. |
| **ECS (Entity Component System)** | `ecs.md` | Games and simulations. Bevy, Unity DOTS, flecs, EnTT. |
| **None** | (skip) | Greenfield with no chosen pattern yet. Add later by re-running setup. |

## How SETUP picks one

Setup form has a "Architecture pattern" dropdown in Advanced. Selected value flows into the JSON command's `project.architecture` field (e.g., `"clean"`, `"hexagonal"`, `"none"`). SETUP.md's Phase 3 copies `_core/.../architecture/<pattern>.md` → `.claude/rules/architecture.md`, prepending a short note that the rule was scaffolded from a template and should be tightened to match the project's actual conventions.

## Why these patterns specifically

The list covers ~85% of architectures seen in real-world projects. Missing patterns worth knowing but not yet templated:

- **Microservices** — too domain-dependent for a generic template; Hexagonal-per-service is the usual starting point.
- **CQRS / Event Sourcing** — adds significant complexity; pair with DDD when domains genuinely need read/write asymmetry.
- **Serverless / FaaS** — more of a deployment model than an architecture; combines with any of the above.
- **Modular Monolith** — typically Feature-based + strict module boundaries (which `feature-based.md` already encodes).

If you want one of these as a first-class option, drop a new `<pattern>.md` into this folder and add it to the dropdown + this table.
