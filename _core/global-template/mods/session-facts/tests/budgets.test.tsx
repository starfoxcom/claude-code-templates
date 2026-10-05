import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import {
  barSvg,
  cacheChip,
  compactedMark,
  contextChip,
  contextParts,
  contextText,
  fillTone,
  pauseChip,
  phoneText,
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
  {
    name: 'unknown fill right after a compaction',
    b: { tokens: undefined, compactedAt: NOW },
    text: /^ctx -- · just compacted 09:00$/,
  },
]

for (const { name, b, text, color } of CONTEXT_CASES) {
  test(`contextChip: ${name}`, () => {
    const chip = contextChip({ ...B, ...b }, NOW)
    expect(chip.text).toMatch(text)
    expect(chip.color).toBe(color)
  })
}

test('the Desktop bar fills the same share in the same tone, clamped to its track', () => {
  const fill = (svg: string) => /<rect x="0" y="2" width="(\d+)" height="6" rx="3" fill="(#\w+)"\/>/.exec(svg)
  expect(fill(barSvg(0, 'green'))).toBeNull()
  expect(fill(barSvg(0.5, 'green'))?.slice(1)).toEqual(['40', '#3fb950'])
  expect(fill(barSvg(0.8, 'yellow'))?.slice(1)).toEqual(['64', '#d29922'])
  expect(fill(barSvg(1.3, 'red'))?.slice(1)).toEqual(['80', '#f85149'])
  expect(barSvg(0.5, 'green')).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="80" height="10"/)
})

test('fillTone: green, then yellow at three quarters, red at nine tenths', () => {
  const cases: [number, string][] = [
    [0, 'green'],
    [0.7499, 'green'],
    [0.75, 'yellow'],
    [0.8999, 'yellow'],
    [0.9, 'red'],
    [1.2, 'red'],
  ]
  for (const [ratio, tone] of cases) expect([ratio, fillTone(ratio)]).toEqual([ratio, tone])
})

