# Architecture — Clean Architecture (Uncle Bob)

Concentric layers; dependencies point INWARD only. The further inside, the more stable.

## Layers (outer → inner)

1. **Frameworks & Drivers** — web framework, UI toolkit, database driver, CLI, external SDKs. The volatile shell.
2. **Interface Adapters** — controllers / presenters / view-models / gateways. Translates between use cases and the outer world.
3. **Use Cases** (Application) — orchestrates entities to achieve a specific user goal. Pure logic, no framework imports.
4. **Entities** (Enterprise / Domain) — business rules + invariants that exist regardless of any application. Pure, framework-free.

## The dependency rule

**Source-code dependencies can only point inward.** Inner layers know nothing of outer layers.

- `entities/` imports nothing project-specific.
- `usecases/` imports `entities/` only.
- `adapters/` imports `usecases/` + `entities/`.
- `frameworks/` imports anything.

Cross-layer communication outward (use case needs to call a DB) is done via **interfaces declared in the use-case layer** and implemented in the outer layer (Dependency Inversion).

## Directory layout (starting point)

```
src/
├── entities/        # pure domain, no imports of anything project-specific
├── usecases/        # application logic, depends on entities + own interfaces
│   └── ports/       # interfaces the use cases need (Repository, EmailSender, etc.)
├── adapters/        # implementations of the ports + UI controllers/presenters
│   ├── db/          # adapter for the database port
│   ├── http/        # controllers, request DTOs
│   └── presenters/  # view-models, response shaping
└── frameworks/      # main, DI wiring, web server bootstrap, external clients
```

Adapt the names to your language's idioms (Go → `internal/`, Java → packages, etc.).

## Rules of thumb

- **No domain model should import a framework type.** If an `entities/User` needs to mention `time.Time`, fine; if it imports `gorm.Model`, that's a violation.
- **Use cases are pure functions of (input, ports) → output.** Test them by injecting fake ports.
- **Adapters are I/O boundaries.** They translate, they don't decide. Decisions live in use cases.
- **Avoid "anemic domain model"** — entities should encapsulate invariants, not just be DTOs.
- **Don't pre-create layers you don't need.** Greenfield: start with entities + usecases + a couple of adapters. Add ports/presenters when you actually have two implementations / two presentations to switch between.

## What this rule will reject in review

- A controller importing the DB driver directly (skips the gateway port).
- A use case importing `express`, `flask`, `axum`, or any framework type.
- An entity with `@Table` / `@Entity` framework annotations.
- A circular import between layers.

## See also

- Robert C. Martin, *Clean Architecture* (the book) — chapter 22 has the canonical concentric diagram.
- For services that mostly do CRUD and have thin business logic, **Layered** (3-tier) is simpler and good enough — don't over-engineer.
