import type { EngineInterface, Register } from 'claude-code'

import { hasEngineWake, hasPendingWake, isPauseHolding, keepGoingText, MAX_IDLE_PROMPTS, workable } from './keepgoing'
import { applyFile, register as settings, SETTINGS_PANE } from './settings'
import { PANE, phoneText } from './view'

// This mod is the main session's task list: it answers TaskCreate, TaskUpdate,
// TaskList and TaskGet itself from `mods-data/tasks/<session>.json`, so the
// engine's own store (deleted once every task is completed) and its panel under
// the spinner (forced open on every task change) never come into play; the
// mod's band is the one list on screen. Subagents keep the engine's tools. It
// also allows one task in progress at a time, names stale tasks instead of the
// engine's generic reminder, and asks for a list when a turn grows without one.

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type MirrorTask = {
  id: string
  subject: string
  activeForm?: string
  status: TaskStatus
  createdTurn: number
  startedTurn?: number
  doneTurn?: number
  doneAt?: number
  // Set while the task waits on something outside it (a decision, another task); the reason.
  hold?: string
  // Set when the task was deleted unfinished: kept in the list as dropped, not done.
  droppedAt?: number
  description?: string
  owner?: string
  blocks?: string[]
  blockedBy?: string[]
  // Metadata other than hold, merged as the engine's tool does (a null value removes a key).
  metadata?: Record<string, unknown>
}

// updatedAt moves on every task tool call; changedAt only when the list changed.
export type Mirror = {
  session: string
  // The session's working folder, lowercased with forward slashes: how a new session finds its predecessor.
  root?: string
  updatedAt: number
  changedAt?: number
  turn: number
  tasks: MirrorTask[]
  // The id the next TaskCreate gets; ids never repeat within a session, even after the 50-task trim.
  nextId?: number
  // The previous session's unfinished tasks in this folder, shown for checking, never recreated here.
  carried?: MirrorTask[]
  carriedFrom?: string
  // The carried list's `updatedAt` when it was read: a list saved again since then is not marked.
  carriedUpdatedAt?: number
  // Set once the carried-over note reached the model; kept on disk so a hot reload never repeats it.
  isCarryNoted?: boolean
  // Marks a clean end (session.end). The running stamp lives in its own `<session>.alive` file.
  endedAt?: number
  // Set on a finished session's list once a newer session carried its leftovers: they are shown
  // once, in that session, never again in every session after it.
  handedOverAt?: number
}

type UpdateArgs = {
  taskId?: string
  status?: string
  subject?: string
  activeForm?: string
  metadata?: { hold?: string | null }
}
// The four task tools' arguments, as the engine's schemas define them.
export type TaskArgs = UpdateArgs & {
  description?: string
  owner?: string
  addBlocks?: string[]
  addBlockedBy?: string[]
}

export const HOLD_HELP =
  'To put a task ON HOLD while it waits on a decision or another task, set status "pending" and ' +
  'metadata {"hold": "<what it waits on>"}; clear it with metadata {"hold": null} (starting or ' +
  'completing the task clears it too).'

const KEEP_TASKS = 50
const COMMAND = 'task-list'
const ALIVE_EVERY_MS = 60_000
// Missed heartbeats this long mean the session is gone (closed without an end, or crashed).
const ALIVE_STALE_MS = 3 * ALIVE_EVERY_MS
const HINT = '[help | settings | set | phone]'
export const HELP = [
  '/task-list: keeps the task list honest and shows it in the band above the prompt.',
  '  /task-list           open the task list',
  '  /task-list settings  open the settings pane',
  '  /task-list set       change a setting: set <name> <value>; alone, list them',
  '  /task-list phone     the same as text, for phone chats',
  '  /task-list help      this list',
].join('\n')
const SWEEP_DAYS = 14
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
const UNCOUNTED_TOOLS = new Set([...TASK_TOOLS, 'ToolSearch', 'TaskStop', 'TaskOutput', 'SendMessage'])
const UNLINK_SCRIPT =
  'const fs=require("fs"),p=require("path");const [d,...names]=process.argv.slice(1);' +
  'for(const n of names){try{fs.unlinkSync(p.join(d,n))}catch{}}'
