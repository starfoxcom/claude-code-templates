import type { ConfigRow, ConfigSetInput, On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { emptyNote, parseNumber, UNLISTED_NOTE, unlistedRows } from '../hooks/settings'

// The settings pane over faked /config rows: the engine's own validation draws it on each surface,
// and every change goes through config.set as the /config menu's would.
const PANE = 'usage-guard-settings'
const PANE_PROPS = {
  title: 'Usage guard settings',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { top: 0 },
  view: {},
} as never
const ENGINE = { plugin: 'engine', tier: 'core' } as never
const THEME: ConfigRow = {
  key: 'theme',
  label: 'Theme',
  kind: 'choice',
  value: 'dark',
  options: ['dark', 'light'],
  provider: ENGINE,
  isLocked: false,
}
const WRAP_UP: ConfigRow = {
  key: 'usage-guard.wrapUpAt',
  label: 'Wrap up at (% used)',
  description: 'When any plan window reaches this percentage, sessions wrap up.',
  kind: 'number',
  value: 90,
  provider: ENGINE,
  isLocked: false,
}
const ROWS: ConfigRow[] = [
  THEME,
  WRAP_UP,
  {
    key: 'usage-guard.wakeDelayMinutes',
    label: 'Resume delay (minutes)',
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

type Pane = Mounted<'terminal' | 'desktop', 'Pane'>
const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<Pane> =>
  $.ui.mount({ plugin: 'usage-guard', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS } as never)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the settings pane lists this mod's rows and saves a change on ${surface}`, async ($, on) => {
    const seen = world(on)
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'setting-wrapUpAt' })).toBeDefined()
    expect(await ui.find({ key: 'setting-wakeDelayMinutes' })).toBeDefined()
    // Another plugin's row and the engine's own stay out of this pane.
    expect(await ui.find({ key: 'setting-theme' })).toBeUndefined()
    // A row a trusted source owns is shown, never offered for change.
    expect(await ui.find({ key: 'usage-guard-set-wakeDelayMinutes' })).toBeUndefined()

    await ui.input({ key: 'usage-guard-set-wrapUpAt', text: '85' })
    expect(seen.writes).toEqual([{ key: 'usage-guard.wrapUpAt', value: 85 }])
  })
}

test('rows whose key names where the plugin came from are still this mod, saved under their own key', async ($, on) => {
  const writes: Pick<ConfigSetInput, 'key' | 'value'>[] = []
  const qualified = ROWS.map(row => ({ ...row, key: row.key.replace('usage-guard.', 'usage-guard@inline.') }))
  on('config.list', () => ({ value: [...qualified, { ...WRAP_UP, key: 'usage-guard-extra.wrapUpAt' }] }))
  on('config.set', ($, e) => {
    writes.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'setting-wrapUpAt' })).toBeDefined()
  expect(await ui.find({ key: 'setting-wakeDelayMinutes' })).toBeDefined()
  await ui.input({ key: 'usage-guard-set-wrapUpAt', text: '85' })
  // Only the one row: a plugin whose name merely starts the same is another plugin.
  expect(writes).toEqual([{ key: 'usage-guard@inline.wrapUpAt', value: 85 }])
})

// The Desktop app lists no plugin rows in /config: the pane draws the mod's fields from the manifest and
// the loaded values, and tries each change anyway (a row the menu leaves out may still take a set).
const MANIFEST = JSON.stringify({
  userConfig: { wrapUpAt: { type: 'number', title: 'Wrap up at (% used)', description: 'Sessions wrap up here.' } },
})
function noPluginRows(on: On, list: () => unknown, set: (key: string) => string | undefined = () => undefined) {
  const writes: Pick<ConfigSetInput, 'key' | 'value'>[] = []
  on('config.list', list as never)
  on('config.set', ($, e) => {
    writes.push({ key: e.key, value: e.value })
    const deny = set(e.key)
    return deny ? { deny } : { value: e.value }
  })
  on('fs.read', ($, e) => {
    if (String((e as { path?: string }).path).endsWith('plugin.json')) return { value: MANIFEST }
    throw new Error('no such file')
  })
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return writes
}

test('a surface whose /config has no plugin rows still draws the fields, named by the manifest', async ($, on) => {
  noPluginRows(on, () => ({ value: [THEME] }))
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: UNLISTED_NOTE })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Wrap up at (% used)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Sessions wrap up here.' })).toBeDefined()
  expect(await ui.find({ key: 'usage-guard-set-wrapUpAt' })).toBeDefined()
  // A field the manifest does not describe shows by its own name.
  expect(await ui.find({ type: 'Text', text: 'wakeDelayMinutes' })).toBeDefined()
})

