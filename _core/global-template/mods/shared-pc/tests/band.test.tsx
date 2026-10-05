import { expect, mock, test } from 'claude-code/testing'

// Draws the band on each surface through the engine's own validation, with the shared state faked:
// a request from another session is open, so the floating card must draw.

const ME = 'me-session-id'
const STATE = {
  seat: null,
  line: [],
  nextUp: null,
  requests: [{ session: 'other-id', name: 'my-game·49ab', reason: 'GPU window closes in 5 min', at: 1, answer: null }],
  updatedAt: 1,
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band draws the request card on ${surface}`, { timeoutMs: 15_000 }, async ($, on) => {
    on('session.id', () => ({ value: ME }))
    on('session.root', () => ({ value: 'C:/Repos/app' }))
    on('process.run', (_$, e) => {
      const argv = (e as { argv: string[] }).argv
      const stdout = argv.includes('where')
        ? JSON.stringify({ dir: 'C:/fake/shared-pc', aliveMs: 45_000, lingerMs: 60_000 })
        : JSON.stringify({ ...STATE, mine: 'none', position: 0 })
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('fs.read', (_$, e) => {
      const path = String((e as { path?: string }).path ?? '').replace(/\\/g, '/')
      if (path.endsWith('state.json')) return { value: JSON.stringify(STATE) }
      return { value: JSON.stringify({ id: 'other-id', name: 'my-game·49ab', lastBeat: Date.now() }) }
    })
    on('fs.write', () => ({ value: undefined }))
    on('command.register', () => ({ value: { command: 'pc' } }))
    on('tool.register', () => ({ value: { tool: 'mcp__shared-pc__pc' } }))
    mock.clock(on)
    on('session.start', () => ({ cwd: 'C:/Repos/app' }) as never)
    // What core and the other mods draw here; the band keeps it.
    on('ui.render', () => ({ type: 'Box', props: { key: 'beneath' }, children: [] }) as never)

    await $.session.start({ source: 'startup', cwd: 'C:/Repos/app' } as never)
    const drawn = await $.ui.mount({
      plugin: 'shared-pc',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never,
    })
    expect(drawn).toBeDefined()
    // The card's own buttons are drawn, so the request is visible and answerable from this session.
    expect(await drawn.find({ key: 'card-approve' })).toBeDefined()
    expect(await drawn.find({ key: 'card-decline' })).toBeDefined()
    expect(await drawn.find({ key: 'beneath' })).toBeDefined()
  })
}

test('a session where the mod cannot start shows a card until dismissed', { timeoutMs: 15_000 }, async ($, on) => {
  on('session.id', () => ({ value: ME }))
  on('session.root', () => ({ value: 'C:/Repos/app' }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'node missing', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', () => ({ value: { command: 'pc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__shared-pc__pc' } }))
  on('ui.toast', () => {
    throw new Error('shared-pc must not use the toast')
  })
  mock.clock(on)
  on('session.start', () => ({ cwd: 'C:/Repos/app' }) as never)
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)

  await $.session.start({ source: 'startup', cwd: 'C:/Repos/app' } as never)
  const props = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
  const drawn = await $.ui.mount({ plugin: 'shared-pc', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await drawn.find({ key: 'off-dismiss' })).toBeDefined()
  await drawn.press({ key: 'off-dismiss' })
  const again = await $.ui.mount({ plugin: 'shared-pc', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await again.find({ key: 'off-dismiss' })).toBeUndefined()
})

test('declining a request answers with a card saying so', { timeoutMs: 15_000 }, async ($, on) => {
  let state: typeof STATE = STATE
  on('session.id', () => ({ value: ME }))
  on('session.root', () => ({ value: 'C:/Repos/app' }))
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    // The helper records the answer: the request is no longer open.
    if (argv.includes('answer')) state = { ...STATE, requests: [] }
    const stdout = argv.includes('where')
      ? JSON.stringify({ dir: 'C:/fake/shared-pc', aliveMs: 45_000, lingerMs: 60_000 })
      : JSON.stringify({ ...state, mine: 'none', position: 0 })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_$, e) => {
    const path = String((e as { path?: string }).path ?? '').replace(/\\/g, '/')
    if (path.endsWith('state.json')) return { value: JSON.stringify(state) }
    return { value: JSON.stringify({ id: 'other-id', name: 'my-game·49ab', lastBeat: Date.now() }) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'pc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__shared-pc__pc' } }))
  mock.clock(on)
  on('session.start', () => ({ cwd: 'C:/Repos/app' }) as never)
  on('session.append', () => ({}) as never)
  on('ui.render', () => ({ type: 'Box', props: { key: 'beneath' }, children: [] }) as never)

  await $.session.start({ source: 'startup', cwd: 'C:/Repos/app' } as never)
  const props = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
  const drawn = await $.ui.mount({ plugin: 'shared-pc', surface: 'terminal', component: 'AbovePrompt', props })
  await drawn.press({ key: 'card-decline' })
  expect(await drawn.find({ type: 'Text', text: /Declined: other-id keeps its place in the line\./ })).toBeDefined()
  expect(await drawn.find({ key: 'card-decline' })).toBeUndefined()
})
