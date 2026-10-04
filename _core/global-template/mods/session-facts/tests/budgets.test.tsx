import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import {
  cacheChip,
  compactedMark,
  contextChip,
  contextParts,
  contextText,
  fillTone,
  pauseChip,
  planChip,
  shortLocal,
} from '../hooks/budgets'
import type { Budgets } from '../types'

// 2026-10-02 16:00 UTC: 09:00 on a Friday at a UTC-7 host.
const NOW = Date.UTC(2026, 9, 2, 16, 0, 0)
const MINUTE = 60_000
const B: Budgets = {
  tokens: 250_000,
  size: 500_000,
  compactsAt: 467_000,
  limits: [],
  offsetMinutes: 420,
  planWarnAt: 75,
  wrapUpAt: 90,
  cacheWarnMinutes: 10,
}

test('shortLocal: weekday and time in the host zone', () => {
  expect(shortLocal(NOW, 420)).toBe('Fri 09:00')
  expect(shortLocal(NOW, -600)).toBe('Sat 02:00')
  expect(shortLocal(NOW, 0)).toBe('Fri 16:00')
})

const CONTEXT_CASES: { name: string; b: Partial<Budgets>; text: RegExp; color?: string }[] = [
  { name: 'unknown before a response', b: { tokens: undefined }, text: /^ctx --$/ },
  { name: 'calm', b: { tokens: 250_000 }, text: /50% · 217k to compact$/ },
  { name: 'one step under yellow', b: { tokens: 350_000 }, text: /70%/ },
  { name: 'yellow at three quarters of the compaction point', b: { tokens: 350_250 }, text: /70%/, color: 'yellow' },
  { name: 'red at nine tenths', b: { tokens: 420_300 }, text: /84%/, color: 'red' },
  { name: 'past the point reads 0k left', b: { tokens: 480_000 }, text: /0k to compact$/, color: 'red' },
  { name: 'no compaction point falls back to the window', b: { compactsAt: undefined }, text: /^ctx \S+ 50%$/ },
  {
    name: 'a compaction minutes ago is named after the fill',
    b: { tokens: 40_000, compactedAt: NOW - 5 * MINUTE },
    text: /^ctx ▰▱▱▱▱▱▱▱▱▱ 8% · 427k to compact · just compacted 08:55$/,
  },
  { name: 'unknown fill right after a compaction', b: { tokens: undefined, compactedAt: NOW }, text: /^ctx -- · just compacted 09:00$/ },
]

for (const { name, b, text, color } of CONTEXT_CASES) {
  test(`contextChip: ${name}`, () => {
    const chip = contextChip({ ...B, ...b }, NOW)
    expect(chip.text).toMatch(text)
    expect(chip.color).toBe(color)
  })
}

test('fillTone: green, then yellow at three quarters, red at nine tenths', () => {
  const cases: [number, string][] = [[0, 'green'], [0.7499, 'green'], [0.75, 'yellow'], [0.8999, 'yellow'], [0.9, 'red'], [1.2, 'red']]
  for (const [ratio, tone] of cases) expect([ratio, fillTone(ratio)]).toEqual([ratio, tone])
})

test('the bar takes the fill tone, the empty cells gray; the facts line draws them as squares', () => {
  // 250k of a 467k compaction point: 5 of 10 cells, calm.
  expect(contextParts(250_000, 500_000, 467_000)).toEqual([
    { text: 'ctx ' },
    { text: '▰▰▰▰▰', color: 'green' },
    { text: '▱▱▱▱▱', color: 'gray' },
    { text: ' 50% · 217k to compact' },
  ])
  expect(contextText(250_000, 500_000, 467_000, true)).toBe('ctx 🟩🟩🟩🟩🟩⬜⬜⬜⬜⬜ 50% · 217k to compact')
  expect(contextText(360_000, 500_000, 467_000, true)).toBe('ctx 🟨🟨🟨🟨🟨🟨🟨🟨⬜⬜ 72% · 107k to compact')
  expect(contextText(440_000, 500_000, 467_000, true)).toBe('ctx 🟥🟥🟥🟥🟥🟥🟥🟥🟥⬜ 88% · 27k to compact')
  expect(contextText(undefined, 500_000, 467_000, true)).toBe('ctx --')
})

test('compactedMark: a quarter hour after the compaction, then nothing', () => {
  const cases: [number | undefined, string][] = [
    [undefined, ''],
    [NOW, ' · just compacted 09:00'],
    [NOW - 15 * MINUTE + 1, ' · just compacted 08:45'],
    [NOW - 15 * MINUTE, ''],
  ]
  for (const [at, expected] of cases) expect([at, compactedMark(at, 420, NOW)]).toEqual([at, expected])
})

