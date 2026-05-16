# Architecture — Feature-based / Vertical Slice

Organize by feature (`auth/`, `cart/`, `checkout/`, `inventory/`), not by technical role (`controllers/`, `services/`, `models/`). Each feature owns its full vertical: routes, business logic, data access, DTOs, tests.

## Why

- **Locality:** to change "checkout", you touch one folder, not seven.
- **Boundary clarity:** features are the boundary that's hard to refactor; technical roles are easy to refactor *within* a feature.
- **Team velocity:** different teams own different features; merge conflicts shrink.
- **Optionality toward microservices:** feature folders extract to services cleanly when scale demands it.

## Directory layout

```
src/
├── features/
│   ├── auth/
│   │   ├── auth.routes.ts        # presentation
│   │   ├── auth.service.ts       # business logic
│   │   ├── auth.repository.ts    # data access
│   │   ├── auth.dto.ts           # input/output types
│   │   ├── auth.test.ts          # tests live next to code
│   │   └── index.ts              # public surface; what other features can import
│   ├── cart/
│   │   ├── cart.routes.ts
│   │   ├── cart.service.ts
│   │   ├── cart.repository.ts
│   │   ├── cart.dto.ts
│   │   └── index.ts
│   └── checkout/
│       ├── ...
├── shared/                       # genuinely cross-feature utilities
│   ├── db/
│   ├── logger/
│   └── http/
└── main.ts                       # composition root
```

## Rules

- **Features import from `shared/` freely.** Cross-feature imports are restricted.
- **One feature can ONLY import another feature's public surface** (`features/<name>/index.ts` or equivalent). Internal files (`auth.repository.ts`) are private.
- **No "common" / "utils" dumping ground.** If something is needed by multiple features, it belongs in `shared/` with a clear name. "common" is where cross-cutting decay starts.
- **Tests live next to the code they test**, not in a separate `tests/` mirror tree. Each feature owns its own tests.
- **Features are independently testable** — set up the feature's repo + service in a test without booting the whole app.

## Cross-feature interactions

When `checkout` needs `cart` data:
- Bad: `checkout` reaches into `cart.repository.ts` directly.
- OK: `checkout` calls `cart`'s public service method via `cart/index.ts`.
- Better: `checkout` defines a port like `CartReader` and `cart` provides an adapter. Lets `checkout` evolve without coupling to `cart`'s internal shape.

## When this fits

- Most product applications with clear user-facing features.
- Teams of 3+ where parallel feature work is the norm.
- Codebases that might later split into microservices or modules.

## When NOT to pick this

- Single-feature apps where the "feature" is just "the thing this app does". Use layered.
- Domain-rich apps where the feature boundaries are unclear — DDD with bounded contexts is the better choice.

## What this rule will reject in review

- A feature importing another feature's internal file (not via the index).
- A `common/` or `utils/` folder accumulating cross-feature drift.
- A feature with no public surface (`index.ts`) — every feature must declare what it exports.
- Tests in a separate top-level `tests/` mirror instead of next to code.
