import type { SessionCompactResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'
import { catchUpOf, parseSavedArm } from '../hooks/arms'
import { CACHE_LIFE_MS, measured, outcomeOf, outcomeText, shouldCompactAtPause } from '../hooks/compact'
import { countOpenTasks, EMPTY_ARM_NOTE, WRAP_UP_ARGS } from '../hooks/plan'
import type { World } from './world'
import {
  ARM_FILE,
  cardOf,
  doWork,
  endTurn,
  mountCard,
  NOW,
  quietWakes,
  RESET,
  resumes,
  start,
  SUMMARY,
  TASKS_DIR,
  WAKE,
  world,
} from './world'

// Compaction at a pause and on an armed resume, arms with nothing pending, saved arms, and the phone view.

// A working session crosses the line at a turn's end, so the wrap-up (/session-close) runs as the next turn.
async function crossAndWrapUp($: Engine, seen: World, resetsAt = RESET): Promise<void> {
  await start($)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt }]
  await endTurn($)
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
}

test('a session that resumes by itself compacts once its wrap-up turn ends, and says what it freed', async ($, on) => {
  const seen = world(on)
  seen.context = { ...seen.context, tokens: 400_000 }
  await crossAndWrapUp($, seen)
  // Not beside the turn that crossed the line: only after the wrap-up's own turn.
  await seen.clock.advance(1_000)
  expect(seen.compactions).toEqual([])
  await endTurn($)
  await seen.clock.advance(1_000)
  expect(seen.compactions).toHaveLength(1)
  expect(seen.compactions[0]).toContain('resumes its saved work on its own')
  expect(seen.statuses.at(-1)).toMatch(/· compacted$/)
  // The engine's own 30k leaves out what every request carries: the next reply's size is the real one.
  seen.context = { ...seen.context, tokens: 125_000 }
  // Once: later turns during the pause compact nothing more.
  await endTurn($)
  expect(seen.statuses.at(-1)).toContain('compacted to 125k')
  await seen.clock.advance(1_000)
  expect(seen.compactions).toHaveLength(1)
})

test('a pause compacts nothing when the context is below the setting', async ($, on) => {
  const seen = world(on)
  await crossAndWrapUp($, seen)
  await endTurn($)
  await seen.clock.advance(1_000)
  expect(seen.compactions).toEqual([])
})

test('a pause compacts nothing when the wake comes before the cache would go cold', async ($, on) => {
  const seen = world(on)
  seen.context = { ...seen.context, tokens: 400_000 }
  await crossAndWrapUp($, seen, new Date(NOW + 30 * 60_000).toISOString())
  await endTurn($)
  await seen.clock.advance(1_000)
  expect(seen.compactions).toEqual([])
})

