import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import type { Mirror } from '../hooks/register'

const MIRROR_FILE = 'C:/Users/me/.claude/mods-data/tasks/sess-a.json'

type World = { files: Map<string, string>; nextId: number; listed: { id: string; subject: string; status: string }[]; runs: string[][] }

function world(on: On): World {
  const seen: World = { files: new Map(), nextId: 1, listed: [], runs: [] }
  mock.clock(on, { now: Date.UTC(2026, 9, 2, 19, 0, 0) })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const key = (path: string) => path.replaceAll('\\', '/')
  on('fs.read', ($, e) => {
    const text = seen.files.get(key(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    seen.files.set(key(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => (seen.runs.push([...(e as never as { argv: string[] }).argv]), { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.id', () => ({ value: 'sess-a' }))
  on('session.root', () => ({ value: 'C:/Repos/x' }))
  on('fs.list', ($, e) => {
    const dir = e.path?.replaceAll('\\', '/') ?? ''
    const names = [...seen.files.keys()].filter(key => key.startsWith(`${dir}/`)).map(key => key.slice(dir.length + 1))
    return { value: names.map(name => ({ name, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) } as never
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }) as never)
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => {
    const id = String(seen.nextId++)
    return { result: { task: { id, subject: (e as never as { subject: string }).subject } } } as never
  })
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => {
    const args = e as never as { taskId: string }
    return { result: { success: true, taskId: args.taskId, updatedFields: ['status'] } } as never
  })
  on('tool.call', { tool: 'TaskList' }, () => ({ result: { tasks: seen.listed } }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: {}, isReadOnly: true }) as never)
  return seen
}

function mirror(seen: World): Mirror {
  return JSON.parse(seen.files.get(MIRROR_FILE) ?? '{"tasks":[]}') as Mirror
}

async function turn($: Engine): Promise<void> {
  await $.turn.start({ turnId: 't' } as never)
}

async function create($: Engine, subject: string): Promise<void> {
  await $.tool.call({ tool: 'TaskCreate', subject, description: subject } as never)
}

async function update($: Engine, taskId: string, status: string): Promise<{ context?: string[] }> {
  return (await $.tool.call({ tool: 'TaskUpdate', taskId, status } as never)) as never
}

test('the mirror keeps every task, finished ones too', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  await turn($)
  await create($, 'one')
  await create($, 'two')
  await update($, '1', 'in_progress')
  await update($, '1', 'completed')
  const tasks = mirror(seen).tasks
  expect(tasks.map(task => [task.id, task.status])).toEqual([
    ['1', 'completed'],
    ['2', 'pending'],
  ])
})

test('a second task in progress gets a one-at-a-time note', async ($, on) => {
  world(on)
  await turn($)
  await create($, 'one')
  await create($, 'two')
  await update($, '1', 'in_progress')
  await update($, '2', 'in_progress')
  const next = (await $.tool.call({ tool: 'Read', file_path: 'a' } as never)) as never as { context?: string[] }
  expect((next.context ?? []).join(' ')).toContain('#1 "one" and #2 "two" are all in progress')
})

test('finishing one task and starting the next in one batch is not an overlap', async ($, on) => {
  world(on)
  await turn($)
  await create($, 'one')
  await create($, 'two')
  await update($, '1', 'in_progress')
  await update($, '2', 'in_progress')
  await update($, '1', 'completed')
  const next = (await $.tool.call({ tool: 'Read', file_path: 'a' } as never)) as never as { context?: string[] }
  expect(next.context ?? []).toEqual([])
})

test('a task on hold keeps its reason and is not counted as in progress', async ($, on) => {
  const seen = world(on)
  await turn($)
  await create($, 'one')
  await create($, 'two')
  await update($, '1', 'in_progress')
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'pending', metadata: { hold: 'owner picks the effort' } } as never)
  expect(mirror(seen).tasks.find(task => task.id === '2')?.hold).toBe('owner picks the effort')
  await update($, '2', 'in_progress')
  expect(mirror(seen).tasks.find(task => task.id === '2')?.hold).toBe(undefined)
})

test('the mod answers the task tools itself, in the engine tools\' shapes', async ($, on) => {
  const seen = world(on)
  on('tool.call', { tool: 'TaskGet' }, () => ({ result: { task: null } }) as never)
  await turn($)
  const made = (await $.tool.call({ tool: 'TaskCreate', subject: 'one', description: 'first' } as never)) as never as { result: unknown }
  expect(made.result).toEqual({ task: { id: '1', subject: 'one' } })
  await create($, 'two')
  // The engine's fakes never run: ids come from the mod.
  expect(seen.nextId).toBe(1)
  const linked = (await $.tool.call({ tool: 'TaskUpdate', taskId: '2', addBlockedBy: ['1'], status: 'in_progress' } as never)) as never as { result: unknown }
  expect(linked.result).toEqual({ success: true, taskId: '2', updatedFields: ['blockedBy', 'status'], statusChange: { from: 'pending', to: 'in_progress' } })
  const got = (await $.tool.call({ tool: 'TaskGet', taskId: '1' } as never)) as never as { result: unknown }
  expect(got.result).toEqual({ task: { id: '1', subject: 'one', description: 'first', status: 'pending', blocks: ['2'], blockedBy: [] } })
  await update($, '1', 'completed')
  const listed = (await $.tool.call({ tool: 'TaskList' } as never)) as never as { result: unknown }
  expect(listed.result).toEqual({
    tasks: [
      { id: '1', subject: 'one', status: 'completed', owner: undefined, blockedBy: [] },
      { id: '2', subject: 'two', status: 'in_progress', owner: undefined, blockedBy: [] },
    ],
  })
  const missing = (await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'completed' } as never)) as never as { result: unknown }
  expect(missing.result).toEqual({ success: false, taskId: '9', updatedFields: [], error: 'Task not found' })
})

test('ids never repeat, even after a deleted task', async ($, on) => {
  const seen = world(on)
  await turn($)
  await create($, 'one')
  await create($, 'two')
  await update($, '1', 'completed')
  await update($, '1', 'deleted')
  await update($, '2', 'completed')
  await update($, '2', 'deleted')
  await create($, 'three')
  expect(mirror(seen).tasks.map(task => task.id)).toEqual(['3'])
})

test('a task left in progress is named on the next prompt', async ($, on) => {
  world(on)
  await turn($)
  await create($, 'one')
  await update($, '1', 'in_progress')
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'done' } as never)
  const answer = (await $.prompt.submit({ text: 'next' } as never)) as never as { context?: string[] }
  expect((answer.context ?? []).join(' ')).toContain('Still in progress from an earlier turn: #1 "one"')
})

