import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import type { Mirror } from '../hooks/register'
import { HELP, MKDIR_SCRIPT } from '../hooks/register'

const MIRROR_FILE = 'C:/Users/me/.claude/mods-data/tasks/sess-a.json'

type World = {
  files: Map<string, string>
  nextId: number
  listed: { id: string; subject: string; status: string }[]
  runs: string[][]
  /** Writes to the mods-data folder fail (a folder that cannot be written). */
  isDataDown?: boolean
  /** Files past the sweep's age limit. */
  old: string[]
  commands: { name: string; argumentHint?: string }[]
  opened: string[]
  /** The engine refuses the command name, as it does a built-in's. */
  isCommandRefused?: boolean
  clock?: ReturnType<typeof mock.clock>
}

function world(on: On): World {
  const seen: World = { files: new Map(), nextId: 1, listed: [], runs: [], old: [], commands: [], opened: [] }
  seen.clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 19, 0, 0) })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const key = (path: string) => path.replaceAll('\\', '/')
  on('fs.read', ($, e) => {
    const text = seen.files.get(key(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    if (seen.isDataDown && key(e.path).includes('/mods-data/')) throw new Error('EPERM')
    seen.files.set(key(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = [...(e as never as { argv: string[] }).argv]
    seen.runs.push(argv)
    // The sweep removes the files marked old, all but the one it is told to keep.
    if (argv[2]?.includes('mtimeMs<cut')) {
      for (const path of seen.old) if (path !== `${argv[3]}/${argv[5]}.json`) seen.files.delete(path)
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: 'sess-a' }))
  on('session.root', () => ({ value: 'C:/Repos/x' }))
  on('fs.list', ($, e) => {
    const dir = e.path?.replaceAll('\\', '/') ?? ''
    const names = [...seen.files.keys()].filter(key => key.startsWith(`${dir}/`)).map(key => key.slice(dir.length + 1))
    return { value: names.map(name => ({ name, kind: 'file', size: 1, mtimeMs: 1, isLink: false })) } as never
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    if (seen.isCommandRefused) throw new Error(`"/${e.name}" refused: it is a built-in command`)
    seen.commands.push({ name: e.name, argumentHint: e.argumentHint })
    return { value: { command: e.name } as never }
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
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

test("a session resumed after the sweep's age limit keeps its own list", async ($, on) => {
  const seen = world(on)
  const old: Mirror = {
    session: 'sess-a',
    updatedAt: 1,
    turn: 4,
    tasks: [{ id: '1', subject: 'Port the mods', status: 'in_progress' }],
  } as never
  seen.files.set(MIRROR_FILE, JSON.stringify(old))
  seen.files.set('C:/Users/me/.claude/mods-data/tasks/sess-old.json', JSON.stringify({ ...old, session: 'sess-old' }))
  seen.old = [MIRROR_FILE, 'C:/Users/me/.claude/mods-data/tasks/sess-old.json']
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })

  expect(seen.files.has('C:/Users/me/.claude/mods-data/tasks/sess-old.json')).toBe(false)
  expect(mirror(seen).tasks.map(t => t.subject)).toEqual(['Port the mods'])
  await turn($)
  await create($, 'Next step')
  expect(mirror(seen).tasks.map(t => t.subject)).toEqual(['Port the mods', 'Next step'])
})

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
  // The engine's fs makes no folders: the mirror's folder is made through node, once per load.
  const made = seen.runs.filter(argv => argv[2] === MKDIR_SCRIPT)
  expect(made).toEqual([['node', '-e', MKDIR_SCRIPT, 'C:/Users/me/.claude/mods-data/tasks']])
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
  await $.tool.call({
    tool: 'TaskUpdate',
    taskId: '2',
    status: 'pending',
    metadata: { hold: 'owner picks the effort' },
  } as never)
  expect(mirror(seen).tasks.find(task => task.id === '2')?.hold).toBe('owner picks the effort')
  await update($, '2', 'in_progress')
  expect(mirror(seen).tasks.find(task => task.id === '2')?.hold).toBe(undefined)
})

test("the mod answers the task tools itself, in the engine tools' shapes", async ($, on) => {
  const seen = world(on)
  on('tool.call', { tool: 'TaskGet' }, () => ({ result: { task: null } }) as never)
  await turn($)
  const made = (await $.tool.call({ tool: 'TaskCreate', subject: 'one', description: 'first' } as never)) as never as {
    result: unknown
  }
  expect(made.result).toEqual({ task: { id: '1', subject: 'one' } })
  await create($, 'two')
  // The engine's fakes never run: ids come from the mod.
  expect(seen.nextId).toBe(1)
  const linked = (await $.tool.call({
    tool: 'TaskUpdate',
    taskId: '2',
    addBlockedBy: ['1'],
    status: 'in_progress',
  } as never)) as never as { result: unknown }
  expect(linked.result).toEqual({
    success: true,
    taskId: '2',
    updatedFields: ['blockedBy', 'status'],
    statusChange: { from: 'pending', to: 'in_progress' },
  })
  const got = (await $.tool.call({ tool: 'TaskGet', taskId: '1' } as never)) as never as { result: unknown }
  expect(got.result).toEqual({
    task: { id: '1', subject: 'one', description: 'first', status: 'pending', blocks: ['2'], blockedBy: [] },
  })
  await update($, '1', 'completed')
  const listed = (await $.tool.call({ tool: 'TaskList' } as never)) as never as { result: unknown }
  expect(listed.result).toEqual({
    tasks: [
      { id: '1', subject: 'one', status: 'completed', owner: undefined, blockedBy: [] },
      { id: '2', subject: 'two', status: 'in_progress', owner: undefined, blockedBy: [] },
    ],
  })
  const missing = (await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'completed' } as never)) as never as {
    result: unknown
  }
  expect(missing.result).toEqual({ success: false, taskId: '9', updatedFields: [], error: 'Task not found' })
  // A status the engine's tool does not know is refused, and the task stays as it was.
  const unknown = (await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'done' } as never)) as never as {
    result: unknown
  }
  expect(unknown.result).toEqual({
    success: false,
    taskId: '2',
    updatedFields: [],
    error: 'status must be pending, in_progress, completed or deleted',
  })
  const still = (await $.tool.call({ tool: 'TaskGet', taskId: '2' } as never)) as never as {
    result: { task: { status: string } }
  }
  expect(still.result.task.status).toBe('in_progress')
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
  const empty = await $.prompt.attachment({
    type: 'task_reminder',
    text: 'generic',
    origin: { kind: 'engine' },
  } as never)
  expect(empty.text).toBe(null)
  await create($, 'one')
  await update($, '1', 'in_progress')
  const named = await $.prompt.attachment({
    type: 'task_reminder',
    text: 'generic',
    origin: { kind: 'engine' },
  } as never)
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
  seen.files.set(
    'C:/Users/me/.claude/mods-data/tasks/old.json',
    JSON.stringify({
      session: 'old',
      root: 'c:/repos/x',
      updatedAt: 5,
      turn: 9,
      tasks: [
        { id: '7', subject: 'keep going', status: 'in_progress', createdTurn: 1 },
        { id: '8', subject: 'wait', status: 'pending', createdTurn: 1, hold: 'a decision' },
        { id: '9', subject: 'finished', status: 'completed', createdTurn: 1 },
      ],
    }),
  )
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
  seen.files.set(
    `${engine}/4.json`,
    JSON.stringify({
      id: '4',
      subject: 'old work',
      description: 'd',
      status: 'in_progress',
      blocks: [],
      blockedBy: [],
      metadata: { hold: 'a reply' },
    }),
  )
  seen.files.set(`${engine}/.highwatermark`, '4')
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  const task = mirror(seen).tasks.find(item => item.id === '4')
  expect([task?.subject, task?.status, task?.hold, task?.description]).toEqual([
    'old work',
    'in_progress',
    'a reply',
    'd',
  ])
  expect(mirror(seen).nextId).toBe(5)
  const unlink = seen.runs.find(run => run.includes(engine))
  expect(unlink?.slice(-2)).toEqual([engine, '4.json'])
  await create($, 'next')
  expect(mirror(seen).tasks.map(item => item.id)).toEqual(['4', '5'])
})

