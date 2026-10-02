import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { ordered, PANE } from '../hooks/view'
import type { TaskRow } from '../types'

// The view draws the mirror register.ts writes; the mirror is faked here.
const NOW = Date.UTC(2026, 9, 2, 19, 0, 0)
const MIRROR = 'C:/Users/me/.claude/mods-data/tasks/sess-a.json'
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
const PANE_PROPS = { title: 'Tasks', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { top: 0 }, view: {} } as never

function world(on: On, tasks: TaskRow[], updatedAt = NOW, carried: TaskRow[] = []) {
  const opened: string[] = []
  mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: 'sess-a' }))
  on('session.root', () => ({ value: 'C:/Repos/x' }))
  on('fs.read', ($, e) => {
    if (e.path.replaceAll('\\', '/') !== MIRROR) throw new Error('ENOENT')
    return { value: JSON.stringify({ session: 'sess-a', updatedAt: NOW, changedAt: updatedAt, turn: 3, tasks, carried }) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }) as never)
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return opened
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
}

const LIST: TaskRow[] = [
  { id: '1', subject: 'Spec the guards', status: 'completed' },
  { id: '2', subject: 'Build the guards mod', activeForm: 'Building the guards mod', status: 'in_progress' },
  { id: '3', subject: 'Shadow-test it', status: 'pending' },
]

test('the band names the task in progress and opens the full list', async ($, on) => {
  const opened = world(on, LIST)
  await start($)
  const ui = await $.ui.mount({ plugin: 'tasks', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /🔨 #2 Building the guards mod/ })).toBeDefined()
  await ui.press({ key: 'tasks-list' })
  expect(opened).toEqual([PANE])
})

test('the pane lists every task, finished ones included', async ($, on) => {
  world(on, LIST)
  await start($)
  const ui = await $.ui.mount({ plugin: 'tasks', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS } as never)
  expect(await ui.find({ key: 'task-1' })).toBeDefined()
  expect(await ui.find({ key: 'task-2' })).toBeDefined()
  expect(await ui.find({ key: 'task-3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 of 3 done/ })).toBeDefined()
})

test('a finished list leaves the band after a while', async ($, on) => {
  world(on, [{ id: '1', subject: 'Done thing', status: 'completed' }], NOW - 10 * 60_000)
  await start($)
  const ui = await $.ui.mount({ plugin: 'tasks', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ key: 'tasks-list' })).toBeUndefined()
})

test('open tasks come first, finished ones newest first', () => {
  const rows: TaskRow[] = [
    { id: '1', subject: 'a', status: 'completed' },
    { id: '4', subject: 'd', status: 'pending' },
    { id: '2', subject: 'b', status: 'completed' },
    { id: '3', subject: 'c', status: 'in_progress' },
  ]
  expect(ordered(rows).map(t => t.id)).toEqual(['3', '4', '2', '1'])
})

test('a new session shows the last session\'s unfinished tasks as carried over', async ($, on) => {
  const opened = world(on, [], NOW, [{ id: '7', subject: 'Port the mods', status: 'pending', hold: 'design review' }])
  await start($)
  const band = await $.ui.mount({ plugin: 'tasks', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ type: 'Text', text: /1 carried over/ })).toBeDefined()
  await band.press({ key: 'tasks-list' })
  expect(opened).toEqual([PANE])
  const pane = await $.ui.mount({ plugin: 'tasks', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS } as never)
  expect(await pane.find({ key: 'carried-7' })).toBeDefined()
})