// `<folder> <days> <this session's id>`: a session resumed after SWEEP_DAYS keeps its own list.
export const SWEEP_SCRIPT =
  'const fs=require("fs"),p=require("path");const [d,days,keep]=process.argv.slice(1);' +
  'if(fs.existsSync(d)){const cut=Date.now()-days*864e5;' +
  'for(const n of fs.readdirSync(d)){if(n===keep+".json")continue;' +
  'const f=p.join(d,n);if(fs.statSync(f).mtimeMs<cut)fs.unlinkSync(f)}}'

const live: {
  mirror?: Mirror
  turn: number
  isTurnRunning: boolean
  toolsThisTurn: number
  sawTaskTool: boolean
  isNudged: boolean
  // Set when a task was started; checked at the next non-task tool call, so a batch that
  // finishes one task and starts the next settles before overlap is judged.
  checkOverlap: boolean
  afterCompact: boolean
  isEngineCleared: boolean
  isAliveStarted: boolean
  nudgeAfter: number
  keepGoing: boolean
  // Keep-going prompts sent in a row with no change to the list, and the list's changedAt at the last one.
  idlePrompts: number
  promptedAt?: number
  // The last turn's end left background work or a scheduled wake that will wake the session (Stop event).
  hasEngineWake: boolean
} = {
  turn: 0,
  hasEngineWake: false,
  isTurnRunning: false,
  toolsThisTurn: 0,
  sawTaskTool: false,
  isNudged: false,
  checkOverlap: false,
  afterCompact: false,
  isEngineCleared: false,
  isAliveStarted: false,
  nudgeAfter: 3,
  keepGoing: true,
  idlePrompts: 0,
}

// One task file in the engine's own store (`<config>/tasks/<session>/<id>.json`).
export type EngineTask = {
  id: string
  subject: string
  description?: string
  activeForm?: string
  status: TaskStatus
  owner?: string
  blocks?: string[]
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}

// Copies the engine's tasks the mirror lacks (a session from before the mod answered the tools); the
// mirror's own copy wins for ids it already has. Returns whether the list changed.
export function importEngineTasks(mirror: Mirror, found: readonly EngineTask[], turn: number, now: number): boolean {
  let isChanged = false
  for (const item of found) {
    const id = String(item.id)
    if (mirror.tasks.some(task => task.id === id)) continue
    applyCreate(mirror, id, String(item.subject ?? `Task #${id}`), item.activeForm, turn)
    const task = mirror.tasks.find(entry => entry.id === id) as MirrorTask
    if (item.description) task.description = item.description
    if (item.owner) task.owner = item.owner
    if (item.blocks?.length) task.blocks = item.blocks.map(String)
    if (item.blockedBy?.length) task.blockedBy = item.blockedBy.map(String)
    applyUpdate(
      mirror,
      { taskId: id, status: item.status, metadata: item.metadata as UpdateArgs['metadata'] },
      turn,
      now,
    )
    isChanged = true
  }
  if (isChanged) {
    const highest = Math.max(0, ...mirror.tasks.map(task => Number(task.id) || 0))
    mirror.nextId = Math.max(mirror.nextId ?? 1, highest + 1)
  }
  return isChanged
}

export function openTasks(mirror: Mirror): MirrorTask[] {
  return mirror.tasks.filter(task => task.status !== 'completed' && !task.droppedAt)
}

function inProgress(mirror: Mirror): MirrorTask[] {
  return mirror.tasks.filter(task => task.status === 'in_progress' && !task.hold && !task.droppedAt)
}

export function applyCreate(
  mirror: Mirror,
  id: string,
  subject: string,
  activeForm: string | undefined,
  turn: number,
): void {
  mirror.tasks = mirror.tasks.filter(task => task.id !== id)
  mirror.tasks.push({ id, subject, activeForm, status: 'pending', createdTurn: turn })
}

