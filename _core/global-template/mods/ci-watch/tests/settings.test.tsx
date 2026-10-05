import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { effectiveValues, kindOf, parseValue, settingsList } from '../hooks/settings'

// The settings pane and `/ci-watch set` over a faked settings file and manifest: the engine's own
// validation draws the pane on each surface, and every change lands in the mod's own file.
const PANE = 'ci-watch-settings'
const PANE_PROPS = {
  title: 'CI watch settings',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { top: 0 },
  view: {},
} as never
const FILE = 'C:/Users/me/.claude/mods-data/ci-watch/settings.json'
const FIELDS = {
  wrapUpAt: { type: 'number', title: 'Wrap up at (% used)', description: 'Sessions wrap up here.' },
  wakeDelayMinutes: { type: 'number', title: 'Resume delay (minutes)' },
}

function world(on: On, saved?: Record<string, unknown>) {
  const files = new Map<string, string>()
  if (saved) files.set(FILE, JSON.stringify(saved))
  const opened: string[] = []
  let isFolderMissing = !saved
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('config.describe', ($, e) => ({ label: e.label, description: e.description, isHidden: e.isHidden }))
  on('fs.read', ($, e) => {
    const path = String(e.path).replace(/\\/g, '/')
    if (path.endsWith('plugin.json')) return { value: JSON.stringify({ userConfig: FIELDS }) }
    const text = files.get(path)
    if (text === undefined) throw new Error('no such file')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    // The first save finds the folder missing until it is made.
    if (isFolderMissing) throw new Error('no such folder')
    files.set(String(e.path).replace(/\\/g, '/'), e.text)
    return { value: undefined }
  })
  on('process.run', () => {
    isFolderMissing = false
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  const savedNow = () => JSON.parse(files.get(FILE) ?? '{}') as Record<string, unknown>
  return { savedNow, opened }
}

type Pane = Mounted<'terminal' | 'desktop', 'Pane'>
const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<Pane> =>
  $.ui.mount({ plugin: 'ci-watch', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS } as never)
const run = async ($: Engine, args: string) =>
  ((await $.command.run({ command: 'ci-watch', args } as never)) as { text: string }).text

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane draws every field from the manifest and saves to the mod's file on ${surface}`, async ($, on) => {
    const seen = world(on)
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: 'Wrap up at (% used)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Sessions wrap up here.' })).toBeDefined()
    expect(await ui.find({ key: 'ci-watch-set-wakeDelayMinutes' })).toBeDefined()
    await ui.input({ key: 'ci-watch-set-wrapUpAt', text: '85' })
    // The folder was missing on the first save: it is made, and the save goes through.
    expect(seen.savedNow()).toEqual({ wrapUpAt: 85 })
    expect(await ui.find({ type: 'Text', text: 'Saved: 85.' })).toBeDefined()
  })
}

test('a save keeps the values another session saved a moment ago', async ($, on) => {
  const seen = world(on, { wakeDelayMinutes: 5 })
  const ui = await mountPane($)
  await ui.input({ key: 'ci-watch-set-wrapUpAt', text: '85' })
  expect(seen.savedNow()).toEqual({ wakeDelayMinutes: 5, wrapUpAt: 85 })
})

test('text that is not a number is refused before anything is written', async ($, on) => {
  const seen = world(on, {})
  const ui = await mountPane($)
  await ui.input({ key: 'ci-watch-set-wrapUpAt', text: 'ninety' })
  expect(seen.savedNow()).toEqual({})
  expect(await ui.find({ type: 'Text', text: /"ninety" is not a number/ })).toBeDefined()
})

test("a pane opened again starts clean, with no earlier save's outcome under its fields", async ($, on) => {
  world(on, {})
  const ui = await mountPane($)
  await ui.input({ key: 'ci-watch-set-wrapUpAt', text: 'ninety' })
  expect(await run($, 'settings')).toBe('Opened the ci-watch settings.')
  // Mounted again on the other surface: the same pane cannot mount twice on one.
  const again = await mountPane($, 'desktop')
  expect(await again.find({ type: 'Text', text: /is not a number/ })).toBeUndefined()
})

