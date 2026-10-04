import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { HELP, selectedEffort } from '../hooks/register'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
const SURFACES = ['terminal', 'desktop'] as const
const DIRTY = '## develop...origin/develop [ahead 2, behind 1]\n M a.ts\n M b.ts\n?? c.ts\n'

function world(on: On, status = DIRTY) {
  const seen = {
    gitCalls: 0,
    status,
    isModelDown: false,
    /** What settings.read answers: the effort picks a test sets. */
    settings: {} as Record<string, unknown>,
    clock: mock.clock(on, { now: 0 }),
    /** A git read waits on this, answering with the status it saw when it started. */
    gate: undefined as Promise<void> | undefined,
    commands: [] as { name: string; argumentHint?: string }[],
  }
  on('settings.read', () => ({ value: seen.settings }))
  on('session.model', () => {
    if (seen.isModelDown) throw new Error('no model yet')
    return { value: 'claude-opus-5-5[1m]' }
  })
  on('session.root', () => ({ value: 'C:\\Repos\\GameProject' }))
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'git') seen.gitCalls += 1
    const status = seen.status
    await seen.gate
    const isGit = e.argv[0] === 'git' && status !== ''
    return {
      value: {
        exitCode: isGit ? 0 : 128,
        stdout: isGit ? status : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    seen.commands.push({ name: e.name, argumentHint: e.argumentHint })
    return { value: { command: e.name } as never }
  })
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  // turn.step streams: the stand-in for the model answers with no chunks.
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return seen
}

async function start($: Engine, surface: 'terminal' | 'desktop'): Promise<void> {
  // A Desktop session starts like an SDK one and its surface attaches after.
  if (surface === 'terminal') {
    await $.session.start({ cwd: 'C:/Repos/GameProject', surface: 'terminal', isInteractive: true })
    return
  }
  await $.session.start({ cwd: 'C:/Repos/GameProject', surface: null, isInteractive: false } as never)
  await $.session.attach({ surface: 'desktop', clientId: 'app' } as never)
}

// A streaming event runs only as it is read.
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of stream) void chunk
}

async function mount($: Engine, surface: 'terminal' | 'desktop') {
  return $.ui.mount({ plugin: 'session-info', surface, component: 'AbovePrompt', props: PROPS })
}

for (const surface of SURFACES) {
  test(`${surface}: the row names model, project and branch with its state`, async ($, on) => {
    world(on)
    await start($, surface)
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5 · GameProject/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /develop\*/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↓1/ })).toBeDefined()
  })

  const CAPPED = { options: { maxFiles: 2 } }
  test(`${surface}: the changes button lists the changed files, capped`, CAPPED, async ($, on) => {
    world(on)
    await start($, surface)
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: / M a\.ts/ })).toBeUndefined()
    await ui.press({ key: 'session-info-changes' })
    expect(await ui.find({ type: 'Text', text: / M a\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /and 1 more/ })).toBeDefined()
    await ui.press({ key: 'session-info-changes' })
    expect(await ui.find({ type: 'Text', text: / M a\.ts/ })).toBeUndefined()
  })
}

test('the effort comes from the main loop, never a subagent', async ($, on) => {
  world(on)
  await start($, 'terminal')
  const main = { turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }
  const subagent = { turnId: 't', index: 1, model: 'claude-haiku-4-5', effort: 'low', messageCount: 1, agentId: 'a1' }
  await drain($.turn.step(main as never))
  await drain($.turn.step(subagent as never))
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'done' } as never)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5 high · GameProject/ })).toBeDefined()
})

test('the effort picked in settings shows before the first request, and a new pick replaces it', async ($, on) => {
  const seen = world(on)
  seen.settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }
  await start($, 'terminal')
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5 high · GameProject/ })).toBeDefined()
  seen.settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }
  await seen.clock.advance(30_000)
  const after = await mount($, 'terminal')
  expect(await after.find({ type: 'Text', text: /Opus 5\.5 medium · GameProject/ })).toBeDefined()
})

test('the picked effort is read per model, with the top-level setting as the fallback', () => {
  const settings = { effortLevel: 'max', modelSettings: { 'claude-fable-5-1': { effortLevel: 'low' } } }
  expect(selectedEffort(settings, 'claude-fable-5-1[1m]')).toBe('low')
  expect(selectedEffort(settings, 'claude-opus-5-5')).toBe('max')
  expect(selectedEffort({}, 'claude-opus-5-5')).toBeUndefined()
})

test('a shell command rereads git, so a checkout shows at once', async ($, on) => {
  const seen = world(on)
  await start($, 'terminal')
  seen.status = '## main...origin/main\n'
  await $.tool.call({ tool: 'Bash', input: { command: 'git checkout main' } } as never)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /main/ })).toBeDefined()
  expect(await ui.find({ key: 'session-info-changes' })).toBeUndefined()
})

test('outside a repository the row keeps model and project only', async ($, on) => {
  world(on, '')
  await start($, 'terminal')
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5 · GameProject/ })).toBeDefined()
  expect(await ui.find({ key: 'session-info-changes' })).toBeUndefined()
})

test('a failed first read still starts the timer that fills the row', async ($, on) => {
  const seen = world(on)
  seen.isModelDown = true
  await start($, 'terminal')
  expect(await (await mount($, 'terminal')).find({ type: 'Text', text: /GameProject/ })).toBeUndefined()
  seen.isModelDown = false
  await seen.clock.advance(30_000)
  expect(await (await mount($, 'terminal')).find({ type: 'Text', text: /Opus 5\.5 · GameProject/ })).toBeDefined()
})

test('one git read at a time: a slow read never lands over a checkout made while it ran', async ($, on) => {
  const seen = world(on)
  await start($, 'terminal')
  let release = () => {}
  seen.gate = new Promise<void>(resolve => {
    release = resolve
  })
  const checkout = { tool: 'Bash', input: { command: 'git checkout main' } } as never
  await $.tool.call(checkout)
  seen.status = '## main...origin/main\n'
  for (let i = 0; i < 3; i++) await $.tool.call(checkout)
  seen.gate = undefined
  release()
  await seen.clock.advance(1)
  // The start, the slow read, and one read for the three requests made while it ran.
  expect(seen.gitCalls).toBe(3)
  expect(await (await mount($, 'terminal')).find({ type: 'Text', text: /main/ })).toBeDefined()
  expect(await (await mount($, 'terminal')).find({ type: 'Text', text: /develop/ })).toBeUndefined()
})

test('/session-info shows its verbs in the menu, and help or anything else lists them', async ($, on) => {
  const seen = world(on)
  await start($, 'terminal')
  expect(seen.commands).toEqual([{ name: 'session-info', argumentHint: '[help | settings]' }])
  for (const args of ['', 'help', 'setings']) {
    const answer = await $.command.run({ command: 'session-info', args } as never)
    expect(answer).toEqual(expect.objectContaining({ text: HELP }))
  }
})
