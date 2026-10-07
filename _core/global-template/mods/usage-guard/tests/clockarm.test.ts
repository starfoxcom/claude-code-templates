import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'
import type { World } from './world'
import { ARM_FILE, endTurn, NOW, quietWakes, RESET, resumes, start, TASKS_DIR, tools, WAKE, world } from './world'

// Arms set for a time of day, the quoted reason a wake hands on, and the arm tool. NOW is Fri 10:00 in Phoenix.

// For tests that run the fake clock to a wake: past the 5 s default on a slower machine.
const LONG = { timeoutMs: 15_000 }
const HALF_HOUR = 30 * 60_000
const REASON_LINE = 'The reason this wake was set with: "check the build".'

const arm = async ($: Engine, args: string) =>
  ((await $.command.run({ command: 'usage-guard', args: `arm ${args}` } as never)) as { text: string }).text

// A list with nothing open: an arm without a reason would only say so at its wake.
function nothingPending(seen: World): void {
  seen.hasTasksMod = true
  seen.files.set(`${TASKS_DIR}/${seen.sessionId}.json`, JSON.stringify({ session: seen.sessionId, tasks: [] }))
}

const saved = (seen: World) => JSON.parse(seen.files.get(ARM_FILE) ?? 'null')

test('a clock arm says its full date and how far off it is, and wakes then with its reason', async ($, on) => {
  const seen = world(on)
  nothingPending(seen)
  await start($)
  const text = await arm($, '10:30 "check the build"')
  expect(text).toContain('at Fri 2026-10-02 10:30 (America/Phoenix) (in 30 min), at the time you set.')
  expect(text).toContain(REASON_LINE)
  // A reason is the wake's work: no question about an empty list.
  expect(text).not.toContain('Nothing is pending')
  expect(saved(seen)).toMatchObject({ kind: 'clock', wakeAt: NOW + HALF_HOUR, reason: 'check the build' })
  await seen.clock.advance(HALF_HOUR - 1_000)
  expect(resumes(seen)).toEqual([])
  await seen.clock.advance(1_000)
  expect(resumes(seen)).toHaveLength(1)
  expect(resumes(seen)[0]).toContain(REASON_LINE)
  expect(quietWakes(seen)).toEqual([])
  expect(saved(seen)).toBeNull()
})

test('a clock arm without a reason and nothing pending only says so at its wake', async ($, on) => {
  const seen = world(on)
  nothingPending(seen)
  await start($)
  expect(await arm($, '10:30')).toContain('Nothing is pending here')
  await seen.clock.advance(HALF_HOUR)
  expect(resumes(seen)).toEqual([])
  expect(quietWakes(seen)).toHaveLength(1)
  expect(quietWakes(seen)[0]).toContain('at the time you set')
})

test('a reset arm hands its reason on at the reset', LONG, async ($, on) => {
  const seen = world(on)
  seen.limits = [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }]
  nothingPending(seen)
  await start($)
  expect(await arm($, '5h "check the build"')).toContain('after the 5-hour reset.')
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
  expect(resumes(seen)[0]).toContain(REASON_LINE)
})

test('a new arm replaces the standing one and says which', async ($, on) => {
  const seen = world(on)
  await start($)
  await arm($, '10:30')
  const replaced = 'It replaces the wake set for Fri 2026-10-02 10:30 (America/Phoenix).'
  expect(await arm($, '11:00 "later"')).toContain(replaced)
  await seen.clock.advance(HALF_HOUR)
  expect(resumes(seen)).toEqual([])
  await seen.clock.advance(HALF_HOUR)
  expect(resumes(seen)).toHaveLength(1)
})

test('a 12-hour time or an unquoted reason arms nothing', async ($, on) => {
  const seen = world(on)
  await start($)
  expect(await arm($, '9pm')).toBe('Use 24-hour time: /usage-guard arm 21:00.')
  expect(await arm($, '10:30 check the build')).toContain('/usage-guard arm 10:30 "check the build"')
  expect(seen.files.get(ARM_FILE)).toBeUndefined()
})

test('the arm tool is registered and arms like the command', async ($, on) => {
  const seen = world(on)
  await start($)
  expect(tools).toContain('arm')
  const call = { tool: 'mcp__usage-guard__arm', at: '10:30', reason: 'check the build' }
  expect(((await $.tool.call(call as never)) as { result: string }).result).toContain('(in 30 min)')
  const refused = (await $.tool.call({ tool: 'mcp__usage-guard__arm', at: '9:30 pm' } as never)) as { result: string }
  expect(refused.result).toBe('Use 24-hour time: /usage-guard arm 21:30.')
  await seen.clock.advance(HALF_HOUR)
  expect(resumes(seen)[0]).toContain(REASON_LINE)
})

test('a session that only set an arm with the tool has no work to wrap up at a pause', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.tool.call({ tool: 'mcp__usage-guard__arm', at: '11:00' } as never)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  expect(seen.commands).toEqual([])
})
