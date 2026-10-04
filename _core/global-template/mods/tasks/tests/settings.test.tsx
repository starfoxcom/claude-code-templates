import type { ConfigRow, ConfigSetInput, On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { PANE as LIST_PANE } from '../hooks/view'

// The settings pane over faked /config rows, through the module's real registration order: the
// settings pane and the task list pane hook the same component, and each must still draw its own.
const PANE = 'tasks-settings'
const PANE_PROPS = {
  title: 'Tasks settings',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { top: 0 },
  view: {},
} as never
const ENGINE = { plugin: 'engine', tier: 'core' } as never
const SET = { provider: ENGINE, isLocked: false }
const ROWS: ConfigRow[] = [
  { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: ['dark', 'light'], ...SET },
  {
    key: 'tasks.nudgeAfterTools',
    label: 'Ask for a task list after (tool calls)',
    description: 'The first field.',
    kind: 'number',
    value: 3,
    provider: ENGINE,
    isLocked: false,
  },
]

function world(on: On, deny?: string) {
  const writes: Pick<ConfigSetInput, 'key' | 'value'>[] = []
  const opened: string[] = []
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: 'sess-a' }))
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
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

const mountPane = ($: Engine, requestId: string, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'tasks', surface, component: 'Pane', requestId, props: PANE_PROPS } as never) as Promise<
    Mounted<'terminal' | 'desktop', 'Pane'>
  >

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the settings pane lists this mod's rows and saves a change on ${surface}`, async ($, on) => {
    const seen = world(on)
    const ui = await mountPane($, PANE, surface)
    expect(await ui.find({ key: 'setting-nudgeAfterTools' })).toBeDefined()
    expect(await ui.find({ key: 'setting-theme' })).toBeUndefined()
    await ui.input({ key: 'tasks-set-nudgeAfterTools', text: '5' })
    expect(seen.writes).toEqual([{ key: 'tasks.nudgeAfterTools', value: 5 }])
  })
}

test('the task list pane still draws beside the settings pane', async ($, on) => {
  world(on)
  const list = await mountPane($, LIST_PANE)
  expect(await list.find({ type: 'Text', text: /No tasks in this session/ })).toBeDefined()
  expect(await list.find({ key: 'setting-nudgeAfterTools' })).toBeUndefined()
})

test('a refused change shows its reason under the field', async ($, on) => {
  world(on, 'Must be 0 or more')
  const ui = await mountPane($, PANE)
  await ui.input({ key: 'tasks-set-nudgeAfterTools', text: '-1' })
  expect(await ui.find({ type: 'Text', text: /Must be 0 or more/ })).toBeDefined()
})
