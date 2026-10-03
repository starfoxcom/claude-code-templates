import { expect, test } from 'claude-code/testing'

import { clockTime, mergeReading, rowText } from '../hooks/register'
import type { RunnerView } from '../types'

// The shipped runner list is empty and the mod under test loads its own copy of rules.ts, so the row
// is tested through rowText, and the hooks only for drawing nothing without runners.
const NOW = Date.UTC(2026, 9, 2, 17, 0, 0)
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const ON: RunnerView = { label: 'runners', isOn: true, online: 4, busy: 1, queued: 2, nextRun: NOW + 3_600_000 }

test('the row names state, online and busy runners, queued runs and the scheduled time', () => {
  expect(rowText(ON, NOW, hhmm)).toBe('runners on · 4 online · 1 busy · 2 queued · scheduled 18:00')
  expect(rowText({ label: 'runners', isOn: false, online: 0 }, NOW, hhmm)).toBe('runners off · 0 online')
  expect(rowText({ label: 'local', isOn: true }, NOW, hhmm)).toBe('local on')
})

test('a runner started under two minutes ago shows as starting, not offline', () => {
  const fresh: RunnerView = { label: 'runners', isOn: true, online: 0, startedAt: NOW - 119_999 }
  expect(rowText(fresh, NOW, hhmm)).toBe('runners on · starting')
  expect(rowText({ ...fresh, startedAt: NOW - 120_000 }, NOW, hhmm)).toBe('runners on · 0 online')
  expect(rowText({ ...fresh, online: 3 }, NOW, hhmm)).toBe('runners on · 3 online')
})

test('the scheduled time shows in the local zone, or says UTC when the zone is unknown', () => {
  const nightly = Date.UTC(2026, 9, 3, 2, 30)
  // getTimezoneOffset is minutes behind UTC: 360 is UTC-6.
  expect(clockTime(nightly, 360)).toBe('20:30')
  expect(clockTime(nightly, -330)).toBe('08:00')
  expect(clockTime(nightly, 0)).toBe('02:30')
  expect(clockTime(nightly, null)).toBe('02:30 UTC')
})

test('a reading keeps a Start or Stop pressed while it was being taken', () => {
  const reading: RunnerView[] = [{ label: 'runners', isOn: true, online: 0 }]
  const pressed: RunnerView[] = [{ label: 'runners', isOn: true, startedAt: NOW, isConfirming: true }]
  expect(mergeReading(reading, pressed)).toEqual([{ ...reading[0], startedAt: NOW, isConfirming: true }])
  // The confirm question ends once the runner is off; nothing pressed keeps nothing.
  const off: RunnerView[] = [{ label: 'runners', isOn: false }]
  expect(mergeReading(off, pressed)).toEqual([{ ...off[0], startedAt: NOW, isConfirming: false }])
  expect(mergeReading(reading, undefined)).toEqual([{ ...reading[0], startedAt: undefined, isConfirming: false }])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`with no runners listed the band draws nothing of its own on ${surface}`, async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('ui.render', () => ({ type: 'Box', props: { key: 'beneath' }, children: [] }) as never)
    await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
    const props = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
    const ui = await $.ui.mount({ plugin: 'runners', surface, component: 'AbovePrompt', props })
    expect(await ui.find({ key: 'beneath' })).toBeDefined()
    expect(await ui.find({ key: 'runner-0' })).toBeUndefined()
  })
}