test('a session with nothing saved compacts nothing at the pause', async ($, on) => {
  const seen = world(on)
  seen.context = { ...seen.context, tokens: 400_000 }
  await start($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  await endTurn($)
  await seen.clock.advance(1_000)
  expect(seen.compactions).toEqual([])
})

test('a compaction at the pause that freed nothing says so instead of claiming it worked', async ($, on) => {
  const seen = world(on)
  seen.context = { ...seen.context, tokens: 400_000 }
  // The engine claims 30k, but the first reply after it is as big as before.
  await crossAndWrapUp($, seen)
  await endTurn($)
  await seen.clock.advance(1_000)
  expect(seen.compactions).toHaveLength(1)
  await endTurn($)
  expect(seen.statuses.at(-1)).toContain('compaction freed nothing')
})

const status = async ($: Engine) =>
  ((await $.command.run({ command: 'usage-guard', args: '' } as never)) as { text: string }).text

test('arm with compact compacts a moment later, whatever the context size, then resumes later', async ($, on) => {
  const seen = world(on)
  seen.context = { ...seen.context, tokens: 400_000 }
  await start($)
  const answer = await $.command.run({ command: 'usage-guard', args: 'arm 5h compact' } as never)
  const { text } = answer as { text: string }
  expect(text).toContain('Armed: this session resumes')
  expect(text).toContain('Compacting this session in a moment')
  // Never inside the command: the engine refuses a compaction under the hook that runs it.
  expect(seen.compactions).toEqual([])
  await seen.clock.advance(1_000)
  expect(seen.compactions).toHaveLength(1)
  // /usage-guard repeats how it went, for a surface the transcript note does not reach.
  expect(await status($)).toContain('Compacted from 400k tokens; the new size shows after the next reply.')
  seen.context = { ...seen.context, tokens: 125_000 }
  await endTurn($)
  expect(await status($)).toContain('Compacted: context went from 400k to 125k tokens.')
  await seen.clock.advance(WAKE - NOW - 1_000)
  expect(resumes(seen)).toHaveLength(1)
})

test('arm with compact that the engine refuses or a hook vetoes still arms, and says so', async ($, on) => {
  const seen = world(on)
  await start($)
  seen.compactResult = new Error('a turn is running')
  await $.command.run({ command: 'usage-guard', args: 'arm 5h compact' } as never)
  await seen.clock.advance(1_000)
  expect(await status($)).toMatch(/Armed to resume at .*\nLast compaction, .*: Not compacted: /)
  seen.compactResult = { skip: 'blocked by a hook' }
  await $.command.run({ command: 'usage-guard', args: 'arm 5h compact' } as never)
  await seen.clock.advance(1_000)
  expect(await status($)).toContain('Not compacted: blocked by a hook')
})

test('arm with an unknown option arms nothing', async ($, on) => {
  const seen = world(on)
  await start($)
  const answer = await $.command.run({ command: 'usage-guard', args: 'arm 5h now' } as never)
  expect(answer).toEqual(expect.objectContaining({ text: expect.stringContaining('Unknown option "now"') }))
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
  expect(seen.compactions).toEqual([])
})

test('a pause compacts only with the setting on, at or above it, and with the wake past the cache life', () => {
  const fill = (percent: number) => ({ tokens: percent * 10_000, percent })
  const far = NOW + CACHE_LIFE_MS + 1
  expect(shouldCompactAtPause(fill(25), 25, far, NOW)).toBe(true)
  expect(shouldCompactAtPause(fill(24), 25, far, NOW)).toBe(false)
  expect(shouldCompactAtPause(fill(100), 0, far, NOW)).toBe(false)
  expect(shouldCompactAtPause(undefined, 25, far, NOW)).toBe(false)
  expect(shouldCompactAtPause(fill(50), 25, NOW + CACHE_LIFE_MS, NOW)).toBe(false)
})

test('a compaction is measured by the first reply after it, never by the engine own count', () => {
  const messages = [{ role: 'user' as const, text: 's', toolUses: [] }]
  const ran = outcomeOf({ messages, tokensBefore: 193_000, tokensAfter: 22_000 }, 192_000)
  expect(outcomeText(ran)).toBe('Compacted from 192k tokens; the new size shows after the next reply.')
  expect(outcomeText(outcomeOf({ messages }))).toBe('Compacted; the new size shows after the next reply.')
  expect(outcomeText(measured(192_000, 125_000))).toBe('Compacted: context went from 192k to 125k tokens.')
  expect(outcomeText(measured(100_000, 100_000))).toBe(
    'The compaction did not free context (100k before, 100k after), so the session keeps its full context.',
  )
  expect(outcomeText(outcomeOf({ skip: 'vetoed' }))).toBe('Not compacted: vetoed')
})

// This session's list as the tasks mod keeps it.
function tasksFile(seen: World, tasks: { status: string; hold?: string }[]): void {
  seen.hasTasksMod = true
  seen.files.set(`${TASKS_DIR}/${seen.sessionId}.json`, JSON.stringify({ session: seen.sessionId, tasks }))
}

const arm5h = async ($: Engine) =>
  ((await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)) as { text: string }).text

test('an arm with nothing pending is set, says so, and the card keeps it', async ($, on) => {
  const seen = world(on)
  tasksFile(seen, [{ status: 'completed' }, { status: 'pending', hold: 'Alex at the PC' }])
  await start($)
  const text = await arm5h($)
  expect(text).toContain('Armed: this session resumes')
  expect(text).toContain(EMPTY_ARM_NOTE)
  const ui = await mountCard($)
  expect(await ui.find({ key: 'usage-arm-question' })).toBeDefined()
  await ui.press({ key: 'usage-arm-keep' })
  expect(await ui.find({ key: 'usage-arm-question' })).toBeUndefined()
  // The press answers: a confirmation takes the card's place until dismissed.
  expect(await ui.find({ type: 'Text', text: /^Kept: this session resumes at Fri 2026-10-02 12:02/ })).toBeDefined()
  await ui.press({ key: 'usage-arm-note-dismiss' })
  expect(await ui.find({ key: 'usage-arm-note' })).toBeUndefined()
  // Kept: the arm still wakes the session, with the one-line prompt since nothing is pending.
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
  expect(quietWakes(seen)).toHaveLength(1)
})

