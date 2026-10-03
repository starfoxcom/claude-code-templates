import type { ConfigRow, ConfigSetInput, On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { parseNumber } from '../hooks/settings'

// The settings pane over faked /config rows: the engine's own validation draws it on each surface,
// and every change goes through config.set as the /config menu's would.
const PANE = 'ci-watch-settings'
const PANE_PROPS = {
  title: 'CI watch settings',
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
    key: 'ci-watch.pollSeconds',
    label: 'First field',
    description: 'The first field.',
    kind: 'number',
    value: 90,
    provider: ENGINE,
    isLocked: false,
  },
  {
    key: 'ci-watch.timeoutMinutes',
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
    plugin: 'ci-watch',
    surface,
    component: 'Pane',
    requestId: PANE,
    props: PANE_PROPS,
  } as never) as Promise<Mounted<'terminal' | 'desktop', 'Pane'>>

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the settings pane lists this mod's rows and saves a change on ${surface}`, async ($, on) => {
    const seen = world(on)
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'setting-pollSeconds' })).toBeDefined()
    expect(await ui.find({ key: 'setting-timeoutMinutes' })).toBeDefined()
    // Another plugin's row and the engine's own stay out of this pane.
    expect(await ui.find({ key: 'setting-theme' })).toBeUndefined()
    // A row a trusted source owns is shown, never offered for change.
    expect(await ui.find({ key: 'ci-watch-set-timeoutMinutes' })).toBeUndefined()

    await ui.input({ key: 'ci-watch-set-pollSeconds', text: '85' })
    expect(seen.writes).toEqual([{ key: 'ci-watch.pollSeconds', value: 85 }])
  })
}

test('a refused change shows its reason under the field', async ($, on) => {
  world(on, 'Must be between 50 and 99')
  const ui = await mountPane($)
  await ui.input({ key: 'ci-watch-set-pollSeconds', text: '120' })
  expect(await ui.find({ type: 'Text', text: /Must be between 50 and 99/ })).toBeDefined()
})

test('text that is not a number is refused before anything is written', async ($, on) => {
  const seen = world(on)
  const ui = await mountPane($)
  await ui.input({ key: 'ci-watch-set-pollSeconds', text: 'ninety' })
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

test('/ci-watch settings opens the pane', async ($, on) => {
  const seen = world(on)
  const answer = await $.command.run({ command: 'ci-watch', args: 'settings' } as never)
  expect(seen.opened).toEqual([PANE])
  expect(answer).toEqual(expect.objectContaining({ text: 'Opened the ci-watch settings.' }))
})