test('/ci-watch settings opens the pane', async ($, on) => {
  const seen = world(on)
  expect(await run($, 'settings')).toBe('Opened the ci-watch settings.')
  expect(seen.opened).toEqual([PANE])
})

test('/ci-watch set lists the settings, saves one, and refuses an unknown name or a bad value', async ($, on) => {
  const seen = world(on, { wakeDelayMinutes: 5 })
  const list = await run($, 'set')
  expect(list).toContain('change one with /ci-watch set <name> <value>')
  expect(list).toMatch(/wakeDelayMinutes +5 +Resume delay \(minutes\)/)
  expect(await run($, 'set wrapUpAt 85')).toBe(
    'Saved: wrapUpAt is 85 for every session (the others within a minute).',
  )
  expect(seen.savedNow()).toEqual({ wakeDelayMinutes: 5, wrapUpAt: 85 })
  expect(await run($, 'set nope 1')).toBe('No setting named "nope". /ci-watch set lists the settings.')
  expect(await run($, 'set wrapUpAt lots')).toBe('"lots" is not a number /ci-watch set lists the settings.')
  expect(seen.savedNow()).toEqual({ wakeDelayMinutes: 5, wrapUpAt: 85 })
})

test("the mod's /config rows are hidden; other rows are left alone", async ($, on) => {
  world(on)
  const provider = { plugin: 'engine', tier: 'core' } as never
  const describe = (key: string) =>
    $.config.describe({ key, label: key, isHidden: false, provider } as never) as Promise<{ isHidden: boolean }>
  expect((await describe('ci-watch.wrapUpAt')).isHidden).toBe(true)
  expect((await describe('ci-watch@inline.wrapUpAt')).isHidden).toBe(true)
  expect((await describe('other-mod.wrapUpAt')).isHidden).toBe(false)
  expect((await describe('theme')).isHidden).toBe(false)
})

test('the effective values: a saved value that fits its field, over the loaded options', () => {
  const options = { wrapUpAt: 90, wakeDelayMinutes: 2 }
  expect(effectiveValues(options, { wrapUpAt: 85 }, FIELDS)).toEqual({ wrapUpAt: 85, wakeDelayMinutes: 2 })
  // A value of the wrong kind, or for a field the manifest does not declare, is ignored.
  expect(effectiveValues(options, { wrapUpAt: 'lots', other: 1 }, FIELDS)).toEqual(options)
})

test('values parse by their kind', () => {
  const choice = { type: 'string', options: ['a', 'b'] }
  expect(kindOf({ type: 'boolean' })).toBe('boolean')
  expect(kindOf(choice)).toBe('choice')
  expect(parseValue({ type: 'number' }, ' 85 ')).toEqual({ value: 85 })
  expect('error' in parseValue({ type: 'number' }, '')).toBe(true)
  expect('error' in parseValue({ type: 'number' }, 'Infinity')).toBe(true)
  expect(parseValue({ type: 'boolean' }, 'on')).toEqual({ value: true })
  expect(parseValue({ type: 'boolean' }, 'OFF')).toEqual({ value: false })
  expect('error' in parseValue({ type: 'boolean' }, 'maybe')).toBe(true)
  expect(parseValue(choice, 'b')).toEqual({ value: 'b' })
  expect(parseValue(choice, 'c')).toEqual({ error: '"c" is not one of: a, b' })
  expect(parseValue({ type: 'string' }, 'any text')).toEqual({ value: 'any text' })
})

test('the list shows each setting with its value and title', () => {
  const text = settingsList({ wrapUpAt: 90, wakeDelayMinutes: 2 }, FIELDS)
  expect(text.split('\n').slice(1)).toEqual([
    '  wrapUpAt          90  Wrap up at (% used)',
    '  wakeDelayMinutes  2  Resume delay (minutes)',
  ])
})