export function applyUpdate(mirror: Mirror, args: UpdateArgs, turn: number, now: number): void {
  const id = String(args.taskId ?? '')
  if (args.status === 'deleted') {
    const gone = mirror.tasks.find(task => task.id === id)
    if (gone && gone.status !== 'completed') {
      gone.droppedAt = now
      delete gone.hold
    } else mirror.tasks = mirror.tasks.filter(task => task.id !== id)
    return
  }
  let task = mirror.tasks.find(item => item.id === id)
  if (!task) {
    task = { id, subject: args.subject ?? `Task #${id}`, status: 'pending', createdTurn: turn }
    mirror.tasks.push(task)
  }
  if (args.subject) task.subject = args.subject
  if (args.activeForm) task.activeForm = args.activeForm
  if (args.status === 'in_progress' && task.status !== 'in_progress') {
    task.status = 'in_progress'
    task.startedTurn = turn
  } else if (args.status === 'completed' && task.status !== 'completed') {
    task.status = 'completed'
    task.doneTurn = turn
    task.doneAt = now
  } else if (args.status === 'pending') {
    task.status = 'pending'
    task.startedTurn = undefined
  }
  if (args.status === 'completed' || args.status === 'in_progress') delete task.hold
  const metadata = metadataOf(args.metadata)
  if (!metadata) return
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'hold') {
      if (typeof value === 'string' && value.trim()) task.hold = value.trim()
      else delete task.hold
    } else if (value === null) {
      if (task.metadata) delete task.metadata[key]
    } else task.metadata = { ...task.metadata, [key]: value }
  }
}

// The model sometimes sends metadata as a JSON string.
function metadataOf(raw: unknown): Record<string, unknown> | undefined {
  let metadata = raw
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata)
    } catch {
      return undefined
    }
  }
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : undefined
}

function findTask(mirror: Mirror, id: string): MirrorTask | undefined {
  return mirror.tasks.find(task => task.id === id && !task.droppedAt)
}

function link(
  mirror: Mirror,
  from: MirrorTask,
  ids: readonly unknown[] | undefined,
  side: 'blocks' | 'blockedBy',
): boolean {
  let isChanged = false
  for (const raw of ids ?? []) {
    const other = findTask(mirror, String(raw))
    if (!other || other.id === from.id) continue
    const back = side === 'blocks' ? 'blockedBy' : 'blocks'
    if (!(from[side] ?? []).includes(other.id)) {
      from[side] = [...(from[side] ?? []), other.id]
      isChanged = true
    }
    if (!(other[back] ?? []).includes(from.id)) other[back] = [...(other[back] ?? []), from.id]
  }
  return isChanged
}

function createTask(mirror: Mirror, args: TaskArgs, turn: number, now: number): unknown {
  const highest = Math.max(0, ...mirror.tasks.map(task => Number(task.id) || 0))
  const id = String(Math.max(mirror.nextId ?? 1, highest + 1))
  mirror.nextId = Number(id) + 1
  applyCreate(mirror, id, String(args.subject ?? `Task #${id}`), args.activeForm, turn)
  const task = findTask(mirror, id) as MirrorTask
  if (args.description) task.description = String(args.description)
  if (args.metadata !== undefined) applyUpdate(mirror, { taskId: id, metadata: args.metadata }, turn, now)
  return { task: { id, subject: task.subject } }
}

function getTask(mirror: Mirror, args: TaskArgs): unknown {
  const task = findTask(mirror, String(args.taskId ?? ''))
  if (!task) return { task: null }
  const { id, subject, status } = task
  const description = task.description ?? ''
  return { task: { id, subject, description, status, blocks: task.blocks ?? [], blockedBy: task.blockedBy ?? [] } }
}

function listTasks(mirror: Mirror): unknown {
  const done = new Set(mirror.tasks.filter(task => task.status === 'completed').map(task => task.id))
  const tasks = mirror.tasks.filter(task => !task.droppedAt)
  return {
    tasks: tasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      blockedBy: (task.blockedBy ?? []).filter(id => !done.has(id)),
    })),
  }
}

