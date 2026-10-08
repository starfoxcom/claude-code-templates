import type { On, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseSharedPlan, planPart, SHARED_PLAN_MAX_AGE_MS, sharedPlanText, wakePart } from '../hooks/plan'

// 2026-10-02 16:00:00 UTC, which is 09:00 at a UTC-7 host.
const NOW = Date.UTC(2026, 9, 2, 16, 0, 0)
const FIVE_HOUR: SessionRateLimit = { kind: 'five_hour', percentUsed: 9, resetsAt: '2026-10-02T18:00:00Z' }
const WEEK: SessionRateLimit = { kind: 'seven_day', percentUsed: 2, resetsAt: '2026-10-09T18:00:00Z' }
const DIR = 'C:/Users/me/.claude/mods-data/session-facts'
const SHARED = `${DIR}/plan.json`
const BREAKDOWN = { rawMaxTokens: 500_000, autoCompactThreshold: 467_000 } as never

test('recorded figures are borrowed only while recent, and only for windows not yet reset', () => {
  const saved = (at: number, limits: readonly SessionRateLimit[] = [FIVE_HOUR, WEEK]) => sharedPlanText(limits, at)
  expect(parseSharedPlan(saved(NOW - 60_000), NOW)).toEqual({ at: NOW - 60_000, limits: [FIVE_HOUR, WEEK] })
  // The age limit, one step either side of it.
  expect(parseSharedPlan(saved(NOW - SHARED_PLAN_MAX_AGE_MS), NOW)?.limits).toHaveLength(2)
  expect(parseSharedPlan(saved(NOW - SHARED_PLAN_MAX_AGE_MS - 1), NOW)).toBeUndefined()
  // A recording from the future is a clock gone wrong, not a reading.
  expect(parseSharedPlan(saved(NOW + 1), NOW)).toBeUndefined()
  // Past its reset a window's usage started over: that window is dropped, and with none left, all of it.
  const reset = { ...FIVE_HOUR, resetsAt: new Date(NOW).toISOString() }
  expect(parseSharedPlan(saved(NOW - 60_000, [reset, WEEK]), NOW)?.limits).toEqual([WEEK])
  expect(parseSharedPlan(saved(NOW - 60_000, [reset]), NOW)).toBeUndefined()
  expect(parseSharedPlan(saved(NOW - 60_000, []), NOW)).toBeUndefined()
  for (const text of ['', 'not json', '{}', '{"at":"x","limits":[]}', `{"at":${NOW},"limits":[{"kind":5}]}`])
    expect(parseSharedPlan(text, NOW)).toBeUndefined()
})

test('the plan part names own figures, borrowed ones with their time, or none', () => {
  const shared = { at: NOW, limits: [FIVE_HOUR, WEEK] }
  expect(planPart([WEEK], false, shared, '08:50')).toEqual({ text: ' | plan used: week 2%', isOwn: true })
  expect(planPart([], true, shared, '08:50')).toEqual({ text: '', isOwn: true })
  const unknown = { text: ' | plan used: unknown until the first response', isOwn: false }
  expect(planPart([], false, undefined)).toEqual(unknown)
  expect(planPart([], false, shared, '08:50')).toEqual({
    text: " | plan used: 5-hour 9%, week 2% (another session's, at 08:50)",
    isOwn: false,
  })
})