test("an arm with nothing pending is dropped by the card's cancel", async ($, on) => {
  const seen = world(on)
  tasksFile(seen, [])
  await start($)
  await arm5h($)
  const ui = await mountCard($)
  await ui.press({ key: 'usage-arm-cancel' })
  expect(await ui.find({ key: 'usage-arm-question' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Disarmed: this session will not resume on its own\.$/ })).toBeDefined()
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
})

test('an arm with nothing pending in a session that never made a list still asks', async ($, on) => {
  const seen = world(on)
  seen.hasTasksMod = true
  await start($)
  expect(await arm5h($)).toContain(EMPTY_ARM_NOTE)
})

test('an arm with an open task, or without the tasks mod to tell, asks nothing', async ($, on) => {
  const seen = world(on)
  await start($)
  // No tasks mod: whether anything is pending is not known, so nothing is said.
  expect(await arm5h($)).not.toContain(EMPTY_ARM_NOTE)
  tasksFile(seen, [{ status: 'in_progress' }])
  expect(await arm5h($)).not.toContain(EMPTY_ARM_NOTE)
  const ui = await mountCard($)
  expect(await ui.find({ key: 'usage-arm-question' })).toBeUndefined()
})

test('open tasks are the ones not completed, not dropped and not on hold', () => {
  const list = (tasks: unknown[]) => JSON.stringify({ tasks })
  expect(countOpenTasks(list([]))).toBe(0)
  expect(countOpenTasks(list([{ status: 'pending' }, { status: 'in_progress' }]))).toBe(2)
  expect(countOpenTasks(list([{ status: 'completed' }]))).toBe(0)
  expect(countOpenTasks(list([{ status: 'pending', hold: 'a decision' }]))).toBe(0)
  expect(countOpenTasks(list([{ status: 'pending', droppedAt: 1 }]))).toBe(0)
  expect(countOpenTasks('not json')).toBeUndefined()
  expect(countOpenTasks('{}')).toBeUndefined()
})