// The fields an update changes, as the engine's TaskUpdate names them; description and owner are set here.
function changedFields(mirror: Mirror, task: MirrorTask, args: TaskArgs): string[] {
  const fields: string[] = []
  if (args.subject !== undefined && args.subject !== task.subject) fields.push('subject')
  if (args.description !== undefined && args.description !== task.description) {
    task.description = String(args.description)
    fields.push('description')
  }
  if (args.activeForm !== undefined && args.activeForm !== task.activeForm) fields.push('activeForm')
  if (args.owner !== undefined && args.owner !== task.owner) {
    task.owner = String(args.owner)
    fields.push('owner')
  }
  if (args.metadata !== undefined) fields.push('metadata')
  if (link(mirror, task, args.addBlocks, 'blocks')) fields.push('blocks')
  if (link(mirror, task, args.addBlockedBy, 'blockedBy')) fields.push('blockedBy')
  return fields
}

const STATUSES = new Set(['pending', 'in_progress', 'completed', 'deleted'])

function updateTask(mirror: Mirror, args: TaskArgs, turn: number, now: number): unknown {
  const id = String(args.taskId ?? '')
  const task = findTask(mirror, id)
  if (!task) return { success: false, taskId: id, updatedFields: [], error: 'Task not found' }
  const from = task.status
  // The engine's own tool refuses any other status; a reply claiming a change that never happened would
  // leave the model believing a task finished while every view still shows it open.
  if (args.status !== undefined && !STATUSES.has(String(args.status))) {
    const error = 'status must be pending, in_progress, completed or deleted'
    return { success: false, taskId: id, updatedFields: [], error }
  }
  if (args.status === 'deleted') {
    applyUpdate(mirror, args, turn, now)
    return { success: true, taskId: id, updatedFields: ['deleted'], statusChange: { from, to: 'deleted' } }
  }
  const fields = changedFields(mirror, task, args)
  const isStatusChange = args.status !== undefined && args.status !== from
  if (isStatusChange) fields.push('status')
  applyUpdate(mirror, args, turn, now)
  return {
    success: true,
    taskId: id,
    updatedFields: fields,
    statusChange: isStatusChange ? { from, to: args.status } : undefined,
  }
}

// Answers one task tool call from the mirror, returning the record the engine's own tool returns
// (core maps it to the model's text with that tool's mapper, so the model reads the usual results).
export function answerTool(mirror: Mirror, tool: string, args: TaskArgs, turn: number, now: number): unknown {
  if (tool === 'TaskCreate') return createTask(mirror, args, turn, now)
  if (tool === 'TaskGet') return getTask(mirror, args)
  if (tool === 'TaskList') return listTasks(mirror)
  return updateTask(mirror, args, turn, now)
}

function label(task: MirrorTask): string {
  return `#${task.id} "${task.subject}"`
}

export function openListText(mirror: Mirror, turn: number): string | null {
  const open = openTasks(mirror)
  if (open.length === 0) return null
  const parts = open.map(task =>
    task.hold
      ? `on hold ${label(task)} (waits on: ${task.hold})`
      : task.status === 'in_progress'
        ? `in progress ${label(task)} (${Math.max(0, turn - (task.startedTurn ?? turn))} turn(s))`
        : `pending ${label(task)}`,
  )
  return `[tasks] Open: ${parts.join('; ')}. Mark each task completed the moment it is done; keep one in progress.`
}

export function staleText(mirror: Mirror, turn: number): string | undefined {
  const stale = inProgress(mirror).filter(task => (task.startedTurn ?? turn) <= turn)
  if (stale.length === 0) return undefined
  return (
    `[tasks] Still in progress from an earlier turn: ${stale.map(label).join(', ')}. If finished, mark ` +
    `completed before new work.`
  )
}

export function overlapText(mirror: Mirror): string | undefined {
  const running = inProgress(mirror)
  if (running.length < 2) return undefined
  return (
    `[tasks] ${running.map(label).join(' and ')} are all in progress. Work one at a time: mark the finished ` +
    `one completed, or set the others back to pending.`
  )
}

export function carriedText(carried: readonly MirrorTask[]): string {
  const parts = carried.map(task => `#${task.id} "${task.subject}"${task.hold ? ` (on hold: ${task.hold})` : ''}`)
  return (
    `[tasks] The previous session in this folder left unfinished: ${parts.join('; ')}. ` +
    'Check them against the hand-off: recreate the ones still valid with TaskCreate, leave the rest.'
  )
}

