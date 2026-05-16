# Architecture — Hexagonal / Ports & Adapters

Domain at the center, **ports** (interfaces) defined by the domain, **adapters** (implementations) on the outside. The domain doesn't know what concrete tech sits on the other side of any port.

## The structure

```
                ┌────────────────────────┐
   HTTP req ───►│ Driving adapter (web)  │──► port ──►│            │
   CLI cmd  ───►│ Driving adapter (CLI)  │──► port ──►│   DOMAIN   │──► port ───►│ Driven adapter (DB)    │
                │ Driving adapter (test) │──► port ──►│            │──► port ───►│ Driven adapter (email) │
                └────────────────────────┘             └────────────┘             └────────────────────────┘
```

- **Driving adapters** (left): things that *call into* the application. HTTP controller, CLI, scheduler, message-queue consumer, test harness.
- **Driven adapters** (right): things the application *calls out to*. Database repo, email sender, payment gateway.
- **Ports**: interfaces, defined and owned by the domain. Adapters implement them.

## Directory layout

```
src/
├── domain/                     # entities + value objects + domain services
├── application/                # use cases (the orchestration layer)
│   └── ports/                  # interfaces — both driving and driven
│       ├── inbound/            # driving ports (use-case interfaces the adapters call)
│       └── outbound/           # driven ports (interfaces the use cases call)
├── adapters/
│   ├── inbound/                # HTTP, CLI, queue consumer
│   │   ├── http/
│   │   └── cli/
│   └── outbound/               # DB, email, payment, external HTTP clients
│       ├── postgres/
│       └── stripe/
└── config/                     # wiring / dependency injection / main
```

## Rules

- **The domain owns the ports**, not the adapters. The DB adapter exists to satisfy the `UserRepository` port that lives in `application/ports/outbound/`.
- **Adapters depend on ports; ports never depend on adapters.** Imports go inward only.
- **Use cases don't know if they're being called from HTTP or a test.** They just take inputs and call ports.
- **Adapters are testable in isolation.** Driving adapters get a fake use case; driven adapters get a real but in-memory port.
- **Swap adapters without touching the domain.** Switching from Postgres to DynamoDB should be a new adapter + DI rewire, zero domain changes.

## When to pick this over Clean Architecture

Hexagonal and Clean are very close. Differences in practice:

- **Clean** is more prescriptive about *layers* (4 of them).
- **Hexagonal** is more prescriptive about *boundaries* (every external thing goes through a port).
- Pick Hexagonal when your project has multiple driving inputs (HTTP + queue + CLI) and/or multiple driven dependencies you want to swap (DB engines, mail providers, etc.).
- Pick Clean when your concern is layering and dependency direction more than I/O symmetry.

## What this rule will reject in review

- An HTTP controller importing a Postgres type.
- A use case `import gorm.io/gorm`.
- A port interface that returns a framework-specific type (`http.Response`, `gorm.DB`).
- An adapter that defines its own port (port belongs to the domain).
