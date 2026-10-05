import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'
import { ADOPT_GRACE_MS, ADOPT_MAX_AGE_MS, parseSavedArm, pickOffer } from '../hooks/arms'
import type { World } from './world'
import { ARM_FILE, ARMS_DIR, mountCard, NOW, RESET, start, world } from './world'

// A closed session's arm that never ran: a later session in the same project offers it, and resumes it
// only when the person says so.

const LONG = { timeoutMs: 15_000 }
const ROOT = 'C:/Repos/my-game'
const OTHER_SPELLING = 'c:\\Repos\\my-game\\'
const OLD_FILE = `${ARMS_DIR}/sess-old.json`
// The arm session sess-old saved before it was closed: its wake passed ten minutes ago.
const MISSED = { kind: 'five_hour', resetsAt: RESET, wakeAt: NOW - 10 * 60_000, armedIn: 'sess-old', root: ROOT }
// The claim the arm's own session takes when its wake fires: one resume per arm, wherever it runs.
const ARM_CLAIM = `arm-${Date.parse(RESET)}-sess-old`

function leaveMissedArm(seen: World, arm: object = MISSED): void {
  seen.files.set(OLD_FILE, JSON.stringify(arm))
}

// The first draw starts the look through the arms folder; its timer then finds the offer.
async function offered($: Engine, seen: World) {
  const ui = await mountCard($)
  await seen.clock.advance(10)
  return ui
}

const adoptPrompts = (seen: World) => seen.prompts.filter(text => text.includes('the person chose to resume it here'))

test('a missed arm is picked only from another session in this project, past its wake and recent', () => {
  const file = (name: string, arm: object | null) => ({ name, text: JSON.stringify(arm) })
  const at = (ago: number) => ({ ...MISSED, wakeAt: NOW - ago })
  const cases: [string, { name: string; text: string }[], string | undefined][] = [
    ['another session, ten minutes past', [file('sess-old.json', MISSED)], 'sess-old'],
    ['this session is never offered its own', [file('sess-a.json', MISSED)], undefined],
    ['another project', [file('sess-old.json', { ...MISSED, root: 'C:/Repos/other' })], undefined],
    ['the same project, spelled another way', [file('sess-old.json', { ...MISSED, root: OTHER_SPELLING })], 'sess-old'],
    ['an arm saved before arms named a project', [file('sess-old.json', { ...MISSED, root: undefined })], undefined],
    ['a dropped arm', [file('sess-old.json', null)], undefined],
    ['inside the grace, its session may still fire it', [file('sess-old.json', at(ADOPT_GRACE_MS - 1))], undefined],
    ['at the grace', [file('sess-old.json', at(ADOPT_GRACE_MS))], 'sess-old'],
    ['at the age bound', [file('sess-old.json', at(ADOPT_MAX_AGE_MS))], 'sess-old'],
    ['past the age bound', [file('sess-old.json', at(ADOPT_MAX_AGE_MS + 1))], undefined],
    ['a wake still ahead', [file('sess-old.json', at(-60_000))], undefined],
    ['not a saved arm', [{ name: 'notes.txt', text: JSON.stringify(MISSED) }], undefined],
    ['the newest wake of two', [file('sess-old.json', at(3_600_000)), file('sess-new.json', MISSED)], 'sess-new'],
  ]
  for (const [label, files, owner] of cases)
    expect([label, pickOffer(files, 'sess-a', ROOT, NOW)?.owner]).toEqual([label, owner])
})

test('every saved arm names the project it was set in', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  expect(parseSavedArm(seen.files.get(ARM_FILE) ?? '')?.root).toBe(ROOT)
})

test('resuming a missed arm here claims it, clears it and submits the resume', LONG, async ($, on) => {
  const seen = world(on)
  leaveMissedArm(seen)
  await start($)
  const ui = await offered($, seen)
  expect(await ui.find({ type: 'Text', text: /armed to resume at Fri 2026-10-02 09:50/ })).toBeDefined()
  expect(adoptPrompts(seen)).toEqual([])
  await ui.press({ key: 'usage-adopt-yes' })
  await seen.clock.advance(1_000)
  expect(seen.claims.has(ARM_CLAIM)).toBe(true)
  expect(seen.files.get(OLD_FILE)).toBe('null')
  const [prompt] = adoptPrompts(seen)
  expect(prompt).toContain('Continue the pending work now')
  expect(prompt).toContain('mods-data/tasks/sess-old.json')
  expect(await ui.find({ key: 'usage-adopt-yes' })).toBeUndefined()
  await ui.press({ key: 'usage-adopt-ok' })
  expect(await ui.find({ key: 'usage-adopt-note' })).toBeUndefined()
})

test('a missed arm another session already resumed is not resumed twice', LONG, async ($, on) => {
  const seen = world(on)
  leaveMissedArm(seen)
  seen.claims.add(ARM_CLAIM)
  await start($)
  const ui = await offered($, seen)
  await ui.press({ key: 'usage-adopt-yes' })
  expect(adoptPrompts(seen)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^Another session already resumed that work\.$/ })).toBeDefined()
})

test('a claim that cannot be confirmed resumes nothing and keeps the arm', LONG, async ($, on) => {
  const seen = world(on)
  leaveMissedArm(seen)
  seen.failClaims = new Set([ARM_CLAIM])
  await start($)
  const ui = await offered($, seen)
  await ui.press({ key: 'usage-adopt-yes' })
  expect(adoptPrompts(seen)).toEqual([])
  expect(seen.files.get(OLD_FILE)).toBe(JSON.stringify(MISSED))
})

test('dropping a missed arm clears it without a resume', LONG, async ($, on) => {
  const seen = world(on)
  leaveMissedArm(seen)
  await start($)
  const ui = await offered($, seen)
  await ui.press({ key: 'usage-adopt-drop' })
  expect(adoptPrompts(seen)).toEqual([])
  expect(seen.claims.has(ARM_CLAIM)).toBe(false)
  expect(seen.files.get(OLD_FILE)).toBe('null')
})

test('from the phone, the text names the offer and /usage-guard adopt resumes it', LONG, async ($, on) => {
  const seen = world(on)
  leaveMissedArm(seen)
  await start($)
  const phone = await $.command.run({ command: 'usage-guard', args: 'phone' } as never)
  expect(String((phone as { text?: string }).text)).toContain('/usage-guard adopt runs it here')
  const answer = await $.command.run({ command: 'usage-guard', args: 'adopt' } as never)
  expect((answer as { text?: string }).text).toBe('Resuming the closed session’s work here.')
  // Submitted once the session is idle: after the command's own run.
  await seen.clock.advance(1_000)
  expect(adoptPrompts(seen)).toHaveLength(1)
  const again = await $.command.run({ command: 'usage-guard', args: 'adopt' } as never)
  expect((again as { text?: string }).text).toBe('No closed session in this project has a missed resume.')
})