test("the engine's task files stay when the mirror holding their copy cannot be written", async ($, on) => {
  const seen = world(on)
  seen.isDataDown = true
  const engine = 'C:/Users/me/.claude/tasks/sess-a'
  const task = { id: '4', subject: 'old work', description: 'd', status: 'pending', blocks: [], blockedBy: [] }
  seen.files.set(`${engine}/4.json`, JSON.stringify(task))
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  expect(seen.runs.find(run => run.includes(engine))).toBeUndefined()
})

test("after a reload the engine's store is left alone, even a subagent task matching a mirror task", async ($, on) => {
  const seen = world(on)
  const engine = 'C:/Users/me/.claude/tasks/sess-a'
  seen.files.set(
    MIRROR_FILE,
    JSON.stringify({
      session: 'sess-a',
      updatedAt: 1,
      turn: 1,
      tasks: [{ id: '1', subject: 'run the tests', status: 'pending', createdTurn: 1 }],
    }),
  )
  // A live subagent's first task: the engine numbers it 1, and the step was delegated word for word.
  seen.files.set(`${engine}/1.json`, JSON.stringify({ id: '1', subject: 'run the tests', status: 'in_progress' }))
  seen.files.set(`${engine}/2.json`, JSON.stringify({ id: '2', subject: 'a subagent step', status: 'pending' }))
  // A hot reload: no session.start before the next turn.
  await turn($)
  expect(seen.runs.find(run => run.includes(engine))).toBeUndefined()
  expect(mirror(seen).tasks.map(task => [task.id, task.status])).toEqual([['1', 'pending']])
})

