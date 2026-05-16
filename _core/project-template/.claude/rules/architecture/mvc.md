# Architecture — MVC (Model-View-Controller)

Classic three-role split, most useful for server-rendered web apps and traditional desktop GUIs.

## Roles

- **Model** — data + business rules + state. Loads/saves itself; enforces invariants. Knows nothing about how it's displayed.
- **View** — renders the model. Templates, components, or GUI widgets. No business logic.
- **Controller** — receives input (HTTP request, button click), updates the model, picks the view to render.

## Directory layout (web example)

```
src/
├── controllers/
│   ├── orders_controller.{ext}
│   └── users_controller.{ext}
├── models/
│   ├── order.{ext}
│   └── user.{ext}
├── views/
│   ├── orders/
│   │   ├── index.{ext}
│   │   └── show.{ext}
│   └── users/
│       └── ...
├── routes.{ext}        # URL → controller#action map
└── helpers/            # view helpers (formatters, etc.)
```

## Rules

- **One controller per resource / use-case group.** `OrdersController` handles `index/show/create/update/destroy`, not "all the buttons in the UI".
- **Controllers are thin.** Their job is parse input → call model → pick view. Business logic goes in the model, not the controller. ("Skinny controller, fat model.")
- **Models enforce invariants.** Validation that "a user must have an email" lives on the model, not the controller and not the view.
- **Views are pure presentation.** No DB queries, no `User.find()` in a template. Pass the data the view needs from the controller.
- **Routes are explicit.** Don't auto-magic-route — make routing readable.

## Variants worth knowing

- **MVP (Model-View-Presenter)** — like MVC but the presenter mediates the view, view is dumber. Used in desktop UI.
- **MVVM (Model-View-ViewModel)** — view binds to a view-model that exposes observable state. Used in WPF / SwiftUI / Vue / Angular.
- **Modern web "MVC"** (Rails, Django, Laravel) — controllers + ORM models + templates. The shape this rule describes.

## When this fits

- Server-rendered web apps (Rails, Django, Laravel, ASP.NET MVC).
- Admin dashboards.
- Apps where the framework already imposes MVC and fighting it is pointless.

## When NOT to pick this

- Single-page apps with rich client-side state — MVVM or component-based (React + state) fits better.
- API-only services with no views — Layered or Clean is cleaner.
- Domain-rich apps — fat models become unmanageable; reach for DDD or Hexagonal.

## The "fat model" failure mode

MVC's biggest pitfall: when controllers stay thin, models accumulate every operation that touches data — they become 2,000-line god objects. Mitigations:

- **Service objects** for multi-step operations (`OrderCheckout.call(order, payment_method)`).
- **Query objects** for complex DB queries (`OverdueInvoicesQuery.new.results`).
- **Form objects** for input validation that spans models.
- **Decorators / presenters** for view-specific formatting.

If the codebase keeps reaching for these escape hatches, that's the signal MVC is no longer fitting — consider promoting to layered/feature-based/clean.

## What this rule will reject in review

- A view containing `User.where(...)` or any DB query.
- A controller with > ~30 lines per action — split into a service object or extract to model methods.
- Business logic in routes (e.g., conditional routing based on user role; that belongs in a controller or middleware).
- Multiple controllers writing the same model state through different paths without a service object — race conditions waiting to happen.
