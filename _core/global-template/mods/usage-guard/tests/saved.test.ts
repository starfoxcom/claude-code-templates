import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'
import type { SavedWork } from '../types'
import { ADOPT_GRACE_MS, ADOPT_MAX_AGE_MS } from '../hooks/arms'
import type { Pause } from '../hooks/plan'
import { KEPT_MAX_AGE_MS, parseSaved, pickSaved, shouldResumeOwn } from '../hooks/saved'
import type { World } from './world'
import { CLAIMS_DIR, doWork, endTurn, KEY, mountCard, NOW, PAUSE_FILE, RESET, start, WAKE, world } from './world'

// A session that saved its work at a pause's wrap-up and was closed before the reset: a later session in
// the same project offers the work (take it here, keep it for that session, or drop it), never by itself.

const LONG = { timeoutMs: 15_000 }
const ROOT = 'C:/Repos/my-game'
// sess-old saved its work at the wrap-up; the reset's wake passed ten minutes ago.
const SAVED: SavedWork = {
  session: 'sess-old',
  root: ROOT,
  key: KEY,
  resetsAt: RESET,
  wakeAt: NOW - 10 * 60_000,
  kinds: ['five_hour'],
}
const OLD_FILE = `${CLAIMS_DIR}/work-${KEY}-sess-old/saved.json`
const RESUME_CLAIM = `resume-${KEY}-sess-old`
const DONE: Pause = {
  status: 'done',
  kinds: ['five_hour'],
  percentUsed: 92,
  resetsAt: RESET,
  wakeAt: SAVED.wakeAt,
  triggeredBy: 'x',
}

function leaveSaved(seen: World, record: object | null = SAVED, file = OLD_FILE): void {
  seen.files.set(file, JSON.stringify(record))
}

async function offered($: Engine, seen: World) {
  const ui = await mountCard($)
  await seen.clock.advance(10)
  return ui
}

const takeOvers = (seen: World) => seen.prompts.filter(text => text.includes('take that work over here'))
const keptResumes = (seen: World) => seen.prompts.filter(text => text.includes('kept that work for this session'))

test('saved work is picked only from another session here, past its wake and recent, never kept or resumed', () => {
  const at = (ago: number) => ({ ...SAVED, wakeAt: NOW - ago })
  const context = { me: 'sess-a', root: ROOT, pause: undefined as Pause | undefined, now: NOW }
  const none = new Set<string>()
  const cases: [string, SavedWork[], Set<string>, Pause | undefined, string | undefined][] = [
    ['another session, ten minutes past', [SAVED], none, undefined, 'sess-old'],
    ["this session's own", [{ ...SAVED, session: 'sess-a' }], none, undefined, undefined],
    ['another project', [{ ...SAVED, root: 'C:/Repos/other' }], none, undefined, undefined],
    [
      'the same project, spelled another way',
      [{ ...SAVED, root: 'c:\\Repos\\my-game\\' }],
      none,
      undefined,
      'sess-old',
    ],
    ['kept for its own session', [{ ...SAVED, isKept: true }], none, undefined, undefined],
    ['already resumed', [SAVED], new Set([RESUME_CLAIM]), undefined, undefined],
    ['inside the grace', [at(ADOPT_GRACE_MS - 1)], none, undefined, undefined],
    ['at the grace', [at(ADOPT_GRACE_MS)], none, undefined, 'sess-old'],
    ['at the age bound', [at(ADOPT_MAX_AGE_MS)], none, undefined, 'sess-old'],
    ['past the age bound', [at(ADOPT_MAX_AGE_MS + 1)], none, undefined, undefined],
    ['a wake still ahead', [at(-60_000)], none, undefined, undefined],
    ['its pause was cancelled', [SAVED], none, { ...DONE, status: 'cancelled' }, undefined],
    ['its pause moved to a later wake', [SAVED], none, { ...DONE, status: 'active', wakeAt: NOW + 60_000 }, undefined],
    ['a later pause stands', [SAVED], none, { ...DONE, resetsAt: '2026-10-09T19:00:00.000Z' }, 'sess-old'],
    ['the newest of two', [at(3_600_000), { ...SAVED, session: 'sess-new' }], none, undefined, 'sess-new'],
  ]
  for (const [label, records, claims, pause, owner] of cases)
    expect([label, pickSaved(records, claims, { ...context, pause })?.record.session]).toEqual([label, owner])
})

