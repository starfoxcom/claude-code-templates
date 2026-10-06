import { expect, test } from 'claude-code/testing'
import { adoptReason, parseSavedArm } from '../hooks/arms'
import { REASON_MAX } from '../hooks/plan'
import { armedText, armLineText } from '../hooks/texts'
import { nextClockTime, parseArmArgs, planWake, toolRequest, untilText } from '../hooks/wake'
import { NOW, RESET } from './world'

// The arm's words, its clock time and its reason, read alone. NOW is Fri 2026-10-02 10:00 in Phoenix (UTC-7).

const PHOENIX = { offsetMinutes: 420, name: 'America/Phoenix' }
const KOLKATA = { offsetMinutes: -330, name: 'Asia/Kolkata' }
const at = (iso: string) => Date.parse(iso)

const READS: [string, unknown][] = [
  ['5h', { which: '5h', isCompact: false }],
  ['week compact', { which: 'week', isCompact: true }],
  ['21:05 "check CI"', { which: '21:05', isCompact: false, reason: 'check CI' }],
  ['9:05 compact "a  b\n c"', { which: '9:05', isCompact: true, reason: 'a b c' }],
  ['21:05 “smart quotes”', { which: '21:05', isCompact: false, reason: 'smart quotes' }],
  ['21:05 "say "hi" now"', { which: '21:05', isCompact: false, reason: 'say "hi" now' }],
  ['21:05 ""', { which: '21:05', isCompact: false }],
  ['  5h   compact  ', { which: '5h', isCompact: true }],
]
for (const [args, read] of READS) {
  test(`reads arm ${JSON.stringify(args)}`, () => {
    expect(parseArmArgs(args)).toEqual(read)
  })
}

const REFUSED: [string, string][] = [
  ['', 'Use: /usage-guard arm 5h|week|HH:MM'],
  ['21:05 "open', "Close the reason's quotes"],
  ['21:05 "a" extra', "Close the reason's quotes"],
  ['9pm', 'Use 24-hour time: /usage-guard arm 21:00.'],
  ['9:05 pm', 'Use 24-hour time: /usage-guard arm 21:05.'],
  ['9:05a.m.', 'Use 24-hour time: /usage-guard arm 09:05.'],
  ['12am', 'Use 24-hour time: /usage-guard arm 00:00.'],
  ['12pm "lunch"', 'Use 24-hour time: /usage-guard arm 12:00.'],
  ['21:05 check CI', 'Put the reason in double quotes: /usage-guard arm 21:05 "check CI"'],
  ['5h compact compact', 'Use: /usage-guard arm'],
  ['5h now "x"', 'Use: /usage-guard arm'],
  [`5h "${'x'.repeat(REASON_MAX + 1)}"`, `Keep the reason under ${REASON_MAX} characters`],
]
for (const [args, why] of REFUSED) {
  test(`refuses arm ${JSON.stringify(args.slice(0, 40))}`, () => {
    expect(String(parseArmArgs(args))).toContain(why)
  })
}

test('a reason of exactly the cap is kept', () => {
  const reason = 'x'.repeat(REASON_MAX)
  expect(parseArmArgs(`5h "${reason}"`)).toEqual({ which: '5h', isCompact: false, reason })
})

const CLOCK: [number, number, typeof PHOENIX, string][] = [
  [10, 1, PHOENIX, '2026-10-02T17:01:00.000Z'],
  // The minute it is now has begun: the next one is tomorrow's.
  [10, 0, PHOENIX, '2026-10-03T17:00:00.000Z'],
  [9, 59, PHOENIX, '2026-10-03T16:59:00.000Z'],
  [0, 0, PHOENIX, '2026-10-03T07:00:00.000Z'],
  [23, 59, PHOENIX, '2026-10-03T06:59:00.000Z'],
  // 22:30 in Kolkata (UTC+5:30): a zone east of UTC, past its own midnight sooner.
  [23, 0, KOLKATA, '2026-10-02T17:30:00.000Z'],
  [22, 29, KOLKATA, '2026-10-03T16:59:00.000Z'],
]
for (const [hour, minute, zone, wake] of CLOCK) {
  test(`${hour}:${minute} in ${zone.name} at the test's now wakes at ${wake}`, () => {
    expect(new Date(nextClockTime(hour, minute, NOW, zone)).toISOString()).toBe(wake)
  })
}

