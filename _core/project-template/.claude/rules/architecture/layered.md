# Architecture — Layered (3-tier)

The classic three-tier split. Simple, well-understood, good for CRUD-heavy services with thin business logic. Don't over-engineer toward Clean / Hexagonal if this fits.

## The three tiers

1. **Presentation** — HTTP controllers, CLI handlers, view templates, response shaping. Validates input, calls the service tier, formats output.
2. **Service / Business** — application logic, transactions, orchestration. Coordinates repositories + external services.
3. **Data Access / Repository** — DB queries, external API clients, file I/O. No business decisions live here.

Sometimes split as 4 tiers (adding a separate **Domain Model** layer for entities). For services with thin logic, 3 is enough.

## Directory layout

```
src/
├── controllers/   # or handlers/ — Presentation tier
├── services/      # Service / Business tier
├── repositories/  # or dao/ — Data Access tier
├── models/        # entities / DTOs / value objects
└── config/        # DI, env loading, app bootstrap
```

## Rules

- **Dependencies flow downward:** controllers → services → repositories. Never upward.
- **No tier-skipping:** controllers don't talk to repositories directly. Always route through services. (One exception: read-only listing endpoints with zero business logic can call repos directly, but document the choice.)
- **Each tier has its own DTOs / models** if the shape needs to differ:
  - `models/api/` — request/response DTOs at the controller boundary
  - `models/domain/` — service-tier entities + value objects
  - `models/db/` — ORM/table mappings at the repository boundary
  - Map between them at tier boundaries. Don't leak ORM models out of the repository tier.
- **Transactions are managed at the service tier**, not in repositories or controllers.
- **Cross-cutting concerns** (auth, logging, rate limiting) live in middleware applied at the controller tier, NOT scattered through services.

## When this fits

- Most CRUD-heavy backends — REST APIs over Postgres with predictable business rules.
- Internal tools, admin dashboards.
- Apps where the domain model is genuinely just data + simple invariants.

## When to graduate to Clean / Hexagonal

- Multiple driving inputs (HTTP + queue + CLI all need the same business logic).
- Business invariants are non-trivial (event sourcing, money handling, regulatory rules).
- You want to swap data stores or external providers without touching business code.

## What this rule will reject in review

- A controller calling a repository directly without going through a service.
- A repository containing business logic (e.g., "if order total > $100, also create a notification").
- ORM models leaking into controller response bodies (use a DTO).
- A transaction boundary opened in a controller or a repository.
