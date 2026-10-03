import { expect, mock, test } from 'claude-code/testing'

// A heavy command that finds the seat taken waits in line through the helper's `wait` child, and
// runs once the child reports the seat granted; a child that ends without the seat leaves the line.

const ROOT = 'C:/Repos/app'
const DATA = 'C:/fake/mods-data'

function fakeHost(on: any, waitOutput: string) {
  const calls: string[][] = []
  on('session.id', () => ({ value: 'me-session-id' }))
  on('session.root', () => ({ value: ROOT }))
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    calls.push([...e.argv])
    const stdout =
      e.argv[1] === '-e'
        ? '360 America/Mexico_City\n'
        : e.argv.includes('where')
          ? JSON.stringify({ dir: `${DATA}/shared-pc`, aliveMs: 45_000, lingerMs: 60_000 })
          : e.argv.includes('claim')
            ? JSON.stringify({
                granted: false,
                mine: 'line',
                position: 1,
                seat: { session: 'other', kind: 'work', since: 0, label: 'build' },
              })
            : JSON.stringify({ seat: null, line: [], nextUp: null, requests: [] })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: waitOutput }
    return { code: 0, signal: null }
  })
  on('fs.read', (_$: unknown, e: { path?: string }) => {
    const path = String(e.path ?? '').replace(/\\/g, '/')
    if (path.endsWith('usage-guard/pause.json')) throw new Error('ENOENT')
    if (path.endsWith('state.json'))
      return { value: JSON.stringify({ seat: null, line: [], nextUp: null, requests: [] }) }
    return { value: JSON.stringify({ id: 'other', name: 'app·othe', lastBeat: 0 }) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'pc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__shared-pc__pc' } }))
  on('session.start', () => ({ cwd: ROOT }) as never)
  on('tool.call', () => ({ result: 'ran' }) as never)
  return calls
}

test('a heavy command waits in line, then runs once the seat is granted', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 2, 17, 0, 0) })
  const calls = fakeHost(on, '{"granted":true,"mine":"seat"}\n')
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  const ran = (await $.tool.call({ tool: 'Bash', command: 'flutter test' } as never)) as {
    result?: unknown
    deny?: string
  }
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toBe('ran')
  expect(calls.some(argv => argv.includes('leave') || argv.includes('abandon'))).toBe(false)
})

test('a wait that ends without the seat leaves the line and runs nothing', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 2, 17, 0, 0) })
  const calls = fakeHost(on, '{"granted":false,"mine":"none"}\n')
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  const ran = (await $.tool.call({ tool: 'Bash', command: 'flutter test' } as never)) as {
    deny?: string
    isError?: boolean
    text?: string
  }
  expect(ran.deny ?? ran.text ?? '').toContain('left the line')
  // Abandon, not just leave: a seat granted as the wait ended is freed with it.
  expect(calls.some(argv => argv.includes('abandon'))).toBe(true)
})
