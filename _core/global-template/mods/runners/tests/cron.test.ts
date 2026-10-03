import { expect, test } from 'claude-code/testing'

import { cronsIn, nextRun, parseCron, soonestRun } from '../hooks/cron'

// Friday 2026-10-02 17:00:30 UTC.
const NOW = Date.UTC(2026, 9, 2, 17, 0, 30)
const at = (expr: string, after = NOW) => {
  const cron = parseCron(expr)
  if (!cron) throw new Error(`did not parse: ${expr}`)
  const next = nextRun(cron, after)
  return next === null ? null : new Date(next).toISOString()
}

test('the next minute that matches, strictly after now', () => {
  const cases: [string, string][] = [
    ['* * * * *', '2026-10-02T17:01:00.000Z'],
    ['0 * * * *', '2026-10-02T18:00:00.000Z'],
    ['0 17 * * *', '2026-10-03T17:00:00.000Z'],
    ['59 23 * * *', '2026-10-02T23:59:00.000Z'],
    ['*/15 * * * *', '2026-10-02T17:15:00.000Z'],
    ['0 9-17/4 * * *', '2026-10-03T09:00:00.000Z'],
    ['30 3 1 * *', '2026-11-01T03:30:00.000Z'],
    ['0 0 1 1 *', '2027-01-01T00:00:00.000Z'],
    ['0 6 * * 1', '2026-10-05T06:00:00.000Z'],
    ['0 6 * * 1-5', '2026-10-05T06:00:00.000Z'],
    ['0 6 * * 0', '2026-10-04T06:00:00.000Z'],
    ['0 6 * * 7', '2026-10-04T06:00:00.000Z'],
    ['5,35 17 * * *', '2026-10-02T17:05:00.000Z'],
  ]
  for (const [expr, expected] of cases) expect([expr, at(expr)]).toEqual([expr, expected])
})

test('a restricted day of month and day of week match either one', () => {
  // The 15th, or any Monday: Monday the 5th comes first.
  expect(at('0 0 15 * 1')).toBe('2026-10-05T00:00:00.000Z')
})

test('a schedule that never fires has no next run', () => {
  expect(at('0 0 30 2 *')).toBeNull()
})

test('malformed expressions do not parse', () => {
  const bad = ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '0 0 0 * *', '*/0 * * * *', 'a * * * *']
  for (const expr of [...bad, '5-1 * * * *']) expect([expr, parseCron(expr)]).toEqual([expr, null])
})

test('a range or list element with a missing number does not parse', () => {
  // GitHub refuses these, so the workflow never runs and no time may be shown for it.
  const bad = ['/5 * * * *', '-5 * * * *', '0,,5 * * * *', '0, * * * *', '1-/2 * * * *', '0 0 1 * 1-', '*/ * * * *']
  for (const expr of bad) expect([expr, parseCron(expr)]).toEqual([expr, null])
  expect(at('5/10 17 * * *')).toBe('2026-10-02T17:05:00.000Z')
  // `5/10` runs on to the end of the hour, not only at :05.
  expect(at('5/10 17 * * *', NOW + 5 * 60_000)).toBe('2026-10-02T17:15:00.000Z')
})

test('cron lines are read from workflow text, quoted or not', () => {
  const workflow = [
    'on:',
    '  schedule:',
    "    - cron: '0 6 * * 1'",
    '    - cron: "30 2 * * *"  # nightly',
    '    - cron: 15 4 1 * *',
    '  push:',
  ].join('\n')
  expect(cronsIn(workflow)).toEqual(['0 6 * * 1', '30 2 * * *', '15 4 1 * *'])
})

test('the soonest run across workflows, skipping a bad expression', () => {
  const nightly = "on:\n  schedule:\n    - cron: '30 2 * * *'\n"
  const weekly = "on:\n  schedule:\n    - cron: '0 6 * * 1'\n    - cron: 'bad cron here x'\n"
  expect(new Date(soonestRun([weekly, nightly], NOW) ?? 0).toISOString()).toBe('2026-10-03T02:30:00.000Z')
  expect(soonestRun(['on: push'], NOW)).toBeNull()
})