test('the bar takes the fill tone, the empty cells gray; the facts line draws them as squares', () => {
  // 250k of a 467k compaction point: 5 of 10 cells, calm.
  expect(contextParts(250_000, 500_000, 467_000)).toEqual([
    { text: 'ctx ' },
    { text: '▰▰▰▰▰', color: 'green', isCell: true },
    { text: '▱▱▱▱▱', color: 'gray', isCell: true },
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

test('cacheChip: hidden while warm, then a countdown naming the cold start, then likely expired', () => {
  const cold = { text: 'cache likely expired · cold start 250k', color: 'red' }
  expect(cacheChip({ ...B, cacheExpiresAt: NOW + 11 * MINUTE }, NOW)).toBeUndefined()
  const countdown = { text: 'cache 10m left · cold start 250k', color: 'yellow' }
  expect(cacheChip({ ...B, cacheExpiresAt: NOW + 10 * MINUTE }, NOW)).toEqual(countdown)
  expect(cacheChip({ ...B, cacheExpiresAt: NOW + MINUTE - 1 }, NOW)).toEqual(cold)
  expect(cacheChip({ ...B, cacheExpiresAt: NOW - MINUTE }, NOW)).toEqual(cold)
  expect(cacheChip({ ...B, cacheExpiresAt: undefined }, NOW)).toBeUndefined()
})

const WARM_FOR_AN_HOUR = { ...B, cacheExpiresAt: NOW + 60 * MINUTE }
const NOTICE_CASES: { name: string; check: Budgets['cacheCheck']; chip?: { text: string; color?: string } }[] = [
  { name: 'a warm check says nothing', check: { at: NOW, resent: 1_000 } },
  { name: 'an expected miss says nothing', check: { at: NOW, resent: 230_000, miss: 'expected' } },
  {
    name: 'an expiry is confirmed, uncolored',
    check: { at: NOW - 15 * MINUTE + 1, resent: 230_000, miss: 'expired' },
    chip: { text: 'cache expired · resent 230k', color: undefined },
  },
  {
    name: 'an early break needs an eye',
    check: { at: NOW, resent: 230_000, miss: 'early' },
    chip: { text: 'cache broke early · resent 230k', color: 'yellow' },
  },
  { name: 'gone after a quarter hour', check: { at: NOW - 15 * MINUTE, resent: 230_000, miss: 'early' } },
]

for (const { name, check, chip } of NOTICE_CASES) {
  test(`cacheChip: ${name}`, () => {
    expect(cacheChip({ ...WARM_FOR_AN_HOUR, cacheCheck: check }, NOW)).toEqual(chip)
  })
}

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
    // No compaction point here, so the bar fills against the window: 5 of 10 cells, green. Desktop draws
    // the same half, in the same green, as one bar instead of cells.
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: '▰▰▰▰▰', color: 'green' } as never)).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '▱▱▱▱▱', color: 'gray' } as never)).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Text', text: /[▰▱]/ })).toBeUndefined()
      const bar = (await ui.find({ type: 'Svg' })) as never as { props: Record<string, unknown> } | undefined
      expect(bar?.props.source).toBe(barSvg(0.5, 'green'))
      expect(bar?.props.alt).toBe('context 50% of the way to compaction')
    }
    expect(await ui.find({ type: 'Text', text: / 50%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 80% → resets Fri 14:00/, color: 'red' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /week 20%/ })).toBeDefined()
  })

  test(`${surface}: in a narrow band each chip wraps whole, and only one wider than the band is cut`, async ($, on) => {
    world(on)
    await start($, surface)
    const ui = await $.ui.mount({ plugin: 'session-facts', surface, component: 'AbovePrompt', props: PROPS })
    const props = async (key: string) =>
      ((await ui.find({ key })) as never as { props: Record<string, unknown> } | undefined)?.props
    expect((await props('session-facts-row'))?.flexWrap).toBe('wrap')
    for (const key of ['session-facts-chip-0', 'session-facts-chip-1', 'session-facts-chip-2'])
      expect(await props(key)).toEqual(expect.objectContaining({ flexShrink: 1, minWidth: 0 }))
    const week = (await ui.find({ type: 'Text', text: /week 20%/ })) as never as { props: Record<string, unknown> }
    expect(week.props.wrap).toBe('truncate-end')
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

test('the phone text is the row as squares, with every reset time and the cache time left', () => {
  const limits = [
    { kind: 'five_hour', percentUsed: 12, resetsAt: NOW + 120 * MINUTE },
    { kind: 'seven_day', percentUsed: 80, resetsAt: NOW + 24 * 60 * MINUTE },
  ]
  expect(phoneText({ ...B, limits, cacheExpiresAt: NOW + 42 * MINUTE }, NOW).split('\n')).toEqual([
    '📊 Budgets · 09:00',
    'ctx 🟩🟩🟩🟩🟩⬜⬜⬜⬜⬜ 50% · 217k to compact',
    '5-hour 🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜ 12% · resets Fri 11:00',
    'week 🟨🟨🟨🟨🟨🟨🟨🟨⬜⬜ 80% · resets Sat 09:00',
    'cache: warm · 42m left',
  ])
})

test('the phone text says -- for what is unknown, and the pause in place of the plan lines', () => {
  expect(phoneText({ ...B, tokens: undefined }, NOW).split('\n').slice(1)).toEqual([
    'ctx --',
    '5-hour --',
    'week --',
    'cache --',
  ])
  const paused = { ...B, pausedUntil: NOW + 180 * MINUTE, cacheExpiresAt: NOW + 5 * MINUTE }
  expect(phoneText(paused, NOW).split('\n').slice(2)).toEqual([
    '🟥 PAUSED until Fri 12:00',
    '🟨 cache 5m left · cold start 250k',
  ])
})