test('a clock arm carries its own time as the reset, and its reason', () => {
  const request = { which: '10:30', isCompact: false, reason: 'check the build' }
  const wakeAt = at('2026-10-02T17:30:00.000Z')
  const arm = { kind: 'clock', resetsAt: new Date(wakeAt).toISOString(), wakeAt, reason: 'check the build' }
  expect(planWake(request, [], 2, NOW, PHOENIX)).toEqual(arm)
})

test('a reset arm keeps its reset and delay, and its reason', () => {
  const limits = [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }]
  const planned = planWake({ which: '5h', isCompact: false, reason: 'r' }, limits, 2, NOW, PHOENIX)
  expect(planned).toEqual({ kind: 'five_hour', resetsAt: RESET, wakeAt: at(RESET) + 120_000, reason: 'r' })
  expect(planWake({ which: 'week', isCompact: false }, limits, 2, NOW, PHOENIX)).toContain('No weekly reset')
})

for (const which of ['24:00', '9:5', '21:60', 'noon', 'compact']) {
  test(`${which} is no time to wake at`, () => {
    expect(String(planWake({ which, isCompact: false }, [], 2, NOW, PHOENIX))).toContain('Name what to wake at')
  })
}

const UNTIL: [number, string][] = [
  [0, 'in 0 min'],
  [-60_000, 'in 0 min'],
  [59_000, 'in 1 min'],
  [3_600_000, 'in 1 h'],
  [61 * 60_000, 'in 1 h 1 min'],
  [27 * 3_600_000, 'in 1 d 3 h'],
  [(24 * 60 + 5) * 60_000, 'in 1 d 5 min'],
]
for (const [ahead, text] of UNTIL) {
  test(`a wake ${ahead} ms ahead reads "${text}"`, () => {
    expect(untilText(NOW + ahead, NOW)).toBe(text)
  })
}

test('the tool reads its input as the command reads its words', () => {
  expect(toolRequest({ at: '21:05', reason: ' check  CI ' })).toEqual({
    which: '21:05',
    isCompact: false,
    reason: 'check CI',
  })
  expect(String(toolRequest({ at: '5h compact' }))).toContain('cannot compact')
  expect(toolRequest({ at: '"5h"' })).toEqual({ which: '5h', isCompact: false })
  expect(String(toolRequest({ at: 5 }))).toContain('Pass "at"')
  expect(String(toolRequest({ at: '9pm' }))).toContain('Use 24-hour time')
  expect(String(toolRequest({ at: '5h', reason: 'x'.repeat(REASON_MAX + 1) }))).toContain('Keep the reason')
})

test('the answer and the slim line name the wake, what it waits for, and the reason', () => {
  const wakeAt = at('2026-10-02T17:30:00.000Z')
  const arm = { kind: 'clock', resetsAt: '', wakeAt, reason: 'check the build' }
  const answer = armedText(arm, 'Fri 2026-10-02 10:30 (America/Phoenix)', 'in 30 min')
  expect(answer).toContain('at Fri 2026-10-02 10:30 (America/Phoenix) (in 30 min), at the time you set.')
  expect(answer).toContain('The reason this wake was set with: "check the build".')
  expect(armLineText(arm, PHOENIX)).toBe('⏰ resumes Fri 10:30 · at the time you set · "check the build"')
  const long = { ...arm, kind: 'five_hour', reason: 'y'.repeat(60) }
  expect(armLineText(long, PHOENIX)).toBe(`⏰ resumes Fri 10:30 · after the 5-hour reset · "${'y'.repeat(39)}…"`)
})

test('a saved arm keeps its reason across a restart, and an adopted one hands it on', () => {
  const saved = JSON.stringify({ kind: 'clock', resetsAt: RESET, wakeAt: at(RESET), reason: 'r' })
  expect(parseSavedArm(saved)?.reason).toBe('r')
  expect(parseSavedArm(JSON.stringify({ kind: 'clock', resetsAt: RESET, wakeAt: 1, reason: 7 }))?.reason).toBe(
    undefined,
  )
  expect(adoptReason('at the time you set', 'Fri', 'old', 'r')).toContain('The reason this wake was set with: "r".')
})
