import type { CommandInfo, On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { expandHome, HELP, modFolders } from '../hooks/register'

const PANE_PROPS = {
  title: 'Mods',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { top: 0 },
  view: {},
} as never
const DIRS = ['ci-watch', 'shared-pc', 'broken'].map(mod => String.raw`C:\Users\me\.claude\mods` + '\\' + mod).join(';')
const MANIFESTS: Record<string, object> = {
  'C:/Users/me/.claude/mods/ci-watch/.claude-plugin/plugin.json': { name: 'ci-watch', description: 'Watches CI.' },
  'C:/Users/me/.claude/mods/shared-pc/.claude-plugin/plugin.json': { name: 'shared-pc', description: 'Turns.' },
  '/home/me/.claude/mods/tasks/.claude-plugin/plugin.json': { name: 'tasks', description: 'Keeps the list.' },
  '/opt/mods/runners/.claude-plugin/plugin.json': { name: 'runners', description: 'Local runners.' },
}
const WINDOWS_ENV = { OS: 'Windows_NT', CLAUDE_CODE_PLUGIN_DIRS: DIRS }
// What the README allows on macOS and Linux: `:` between folders, `~` for the home folder.
const POSIX_ENV = { HOME: '/home/me', CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/tasks:/opt/mods/runners/' }
const COMMANDS: CommandInfo[] = [
  { name: 'ci-watch', description: 'The PRs this session watches', source: 'plugin' },
  { name: 'pc', description: 'The shared PC', source: 'plugin' },
  { name: 'help', description: 'Help', source: 'builtin' },
]

function world(on: On, env: Record<string, string> = WINDOWS_ENV) {
  const seen = { opened: [] as string[], commands: [] as { name: string; argumentHint?: string }[] }
  mock.env(on, env)
  on('fs.read', ($, e) => {
    // The engine resolves a POSIX path against the host's drive when the tests run on Windows.
    const path = e.path.replaceAll('\\', '/')
    const manifest = MANIFESTS[path] ?? MANIFESTS[path.replace(/^[A-Za-z]:(?=\/(?:home|opt)\/)/, '')]
    if (!manifest) throw new Error('ENOENT')
    return { value: JSON.stringify(manifest) }
  })
  on('command.list', () => ({ value: COMMANDS }))
  on('command.register', ($, e) => {
    seen.commands.push({ name: e.name, argumentHint: e.argumentHint })
    return { value: { command: e.name } as never }
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return seen
}

const mountPane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'mods',
    surface,
    component: 'Pane',
    requestId: 'mods-list',
    props: PANE_PROPS,
  } as never) as Promise<Mounted<'terminal' | 'desktop', 'Pane'>>

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane lists each mod, its own command, and the other plugin commands on ${surface}`, async ($, on) => {
    world(on)
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /3 mods loaded/ })).toBeDefined()
    expect(await ui.find({ key: 'mods-row-ci-watch' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Watches CI\./ })).toBeDefined()
    expect(await ui.find({ key: 'mods-command-ci-watch' })).toBeDefined()
    // A folder with no readable manifest still shows, by its folder name.
    expect(await ui.find({ key: 'mods-row-broken' })).toBeDefined()
    // A command not named after a mod is listed apart; a built-in one not at all.
    expect(await ui.find({ key: 'mods-others' })).toBeDefined()
    expect(await ui.find({ key: 'mods-command-pc' })).toBeDefined()
    expect(await ui.find({ key: 'mods-command-help' })).toBeUndefined()
  })
}

test('/mods opens the pane, and any argument lists its verbs', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  expect(seen.commands).toEqual([{ name: 'mods', argumentHint: '[help]' }])
  const run = (args: string) => $.command.run({ command: 'mods', args } as never)
  expect(await run('')).toEqual(expect.objectContaining({ text: 'Opened the mods list.' }))
  expect(seen.opened).toEqual(['mods-list'])
  for (const args of ['help', 'list']) expect(await run(args)).toEqual(expect.objectContaining({ text: HELP }))
})

test('the folder list splits on ; on Windows and on : elsewhere', () => {
  expect(modFolders(String.raw`C:\a; C:\b;`, true)).toEqual([String.raw`C:\a`, String.raw`C:\b`])
  expect(modFolders('/home/me/a:/home/me/b', false)).toEqual(['/home/me/a', '/home/me/b'])
  expect(modFolders(undefined, true)).toEqual([])
})

test('on macOS and Linux, a ~ folder and a trailing-slash folder both show their manifest', async ($, on) => {
  world(on, POSIX_ENV)
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /2 mods loaded/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Keeps the list\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Local runners\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No readable plugin\.json/ })).toBeUndefined()
})

test('a leading ~ is the home folder; a ~ inside a name is not', () => {
  expect(expandHome('~/.claude/mods/tasks', '/home/me')).toBe('/home/me/.claude/mods/tasks')
  expect(expandHome(String.raw`~\mods\tasks`, String.raw`C:\Users\me`)).toBe(String.raw`C:\Users\me\mods\tasks`)
  expect(expandHome('~', '/home/me')).toBe('/home/me')
  expect(expandHome('~other/mods', '/home/me')).toBe('~other/mods')
  expect(expandHome('/opt/mods', '/home/me')).toBe('/opt/mods')
})
