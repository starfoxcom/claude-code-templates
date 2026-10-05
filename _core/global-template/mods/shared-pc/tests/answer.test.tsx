import { expect, mock, test } from 'claude-code/testing'

// The answer to this session's skip-the-line request reaches it as a prompt of its own, even while a
// turn runs: a note added to the transcript mid-turn woke nothing once the turn ended.

const ME = 'me-session-id'
const ASKED = { session: ME, name: 'templates·499b', reason: 'a window closes', at: 1 }

test('an answer that lands mid-turn is submitted as a prompt, never appended', { timeoutMs: 15_000 }, async (
  $,
  on,
) => {
  // The answer lands only once the turn is running, as the person presses Approve mid-turn.
  const waiting = [{ ...ASKED, answer: null as string | null }]
  let state = { seat: null, line: [], nextUp: null, requests: waiting, updatedAt: 1 }
  const prompts: string[] = []
  const appended: unknown[] = []
  on('session.id', () => ({ value: ME }))
  on('session.root', () => ({ value: 'C:/Repos/app' }))
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    const stdout = argv.includes('where')
      ? JSON.stringify({ dir: 'C:/fake/shared-pc', aliveMs: 45_000, lingerMs: 60_000 })
      : JSON.stringify({ ...state, mine: 'none', position: 0 })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_$, e) => {
    const path = String((e as { path?: string }).path ?? '').replace(/\\/g, '/')
    if (path.endsWith('state.json')) return { value: JSON.stringify(state) }
    return { value: JSON.stringify({ id: ME, name: 'templates·499b', lastBeat: Date.now() }) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'pc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__shared-pc__pc' } }))
  on('prompt.submit', (_$, e) => {
    prompts.push(String((e as { text?: string }).text))
    return { value: undefined } as never
  })
  on('session.append', (_$, e) => {
    appended.push(e)
    return { value: undefined } as never
  })
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: 'C:/Repos/app' }) as never)
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)

  await $.session.start({ source: 'startup', cwd: 'C:/Repos/app' } as never)
  const props = { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100 } as never
  await $.ui.mount({ plugin: 'shared-pc', surface: 'terminal', component: 'AbovePrompt', props })
  await clock.advance(2_000)
  expect(prompts).toEqual([])
  state = { ...state, requests: [{ ...ASKED, answer: 'approved' }], updatedAt: 2 }
  await clock.advance(2_000)

  expect(prompts.filter(text => text.includes('approved your request'))).toHaveLength(1)
  expect(appended).toEqual([])
})