test('/task-list opens the list or its settings, and help or anything else lists its verbs', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
  expect(seen.commands).toEqual([{ name: 'task-list', argumentHint: '[help | settings | phone]' }])
  const run = (args: string) => $.command.run({ command: 'task-list', args } as never)
  expect(await run('')).toEqual(expect.objectContaining({ text: 'Opened the task list.' }))
  expect(await run('settings')).toEqual(expect.objectContaining({ text: 'Opened the tasks settings.' }))
  expect(seen.opened).toEqual(['tasks', 'tasks-settings'])
  for (const args of ['help', 'lists']) expect(await run(args)).toEqual(expect.objectContaining({ text: HELP }))
})

const NOW = Date.UTC(2026, 9, 2, 19, 0, 0)
const DIR = 'C:/Users/me/.claude/mods-data/tasks'
const OPEN_TASK = { id: '7', subject: 'keep going', status: 'in_progress', createdTurn: 1 }
const STALE_MS = 3 * 60_000

for (const { name, aliveAt, endedAt, isCarried } of [
  { name: 'a session still running', aliveAt: NOW - 60_000, endedAt: undefined, isCarried: false },
  { name: 'a session stamped at the stale limit', aliveAt: NOW - STALE_MS, endedAt: undefined, isCarried: false },
  { name: 'a session just past the stale limit', aliveAt: NOW - STALE_MS - 1, endedAt: undefined, isCarried: true },
  { name: 'a session that ended after its last stamp', aliveAt: NOW - 60_000, endedAt: NOW - 30_000, isCarried: true },
  { name: 'a session resumed after it ended', aliveAt: NOW - 10_000, endedAt: NOW - 30_000, isCarried: false },
  { name: 'a session from before the stamps', aliveAt: undefined, endedAt: undefined, isCarried: true },
  { name: 'a session with a damaged stamp', aliveAt: 'garbage', endedAt: undefined, isCarried: true },
]) {
  test(`carry-over from ${name}: ${isCarried ? 'carried' : 'left alone'}`, async ($, on) => {
    const seen = world(on)
    const other = { session: 'other', root: 'c:/repos/x', updatedAt: 5, turn: 9, tasks: [OPEN_TASK], endedAt }
    seen.files.set(`${DIR}/other.json`, JSON.stringify(other))
    if (aliveAt !== undefined) seen.files.set(`${DIR}/other.alive`, String(aliveAt))
    await $.session.start({ cwd: 'C:/Repos/x' } as never)
    expect(mirror(seen).carried?.map(task => task.id)).toEqual(isCarried ? ['7'] : undefined)
  })
}

test('a running session stamps at start, each turn and each minute; its end marks the list', async ($, on) => {
  const seen = world(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  expect(seen.files.get(`${DIR}/sess-a.alive`)).toBe(String(NOW))
  await seen.clock?.advance(60_000)
  expect(seen.files.get(`${DIR}/sess-a.alive`)).toBe(String(NOW + 60_000))
  await turn($)
  await create($, 'work')
  await $.session.end({ reason: 'other', sessionId: 'sess-a' } as never)
  expect(mirror(seen).endedAt).toBe(NOW + 60_000)
})

test("the minute stamp never rewrites the task list, even an ended session's", async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  const ended = { session: 'sess-a', root: 'c:/repos/x', updatedAt: 5, turn: 2, tasks: [OPEN_TASK], endedAt: NOW }
  seen.files.set(MIRROR_FILE, JSON.stringify(ended))
  await seen.clock?.advance(60_000)
  expect(JSON.parse(seen.files.get(MIRROR_FILE) ?? '{}')).toEqual(ended)
})

