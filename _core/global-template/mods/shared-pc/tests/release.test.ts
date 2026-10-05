import { expect, mock, test } from 'claude-code/testing'

// The tool's release gives up the seat and the place in line in one helper write (`drop`), and answers
// by what that write did: never "Released." while the session still waits in line, never a success when
// the helper failed.

const ME = 'me-session-id'

function fakeHost(on: any, ops: string[][], replies: Record<string, object>) {
  on('session.id', () => ({ value: ME }))
  on('session.root', () => ({ value: 'C:/Repos/app' }))
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const op = e.argv.slice(e.argv.findIndex(a => a.endsWith('pcctl.cjs')) + 1)
    ops.push([...op])
    const view = { seat: null, line: [], nextUp: null, requests: [], mine: 'none', position: 0 }
    const stdout =
      op[0] === 'where'
        ? JSON.stringify({ dir: 'C:/fake/shared-pc', aliveMs: 45_000, lingerMs: 60_000 })
        : JSON.stringify({ ...view, ...replies[op[0] ?? ''] })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_$: unknown, e: { path?: string }) => {
    const path = String(e.path ?? '').replace(/\\/g, '/')
    const empty = { seat: null, line: [], nextUp: null, requests: [] }
    if (path.endsWith('state.json')) return { value: JSON.stringify(empty) }
    return { value: JSON.stringify({ id: ME, name: 'x', lastBeat: Date.now() }) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'pc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__shared-pc__pc' } }))
  mock.clock(on)
  on('session.start', () => ({ cwd: 'C:/Repos/app' }) as never)
}

const cases: [string, object, string][] = [
  ['holding the seat', { freed: true, left: false }, 'Released.'],
  ['only waiting in line', { freed: false, left: true }, 'Left the line.'],
  ['neither', { freed: false, left: false }, 'Nothing to release: this session held no seat and was not in line.'],
  ['the helper failing', { error: 'MutexLost' }, 'Release failed: MutexLost'],
]

for (const [label, dropReply, answer] of cases) {
  test(`release answers by what its one write did: ${label}`, { timeoutMs: 15_000 }, async ($, on) => {
    const ops: string[][] = []
    fakeHost(on, ops, { drop: dropReply })
    await $.session.start({ source: 'startup', cwd: 'C:/Repos/app' } as never)
    const before = ops.length
    const result = await $.tool.call({ tool: 'mcp__shared-pc__pc', action: 'release' } as never)

    expect((result as { result?: unknown }).result).toBe(answer)
    // One helper write: no grant can land between giving up the seat and the line.
    expect(ops.slice(before).filter(op => op[0] !== 'status')).toEqual([['drop', ME]])
  })
}

test('a hold the helper fails says so instead of a place in line', { timeoutMs: 15_000 }, async ($, on) => {
  fakeHost(on, [], { hold: { error: 'MutexLost' } })
  await $.session.start({ source: 'startup', cwd: 'C:/Repos/app' } as never)
  const result = await $.tool.call({ tool: 'mcp__shared-pc__pc', action: 'hold', minutes: 5 } as never)
  expect((result as { result?: unknown }).result).toBe('Hold failed: MutexLost')
})
