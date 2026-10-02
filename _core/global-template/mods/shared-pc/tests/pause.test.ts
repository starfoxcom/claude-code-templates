import { expect, mock, test } from 'claude-code/testing'

// While usage-guard's pause is active, heavy commands are refused before they claim the seat; light
// ones still run. The shared state and the pause file are faked through the fs and process events.

const ROOT = 'C:/Repos/app'
const DATA = 'C:/fake/mods-data'

function fakeHost(on: Parameters<Parameters<typeof test>[1] & ((...a: never[]) => unknown)>[1] | any, pause: object | null) {
  on('session.id', () => ({ value: 'me-session-id' }))
  on('session.root', () => ({ value: ROOT }))
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    // The host's time zone probe (node -e): six hours behind UTC.
    const stdout = e.argv[1] === '-e'
      ? '360 America/Mexico_City\n'
      : e.argv.includes('where')
      ? JSON.stringify({ dir: `${DATA}/shared-pc`, aliveMs: 45_000, lingerMs: 60_000 })
      : JSON.stringify({ seat: null, line: [], nextUp: null, requests: [], granted: true, mine: 'seat' })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_$: unknown, e: { path?: string }) => {
    const path = String(e.path ?? '').replace(/\\/g, '/')
    if (path.endsWith('usage-guard/pause.json')) {
      if (!pause) throw new Error('ENOENT')
      return { value: JSON.stringify(pause) }
    }
    if (path.endsWith('state.json')) return { value: JSON.stringify({ seat: null, line: [], nextUp: null, requests: [] }) }
    return { value: JSON.stringify({ id: 'me-session-id', name: 'x', lastBeat: Date.now() }) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'pc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__shared-pc__pc' } }))
  on('session.start', () => ({ cwd: ROOT }) as never)
  on('tool.call', () => ({ result: 'ran' }) as never)
}

// A refusal reaches a test's own tool call as an errored result carrying the reason as text.
function refusal(r: unknown): string {
  const x = r as { deny?: string; isError?: boolean; text?: string }
  return x.deny ?? (x.isError ? String(x.text ?? '') : '')
}

test('a heavy command is refused while the usage pause is active', async ($, on) => {
  const clock = mock.clock(on)
  fakeHost(on, { status: 'active', wakeAt: Date.now() + 3_600_000 })
  void clock
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  const heavy = await $.tool.call({ tool: 'Bash', command: 'flutter test' } as never)
  expect(refusal(heavy)).toContain('plan-usage pause')
  const light = await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  expect(refusal(light)).toBe('')
})

test('a finished or cancelled pause does not block heavy work', async ($, on) => {
  mock.clock(on)
  fakeHost(on, { status: 'cancelled', wakeAt: Date.now() + 3_600_000 })
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  const heavy = await $.tool.call({ tool: 'Bash', command: 'flutter test' } as never)
  expect(refusal(heavy)).toBe('')
})

test('the pause end is shown in the host time zone, not the sandbox clock', async ($, on) => {
  // 17:00 UTC now; the pause ends at 20:05 UTC, which is 14:05 on a host six hours behind UTC.
  mock.clock(on, { now: Date.UTC(2026, 9, 2, 17, 0, 0) })
  fakeHost(on, { status: 'active', wakeAt: Date.UTC(2026, 9, 2, 20, 5, 0) })
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  const heavy = await $.tool.call({ tool: 'Bash', command: 'flutter test' } as never)
  expect(refusal(heavy)).toContain('until 14:05 (America/Mexico_City)')
  const hold = await $.tool.call({ tool: 'mcp__shared-pc__pc', action: 'hold', minutes: 10 } as never)
  expect(JSON.stringify(hold)).toContain('until 14:05 (America/Mexico_City)')
})
