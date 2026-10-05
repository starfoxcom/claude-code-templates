import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { ordered, PANE, phoneText } from '../hooks/view'
import type { TaskRow } from '../types'

// The view draws the mirror register.ts writes; the mirror is faked here.
const NOW = Date.UTC(2026, 9, 2, 19, 0, 0)
const MIRROR = 'C:/Users/me/.claude/mods-data/tasks/sess-a.json'
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
const PANE_PROPS = {
  title: 'Tasks',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { top: 0 },
  view: {},
} as never

function world(on: On, tasks: TaskRow[], updatedAt = NOW, carried: TaskRow[] = []) {
  const opened: string[] = []
  mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: 'sess-a' }))
  on('session.root', () => ({ value: 'C:/Repos/x' }))
  on('fs.read', ($, e) => {
    if (e.path.replaceAll('\\', '/') !== MIRROR) throw new Error('ENOENT')
    return {
      value: JSON.stringify({ session: 'sess-a', updatedAt: NOW, changedAt: updatedAt, turn: 3, tasks, carried }),
    }
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }) as never)
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
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

test('a Desktop session shows the band once the app attaches, before any tool call', async ($, on) => {
  world(on, LIST)
  // How the Desktop app starts a session: not interactive, drawing nowhere until it attaches.
  await $.session.start({ cwd: 'C:/Repos/x', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  const ui = await $.ui.mount({ plugin: 'tasks', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /🔨 #2 Building the guards mod/ })).toBeDefined()
})

// The band and the pane draw through the engine's own validation on each surface the CLI and the
// Desktop app use.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band names the task in progress and opens the full list on ${surface}`, async ($, on) => {
    const opened = world(on, LIST)
    await start($)
    const ui = await $.ui.mount({ plugin: 'tasks', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /🔨 #2 Building the guards mod/ })).toBeDefined()
    await ui.press({ key: 'tasks-list' })
    expect(opened).toEqual([PANE])
  })

  test(`with nothing in progress the band names the next task with the open look on ${surface}`, async ($, on) => {
    world(on, [LIST[0]!, { ...LIST[2]!, id: '4' }, LIST[2]!])
    await start($)
    const ui = await $.ui.mount({ plugin: 'tasks', surface, component: 'AbovePrompt', props: PROPS })
    // The list's 📝 and its plain color, never dimmed: an open task is not a finished one.
    const next = (await ui.find({ type: 'Text', text: /· 📝 next #3 Shadow-test it/ })) as never as {
      props: Record<string, unknown>
    }
    expect(next).toBeDefined()
    expect([next.props.color, next.props.dimColor]).toEqual([undefined, undefined])
  })

  test(`the band stays one line when narrow: only the task's name gives way, on ${surface}`, async ($, on) => {
    world(on, [...LIST, { id: '4', subject: 'Wait on it', status: 'pending', hold: 'the logs' }])
    await start($)
    const ui = await $.ui.mount({ plugin: 'tasks', surface, component: 'AbovePrompt', props: PROPS })
    const props = async (key: string) =>
      ((await ui.find({ key })) as never as { props: Record<string, unknown> } | undefined)?.props
    // The counts and the List button keep their width, so nothing they hold wraps to a second row.
    for (const key of ['tasks-done', 'tasks-open', 'tasks-held', 'tasks-list-slot'])
      expect((await props(key))?.flexShrink).toBe(0)
    expect(await props('tasks-current')).toEqual(expect.objectContaining({ flexShrink: 1, minWidth: 0 }))
    const name = (await ui.find({ type: 'Text', text: /🔨 #2 Building the guards mod/ })) as never as {
      props: Record<string, unknown>
    }
    expect(name.props.wrap).toBe('truncate-end')
  })

  test(`the pane lists every task, finished ones included, on ${surface}`, async ($, on) => {
    world(on, LIST)
    await start($)
    const ui = await $.ui.mount({
      plugin: 'tasks',
      surface,
      component: 'Pane',
      requestId: PANE,
      props: PANE_PROPS,
    } as never)
    expect(await ui.find({ key: 'task-1' })).toBeDefined()
    expect(await ui.find({ key: 'task-2' })).toBeDefined()
    expect(await ui.find({ key: 'task-3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 of 3 done/ })).toBeDefined()
  })
}

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

test('the carried-over line stays until this session makes a list, however long that takes', async ($, on) => {
  world(on, [], NOW - 10 * 60_000, [{ id: '7', subject: 'Port the mods', status: 'pending' }])
  await start($)
  const band = await $.ui.mount({ plugin: 'tasks', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ type: 'Text', text: /1 carried over/ })).toBeDefined()
})

test("a new session shows the last session's unfinished tasks as carried over", async ($, on) => {
  const opened = world(on, [], NOW, [{ id: '7', subject: 'Port the mods', status: 'pending', hold: 'design review' }])
  await start($)
  const band = await $.ui.mount({ plugin: 'tasks', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ type: 'Text', text: /1 carried over/ })).toBeDefined()
  await band.press({ key: 'tasks-list' })
  expect(opened).toEqual([PANE])
  const pane = await $.ui.mount({
    plugin: 'tasks',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    props: PANE_PROPS,
  } as never)
  expect(await pane.find({ key: 'carried-7' })).toBeDefined()
})

test('the phone text counts each kind, lists the unfinished tasks, then the newest finished ones', () => {
  const row = (id: string, status: TaskRow['status'], extra: Partial<TaskRow> = {}): TaskRow => ({
    id,
    subject: `task ${id}`,
    status,
    ...extra,
  })
  const done = ['1', '2', '3', '4', '5', '6'].map(id => row(id, 'completed'))
  const tasks = [...done, row('7', 'in_progress'), row('8', 'pending', { hold: 'Alex' }), row('9', 'pending')]
  expect(phoneText(tasks).split('\n')).toEqual([
    '📋 Tasks · 🔨 1 working · 📝 1 open · 🚧 1 on hold · ✅ 6 done',
    '🔨 #7 task 7',
    '📝 #9 task 9',
    '🚧 #8 task 8 (waits on: Alex)',
    '✅ #6 task 6',
    '✅ #5 task 5',
    '✅ #4 task 4',
    '✅ #3 task 3',
    '✅ #2 task 2',
    '… and 1 more finished',
  ])
  expect(phoneText([])).toBe('📋 No task list in this session.')
})
