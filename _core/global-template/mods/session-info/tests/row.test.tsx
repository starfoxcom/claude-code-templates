import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { HELP, selectedEffort } from '../hooks/register'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
const SURFACES = ['terminal', 'desktop'] as const
const DIRTY = '## develop...origin/develop [ahead 2, behind 1]\n M a.ts\n M b.ts\n?? c.ts\n'
const SETTINGS = 'mods-data/session-info/settings.json'

// The test runner has timers; the mod sandbox's types do not list them.
declare function setTimeout(callback: () => void, ms: number): unknown

/** A short real wait: room for other work to go ahead (a bound, never what a test waits on to pass). */
function moment(ms = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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
    /** Readable files by the end of their path: the mod's settings file, `plugin.json` for its manifest. */
    files: {} as Record<string, string>,
  }
  on('settings.read', () => ({ value: seen.settings }))
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    const key = Object.keys(seen.files).find(end => path.endsWith(`/${end}`))
    if (key === undefined) throw new Error('ENOENT')
    return { value: seen.files[key] ?? '' }
  })
  on('fs.write', ($, e) => {
    if (e.path.replaceAll('\\', '/').endsWith(`/${SETTINGS}`)) seen.files[SETTINGS] = e.text
    return { value: undefined }
  })
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
    expect(await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · GameProject' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /develop\*/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↓1/ })).toBeDefined()
  })

  test(`${surface}: in a narrow band each part wraps whole, and only one wider than the band is cut`, async ($, on) => {
    world(on)
    await start($, surface)
    const ui = await mount($, surface)
    const props = async (key: string) =>
      ((await ui.find({ key })) as never as { props: Record<string, unknown> } | undefined)?.props
    expect((await props('session-info-row'))?.flexWrap).toBe('wrap')
    for (const key of ['session-info-model', 'session-info-project', 'session-info-branch'])
      expect(await props(key)).toEqual(expect.objectContaining({ flexShrink: 1, minWidth: 0 }))
    expect((await props('session-info-changes-slot'))?.flexShrink).toBe(0)
    const branch = (await ui.find({ type: 'Text', text: /develop\*/ })) as never as { props: Record<string, unknown> }
    expect(branch.props.wrap).toBe('truncate-end')
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
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5 high$/ })).toBeDefined()
})

const TURN_DONE = { turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'done' } as never

test("a request's own effort beats an unchanged pick, even when it lands before the row starts", async ($, on) => {
  const seen = world(on)
  seen.settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'max' } } }
  // After a hot reload the turn's request comes first; the turn's end starts the row.
  const step = { turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }
  await drain($.turn.step(step as never))
  await $.turn.complete(TURN_DONE)
  expect(await (await mount($, 'terminal')).find({ type: 'Text', text: /^Opus 5\.5 high$/ })).toBeDefined()
  // A refresh with the same pick keeps it.
  await seen.clock.advance(30_000)
  expect(await (await mount($, 'terminal')).find({ type: 'Text', text: /^Opus 5\.5 high$/ })).toBeDefined()
})

test('the effort picked in settings shows before the first request, and a new pick replaces it', async ($, on) => {
  const seen = world(on)
  seen.settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }
  await start($, 'terminal')
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5 high$/ })).toBeDefined()
  seen.settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }
  await seen.clock.advance(30_000)
  const after = await mount($, 'terminal')
  expect(await after.find({ type: 'Text', text: /^Opus 5\.5 medium$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · GameProject' })).toBeDefined()
  expect(await ui.find({ key: 'session-info-changes' })).toBeUndefined()
})

test('a failed first read still starts the timer that fills the row', async ($, on) => {
  const seen = world(on)
  seen.isModelDown = true
  await start($, 'terminal')
  expect(await (await mount($, 'terminal')).find({ type: 'Text', text: /GameProject/ })).toBeUndefined()
  seen.isModelDown = false
  await seen.clock.advance(30_000)
  expect(await (await mount($, 'terminal')).find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
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
  expect(seen.commands).toEqual([{ name: 'session-info', argumentHint: '[help | settings | set | phone]' }])
  for (const args of ['', 'help', 'setings']) {
    const answer = await $.command.run({ command: 'session-info', args } as never)
    expect(answer).toEqual(expect.objectContaining({ text: HELP }))
  }
})

test('/session-info phone gives the row as text, ending with the help hint', async ($, on) => {
  world(on)
  await start($, 'terminal')
  const answer = (await $.command.run({ command: 'session-info', args: 'phone' } as never)) as { text: string }
  const lines = answer.text.split('\n')
  expect(lines[0]).toMatch(/^🧭 /)
  expect(lines[1]).toMatch(/^🌿 /)
  expect(lines.at(-1)).toBe('/session-info help for more')
})

test('/session-info phone that lands while a reloaded start still reads git waits for the row', async ($, on) => {
  const seen = world(on)
  let open = () => undefined as void
  seen.gate = new Promise(resolve => (open = resolve))
  const started = start($, 'terminal')
  for (let i = 0; i < 50 && seen.gitCalls === 0; i++) await moment(10)
  expect(seen.gitCalls).toBeGreaterThan(0)
  // The command lands mid-start: git is answered once the command is, or a moment if it waits for the start.
  const phone = $.command.run({ command: 'session-info', args: 'phone' } as never) as Promise<{ text: string }>
  await Promise.race([phone, moment()])
  open()
  await started
  expect((await phone).text.split('\n')[0]).toMatch(/^🧭 /)
})

test('a bare /session-info typed over Remote Control answers with the phone text', async ($, on) => {
  world(on)
  await start($, 'terminal')
  const bridge = { command: 'session-info', args: '', origin: { kind: 'bridge' } }
  const answer = (await $.command.run(bridge as never)) as { text: string }
  expect(answer.text.split('\n').at(-1)).toBe('/session-info help for more')
})

test('the recheck interval in the settings file applies from the start, and a new one takes over', async ($, on) => {
  const seen = world(on)
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const manifest = { userConfig: { refreshSeconds: { type: 'number' }, maxFiles: { type: 'number' } } }
  seen.files = { 'plugin.json': JSON.stringify(manifest), [SETTINGS]: '{"refreshSeconds":60}' }
  await start($, 'terminal')
  const atStart = seen.gitCalls
  await seen.clock.advance(30_000)
  expect(seen.gitCalls).toBe(atStart)
  await seen.clock.advance(30_000)
  const perRead = seen.gitCalls - atStart
  expect(perRead).toBeGreaterThan(0)
  // Off: the old timer ticks once more, then only a slow watch for a new interval runs.
  await $.command.run({ command: 'session-info', args: 'set refreshSeconds 0' } as never)
  await seen.clock.advance(60_000)
  const atOff = seen.gitCalls
  await seen.clock.advance(180_000)
  expect(seen.gitCalls).toBe(atOff)
  // Back on: the slow watch hands over to the new interval.
  await $.command.run({ command: 'session-info', args: 'set refreshSeconds 30' } as never)
  await seen.clock.advance(60_000)
  await seen.clock.advance(30_000)
  expect(seen.gitCalls).toBe(atOff + 2 * perRead)
})
