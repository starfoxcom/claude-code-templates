import type { ConfigRow, ConfigSetInput, On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { HELP } from '../hooks/register'
import { READ_ONLY_NOTE, parseNumber } from '../hooks/settings'

// The settings pane over faked /config rows: the engine's own validation draws it on each surface,
// and every change goes through config.set as the /config menu's would.
const PANE = 'session-facts-settings'
const PANE_PROPS = {
  title: 'Session facts settings',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { top: 0 },
  view: {},
} as never
const ENGINE = { plugin: 'engine', tier: 'core' } as never
const ROWS: ConfigRow[] = [
  {
    key: 'theme',
    label: 'Theme',
    kind: 'choice',
    value: 'dark',
    options: ['dark', 'light'],
    provider: ENGINE,
    isLocked: false,
  },
  {
    key: 'session-facts.planWarnAt',
    label: 'First field',
    description: 'The first field.',
    kind: 'number',
    value: 90,
    provider: ENGINE,
    isLocked: false,
  },
  {
    key: 'session-facts.cacheWarnMinutes',
    label: 'Second field',
    kind: 'number',
    value: 2,
    provider: ENGINE,
    isLocked: true,
  },
]

function world(on: On, deny?: string) {
  const writes: Pick<ConfigSetInput, 'key' | 'value'>[] = []
  const opened: string[] = []
  on('config.list', () => ({ value: ROWS }))
  on('config.set', ($, e) => {
    writes.push({ key: e.key, value: e.value })
    return deny ? { deny } : { value: e.value }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return { writes, opened }
}

// The pane's props are faked whole, so the mount is typed by hand: a field-drawing surface's Pane.
const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({
    plugin: 'session-facts',
    surface,
    component: 'Pane',
    requestId: PANE,
    props: PANE_PROPS,
  } as never) as Promise<Mounted<'terminal' | 'desktop', 'Pane'>>

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the settings pane lists this mod's rows and saves a change on ${surface}`, async ($, on) => {
    const seen = world(on)
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'setting-planWarnAt' })).toBeDefined()
    expect(await ui.find({ key: 'setting-cacheWarnMinutes' })).toBeDefined()
    // Another plugin's row and the engine's own stay out of this pane.
    expect(await ui.find({ key: 'setting-theme' })).toBeUndefined()
    // A row a trusted source owns is shown, never offered for change.
    expect(await ui.find({ key: 'session-facts-set-cacheWarnMinutes' })).toBeUndefined()

    await ui.input({ key: 'session-facts-set-planWarnAt', text: '85' })
    expect(seen.writes).toEqual([{ key: 'session-facts.planWarnAt', value: 85 }])
  })
}

test('a refused change shows its reason under the field', async ($, on) => {
  world(on, 'Must be between 50 and 99')
  const ui = await mountPane($)
  await ui.input({ key: 'session-facts-set-planWarnAt', text: '120' })
  expect(await ui.find({ type: 'Text', text: /Must be between 50 and 99/ })).toBeDefined()
})

test('text that is not a number is refused before anything is written', async ($, on) => {
  const seen = world(on)
  const ui = await mountPane($)
  await ui.input({ key: 'session-facts-set-planWarnAt', text: 'ninety' })
  expect(seen.writes).toEqual([])
  expect(await ui.find({ type: 'Text', text: /"ninety" is not a number/ })).toBeDefined()
})

test('numbers parse from trimmed text; empty and non-numeric text do not', () => {
  expect(parseNumber(' 85 ')).toEqual({ value: 85 })
  expect(parseNumber('0')).toEqual({ value: 0 })
  expect('error' in parseNumber('')).toBe(true)
  expect('error' in parseNumber('ninety')).toBe(true)
  expect('error' in parseNumber('Infinity')).toBe(true)
})

test('/session-facts settings opens the pane', async ($, on) => {
  const seen = world(on)
  const answer = await $.command.run({ command: 'session-facts', args: 'settings' } as never)
  expect(seen.opened).toEqual([PANE])
  expect(answer).toEqual(expect.objectContaining({ text: 'Opened the session-facts settings.' }))
})

test('/session-facts with help, no argument or an unknown one answers with the help', async ($, on) => {
  const seen = world(on)
  for (const args of ['help', '', 'nonsense']) {
    const answer = await $.command.run({ command: 'session-facts', args } as never)
    expect(answer).toEqual(expect.objectContaining({ text: HELP }))
  }
  expect(seen.opened).toEqual([])
})

test('a bare /session-facts typed over Remote Control answers with the phone text', async ($, on) => {
  world(on)
  const bridge = { command: 'session-facts', args: '', origin: { kind: 'bridge' } }
  const answer = (await $.command.run(bridge as never)) as { text: string }
  expect(answer.text.split('\n').at(-1)).toBe('/session-facts help for more')
})

// The Desktop app lists no plugin rows in /config: the pane shows the mod's values read-only, named by
// the manifest, and offers nothing to change there.
const TITLES = { userConfig: { planWarnAt: { title: 'Warn on plan usage at (%)' } } }

function noPluginRows(on: On, list: () => unknown) {
  on('config.list', list as never)
  on('fs.read', ($, e) => {
    if (String((e as { path?: string }).path).endsWith('plugin.json')) return { value: JSON.stringify(TITLES) }
    throw new Error('no such file')
  })
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
}

test('a /config with no plugin rows shows the values read-only, named by the manifest', async ($, on) => {
  noPluginRows(on, () => ({ value: ROWS.filter(row => row.key === 'theme') }))
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: READ_ONLY_NOTE })).toBeDefined()
  expect(await ui.find({ key: 'setting-planWarnAt' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Warn on plan usage at (%)' })).toBeDefined()
  expect(await ui.find({ key: 'session-facts-set-planWarnAt' })).toBeUndefined()
})

test('a /config that cannot be listed says so, not that the app hides the rows', async ($, on) => {
  noPluginRows(on, () => ({ deny: 'no menu here' }))
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /could not be listed \(.*no menu here.*\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: READ_ONLY_NOTE })).toBeUndefined()
})

test('a row listed under a qualified key is this mod\'s and saves under that same key', async ($, on) => {
  const writes: string[] = []
  const qualified = ROWS.map(row => ({ ...row, key: row.key.replace('session-facts.', 'session-facts@inline.') }))
  on('config.list', () => ({ value: [...qualified, { ...qualified[1], key: 'session-facts-extra.planWarnAt' }] }))
  on('config.set', ($, e) => {
    writes.push(e.key)
    return { value: e.value }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: READ_ONLY_NOTE })).toBeUndefined()
  await ui.input({ key: 'session-facts-set-planWarnAt', text: '85' })
  expect(writes).toEqual(['session-facts@inline.planWarnAt'])
})

test('rows of another plugin in /config name what was listed, not an app that hides them', async ($, on) => {
  const other = { ...ROWS[0], key: 'other-mod.level', provider: { plugin: 'other-mod', tier: 'user' } as never }
  noPluginRows(on, () => ({ value: [ROWS[0], other] }))
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /No settings for session-facts here: .*other-mod\.level/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: READ_ONLY_NOTE })).toBeUndefined()
})
