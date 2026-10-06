import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { HELPER_BLOCK, helpersCommand, helpersLine, isHelperChecked } from '../hooks/helpers'

// The helper-agent block: Agent and Workflow calls while the `helpers` setting is `block`, and the
// per-session allow typed with `/guards helpers allow`.
const LOG = 'C:/Users/me/.claude/mods-data/guards/decisions.jsonl'
const BLOCK = { mode: 'enforce', helpers: 'block' }

function world(on: On) {
  const seen = { files: new Map<string, string>(), ran: [] as string[], session: 'sess-a', isIdDown: false }
  mock.clock(on)
  mock.env(on, { USERPROFILE: 'C:/Users/me', OS: 'Windows_NT' })
  on('session.id', () => {
    if (seen.isIdDown) throw new Error('session.id is down')
    return { value: seen.session }
  })
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    // The manifest, wherever the plugin root is: a test that needs it lists it as `plugin.json`.
    const text = seen.files.get(path.endsWith('/plugin.json') ? 'plugin.json' : path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    seen.files.set(e.path.replaceAll('\\', '/'), e.text)
    return { value: undefined }
  })
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('tool.call', ($, e) => {
    seen.ran.push(String(e.tool))
    return { result: {} as never }
  })
  return seen
}

async function start($: Engine) {
  await $.session.start({ cwd: 'C:/Repos/my-game', surface: 'terminal', isInteractive: true })
}

const agent = ($: Engine) =>
  $.tool.call({ tool: 'Agent', prompt: 'look around', description: 'look' } as never) as Promise<{ deny?: string }>
const workflow = ($: Engine) => $.tool.call({ tool: 'Workflow', script: 'x' } as never) as Promise<{ deny?: string }>
const guards = async ($: Engine, args: string) =>
  ((await $.command.run({ command: 'guards', args } as never)) as { text: string }).text
const logged = (seen: { files: Map<string, string> }) =>
  (seen.files.get(LOG) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line))

test('a helper call is checked only while the setting blocks and this session has no allow', () => {
  const cases: [Parameters<typeof isHelperChecked>[0], boolean][] = [
    [{ setting: 'allow', isAllowedHere: false }, false],
    [{ setting: 'allow', isAllowedHere: true }, false],
    [{ setting: 'block', isAllowedHere: false }, true],
    [{ setting: 'block', isAllowedHere: true }, false],
  ]
  for (const [state, isChecked] of cases) expect(isHelperChecked(state)).toBe(isChecked)
})

test('/guards helpers answers by the setting and the word, and only block mode keeps an allow', () => {
  const blocked = { setting: 'block' as const, isAllowedHere: false }
  expect(helpersCommand('allow', blocked).isAllowedHere).toBe(true)
  expect(helpersCommand('block', { ...blocked, isAllowedHere: true }).isAllowedHere).toBe(false)
  expect(helpersCommand('', blocked)).toEqual({ text: expect.stringContaining('blocked'), isAllowedHere: false })
  expect(helpersCommand('maybe', { ...blocked, isAllowedHere: true }).isAllowedHere).toBe(true)
  const open = helpersCommand('allow', { setting: 'allow', isAllowedHere: false })
  expect(open.text).toContain('setting helpers = allow')
  expect(helpersLine({ setting: 'block', isAllowedHere: false }, false)).toContain('would be blocked')
  expect(helpersLine({ setting: 'block', isAllowedHere: false }, true)).toBe('Helper agents are blocked.')
})

test('with the default setting, Agent and Workflow calls run and nothing is logged', async ($, on) => {
  const seen = world(on)
  await start($)
  expect((await agent($)).deny).toBeUndefined()
  expect((await workflow($)).deny).toBeUndefined()
  expect(seen.ran).toEqual(['Agent', 'Workflow'])
  expect(logged(seen)).toEqual([])
})