// A UTC-7 host whose engine has no figures until `usage.isReplied`; `files` is the disk.
function host(on: On) {
  const usage = { isReplied: false }
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const zone = { exitCode: 0, stdout: '420 America/Phoenix\n', stderr: '' }
  on('process.run', () => ({ value: { ...zone, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: {
        tokens: usage.isReplied ? 50_000 : undefined,
        window: 1_000_000,
        ...(e.breakdown ? { breakdown: BREAKDOWN } : {}),
      },
      rateLimits: usage.isReplied ? [{ ...FIVE_HOUR, percentUsed: 11 }, WEEK] : [],
    },
  }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path.replaceAll('\\', '/'))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path.replaceAll('\\', '/'), e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-b' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: {} as never }))
  const seen: string[] = []
  on('prompt.submit', ($, e) => {
    seen.push(...(e.context ?? []))
    return { text: e.text, context: e.context }
  })
  return { usage, files, clock, seen }
}

const read = { tool: 'Read', file_path: 'C:/repo/a.txt' } as never

test('a fresh session borrows recent figures, then a tool result carries its own once they are in', async ($, on) => {
  const { usage, files, clock, seen } = host(on)
  files.set(SHARED, sharedPlanText([FIVE_HOUR, WEEK], NOW - 10 * 60_000))
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello' } as never)
  expect(seen[0]).toContain("| plan used: 5-hour 9%, week 2% (another session's, at 08:50) |")

  // Before the first response nothing better is known: the tool result stays as it was.
  expect((await $.tool.call(read)).context).toBeUndefined()
  usage.isReplied = true
  const first = (await $.tool.call(read)).context ?? []
  expect(first).toHaveLength(1)
  expect(first[0]).toContain('[session-facts] 2026-10-02 09:00:00 America/Phoenix')
  expect(first[0]).toContain('| ctx 🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜ 10% · 417k to compact | plan used: 5-hour 11%, week 2% |')
  expect(first[0]).toContain('base the State line on THIS line')
  // Once is enough, until the line is ten minutes old.
  expect((await $.tool.call(read)).context).toBeUndefined()
  await clock.advance(10 * 60_000 - 1)
  expect((await $.tool.call(read)).context).toBeUndefined()
  await clock.advance(1)
  expect((await $.tool.call(read)).context?.[0]).toContain('2026-10-02 09:10:00 America/Phoenix')

  // The turn's end records this session's own figures for the next fresh session.
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, reason: 'answer' } as never)
  expect(parseSharedPlan(files.get(SHARED) ?? '', NOW + 10 * 60_000)?.limits[0]?.percentUsed).toBe(11)
})

test('figures too old to borrow leave the plan unknown', async ($, on) => {
  const { files, seen } = host(on)
  files.set(SHARED, sharedPlanText([FIVE_HOUR, WEEK], NOW - SHARED_PLAN_MAX_AGE_MS - 1))
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello' } as never)
  expect(seen[0]).toContain('| plan used: unknown until the first response |')
})

test("a subagent's tool results never carry the line", async ($, on) => {
  const { usage } = host(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello' } as never)
  usage.isReplied = true
  expect((await $.tool.call({ ...(read as object), agentId: 'a1' } as never)).context).toBeUndefined()
})

// The phone draws no row: the line the State line copies is where the person reads a scheduled wake.
test("the line names the pause and this session's own arm while they are ahead", () => {
  const HOUR = 60 * 60_000
  // NOW is Fri 09:00 at the UTC-7 host.
  expect(wakePart(NOW, 420)).toBe('')
  expect(wakePart(NOW, 420, NOW + HOUR)).toBe(' | paused until Fri 10:00')
  expect(wakePart(NOW, 420, undefined, NOW + 2 * HOUR)).toBe(' | armed: resumes Fri 11:00')
  expect(wakePart(NOW, 420, NOW + HOUR, NOW + 2 * HOUR)).toBe(' | paused until Fri 10:00 | armed: resumes Fri 11:00')
  // An arm at or before the pause's wake joins it (usage-guard defers it there, also after the pause is
  // extended): it resumes with the pause, which alone wakes no session; a wake that passed is no longer ahead.
  expect(wakePart(NOW, 420, NOW + HOUR, NOW + HOUR)).toBe(' | paused until Fri 10:00 | armed: resumes with the pause')
  const joined = ' | paused until Fri 11:00 | armed: resumes with the pause'
  expect(wakePart(NOW, 420, NOW + 2 * HOUR, NOW + HOUR)).toBe(joined)
  expect(wakePart(NOW, 420, NOW, NOW - 1)).toBe('')
})

test("the prompt's line carries usage-guard's pause and this session's arm", async ($, on) => {
  const { files, seen } = host(on)
  const GUARD = 'C:/Users/me/.claude/mods-data/usage-guard'
  files.set(`${GUARD}/pause.json`, JSON.stringify({ status: 'active', wakeAt: NOW + 60 * 60_000 }))
  files.set(`${GUARD}/arms/sess-b.json`, JSON.stringify({ kind: 'clock', resetsAt: '', wakeAt: NOW + 2 * 60 * 60_000 }))
  files.set(`${GUARD}/arms/another.json`, JSON.stringify({ kind: 'clock', resetsAt: '', wakeAt: NOW + 30 * 60_000 }))
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello' } as never)
  expect(seen[0]).toContain('| paused until Fri 10:00 | armed: resumes Fri 11:00 |')
  expect(seen[0]).not.toContain('09:30')
})
