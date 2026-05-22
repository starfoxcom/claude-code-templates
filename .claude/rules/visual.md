# Visual systems — slice discipline + smoke-test gate

Enable for projects with a UI / visual surface (web frontend, native UI, game, design tool, data visualization — anything where correctness depends on what the user **sees** in a running app).

---

## 1. Ship one verifiable slice at a time

Each slice must be:

- **Smaller than ~150 lines of net code change.** If a slice can't fit, split it further.
- **Independently visually verifiable.** Each slice produces a specific user-observable change.
- **Authored with its debug toggle in place from line 1.** The toggle is the verification primitive — don't add it after.
- **Followed by a hand-off:** commit locally → rebuild → **wait for the user to visually verify** → only then proceed to the next slice.

Anti-patterns:
- ❌ "MVP slice ships everything per the design doc, then we iterate on visuals." Each round of visual iteration cycles CI and the visual end-state never settles.
- ❌ Reporting "build clean, all tests pass" as a green light to push when the slice has any user-visible surface.
- ❌ Treating unit tests as a substitute for visual verification. They cover the algorithm, not the rendering.
- ❌ Bundling N visual subsystems into one PR — when the visual fails, the diagnosis surface is N, not 1.

**Canonical slice sequencing for a visual feature:**

1. Data layer (no visual surface yet) → unit-test only.
2. Surface skeleton with a debug toggle that renders a known pattern (a red placeholder, a "TEST" overlay, a single dummy element) → visual test: pattern is visible.
3. One channel of real data wired up, rendered as plain text or simple form → visual test: data reaches the surface.
4. Real visual rendering / styling → visual test: the intended look is achieved.
5. Live integration (re-render on data updates / route changes / state changes) → visual test: surface updates correctly.
6. Tests + cleanup → no visual change.

If a step's visual test fails, the diagnosis surface is **one step**, not seven. The previous step is the rollback point.

---

## 2. Local-iterate-then-push — never push for visual iteration

For any slice whose DoD includes a user-side visual check:

1. Implement + commit locally on the feature branch.
2. Run unit tests + headless boot. **Report results. Stop there.**
3. User does the visual smoke test.
4. If the user reports a regression, iterate locally — **keep the commits, do not push.**
5. Once the user confirms visuals look right → push + open PR + standard CI loop.

**Why:** rapid-fire visual iteration is the norm for any visual work. The PR routine review costs CI minutes per run. Holding the PR until visuals are approved keeps per-feature cost at one CI cycle instead of N.

**Edge cases:**
- **Pure-engine slice with no visual surface** — standard push-and-CI flow applies.
- **Mixed slice** (engine + visual) — default to local-iterate-then-push.
- **Routine-review fixes** that don't change visuals — push as usual.

---

## 3. Concrete visual smoke-test checklists — never "verify no regressions"

When asking the user to do a visual smoke test, hand them a **specific yes/no checklist** tied to what the change actually adds. Never ask them to "verify no regressions vs the prior baseline" — they don't have screenshot diffs in their head.

| Change shape | Checklist shape |
|---|---|
| **Config flip / default-preserving migration** | Binary boot check: "verify the app boots, renders at all sizes, no error spam in console." |
| **New visual system** | Specific yes/no list tied to what the system newly produces. |
| **Bug-fix verification** | Repro scenario: "do X, expect Y." User reports Y or not-Y. |

If you genuinely can't enumerate what to look at, that's a signal there's no visual test owed — headless boot + CI green already covered it.

---

## 4. When this rule does NOT apply

- Pure-algorithm work where the entire DoD is unit-testable.
- Refactors with no visual surface change (rename, extract, file moves).
- Bug fixes to existing visual systems where the visual is already known-good.
- Documentation / rules / ROADMAP / CI changes.