test('blocked in enforce mode, Agent and Workflow calls are refused and logged, never counted as writes', {
  options: BLOCK,
}, async ($, on) => {
  const seen = world(on)
  await start($)
  expect((await agent($)).deny).toBe(`BLOCKED (guards): ${HELPER_BLOCK}`)
  expect((await workflow($)).deny).toBe(`BLOCKED (guards): ${HELPER_BLOCK}`)
  expect(seen.ran).toEqual([])
  expect(logged(seen).map(entry => [entry.tool, entry.enforced])).toEqual([
    ['Agent', true],
    ['Workflow', true],
  ])
  // stats.json counts shell writes for the shadow comparison; helper calls stay out of it.
  expect(seen.files.get('C:/Users/me/.claude/mods-data/guards/stats.json')).toBeUndefined()
})

test("one session's allow, block or status look never changes another session's allow", { options: BLOCK }, async (
  $,
  on,
) => {
  const seen = world(on)
  await start($)
  await guards($, 'helpers allow')
  seen.session = 'sess-b'
  expect(await guards($, 'helpers')).toContain('blocked')
  await guards($, 'helpers block')
  expect((await agent($)).deny).toBe(`BLOCKED (guards): ${HELPER_BLOCK}`)
  await guards($, 'helpers allow')
  seen.session = 'sess-a'
  expect((await agent($)).deny).toBeUndefined()
  await guards($, 'helpers block')
  seen.session = 'sess-b'
  expect((await agent($)).deny).toBeUndefined()
  expect(seen.ran).toEqual(['Agent', 'Agent'])
})

test('after a reload, the first helper call reads the saved block before it decides', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on)
  const manifest = {
    userConfig: {
      mode: { type: 'string', options: ['shadow', 'enforce'] },
      helpers: { type: 'string', options: ['allow', 'block'] },
    },
  }
  seen.files.set('plugin.json', JSON.stringify(manifest))
  seen.files.set('C:/Users/me/.claude/mods-data/guards/settings.json', '{"helpers":"block"}')
  // No session.start: a hot reload starts the module over without one.
  expect((await agent($)).deny).toBe(`BLOCKED (guards): ${HELPER_BLOCK}`)
  expect(seen.ran).toEqual([])
})

test('blocked in shadow mode, a helper call runs and is logged as one it would block', {
  options: { mode: 'shadow', helpers: 'block' },
}, async ($, on) => {
  const seen = world(on)
  await start($)
  expect((await agent($)).deny).toBeUndefined()
  expect(seen.ran).toEqual(['Agent'])
  expect(logged(seen)).toEqual([expect.objectContaining({ tool: 'Agent', mod: HELPER_BLOCK })])
  expect(logged(seen)[0].enforced).toBeUndefined()
})

test('/guards helpers allow lets helpers run in this session only, until block', { options: BLOCK }, async (
  $,
  on,
) => {
  const seen = world(on)
  await start($)
  expect(await guards($, 'helpers allow')).toBe('Helper agents are allowed for the rest of this session.')
  expect((await agent($)).deny).toBeUndefined()
  expect(await guards($, '')).toContain('Helper agents are blocked, but allowed in this session.')
  // Another session on the same worker never inherits the allow.
  seen.session = 'sess-b'
  expect((await agent($)).deny).toBe(`BLOCKED (guards): ${HELPER_BLOCK}`)
  seen.session = 'sess-a'
  expect(await guards($, 'helpers block')).toBe('Helper agents are blocked again in this session.')
  expect((await workflow($)).deny).toBe(`BLOCKED (guards): ${HELPER_BLOCK}`)
  expect(seen.ran).toEqual(['Agent'])
})

test('a helper check that fails refuses in enforce mode, and never stops a helper the setting allows', {
  options: BLOCK,
}, async ($, on) => {
  const seen = world(on)
  await start($)
  seen.isIdDown = true
  const answer = await agent($)
  expect(answer.deny).toContain('the check failed before it could read this call')
  expect(seen.ran).toEqual([])
})

test('with helpers allowed, a broken session id still lets helper calls run', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  await start($)
  seen.isIdDown = true
  expect((await agent($)).deny).toBeUndefined()
  expect(seen.ran).toEqual(['Agent'])
})
