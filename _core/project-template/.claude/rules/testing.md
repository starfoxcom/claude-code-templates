---
paths:
  - "**/*.{js,jsx,ts,tsx,mjs,cjs,py,go,rs,java,kt,kts,cs,c,cc,cpp,h,hpp,swift,dart,rb,php,gd,lua,ex,exs,scala}"
---

# Testing

## Test the real code

A test calls the production function. It never re-implements the logic in the test and checks the copy against itself, and it does not mock the unit under test. Mock only what the unit talks to (network, clock, disk) and only when the real thing is slow or unavailable.

## Cover the edges on purpose

- For logic with ranges or branches, write a table of cases: each boundary, one step either side of it, empty input and the largest supported input.
- For logic with many inputs, add a seeded randomized sweep. Print the seed on failure so the case can be replayed.
- When fixing a bug, first add the test that fails on the old code, then fix. Keep that test.
- When replacing a formula or algorithm, keep a check that the case table still catches the old, wrong version. If the old version passes the table, the table is too weak.

## Tiers

- **Every PR:** fast tests only, a few minutes at most.
- **Nightly or weekly:** slow suites (long sweeps, integration, performance). A red scheduled run must open or update an issue, because nothing else will surface it.

## Coverage

Coverage is a report, never a merge gate. A gate rewards tests that execute lines without checking results. Use the report to find untested code worth testing.

## Flaky tests

A flaky test is a bug. Quarantine it in the same PR that notices it (skip with a linked issue), then fix it. Never re-run until green and merge.