test('an armed session with nothing pending gets the one-line prompt at a pause reset too', async ($, on) => {
  const seen = world(on)
  tasksFile(seen, [])
  await start($)
  await arm5h($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
  expect(quietWakes(seen)).toHaveLength(1)
})

const savedArm = (seen: World) => seen.files.get(ARM_FILE)

test('an arm is saved for a restart, and a disarm drops the saved copy', async ($, on) => {
  const seen = world(on)
  await start($)
  await arm5h($)
  expect(parseSavedArm(savedArm(seen) ?? '')).toEqual(
    expect.objectContaining({ kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE }),
  )
  await $.command.run({ command: 'usage-guard', args: 'disarm' } as never)
  expect(savedArm(seen)).toBe('null')
})

test('a session started again before its wake schedules the saved arm', async ($, on) => {
  const seen = world(on)
  seen.files.set(ARM_FILE, JSON.stringify({ kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE }))
  await start($)
  await seen.clock.advance(WAKE - NOW - 1)
  expect(resumes(seen)).toEqual([])
  await seen.clock.advance(1)
  expect(resumes(seen)).toHaveLength(1)
  expect(savedArm(seen)).toBe('null')
})

test('a session started again within the catch-up window resumes at once', async ($, on) => {
  const seen = world(on)
  const missed = new Date(NOW - 2 * 3_600_000).toISOString()
  seen.files.set(ARM_FILE, JSON.stringify({ kind: 'five_hour', resetsAt: missed, wakeAt: NOW - 29 * 60_000 }))
  await start($)
  await seen.clock.advance(1)
  expect(resumes(seen)).toHaveLength(1)
  expect(savedArm(seen)).toBe('null')
})

test('a session started again past the catch-up window drops the saved arm and resumes nothing', async ($, on) => {
  const seen = world(on)
  const missed = new Date(NOW - 2 * 3_600_000).toISOString()
  seen.files.set(ARM_FILE, JSON.stringify({ kind: 'five_hour', resetsAt: missed, wakeAt: NOW - 31 * 60_000 }))
  await start($)
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
  expect(savedArm(seen)).toBe('null')
})

test('a saved arm is scheduled ahead, caught up within the window, and dropped past it or with catch-up off', () => {
  const minute = 60_000
  expect(catchUpOf(NOW + 1, NOW, 30)).toBe('schedule')
  expect(catchUpOf(NOW, NOW, 30)).toBe('fire')
  expect(catchUpOf(NOW - 30 * minute, NOW, 30)).toBe('fire')
  expect(catchUpOf(NOW - 30 * minute - 1, NOW, 30)).toBe('drop')
  expect(catchUpOf(NOW - 1, NOW, 0)).toBe('drop')
  expect(catchUpOf(NOW + 1, NOW, 0)).toBe('schedule')
})

test('only a whole arm reads back from its file', () => {
  const arm = { kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE }
  expect(parseSavedArm(JSON.stringify(arm))).toEqual({ ...arm, isQuestioned: false })
  expect(parseSavedArm('null')).toBeUndefined()
  expect(parseSavedArm('{"kind":"five_hour","resetsAt":"x"}')).toBeUndefined()
  expect(parseSavedArm('not json')).toBeUndefined()
})

const phone = async ($: Engine) =>
  ((await $.command.run({ command: 'usage-guard', args: 'phone' } as never)) as { text: string }).text.split('\n')

test('/usage-guard phone gives the status as text, in green with no pause', async ($, on) => {
  world(on)
  await start($)
  expect(await phone($)).toEqual([
    '🟩 No usage pause. Sessions wrap up at 90% of any plan window.',
    '/usage-guard help for more',
  ])
})

test('/usage-guard phone shows the pause and the card the PC draws above the prompt', async ($, on) => {
  const seen = world(on)
  await start($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)
  const lines = await phone($)
  expect(lines[0]).toMatch(/^🟨 Paused: 5-hour at 92%\. Resumes at Fri 2026-10-02 12:02/)
  expect(lines[1]).toBe(`🟨 ${cardOf(seen)?.text}`)
  expect(lines.at(-1)).toBe('/usage-guard help for more')
})

test('/usage-guard phone carries the question about an arm with nothing pending', async ($, on) => {
  const seen = world(on)
  tasksFile(seen, [])
  await start($)
  await arm5h($)
  const lines = await phone($)
  expect(lines[0]).toContain('Armed to resume at Fri 2026-10-02 12:02')
  expect(lines).toContain(`🟨 ${EMPTY_ARM_NOTE}`)
})

test('after a hot reload while idle, a command restores the saved arm and its timer', async ($, on) => {
  const seen = world(on)
  // The reload emptied the module and its state, and no turn has run since: only the saved copy is left.
  seen.files.set(ARM_FILE, JSON.stringify({ kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE }))
  expect(await status($)).toContain('Armed to resume at Fri 2026-10-02 12:02')
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
})

test('after a hot reload while idle, disarm finds the saved arm and drops it', async ($, on) => {
  const seen = world(on)
  seen.files.set(ARM_FILE, JSON.stringify({ kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE }))
  const answer = (await $.command.run({ command: 'usage-guard', args: 'disarm' } as never)) as { text: string }
  expect(answer.text).toContain('Disarmed')
  expect(savedArm(seen)).toBe('null')
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
})

test('a start after a reload restores the saved arm even when the command is refused', async ($, on) => {
  const seen = world(on)
  seen.refuseRegister = true
  seen.files.set(ARM_FILE, JSON.stringify({ kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE }))
  await start($)
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
})

test('a bare /usage-guard typed over Remote Control answers with the phone text', async ($, on) => {
  world(on)
  await start($)
  const bridge = { command: 'usage-guard', args: '', origin: { kind: 'bridge' } }
  const answer = (await $.command.run(bridge as never)) as { text: string }
  expect(answer.text.split('\n')).toEqual([
    '🟩 No usage pause. Sessions wrap up at 90% of any plan window.',
    '/usage-guard help for more',
  ])
})
