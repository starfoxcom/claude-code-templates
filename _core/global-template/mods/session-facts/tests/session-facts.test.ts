import { expect, mock, test } from 'claude-code/testing'
import { MKDIR_SCRIPT } from '../hooks/register'

// 2026-10-02 16:00:00 UTC, which is 09:00 at a UTC-7 host.
const NOON_UTC = Date.UTC(2026, 9, 2, 16, 0, 0)

const BREAKDOWN = { rawMaxTokens: 500_000, autoCompactThreshold: 467_000 } as never

test('every prompt carries the local time, the context fill to compaction and plan usage', async ($, on) => {
  mock.clock(on, { now: NOON_UTC })
  const order: string[] = []
  on('process.run', ($, e) => {
    order.push(e.argv.join(' '))
    return {
      value: {
        exitCode: 0,
        stdout: '420 America/Phoenix\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
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
  on('session.id', () => ({ value: 'sess-1' }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', ($, e) => {
    writes.push({ path: e.path.replaceAll('\\', '/'), text: e.text })
    order.push(`write ${e.path.replaceAll('\\', '/')}`)
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

  expect(writes[0]).toEqual({
    path: 'C:/Users/me/.claude/mods-data/session-facts/sess-1.json',
    text: JSON.stringify({ size: 500_000, compactsAt: 467_000 }),
  })
  // The data folder is made before the first write: the engine's fs makes no folders.
  const made = order.indexOf(`node -e ${MKDIR_SCRIPT} C:/Users/me/.claude/mods-data/session-facts`)
  expect(made).toBeGreaterThanOrEqual(0)
  expect(made).toBeLessThan(order.indexOf('write C:/Users/me/.claude/mods-data/session-facts/sess-1.json'))
  expect(seen.length).toBe(1)
  expect(seen[0]).toContain('2026-10-02 09:00:00 America/Phoenix')
  expect(seen[0]).toContain('ctx 57% (287k of 500k; auto-compacts at 467k)')
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
  let seen: readonly string[] = []
  on('prompt.submit', ($, e) => {
    seen = e.context ?? []
    return { text: e.text, context: e.context }
  })

  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello' } as never)

  expect(seen[0]).toContain('2026-10-02 16:00:00 UTC (host zone unread)')
  expect(seen[0]).toContain('ctx unknown until the first response')
  expect(seen[0]).not.toContain('plan used')
})