const RESET = Date.UTC(2026, 9, 2, 21, 0, 0)
const PLAN_CASES: { used: number; text: string; color?: string }[] = [
  { used: 0, text: '5h 0%' },
  { used: 74, text: '5h 74%' },
  { used: 75, text: '5h 75% → resets Fri 14:00', color: 'yellow' },
  { used: 89, text: '5h 89% → resets Fri 14:00', color: 'yellow' },
  { used: 90, text: '5h 90% → resets Fri 14:00', color: 'red' },
  { used: 100, text: '5h 100% → resets Fri 14:00', color: 'red' },
]

for (const { used, text, color } of PLAN_CASES) {
  test(`planChip: ${used}%`, () => {
    expect(planChip({ kind: 'five_hour', percentUsed: used, resetsAt: RESET }, B)).toEqual({ text, color })
  })
}

test('planChip: an unknown window keeps its own name', () => {
  expect(planChip({ kind: 'seven_day_opus', percentUsed: 3 }, B).text).toBe('seven-day-opus 3%')
})

test('cacheChip: hidden while warm, a countdown near the end, then cold', () => {
  expect(cacheChip({ ...B, cacheExpiresAt: NOW + 11 * MINUTE }, NOW)).toBeUndefined()
  expect(cacheChip({ ...B, cacheExpiresAt: NOW + 10 * MINUTE }, NOW)).toEqual({ text: 'cache 10m', color: 'yellow' })
  expect(cacheChip({ ...B, cacheExpiresAt: NOW + MINUTE - 1 }, NOW)).toEqual({ text: 'cache cold', color: 'red' })
  expect(cacheChip({ ...B, cacheExpiresAt: NOW - MINUTE }, NOW)).toEqual({ text: 'cache cold', color: 'red' })
  expect(cacheChip({ ...B, cacheExpiresAt: undefined }, NOW)).toBeUndefined()
})

test('pauseChip: only while the pause is still ahead', () => {
  expect(pauseChip({ ...B, pausedUntil: NOW + MINUTE }, NOW)?.text).toBe('PAUSED → Fri 09:01')
  expect(pauseChip({ ...B, pausedUntil: NOW }, NOW)).toBeUndefined()
})

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never

function world(on: On, pause?: object) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '420 America/Phoenix\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 250_000, window: 500_000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 80, resetsAt: '2026-10-02T21:00:00Z' },
        { kind: 'seven_day', percentUsed: 20, resetsAt: '2026-10-04T18:00:00Z' },
      ],
    },
  }))
  on('settings.read', () => ({ value: { pluginConfigs: { 'usage-guard': { options: { wrapUpAt: 80 } } } } }) as never)
  on('fs.read', ($, e) => {
    if (!pause || !e.path.replaceAll('\\', '/').endsWith('usage-guard/pause.json')) throw new Error('ENOENT')
    return { value: JSON.stringify(pause) }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return clock
}

async function start($: Engine, surface: 'terminal' | 'desktop'): Promise<void> {
  if (surface === 'terminal') {
    await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
    return
  }
  await $.session.start({ cwd: 'C:/repo', surface: null, isInteractive: false } as never)
  await $.session.attach({ surface: 'desktop', clientId: 'app' } as never)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the row shows context and both plan windows, red at usage-guard's level`, async ($, on) => {
    world(on)
    await start($, surface)
    const ui = await $.ui.mount({ plugin: 'session-facts', surface, component: 'AbovePrompt', props: PROPS })
    // No compaction point here, so the bar fills against the window: 5 of 10 cells, green.
    expect(await ui.find({ type: 'Text', text: '▰▰▰▰▰', color: 'green' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▱▱▱▱▱', color: 'gray' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 50%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 80% → resets Fri 14:00/, color: 'red' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /week 20%/ })).toBeDefined()
  })

  test(`${surface}: a usage-guard pause replaces the plan chips`, async ($, on) => {
    world(on, { status: 'active', wakeAt: NOW + 60 * MINUTE })
    await start($, surface)
    const ui = await $.ui.mount({ plugin: 'session-facts', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /PAUSED → Fri 10:00/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 80%/ })).toBeUndefined()
  })

  test(`${surface}: a compaction is named on the row for a quarter hour`, async ($, on) => {
    const clock = world(on)
    on('session.compact', () => ({ messages: [{ role: 'user', text: 'SUMMARY', toolUses: [] }] }) as never)
    await start($, surface)
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'old', toolUses: [] }] } as never)
    // The row's 30-second refresh picks the compaction up.
    await clock.advance(30_000)
    const ui = await $.ui.mount({ plugin: 'session-facts', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: ' · just compacted 09:00' })).toBeDefined()
    await clock.advance(15 * MINUTE)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /just compacted/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: ' 50%' })).toBeDefined()
  })
}
