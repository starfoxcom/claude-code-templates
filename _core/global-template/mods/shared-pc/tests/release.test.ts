import { expect, mock, test } from 'claude-code/testing'

// The tool's release frees this session's seat; a session only waiting in line leaves the line instead,
// so "release" never answers "Released." while the session still waits its turn.

const ME = 'me-session-id'

function fakeHost(on: any, ops: string[][], inLineAfterLeave: boolean) {
  on('session.id', () => ({ value: ME }))
  on('session.root', () => ({ value: 'C:/Repos/app' }))
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const op = e.argv.slice(e.argv.findIndex(a => a.endsWith('pcctl.cjs')) + 1)
    ops.push([...op])
    const other = { session: 'other', kind: 'work', label: 'build', since: 1, tasks: [] }
    const isInLine = op[0] === 'release' || (op[0] === 'leave' && inLineAfterLeave)
    const stdout =
      op[0] === 'where'
        ? JSON.stringify({ dir: 'C:/fake/shared-pc', aliveMs: 45_000, lingerMs: 60_000 })
        : JSON.stringify({
            seat: other,
            line: isInLine ? [{ session: ME }] : [],
            nextUp: null,
            requests: [],
            mine: isInLine ? 'line' : 'none',
            position: isInLine ? 1 : 0,
          })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_$: unknown, e: { path?: string }) => {
    const path = String(e.path ?? '').replace(/\\/g, '/')
    if (path.endsWith('state.json')) return { value: JSON.stringify({ seat: null, line: [], nextUp: null, requests: [] }) }
    return { value: JSON.stringify({ id: ME, name: 'x', lastBeat: Date.now() }) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'pc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__shared-pc__pc' } }))
  mock.clock(on)
  on('session.start', () => ({ cwd: 'C:/Repos/app' }) as never)
}

test('release while only waiting in line leaves the line', { timeoutMs: 15_000 }, async ($, on) => {
  const ops: string[][] = []
  fakeHost(on, ops, false)
  await $.session.start({ source: 'startup', cwd: 'C:/Repos/app' } as never)
  const answer = await $.tool.call({ tool: 'mcp__shared-pc__pc', action: 'release' } as never)

  expect((answer as { result?: unknown }).result).toBe('Left the line.')
  expect(ops.filter(op => op[0] === 'leave')).toEqual([['leave', ME]])
})

test('release never claims success while the session is still in line', { timeoutMs: 15_000 }, async ($, on) => {
  fakeHost(on, [], true)
  await $.session.start({ source: 'startup', cwd: 'C:/Repos/app' } as never)
  const answer = await $.tool.call({ tool: 'mcp__shared-pc__pc', action: 'release' } as never)

  expect((answer as { result?: unknown }).result).toBe('Still #1 in line.')
})
