import type { ConfigRow, ConfigSetInput, On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

// The settings pane over faked /config rows: the engine's own validation draws it on each surface,
// and every change goes through config.set as the /config menu's would.
const PANE = 'guards-settings'
const PANE_PROPS = {
  title: 'Guards settings',
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
    key: 'guards.mentionRepos',
    label: 'Repos that may name the product',
    description: 'The first field.',
    kind: 'text',
    value: '*',
    provider: ENGINE,
    isLocked: false,
  },
  {
    key: 'guards.mode',
    label: 'Mode',
    kind: 'choice',
    value: 'shadow',
    options: ['shadow', 'enforce'],
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
  $.ui.mount({ plugin: 'guards', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS } as never)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the settings pane lists this mod's rows and saves a change on ${surface}`, async ($, on) => {
    const seen = world(on)
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'setting-mentionRepos' })).toBeDefined()
    expect(await ui.find({ key: 'setting-mode' })).toBeDefined()
    // Another plugin's row and the engine's own stay out of this pane.
    expect(await ui.find({ key: 'setting-theme' })).toBeUndefined()
    // A row a trusted source owns is shown, never offered for change.
    expect(await ui.find({ key: 'guards-set-mode' })).toBeUndefined()

    await ui.input({ key: 'guards-set-mentionRepos', text: 'docs-site' })
    expect(seen.writes).toEqual([{ key: 'guards.mentionRepos', value: 'docs-site' }])
  })
}

test('a refused change shows its reason under the field', async ($, on) => {
  world(on, 'Not a repo list')
  const ui = await mountPane($)
  await ui.input({ key: 'guards-set-mentionRepos', text: '!!' })
  expect(await ui.find({ type: 'Text', text: /Not a repo list/ })).toBeDefined()
})
