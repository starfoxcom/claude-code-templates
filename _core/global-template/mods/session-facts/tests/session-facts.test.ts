import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// 2026-10-02 16:00:00 UTC, which is 09:00 at a UTC-7 host.
const NOON_UTC = Date.UTC(2026, 9, 2, 16, 0, 0)

const BREAKDOWN = { rawMaxTokens: 500_000, autoCompactThreshold: 467_000 } as never

test('every prompt carries the local time, the context fill to compaction and plan usage', async ($, on) => {
  mock.clock(on, { now: NOON_UTC })
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '420 America/Phoenix\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: { tokens: 286_500, window: 1_000_000, ...(e.breakdown ? { breakdown: BREAKDOWN } : {}) },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-02T21:00:00Z' },
        { kind: 'seven_day', percentUsed: 20, resetsAt: '2026-10-04T18:00:00Z' },
      ],
    },
  }))
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const writes: string[] = []
  on('fs.write', ($, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  let seen: readonly string[] = []
  on('prompt.submit', ($, e) => {
    seen = e.context ?? []
    return { text: e.text, context: e.context }
  })

  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello' } as never)

  // The facts go to the model and the budgets row only; before a reply nothing is written to disk.
  expect(writes).toEqual([])
  expect(seen.length).toBe(1)
  expect(seen[0]).toContain('2026-10-02 09:00:00 America/Phoenix')
  // The budgets row's own text, so the State line copied from it reads like the row.
  expect(seen[0]).toContain('| ctx 🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜ 57% · 181k to compact |')
  expect(seen[0]).toContain('plan used: 5-hour 3%, week 20%')
  expect(seen[0]).not.toContain('2026-10-04')
})

test('an unreadable host zone and window fall back instead of failing the prompt', async ($, on) => {
  mock.clock(on, { now: NOON_UTC })
  on('process.run', () => {
    throw new Error('no node')
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  let seen: readonly string[] = []
  on('prompt.submit', ($, e) => {
    seen = e.context ?? []
    return { text: e.text, context: e.context }
  })

  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello' } as never)

  expect(seen[0]).toContain('2026-10-02 16:00:00 UTC (host zone unread)')
  expect(seen[0]).toContain('| ctx -- (unknown until the first response of this window)')
  // A fresh session has no plan figures before its first response: the line says so instead of dropping them.
  expect(seen[0]).toContain('| plan used: unknown until the first response |')

  // Past a response the list is still empty: an account with no plan windows, so the line names none.
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, reason: 'answer' } as never)
  await $.prompt.submit({ text: 'again' } as never)
  expect(seen[0]).not.toContain('plan used')
})

const SUMMARY = { role: 'user', text: 'SUMMARY', toolUses: [] }
const KEPT = { role: 'assistant', text: 'kept', toolUses: [] }
const CONVERSATION = [{ role: 'user', text: 'old', toolUses: [] }] as never

// A UTC-7 host whose engine still reports the fill from before the compaction until told otherwise.
function compactingHost(on: On) {
  const usage = { tokens: 450_000 as number | undefined }
  const clock = mock.clock(on, { now: NOON_UTC })
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '420 America/Phoenix\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: { tokens: usage.tokens, window: 1_000_000, ...(e.breakdown ? { breakdown: BREAKDOWN } : {}) },
      rateLimits: [{ kind: 'seven_day', percentUsed: 68, resetsAt: '2026-10-04T18:00:00Z' }],
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  const seen: string[] = []
  on('prompt.submit', ($, e) => {
    seen.push(...(e.context ?? []))
    return { text: e.text, context: e.context }
  })
  return { usage, seen, clock }
}

test('a compaction is followed by a fresh facts line, and later lines name it for a quarter hour', async ($, on) => {
  const { usage, seen, clock } = compactingHost(on)
  on('session.compact', () => ({ messages: [SUMMARY, KEPT], tokensAfter: 40_000 }) as never)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })

  const result = await $.session.compact({ trigger: 'auto', messages: CONVERSATION } as never)
  const texts = (result.messages ?? []).map(message => message.text)
  expect(texts.length).toBe(3)
  expect([texts[0], texts[2]]).toEqual(['SUMMARY', 'kept'])
  // Unknown until the first response: never the 450k the engine still reports from before it, nor the
  // compaction's own size, which leaves out the system prompt, tools and rules every request carries.
  expect(texts[1]).toContain('[session-facts] 2026-10-02 09:00:00 America/Phoenix')
  expect(texts[1]).toContain('| ctx -- · just compacted 09:00 (unknown until the first response of this window) |')
  expect(texts[1]).toContain('week 68%')
  expect(texts[1]).toContain('from before the compaction')

  usage.tokens = undefined
  await $.prompt.submit({ text: 'next' } as never)
  expect(seen[0]).toContain('| ctx -- · just compacted 09:00 (unknown until the first response of this window) |')

  usage.tokens = 60_000
  await clock.advance(15 * 60_000 - 1)
  await $.prompt.submit({ text: 'still close' } as never)
  expect(seen[1]).toContain('| ctx 🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜ 12% · 407k to compact · just compacted 09:00 |')

  await clock.advance(1)
  await $.prompt.submit({ text: 'after that' } as never)
  expect(seen[2]).toContain('| ctx 🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜ 12% · 407k to compact |')
  expect(seen[2]).not.toContain('just compacted')
})

test('a compaction with no size afterwards says the fill is unknown, not the old one', async ($, on) => {
  const { usage, seen } = compactingHost(on)
  on('session.compact', () => ({ messages: [SUMMARY] }) as never)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })

  const result = await $.session.compact({ trigger: 'manual', messages: CONVERSATION } as never)
  expect(result.messages?.[1]?.text).toContain('| ctx -- · just compacted 09:00 (unknown until the first response')
  // A response came before the next prompt: its fill is the fresh one.
  usage.tokens = 55_000
  await $.prompt.submit({ text: 'next' } as never)
  expect(seen[0]).toContain('| ctx 🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜ 11% · 412k to compact · just compacted 09:00 |')
})

test('a precompute, a skipped compaction and a subagent compaction pass through untouched', async ($, on) => {
  const { seen } = compactingHost(on)
  let answer: unknown = { messages: [SUMMARY], tokensAfter: 40_000 }
  on('session.compact', () => answer as never)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })

  const precomputed = await $.session.compact({ trigger: 'precompute', messages: CONVERSATION } as never)
  expect(precomputed.messages?.map(message => message.text)).toEqual(['SUMMARY'])
  const subagent = await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: CONVERSATION } as never)
  expect(subagent.messages?.map(message => message.text)).toEqual(['SUMMARY'])
  answer = { skip: 'blocked' }
  expect(await $.session.compact({ trigger: 'manual', messages: CONVERSATION } as never)).toEqual({ skip: 'blocked' })

  await $.prompt.submit({ text: 'next' } as never)
  expect(seen[0]).not.toContain('just compacted')
})