test('a record reads back, and a dropped or broken one reads as none', () => {
  expect(parseSaved(JSON.stringify(SAVED))).toEqual(SAVED)
  for (const text of ['null', '', '{', JSON.stringify({ ...SAVED, wakeAt: 'soon' })])
    expect(parseSaved(text)).toBeUndefined()
})

test('only kept work resumes its own session, within a week of the wake', () => {
  const kept = { ...SAVED, isKept: true }
  expect(shouldResumeOwn(kept, undefined, NOW)).toBe(true)
  expect(shouldResumeOwn(SAVED, undefined, NOW)).toBe(false)
  expect(shouldResumeOwn({ ...kept, wakeAt: NOW - KEPT_MAX_AGE_MS }, undefined, NOW)).toBe(true)
  expect(shouldResumeOwn({ ...kept, wakeAt: NOW - KEPT_MAX_AGE_MS - 1 }, undefined, NOW)).toBe(false)
  expect(shouldResumeOwn(kept, { ...DONE, status: 'cancelled' }, NOW)).toBe(false)
})

test('the wrap-up files the saved work in its claim, naming the project', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  const record = parseSaved(seen.files.get(`${CLAIMS_DIR}/work-${KEY}-sess-a/saved.json`) ?? '')
  const expected = { session: 'sess-a', root: ROOT, key: KEY, resetsAt: RESET, wakeAt: WAKE, kinds: ['five_hour'] }
  expect(record).toEqual(expected)
})

test('a session that changed nothing files no saved work', async ($, on) => {
  const seen = world(on)
  await start($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  expect([...seen.files.keys()].filter(path => path.startsWith(CLAIMS_DIR))).toEqual([])
})

test('taking saved work over claims its resume, clears it and submits the resume', LONG, async ($, on) => {
  const seen = world(on)
  leaveSaved(seen)
  await start($)
  const ui = await offered($, seen)
  expect(await ui.find({ type: 'Text', text: /saved its work at the 5-hour wrap-up/ })).toBeDefined()
  expect(takeOvers(seen)).toEqual([])
  await ui.press({ key: 'usage-adopt-take' })
  await seen.clock.advance(1_000)
  expect(seen.claims.has(RESUME_CLAIM)).toBe(true)
  expect(seen.files.get(OLD_FILE)).toBe('null')
  const [prompt] = takeOvers(seen)
  expect(prompt).toContain('Continue the pending work now')
  expect(prompt).toContain('mods-data/tasks/sess-old.json')
  await ui.press({ key: 'usage-adopt-ok' })
  expect(await ui.find({ key: 'usage-adopt' })).toBeUndefined()
})

test('keeping saved work marks it for its session, which resumes it when opened again', LONG, async ($, on) => {
  const seen = world(on)
  leaveSaved(seen)
  await start($)
  const ui = await offered($, seen)
  await ui.press({ key: 'usage-adopt-keep' })
  await seen.clock.advance(1_000)
  expect(parseSaved(seen.files.get(OLD_FILE) ?? '')?.isKept).toBe(true)
  expect(seen.claims.has(RESUME_CLAIM)).toBe(false)
  expect(takeOvers(seen)).toEqual([])
  await ui.press({ key: 'usage-adopt-ok' })
  await seen.clock.advance(10)
  expect(await ui.find({ key: 'usage-adopt' })).toBeUndefined()
})

test('the kept session, opened again, resumes its own work once', LONG, async ($, on) => {
  const seen = world(on)
  seen.sessionId = 'sess-old'
  leaveSaved(seen, { ...SAVED, isKept: true })
  await start($)
  await seen.clock.advance(1_000)
  expect(keptResumes(seen)).toHaveLength(1)
  expect(seen.claims.has(RESUME_CLAIM)).toBe(true)
  expect(seen.files.get(OLD_FILE)).toBe('null')
})

test('saved work nobody kept does not resume its session when opened again', LONG, async ($, on) => {
  const seen = world(on)
  seen.sessionId = 'sess-old'
  leaveSaved(seen)
  await start($)
  await seen.clock.advance(1_000)
  expect(seen.prompts).toEqual([])
  expect(seen.files.get(OLD_FILE)).toBe(JSON.stringify(SAVED))
})

test('dropping saved work clears it without a resume', LONG, async ($, on) => {
  const seen = world(on)
  leaveSaved(seen)
  await start($)
  const ui = await offered($, seen)
  await ui.press({ key: 'usage-adopt-drop' })
  await seen.clock.advance(1_000)
  expect(seen.files.get(OLD_FILE)).toBe('null')
  expect(seen.prompts).toEqual([])
})

test('saved work taken elsewhere after the offer showed is not resumed twice', LONG, async ($, on) => {
  const seen = world(on)
  leaveSaved(seen)
  await start($)
  const ui = await offered($, seen)
  seen.claims.add(RESUME_CLAIM)
  await ui.press({ key: 'usage-adopt-take' })
  await seen.clock.advance(1_000)
  expect(takeOvers(seen)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^Another session already resumed that work\.$/ })).toBeDefined()
})