test('a hot reload never repeats the carried-over note', async ($, on) => {
  const seen = world(on)
  // This session's own mirror, as a reloaded module finds it (no session.start): the note already went out.
  const own = { session: 'sess-a', root: 'c:/repos/x', updatedAt: 5, turn: 2, tasks: [] }
  seen.files.set(MIRROR_FILE, JSON.stringify({ ...own, carried: [OPEN_TASK], isCarryNoted: true }))
  const answer = (await $.prompt.submit({ text: 'hi' } as never)) as never as { context?: string[] }
  expect((answer.context ?? []).join(' ')).not.toContain('left unfinished')
})

test('a refused command name never stops the rest of the session start', async ($, on) => {
  const seen = world(on)
  seen.isCommandRefused = true
  const old = { session: 'old', root: 'c:/repos/x', updatedAt: 5, turn: 9 }
  const task = { id: '7', subject: 'go', status: 'pending', createdTurn: 1 }
  seen.files.set('C:/Users/me/.claude/mods-data/tasks/old.json', JSON.stringify({ ...old, tasks: [task] }))
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  expect(mirror(seen).carried?.map(task => task.id)).toEqual(['7'])
})

test("a finished session's leftovers are carried over once, never into every later session", async ($, on) => {
  const seen = world(on)
  const old = { session: 'old', root: 'c:/repos/x', updatedAt: 5, turn: 9, tasks: [OPEN_TASK] }
  seen.files.set(`${DIR}/old.json`, JSON.stringify(old))
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  expect(mirror(seen).carried?.map(task => task.id)).toEqual(['7'])
  // Marked only once the note reached the model: a session ending before its first prompt saw nothing.
  expect(JSON.parse(seen.files.get(`${DIR}/old.json`) ?? '{}').handedOverAt).toBeUndefined()
  await $.prompt.submit({ text: 'hi' } as never)
  expect(JSON.parse(seen.files.get(`${DIR}/old.json`) ?? '{}').handedOverAt).toBe(NOW)
})

test('a list resumed and saved again after it was carried is not marked', async ($, on) => {
  const seen = world(on)
  const old = { session: 'old', root: 'c:/repos/x', updatedAt: 5, turn: 9, tasks: [OPEN_TASK] }
  seen.files.set(`${DIR}/old.json`, JSON.stringify(old))
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  const newer = { ...OPEN_TASK, id: '9', subject: 'added after the carry' }
  seen.files.set(`${DIR}/old.json`, JSON.stringify({ ...old, updatedAt: 50, tasks: [OPEN_TASK, newer] }))
  await $.prompt.submit({ text: 'hi' } as never)
  expect(JSON.parse(seen.files.get(`${DIR}/old.json`) ?? '{}').handedOverAt).toBeUndefined()
})

test('a list already handed over is not carried again', async ($, on) => {
  const seen = world(on)
  const old = { session: 'old', root: 'c:/repos/x', updatedAt: 5, turn: 9, tasks: [OPEN_TASK], handedOverAt: 1 }
  seen.files.set(`${DIR}/old.json`, JSON.stringify(old))
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  expect(mirror(seen).carried).toBeUndefined()
})

test('a handed-over session that is resumed and saves its list is current again', async ($, on) => {
  const seen = world(on)
  const own = { session: 'sess-a', root: 'c:/repos/x', updatedAt: 5, turn: 2, tasks: [OPEN_TASK], handedOverAt: 1 }
  seen.files.set(MIRROR_FILE, JSON.stringify(own))
  await $.session.start({ cwd: 'C:/Repos/x' } as never)
  await turn($)
  await create($, 'more work')
  expect(mirror(seen).handedOverAt).toBeUndefined()
})

test('a bare /task-list typed over Remote Control answers with the phone text', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
  const bridge = { command: 'task-list', args: '', origin: { kind: 'bridge' } }
  const answer = (await $.command.run(bridge as never)) as { text: string }
  expect(answer.text.split('\n')).toEqual(['📋 No task list in this session.', '/task-list help for more'])
})