// A running session writes the time to `<session>.alive` every minute and at each turn; it is a
// file of its own so the stamp never rewrites a task list. A session is finished when it never
// stamped (gone before the stamps existed), stopped stamping, or ended after its last stamp.
export function isFinished(endedAt: number | undefined, aliveAt: number | undefined, now: number): boolean {
  // A stamp that is not a number (a damaged or foreign file) counts as no stamp.
  if (aliveAt === undefined || !Number.isFinite(aliveAt) || now - aliveAt > ALIVE_STALE_MS) return true
  return endedAt !== undefined && endedAt >= aliveAt
}

// The newest other finished session in the same folder that left open tasks.
export function pickPredecessor(
  mirrors: readonly Mirror[],
  aliveAt: ReadonlyMap<string, number>,
  root: string,
  session: string,
  now: number,
): Mirror | undefined {
  return mirrors
    .filter(mirror => mirror.session !== session && mirror.root === root && !mirror.handedOverAt)
    .filter(mirror => openTasks(mirror).length > 0)
    .filter(mirror => isFinished(mirror.endedAt, aliveAt.get(mirror.session), now))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export function nudgeText(tools: number): string {
  return (
    `[tasks] This turn ran ${tools} tool calls with no task list. If the work has 3+ steps, create the tasks ` +
    `now (TaskCreate) and keep their status current.`
  )
}

// The engine's fs makes no missing folders, so the data folder is made through node, once per load.
export const MKDIR_SCRIPT = 'require("fs").mkdirSync(process.argv[1],{recursive:true})'
const madeDirs = new Set<string>()
async function ensureDir($: EngineInterface, dir: string): Promise<void> {
  if (madeDirs.has(dir)) return
  const { exitCode } = await $.process.run(['node', '-e', MKDIR_SCRIPT, dir], { timeoutMs: 10_000 })
  if (exitCode === 0) madeDirs.add(dir)
}

async function dataDir($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/tasks`.replaceAll('\\', '/')
}

async function mirrorOf($: EngineInterface): Promise<Mirror> {
  if (live.mirror) return live.mirror
  const session = await $.session.id()
  try {
    live.mirror = JSON.parse(String(await $.fs.read(`${await dataDir($)}/${session}.json`))) as Mirror
    live.turn = Math.max(live.turn, live.mirror.turn)
  } catch {
    live.mirror = { session, updatedAt: 0, turn: live.turn, tasks: [] }
  }
  live.mirror.root = (await $.session.root()).replaceAll('\\', '/').toLowerCase()
  return live.mirror
}

// True when the mirror file was written.
async function saveMirror($: EngineInterface, mirror: Mirror): Promise<boolean> {
  // A session writing its own list makes it current again: a resumed session's new leftovers carry over.
  delete mirror.handedOverAt
  mirror.updatedAt = await $.clock.now()
  mirror.turn = live.turn
  mirror.tasks.sort((a, b) => Number(a.id) - Number(b.id))
  if (mirror.tasks.length > KEEP_TASKS) {
    // Drop the oldest finished tasks first; open ones always stay.
    const finished = mirror.tasks.filter(task => task.status === 'completed')
    const drop = new Set(finished.slice(0, mirror.tasks.length - KEEP_TASKS).map(task => task.id))
    mirror.tasks = mirror.tasks.filter(task => !drop.has(task.id))
  }
  const dir = await dataDir($)
  await ensureDir($, dir).catch(() => undefined)
  return $.fs.write(`${dir}/${mirror.session}.json`, JSON.stringify(mirror, null, 1)).then(
    () => true,
    () => false,
  )
}

function withContext<T extends object>(result: T, note: string | undefined): T {
  if (!note || 'deny' in result) return result
  const before = (result as { context?: readonly string[] }).context ?? []
  return { ...result, context: [...before, note] }
}

// The engine's panel under the spinner draws the task files in the engine's store. The mod answers
// the task tools itself, so files there are leftovers from before it did: import what the list lacks,
// then delete them, which leaves the panel empty (it hides). Runs at a session start only.
// A subagent's task calls still go to the engine and land in this same folder (only a team gets its
// own), numbered from 1 like the mirror's, and a background subagent can outlive a turn; nothing in a
// file tells whose it is. None survives a restart, so a start imports and deletes everything. A hot
// reload deletes nothing: a subagent may be live then, and leftovers wait for the next start.
async function clearEngineStore($: EngineInterface): Promise<void> {
  if (live.isEngineCleared) return
  live.isEngineCleared = true
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const dir = `${configured ?? `${home}/.claude`}/tasks/${await $.session.id()}`.replaceAll('\\', '/')
  let names: string[]
  try {
    names = (await $.fs.list(dir)).map(entry => entry.name).filter(name => /^\d+\.json$/.test(name))
  } catch {
    return
  }
  if (names.length === 0) return
  const found = new Map<string, EngineTask>()
  for (const name of names) {
    try {
      found.set(name, JSON.parse(String(await $.fs.read(`${dir}/${name}`))) as EngineTask)
    } catch {
      // A half-written file is deleted with the rest.
    }
  }
  const mirror = await mirrorOf($)
  const now = await $.clock.now()
  if (importEngineTasks(mirror, [...found.values()], live.turn, now)) {
    mirror.changedAt = now
    // The engine's files are deleted only once the mirror holding their copy is written; until then
    // they wait for the next start.
    if (!(await saveMirror($, mirror))) return
  }
  await $.process.run(['node', '-e', UNLINK_SCRIPT, dir, ...names], { timeoutMs: 20_000 })
}

// Marks the finished list whose leftovers just reached the model, so no later session shows them again.
// Done when the note goes out, not at the start: a session that ends before its first prompt never saw
// them, and the next new session carries them instead. A list resumed and saved again after it was carried
// holds tasks this session never showed, so it stays unmarked for the next new session.
async function markHandedOver($: EngineInterface, carrier: Mirror): Promise<void> {
  if (!carrier.carriedFrom) return
  const path = `${await dataDir($)}/${carrier.carriedFrom}.json`
  const previous = JSON.parse(String(await $.fs.read(path))) as Mirror
  if (previous.updatedAt !== carrier.carriedUpdatedAt) return
  previous.handedOverAt = await $.clock.now()
  await $.fs.write(path, JSON.stringify(previous, null, 1))
}

async function carryOver($: EngineInterface): Promise<void> {
  const mirror = await mirrorOf($)
  if (mirror.tasks.length > 0 || mirror.carried) return
  const dir = await dataDir($)
  const mirrors: Mirror[] = []
  const aliveAt = new Map<string, number>()
  for (const entry of await $.fs.list(dir)) {
    try {
      const text = String(await $.fs.read(`${dir}/${entry.name}`))
      if (entry.name.endsWith('.json')) mirrors.push(JSON.parse(text) as Mirror)
      else if (entry.name.endsWith('.alive')) aliveAt.set(entry.name.slice(0, -'.alive'.length), Number(text))
    } catch {
      // A half-written or foreign file is skipped.
    }
  }
  const previous = pickPredecessor(mirrors, aliveAt, mirror.root ?? '', mirror.session, await $.clock.now())
  if (!previous) return
  const now = await $.clock.now()
  mirror.carried = openTasks(previous)
  mirror.carriedFrom = previous.session
  mirror.carriedUpdatedAt = previous.updatedAt
  mirror.changedAt = now
  await saveMirror($, mirror)
}

// Writes only the stamp file, for the session id of the moment: a timer a hot reload left behind,
// or one still running after /clear, stamps the live session and never touches a task list.
async function stampAlive($: EngineInterface): Promise<void> {
  const dir = await dataDir($)
  await ensureDir($, dir).catch(() => undefined)
  await $.fs.write(`${dir}/${await $.session.id()}.alive`, String(await $.clock.now()))
}

// Stamps at once, and starts the minute timer once per load (a hot reload runs no session.start).
async function startAlive($: EngineInterface): Promise<void> {
  await stampAlive($).catch(() => undefined)
  if (live.isAliveStarted) return
  live.isAliveStarted = true
  $.clock.every(ALIVE_EVERY_MS, () => void stampAlive($).catch(() => undefined))
}

async function markEnded($: EngineInterface): Promise<void> {
  const mirror = await mirrorOf($)
  mirror.endedAt = await $.clock.now()
  if (mirror.tasks.length > 0 || mirror.carried) await saveMirror($, mirror)
}

const KEEP_GOING_DELAY_MS = 3_000

// The file another mod keeps beside this one's: `mods-data/<mod>/<name>`. Undefined when it is not there.
async function peerFile($: EngineInterface, mod: string, name: string): Promise<string | undefined> {
  const dir = (await dataDir($)).replace(/\/tasks$/, `/${mod}`)
  return $.fs.read(`${dir}/${name}`).then(String, () => undefined)
}

// A turn that ended with work nobody has to wait for gets a prompt to carry on, unless something else
// wakes the session (background work, a scheduled wake, a CI watch, a plan-limit pause) or the last prompts
// changed nothing on the list.
async function keepGoing($: EngineInterface): Promise<void> {
  if (live.isTurnRunning) return
  const mirror = await mirrorOf($)
  const tasks = workable(mirror)
  if (tasks.length === 0 || live.hasEngineWake) return
  if (hasPendingWake(await peerFile($, 'ci-watch', `${await $.session.id()}.json`))) return
  if (isPauseHolding(await peerFile($, 'usage-guard', 'pause.json'), await $.clock.now())) return
  const isIdle = live.idlePrompts > 0 && live.promptedAt === mirror.changedAt
  if (isIdle && live.idlePrompts >= MAX_IDLE_PROMPTS) return
  live.idlePrompts = isIdle ? live.idlePrompts + 1 : 1
  live.promptedAt = mirror.changedAt
  await $.prompt.submit({ text: keepGoingText(tasks) })
}

// The settings file at the session's start, before any tool call: the settings module follows it from
// there. Read here, since an engine handle is never passed into another file.
async function readSettings($: EngineInterface): Promise<void> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const file = await $.fs.read(`${config}/mods-data/tasks/settings.json`.replace(/\\/g, '/')).catch(() => '')
  const manifest = (dir: string) => $.fs.read(`${$.plugin.root}${dir}/plugin.json`)
  applyFile(String(file), String(await manifest('/.claude-plugin').catch(() => manifest('').catch(() => ''))))
}

export const register: Register = (on, options) => {
  // The settings come from the mod's own file over the loaded options, read again as it changes.
  settings(on, options, values => {
    live.nudgeAfter = Number(values.nudgeAfterTools ?? 3)
    live.keepGoing = values.keepGoing !== false
  })

  // `/task-list [help | settings]`; with no argument, the task list. Any other argument gets the help.
  // Not `/tasks`: that name is a built-in command, and the engine refuses it.
  on('command.run', { command: COMMAND }, async ($, e) => {
    // Typed with no word over Remote Control (the phone, the web, Desktop viewing a CLI session), where no
    // row draws: the bare command answers with the phone text.
    const verb = e.args.trim() || (e.origin?.kind === 'bridge' ? 'phone' : '')
    if (verb === 'phone') return { text: `${phoneText((await mirrorOf($)).tasks)}\n/task-list help for more` }
    if (verb !== '' && verb !== 'settings') return { text: HELP }
    const [id, title] = verb === '' ? [PANE, 'Tasks'] : [SETTINGS_PANE, 'Tasks settings']
    await $.ui.open({ id, title, focus: true })
    return { text: verb === '' ? 'Opened the task list.' : 'Opened the tasks settings.' }
  })

  on('session.start', async ($, e, next) => {
    // A settings file that cannot be read never costs the start: the loaded options stand.
    await readSettings($).catch(() => undefined)
    const result = await next(e)
    // A refused command must never cost the rest of the start: the list, the carry-over, the band.
    await $.command
      .register({ name: COMMAND, description: 'The task list', argumentHint: HINT })
      .catch(() => undefined)
    const dir = await dataDir($)
    // Done before this session's list is read, so the two never race.
    await $.process
      .run(['node', '-e', SWEEP_SCRIPT, dir, String(SWEEP_DAYS), await $.session.id()], { timeoutMs: 20_000 })
      .catch(() => undefined)
    await clearEngineStore($).catch(() => undefined)
    await carryOver($).catch(() => undefined)
    await startAlive($)
    return result
  })

  // After a /clear the process goes on under a new session id with no session.start: the next save
  // reads that session's own mirror.
  on('session.end', async ($, e, next) => {
    await markEnded($).catch(() => undefined)
    live.mirror = undefined
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await startAlive($)
    live.turn += 1
    live.isTurnRunning = true
    live.toolsThisTurn = 0
    live.sawTaskTool = false
    live.isNudged = false
    live.checkOverlap = false
    return next(e)
  })

  // The main session's turn end, with what the engine still has in flight to wake it. Read before the
  // keep-going look, which waits a moment after the turn completes.
  on('classic.Stop', async ($, e, next) => {
    live.hasEngineWake = hasEngineWake(e)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    live.isTurnRunning = false
    // Looked at a moment after the turn ends, never from the end itself: a prompt sent there was seen lost.
    // `reason` is the engine's TurnCompleteReason ('answer' | 'aborted' | 'refusal' | 'error'): only a turn
    // the model answered goes on.
    if (live.keepGoing && !e.agentId && e.reason === 'answer')
      $.clock.after(KEEP_GOING_DELAY_MS, () => void keepGoing($).catch(() => undefined))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    live.afterCompact = true
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // The person's own prompt, typed or from the phone: the keep-going count starts over.
    if (e.origin?.kind === 'composer' || e.origin?.kind === 'bridge') live.idlePrompts = 0
    if (live.isTurnRunning) return next(e)
    const mirror = await mirrorOf($)
    const notes: string[] = []
    if (!mirror.isCarryNoted && mirror.carried?.length) {
      notes.push(carriedText(mirror.carried))
      mirror.isCarryNoted = true
      await saveMirror($, mirror)
      await markHandedOver($, mirror).catch(() => undefined)
    }
    const note = live.afterCompact ? openListText(mirror, live.turn) : staleText(mirror, live.turn)
    live.afterCompact = false
    if (note) notes.push(note)
    if (notes.length === 0) return next(e)
    return next({ ...e, context: [...(e.context ?? []), ...notes] })
  })

  on('prompt.attachment', { type: 'task_reminder' }, async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId) return answer
    return { text: openListText(await mirrorOf($), live.turn) }
  })

  on('tool.call', async ($, e, next) => {
    if (TASK_TOOLS.has(e.tool) && !e.agentId) {
      live.sawTaskTool = true
      const mirror = await mirrorOf($)
      const now = await $.clock.now()
      const args = e as unknown as TaskArgs
      const before = JSON.stringify(mirror)
      const output = answerTool(mirror, e.tool, args, live.turn, now)
      if (e.tool === 'TaskUpdate' && args.status === 'in_progress' && (output as { success: boolean }).success) {
        live.checkOverlap = true
      }
      if (JSON.stringify(mirror) !== before) {
        mirror.changedAt = now
        await saveMirror($, mirror)
      }
      return { result: output } as never
    }
    const result = await next(e)
    if (e.agentId) return result
    if (!TASK_TOOLS.has(e.tool)) {
      if (UNCOUNTED_TOOLS.has(e.tool)) return result
      if (live.checkOverlap) {
        live.checkOverlap = false
        const overlap = overlapText(await mirrorOf($))
        if (overlap) return withContext(result, overlap)
      }
      live.toolsThisTurn += 1
      if (live.nudgeAfter <= 0 || live.isNudged || live.sawTaskTool || live.toolsThisTurn < live.nudgeAfter)
        return result
      if (openTasks(await mirrorOf($)).length > 0) return result
      live.isNudged = true
      return withContext(result, nudgeText(live.toolsThisTurn))
    }
    // A subagent's task call ran on the engine's own tools; its list stays out of this session's.
    return result
  })

  // The task tool itself knows no hold state; its description teaches the convention.
  on('tool.describe', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const described = await next(e)
    return { ...described, description: `${described.description}\n\n${HOLD_HELP}` }
  })
}