for (const key of ['usage-adopt-take', 'usage-adopt-keep', 'usage-adopt-drop']) {
  test(`saved work kept elsewhere after the offer showed is left alone by ${key}`, LONG, async ($, on) => {
    const seen = world(on)
    leaveSaved(seen)
    await start($)
    const ui = await offered($, seen)
    leaveSaved(seen, { ...SAVED, isKept: true })
    await ui.press({ key })
    await seen.clock.advance(1_000)
    expect(seen.files.get(OLD_FILE)).toBe(JSON.stringify({ ...SAVED, isKept: true }))
    expect(seen.claims.has(RESUME_CLAIM)).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^That saved work changed meanwhile/ })).toBeDefined()
  })
}

test('saved work a closed session misses shows just past the reset, with no 15-minute wait', LONG, async ($, on) => {
  const seen = world(on)
  const pause: Pause = { ...DONE, status: 'active', wakeAt: WAKE }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  leaveSaved(seen, { ...SAVED, wakeAt: WAKE })
  await start($)
  const ui = await offered($, seen)
  expect(await ui.find({ key: 'usage-adopt' })).toBeUndefined()
  await seen.clock.advance(WAKE - NOW + ADOPT_GRACE_MS + 1_000)
  expect(await ui.find({ key: 'usage-adopt-take' })).toBeDefined()
})

test('from the phone, the text names saved work and /usage-guard adopt keep keeps it', LONG, async ($, on) => {
  const seen = world(on)
  leaveSaved(seen)
  await start($)
  const phone = await $.command.run({ command: 'usage-guard', args: 'phone' } as never)
  expect(String((phone as { text?: string }).text)).toContain('/usage-guard adopt keep leaves it for that session')
  const answer = await $.command.run({ command: 'usage-guard', args: 'adopt keep' } as never)
  expect((answer as { text?: string }).text).toBe('Kept: that session resumes the work when you open it again.')
  expect(parseSaved(seen.files.get(OLD_FILE) ?? '')?.isKept).toBe(true)
  const again = await $.command.run({ command: 'usage-guard', args: 'adopt' } as never)
  expect((again as { text?: string }).text).toBe('No closed session in this project has a missed resume.')
})
