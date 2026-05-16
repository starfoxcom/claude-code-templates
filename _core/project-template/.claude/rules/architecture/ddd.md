# Architecture — Domain-Driven Design (DDD)

Organize around **bounded contexts** — explicit domain boundaries where the ubiquitous language is consistent. DDD is heaviest of the patterns here; pick it when the domain is genuinely complex and worth modeling carefully.

## Core building blocks

- **Bounded Context** — a self-contained model with its own ubiquitous language. Two contexts can use the word "User" to mean different things; that's fine.
- **Entity** — has an identity that persists over time. `Order #1234` is the same order even as its line items change.
- **Value Object** — defined by its attributes; no identity. `Money(amount=100, currency=USD)`. Immutable.
- **Aggregate** — a cluster of entities + value objects treated as one unit for consistency. The aggregate root is the only thing outside the aggregate can reference.
- **Aggregate Root** — the entry point to the aggregate. External code reads/writes only through the root.
- **Domain Service** — operations that don't naturally live on an entity (e.g., transferring money between two accounts).
- **Repository** — abstracts persistence of aggregates. One repo per aggregate root.
- **Domain Event** — something important happened in the domain (`OrderPlaced`). Other contexts may subscribe.

## Directory layout

```
src/
├── contexts/
│   ├── ordering/
│   │   ├── domain/
│   │   │   ├── order.{ext}            # aggregate root
│   │   │   ├── order_line.{ext}       # entity within the aggregate
│   │   │   ├── money.{ext}            # value object
│   │   │   ├── order_repository.{ext} # interface
│   │   │   └── events.{ext}           # domain events
│   │   ├── application/
│   │   │   └── place_order_service.{ext}
│   │   └── infrastructure/
│   │       ├── postgres_order_repository.{ext}
│   │       └── http_controller.{ext}
│   ├── shipping/
│   │   └── ...
│   └── billing/
│       └── ...
└── shared_kernel/              # types shared between contexts (use sparingly)
```

## Rules

- **Aggregates enforce invariants.** All writes to an aggregate go through its root. Don't let external code mutate a child entity directly.
- **Aggregates are transactional units.** One transaction = one aggregate. Don't update two aggregates in the same transaction; use eventual consistency via domain events.
- **Bounded contexts are isolated.** Two contexts NEVER share entity types. If `Ordering` and `Shipping` both need `User`, each has its own `User` model with only the fields it cares about. Map between them at the boundary.
- **The ubiquitous language is real.** Code uses the same terms the domain experts use. If accountants call it a "ledger entry", the class is `LedgerEntry`, not `Transaction`.
- **No anemic models.** If a class has only getters/setters, it's not a domain entity, it's a DTO. Move the behavior onto it.
- **Repositories are per aggregate root.** `OrderRepository`, not `OrderLineRepository`.

## Context map (cross-context relationships)

Document how contexts relate:

- **Shared Kernel** — both contexts share a tiny slice of model. Brittle; use rarely.
- **Customer/Supplier** — upstream context publishes a contract; downstream consumes.
- **Conformist** — downstream just accepts whatever upstream gives, no translation. Cheap and lossy.
- **Anticorruption Layer (ACL)** — downstream translates upstream's model into its own. Most defensive option.
- **Open Host Service** — upstream exposes a well-defined API for all downstream consumers.

Pick explicitly per pair; document in a `CONTEXT-MAP.md`.

## When this fits

- Complex business domains: finance, insurance, healthcare, logistics, multi-sided marketplaces.
- Long-lived codebases (5+ years projected).
- Teams large enough to align around shared language.

## When NOT to pick this

- CRUD apps with thin business logic. DDD overhead > value.
- Greenfield prototypes. Apply DDD only after the domain stabilizes; premature bounded contexts ossify wrong decisions.
- Solo dev on a small project. The ceremony slows you down.

## What this rule will reject in review

- External code mutating a non-root entity directly.
- A transaction that updates two aggregates.
- A single `User` model used across all contexts.
- An anemic "entity" that's just getters/setters with no invariants.
- A repository named after a non-root entity (`OrderLineRepository`).
- Cross-context imports of entity types without an anticorruption layer.
