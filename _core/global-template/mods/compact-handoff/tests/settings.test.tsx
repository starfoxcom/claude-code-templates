import type { ConfigRow, ConfigSetInput, On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'
import { READ_ONLY_NOTE } from '../hooks/settings'

// The settings pane over faked /config rows: the engine's own validation draws it on each surface,
// and every change goes through config.set as the /config menu's would.
const PANE = 'compact-handoff-settings'
const PANE_PROPS = {
  title: 'Compact hand-off settings',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { top: 0 },
  view: {},
} as never
const ENGINE = { plugin: 'engine', tier: 'core' } as never
const SET = { provider: ENGINE, isLocked: false }
const MODES = ['off', 'shadow', 'on']
const ROWS: ConfigRow[] = [
  { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: ['dark', 'light'], ...SET },
  { key: 'compact-handoff.mode', label: 'Mode', kind: 'choice', value: 'on', options: MODES, ...SET },
]

function world(on: On, deny?: string) {
  const writes: Pick<ConfigSetInput, 'key' | 'value'>[] = []
  on('config.list', () => ({ value: ROWS }))
  on('config.set', ($, e) => {
    writes.push({ key: e.key, value: e.value })
    return deny ? { deny } : { value: e.value }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return { writes }
}

const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({
    plugin: 'compact-handoff',
    surface,
    component: 'Pane',
    requestId: PANE,
    props: PANE_PROPS,
  } as never) as Promise<Mounted<'terminal' | 'desktop', 'Pane'>>

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the settings pane offers the modes and saves a pick on ${surface}`, async ($, on) => {
    const seen = world(on)
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'setting-mode' })).toBeDefined()
    expect(await ui.find({ key: 'setting-theme' })).toBeUndefined()
    await ui.select({ key: 'compact-handoff-set-mode', value: 'shadow' })
    expect(seen.writes).toEqual([{ key: 'compact-handoff.mode', value: 'shadow' }])
  })
}

test('a refused change shows its reason under the field', async ($, on) => {
  world(on, 'Not allowed here')
  const ui = await mountPane($)
  await ui.select({ key: 'compact-handoff-set-mode', value: 'off' })
  expect(await ui.find({ type: 'Text', text: /Not allowed here/ })).toBeDefined()
})

// The Desktop app lists no plugin rows in /config: the pane shows the mod's values read-only, named by
// the manifest, and offers nothing to change there.
const TITLES = { userConfig: { mode: { title: 'Mode' } } }

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
  expect(await ui.find({ key: 'setting-mode' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Mode' })).toBeDefined()
  expect(await ui.find({ key: 'compact-handoff-set-mode' })).toBeUndefined()
})

test('a /config that cannot be listed says so, not that the app hides the rows', async ($, on) => {
  noPluginRows(on, () => ({ deny: 'no menu here' }))
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /could not be listed \(.*no menu here.*\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: READ_ONLY_NOTE })).toBeUndefined()
})

test('a row listed under a qualified key is this mod\'s and saves under that same key', async ($, on) => {
  const writes: string[] = []
  const qualified = ROWS.map(row => ({ ...row, key: row.key.replace('compact-handoff.', 'compact-handoff@inline.') }))
  on('config.list', () => ({ value: [...qualified, { ...qualified[1], key: 'compact-handoff-extra.mode' }] }))
  on('config.set', ($, e) => {
    writes.push(e.key)
    return { value: e.value }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: READ_ONLY_NOTE })).toBeUndefined()
  await ui.select({ key: 'compact-handoff-set-mode', value: 'shadow' })
  expect(writes).toEqual(['compact-handoff@inline.mode'])
})
