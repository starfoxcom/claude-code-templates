import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { hasPendingWake, isPauseLive, keepGoingText, workable } from '../hooks/keepgoing'
import type { Mirror, MirrorTask } from '../hooks/register'

// Keep going: a turn that ends with work nobody waits for gets a prompt to carry on.

const DATA = 'C:/Users/me/.claude/mods-data'
const MIRROR_FILE = `${DATA}/tasks/sess-a.json`
const task = (id: string, status: MirrorTask['status'], more: Partial<MirrorTask> = {}): MirrorTask => ({
  id,
  subject: `task ${id}`,
  status,
  createdTurn: 1,
  ...more,
})
const mirrorOf = (tasks: MirrorTask[], changedAt = 1): Mirror => ({
  session: 'sess-a',
  updatedAt: 1,
  changedAt,
  turn: 1,
  tasks,
})

test('workable: open tasks with no hold and nothing open before them, the one in progress first', () => {
  const list = mirrorOf([
    task('1', 'completed'),
    task('2', 'pending'),
    task('3', 'pending', { hold: 'Alex' }),
    task('4', 'in_progress'),
    task('5', 'pending', { blockedBy: ['2'] }),
    task('6', 'pending', { blockedBy: ['1'] }),
    task('7', 'pending', { droppedAt: 1 }),
  ])
  expect(workable(list).map(t => t.id)).toEqual(['4', '2', '6'])
  expect(workable(mirrorOf([task('1', 'pending', { hold: 'x' })]))).toEqual([])
})

test('a CI watch still running, or settled and not yet sent, is a pending wake', () => {
  expect(hasPendingWake(undefined)).toBe(false)
  expect(hasPendingWake('{ broken')).toBe(false)
  expect(hasPendingWake(JSON.stringify({ watches: [] }))).toBe(false)
  expect(hasPendingWake(JSON.stringify({ watches: [{ outcome: 'passed' }] }))).toBe(false)
  expect(hasPendingWake(JSON.stringify({ watches: [{}] }))).toBe(true)
  expect(hasPendingWake(JSON.stringify({ watches: [{ outcome: 'failed', wakePending: true }] }))).toBe(true)
})

test("a plan-limit pause counts only while usage-guard's own test holds: active, its wake still ahead", () => {
  const pause = (fields: object) => JSON.stringify(fields)
  expect(isPauseLive(pause({ status: 'active', wakeAt: 2_000 }), 1_000)).toBe(true)
  // Its wake passed while no session was open: the file still says active.
  expect(isPauseLive(pause({ status: 'active', wakeAt: 1_000 }), 1_000)).toBe(false)
  expect(isPauseLive(pause({ status: 'active', wakeAt: 999 }), 1_000)).toBe(false)
  expect(isPauseLive(pause({ status: 'done', wakeAt: 2_000 }), 1_000)).toBe(false)
  expect(isPauseLive(pause({ status: 'active' }), 1_000)).toBe(false)
  for (const text of [undefined, '', '{ broken']) expect(isPauseLive(text, 1_000)).toBe(false)
})

test('the prompt names the first task and how many more', () => {
  const text = keepGoingText([task('4', 'in_progress'), task('2', 'pending')])
  expect(text).toContain('task #4 "task 4" (and 1 more with no hold) needs no one')
})

function world(on: On, tasks: MirrorTask[], files: Record<string, string> = {}) {
  const seen = { prompts: [] as string[], origins: [] as (string | undefined)[], files: new Map(Object.entries(files)) }
  seen.files.set(MIRROR_FILE, JSON.stringify(mirrorOf(tasks)))
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: 'sess-a' }))
  on('session.root', () => ({ value: 'C:/Repos/x' }))
  on('fs.read', ($, e) => {
    const text = seen.files.get(e.path.replaceAll('\\', '/'))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    seen.files.set(e.path.replaceAll('\\', '/'), e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    seen.origins.push(e.origin?.kind)
    return { text: e.text }
  })
  return { seen, clock }
}

async function turnEnds($: Engine, clock: { advance: (ms: number) => Promise<unknown> }, reason = 'answer') {
  await $.turn.start({ turnId: 't' } as never)
  const isAborted = reason === 'aborted'
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted, reason } as never)
  await clock.advance(5_000)
}

test('a turn that ends with a task in progress gets a prompt to carry on', async ($, on) => {
  const { seen, clock } = world(on, [task('1', 'in_progress')])
  await turnEnds($, clock)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('task #1 "task 1" needs no one. Continue it now.')
})

test('no prompt when every open task is on hold, the turn was interrupted, or a wake is pending', async (
  $,
  on,
) => {
  const ciWatch = { [`${DATA}/ci-watch/sess-a.json`]: JSON.stringify({ watches: [{}] }) }
  const { seen, clock } = world(on, [task('1', 'in_progress')], ciWatch)
  await turnEnds($, clock)
  seen.files.delete(`${DATA}/ci-watch/sess-a.json`)
  seen.files.set(`${DATA}/usage-guard/pause.json`, JSON.stringify({ status: 'active', wakeAt: 9e12 }))
  await turnEnds($, clock)
  seen.files.delete(`${DATA}/usage-guard/pause.json`)
  await turnEnds($, clock, 'aborted')
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', metadata: { hold: 'Alex' } } as never)
  await turnEnds($, clock)
  expect(seen.prompts).toEqual([])
})

test('a pause whose wake already passed does not hold the prompt back', async ($, on) => {
  const stale = { [`${DATA}/usage-guard/pause.json`]: JSON.stringify({ status: 'active', wakeAt: 500 }) }
  const { seen, clock } = world(on, [task('1', 'in_progress')], stale)
  await turnEnds($, clock)
  expect(seen.prompts).toHaveLength(1)
})

test('two prompts that change nothing on the list are the last; the person prompting starts over', async (
  $,
  on,
) => {
  const { seen, clock } = world(on, [task('1', 'in_progress')])
  for (let i = 0; i < 4; i++) await turnEnds($, clock)
  expect(seen.prompts).toHaveLength(2)
  // A change to the list counts as progress: the prompts go on.
  await $.tool.call({ tool: 'TaskCreate', subject: 'next', description: 'next' } as never)
  await turnEnds($, clock)
  expect(seen.prompts).toHaveLength(3)
  await turnEnds($, clock)
  await turnEnds($, clock)
  expect(seen.prompts).toHaveLength(4)
  // The mod's own prompts come from a plugin and never start the count over; the person's do.
  expect(seen.origins).toEqual(['plugin', 'plugin', 'plugin', 'plugin'])
  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await turnEnds($, clock)
  expect(seen.prompts.filter(text => text.startsWith('[tasks]'))).toHaveLength(5)
})

test('the setting turns it off', { options: { keepGoing: false } }, async ($, on) => {
  const { seen, clock } = world(on, [task('1', 'in_progress')])
  await turnEnds($, clock)
  expect(seen.prompts).toEqual([])
})