test('a change there is tried by its plain key and says it was saved', async ($, on) => {
  const writes = noPluginRows(on, () => ({ value: [THEME] }))
  const ui = await mountPane($, 'desktop')
  await ui.input({ key: 'usage-guard-set-wrapUpAt', text: '85' })
  expect(writes).toEqual([{ key: 'usage-guard.wrapUpAt', value: 85 }])
  expect(await ui.find({ type: 'Text', text: 'Saved: 85.' })).toBeDefined()
})

test('a plain key refused there is tried with the inline source next', async ($, on) => {
  const writes = noPluginRows(on, () => ({ value: [THEME] }), key => (key.includes('@') ? undefined : 'no such row'))
  const ui = await mountPane($, 'desktop')
  await ui.input({ key: 'usage-guard-set-wrapUpAt', text: '85' })
  expect(writes.map(write => write.key)).toEqual(['usage-guard.wrapUpAt', 'usage-guard@inline.wrapUpAt'])
  expect(await ui.find({ type: 'Text', text: 'Saved: 85 (as usage-guard@inline.wrapUpAt).' })).toBeDefined()
})

test('both keys refused there: each refusal shows word for word', async ($, on) => {
  noPluginRows(on, () => ({ value: [THEME] }), key => `no row ${key}`)
  const ui = await mountPane($, 'desktop')
  await ui.input({ key: 'usage-guard-set-wrapUpAt', text: '85' })
  const text = 'Refused. usage-guard.wrapUpAt: no row usage-guard.wrapUpAt usage-guard@inline.wrapUpAt: no row ' +
    'usage-guard@inline.wrapUpAt'
  expect(await ui.find({ type: 'Text', text })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Saved/ })).toBeUndefined()
})

test('a /config that cannot be listed draws the fields too', async ($, on) => {
  noPluginRows(on, () => {
    throw new Error('no menu here')
  })
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: UNLISTED_NOTE })).toBeDefined()
  expect(await ui.find({ key: 'usage-guard-set-wrapUpAt' })).toBeDefined()
})

test('the rows /config left out take their kind from the manifest', () => {
  const fields = { on: { type: 'boolean' }, pick: { type: 'string', options: ['a', 'b'] }, n: { type: 'number' } }
  const rows = unlistedRows({ on: true, pick: 'a', n: 3, free: 'x' }, fields)
  expect(rows.map(row => [row.key, row.kind])).toEqual([
    ['usage-guard.on', 'boolean'],
    ['usage-guard.pick', 'choice'],
    ['usage-guard.n', 'number'],
    ['usage-guard.free', 'text'],
  ])
})

test('the note there names the terminal menu and this mod command', () => {
  expect(UNLISTED_NOTE).toContain("The terminal's /config (or /usage-guard settings there) always works.")
})

// With no values to show, the pane says what /config listed, or why it could not.
test("with nothing to show, the note names other plugins' rows, not the engine's", () => {
  const other = { ...THEME, key: 'ci-watch.pollSeconds', provider: { plugin: 'ci-watch', tier: 'user' } as never }
  expect(emptyNote([THEME])).toBe('No settings for usage-guard here: /config listed 1 row(s), 0 of them from plugins.')
  const named = /2 row\(s\), 1 of them from plugins, such as ci-watch\.pollSeconds \(ci-watch\)\.$/
  expect(emptyNote([THEME, other])).toMatch(named)
  expect(emptyNote(new Error('no menu here'))).toBe(
    'No settings for usage-guard here: /config could not be listed (no menu here).',
  )
})

test('a refused change shows its reason under the field', async ($, on) => {
  world(on, 'Must be between 50 and 99')
  const ui = await mountPane($)
  await ui.input({ key: 'usage-guard-set-wrapUpAt', text: '120' })
  expect(await ui.find({ type: 'Text', text: /Must be between 50 and 99/ })).toBeDefined()
})

test('text that is not a number is refused before anything is written', async ($, on) => {
  const seen = world(on)
  const ui = await mountPane($)
  await ui.input({ key: 'usage-guard-set-wrapUpAt', text: 'ninety' })
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

test('/usage-guard settings opens the pane', async ($, on) => {
  const seen = world(on)
  const answer = await $.command.run({ command: 'usage-guard', args: 'settings' } as never)
  expect(seen.opened).toEqual([PANE])
  expect(answer).toEqual(expect.objectContaining({ text: 'Opened the usage-guard settings.' }))
})