test('the generic task reminder names the open tasks, or goes away', async ($, on) => {
  world(on)
  on('prompt.attachment', ($, e) => ({ text: e.text }))
  await turn($)
  const empty = await $.prompt.attachment({ type: 'task_reminder', text: 'generic', origin: { kind: 'engine' } } as never)
  expect(empty.text).toBe(null)
  await create($, 'one')
  await update($, '1', 'in_progress')
  const named = await $.prompt.attachment({ type: 'task_reminder', text: 'generic', origin: { kind: 'engine' } } as never)
  expect(named.text).toContain('in progress #1 "one"')
})

test('a long turn with no task list is asked for one, once', async ($, on) => {
  world(on)
  await turn($)
  const notes: string[] = []
  for (let i = 0; i < 5; i++) {
    const result = (await $.tool.call({ tool: 'Read', file_path: 'a' } as never)) as never as { context?: string[] }
    notes.push(...(result.context ?? []))
  }
  expect(notes.length).toBe(1)
  expect(notes[0]).toContain('ran 3 tool calls with no task list')
})

test('a task deleted unfinished stays in the list as dropped', async ($, on) => {
  const seen = world(on)
  await turn($)
  await create($, 'one')
  await create($, 'two')
  await update($, '1', 'completed')
  await update($, '2', 'deleted')
  await update($, '1', 'deleted')
  const tasks = mirror(seen).tasks
  expect(tasks.map(task => task.id)).toEqual(['2'])
  expect(typeof tasks[0]?.droppedAt).toBe('number')
})

test("a new session sees the previous session's unfinished tasks once", async ($, on) => {
  const seen = world(on)
  seen.files.set('C:/Users/me/.claude/mods-data/tasks/old.json', JSON.stringify({
    session: 'old', root: 'c:/repos/x', updatedAt: 5, turn: 9,
    tasks: [
      { id: '7', subject: 'keep going', status: 'in_progress', createdTurn: 1 },
      { id: '8', subject: 'wait', status: 'pending', createdTurn: 1, hold: 'a decision' },
      { id: '9', subject: 'finished', status: 'completed', createdTurn: 1 },
    ],
  }))
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  expect(mirror(seen).carried?.map(task => task.id)).toEqual(['7', '8'])
  const first = (await $.prompt.submit({ text: 'hi' } as never)) as never as { context?: string[] }
  expect((first.context ?? []).join(' ')).toContain('left unfinished: #7 "keep going"; #8 "wait" (on hold: a decision)')
  const second = (await $.prompt.submit({ text: 'again' } as never)) as never as { context?: string[] }
  expect((second.context ?? []).join(' ')).not.toContain('left unfinished')
})

test("the engine's leftover task files are imported, then deleted", async ($, on) => {
  const seen = world(on)
  const engine = 'C:/Users/me/.claude/tasks/sess-a'
  seen.files.set(`${engine}/4.json`, JSON.stringify({ id: '4', subject: 'old work', description: 'd', status: 'in_progress', blocks: [], blockedBy: [], metadata: { hold: 'a reply' } }))
  seen.files.set(`${engine}/.highwatermark`, '4')
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  const task = mirror(seen).tasks.find(item => item.id === '4')
  expect([task?.subject, task?.status, task?.hold, task?.description]).toEqual(['old work', 'in_progress', 'a reply', 'd'])
  expect(mirror(seen).nextId).toBe(5)
  const unlink = seen.runs.find(run => run.includes(engine))
  expect(unlink?.slice(-2)).toEqual([engine, '4.json'])
  await create($, 'next')
  expect(mirror(seen).tasks.map(item => item.id)).toEqual(['4', '5'])
})

test('after a reload only the mirror\'s own copies are deleted, a subagent\'s files stay', async ($, on) => {
  const seen = world(on)
  const engine = 'C:/Users/me/.claude/tasks/sess-a'
  seen.files.set(MIRROR_FILE, JSON.stringify({ session: 'sess-a', updatedAt: 1, turn: 1, tasks: [{ id: '2', subject: 'mine', status: 'pending', createdTurn: 1 }] }))
  seen.files.set(`${engine}/2.json`, JSON.stringify({ id: '2', subject: 'mine', status: 'pending' }))
  seen.files.set(`${engine}/3.json`, JSON.stringify({ id: '3', subject: 'a subagent step', status: 'in_progress' }))
  // A hot reload: no session.start, the next turn runs the cleanup.
  await turn($)
  const unlink = seen.runs.find(run => run.includes(engine))
  expect(unlink?.slice(-2)).toEqual([engine, '2.json'])
  expect(mirror(seen).tasks.map(task => task.id)).toEqual(['2'])
})
