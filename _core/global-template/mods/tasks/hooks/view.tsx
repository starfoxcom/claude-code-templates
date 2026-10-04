import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { TaskRow, TasksView } from '../types'

// The task list on screen: one line above the prompt and the whole list, finished tasks included, in a
// pane. It only reads the mirror register.ts writes; the engine deletes its own task files once every
// task is done, so the mirror is the only full record.

const REFRESH_MS = 2_000
// After the last change the line stays this long even with nothing open, so a finished list is seen.
const LINGER_MS = 5 * 60_000
export const PANE = 'tasks'
const view = atom({ plugin: 'tasks', key: 'view' } as const, null)
const ctx = { file: '', isStarted: false }

async function mirrorPath($: Engine): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/tasks/${await $.session.id()}.json`.replaceAll('\\', '/')
}

async function refresh($: Engine): Promise<void> {
  let mirror: { tasks?: TaskRow[]; changedAt?: number; carried?: TaskRow[] } = {}
  try {
    mirror = JSON.parse(String(await $.fs.read(ctx.file)))
  } catch {
    // No mirror yet: this session has made no task list.
  }
  const tasks = mirror.tasks ?? []
  // The carried-over group shows only until this session starts its own list.
  const carried = tasks.length === 0 ? (mirror.carried ?? []) : []
  await update($, view, () =>
    tasks.length + carried.length > 0 ? { tasks, carried, updatedAt: mirror.changedAt ?? 0 } : null,
  )
}

function openList($: Engine): void {
  void $.ui.open({ id: PANE, title: 'Tasks', focus: true }).catch(() => undefined)
}

export type Kind = 'working' | 'open' | 'hold' | 'done' | 'dropped'

// A hold wins over the engine's status: a held task is waiting, whatever it was.
export function kindOf(task: TaskRow): Kind {
  if (task.droppedAt) return 'dropped'
  if (task.status === 'completed') return 'done'
  if (task.hold) return 'hold'
  return task.status === 'in_progress' ? 'working' : 'open'
}

export const KINDS: { kind: Kind; icon: string; title: string; color?: string }[] = [
  { kind: 'working', icon: '🔨', title: 'Working', color: 'cyan' },
  { kind: 'open', icon: '📝', title: 'Open' },
  { kind: 'hold', icon: '🚧', title: 'On hold', color: 'yellow' },
  { kind: 'done', icon: '✅', title: 'Done', color: 'green' },
  { kind: 'dropped', icon: '🚫', title: 'Dropped', color: 'gray' },
]

// Working, open, on hold by id; then the finished ones, newest first.
export function ordered(tasks: readonly TaskRow[]): TaskRow[] {
  const rank = { working: 0, open: 1, hold: 2, done: 3, dropped: 4 }
  return [...tasks].sort((a, b) => {
    const byKind = rank[kindOf(a)] - rank[kindOf(b)]
    if (byKind !== 0) return byKind
    const byId = Number(a.id) - Number(b.id)
    return kindOf(a) === 'done' || kindOf(a) === 'dropped' ? -byId : byId
  })
}

function countOf(tasks: readonly TaskRow[], kind: Kind): number {
  return tasks.filter(task => kindOf(task) === kind).length
}

type Ui = ReturnType<Engine['ui']['resolve']>

// The line above the prompt while only last session's leftovers are listed.
function carriedLine(ui: Ui, $: Engine, count: number) {
  const { Box, Button, Text } = ui
  return (
    <Box>
      <Text color="magenta">↩ {count} carried over from the last session, check them against the hand-off </Text>
      <Button key="tasks-list" label="List" onPress={() => openList($)} />
    </Box>
  )
}

// The line above the prompt: done count, the task being worked (or the next one), open and held counts.
function bandLine(ui: Ui, $: Engine, tasks: readonly TaskRow[]) {
  const { Box, Button, Text } = ui
  const active = tasks.filter(t => kindOf(t) === 'working')
  const done = countOf(tasks, 'done')
  const kept = tasks.length - countOf(tasks, 'dropped')
  const open = countOf(tasks, 'open')
  const held = countOf(tasks, 'hold')
  return (
    <Box>
      <Text color={done === kept ? 'green' : undefined}>
        ✅ {done}/{kept}{' '}
      </Text>
      {currentText(ui, tasks, active)}
      {open > 0 ? <Text>· 📝 {open} </Text> : null}
      {held > 0 ? <Text color="yellow">· 🚧 {held} </Text> : null}
      <Button key="tasks-list" label="List" onPress={() => openList($)} />
    </Box>
  )
}

function currentText(ui: Ui, tasks: readonly TaskRow[], active: readonly TaskRow[]) {
  const { Text } = ui
  const first = active[0]
  if (first) {
    return (
      <Text color={active.length > 1 ? 'yellow' : 'cyan'} bold wrap="truncate-end">
        · 🔨 #{first.id} {first.activeForm ?? first.subject}
        {active.length > 1 ? ` (+${active.length - 1} more at once)` : ''}{' '}
      </Text>
    )
  }
  const upcoming = ordered(tasks).find(t => kindOf(t) === 'open')
  if (!upcoming) return null
  // The open kind's own icon and color, as the list draws it.
  const look = KINDS.find(k => k.kind === 'open')
  return (
    <Text key="tasks-next" color={look?.color} wrap="truncate-end">
      · {look?.icon} next #{upcoming.id} {upcoming.subject}{' '}
    </Text>
  )
}

function carriedGroup(ui: Ui, carried: readonly TaskRow[]) {
  const { Box, Text } = ui
  return (
    <Box key="group-carried" flexDirection="column" marginBottom={1}>
      <Text bold color="magenta">
        ↩ Carried over from the last session ({carried.length})
      </Text>
      {carried.map(t => (
        <Box key={`carried-${t.id}`}>
          <Text dimColor wrap="truncate-end">
            {'  '}#{t.id} {t.subject}
            {t.hold ? ` (on hold: ${t.hold})` : ''}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

function kindGroup(ui: Ui, group: (typeof KINDS)[number], tasks: readonly TaskRow[]) {
  const { Box, Text } = ui
  const rows = tasks.filter(t => kindOf(t) === group.kind)
  if (rows.length === 0) return null
  return (
    <Box key={`group-${group.kind}`} flexDirection="column" marginTop={1}>
      <Text bold color={group.color}>
        {group.icon} {group.title} ({rows.length})
      </Text>
      {rows.map(t => (
        <Box key={`task-${t.id}`} flexDirection="column">
          <Text
            color={group.color}
            bold={group.kind === 'working'}
            dimColor={group.kind === 'done'}
            wrap="truncate-end"
          >
            {'  '}#{t.id} {t.subject}
          </Text>
          {t.hold ? (
            <Text dimColor wrap="truncate-end">
              {'      '}waits on: {t.hold}
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

// Called from register.ts's session.start: a plugin hooks an event once, and a render hook may not
// write state, so the view cannot start itself.
export async function startView($: Engine): Promise<void> {
  if (ctx.isStarted) return
  ctx.isStarted = true
  ctx.file = await mirrorPath($)
  await refresh($)
  $.clock.every(REFRESH_MS, () => void refresh($).catch(() => undefined))
}

export const register: Register = on => {
  // register.ts hooks session.start without a matcher; a plugin may hook an event twice only when one
  // of them narrows it, so the view starts here on interactive (terminal) sessions.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e)
    await startView($)
    return result
  })

  // A Desktop session starts like an SDK one, not interactive and drawing nowhere, and its surface
  // joins afterwards: the view starts when it does, so the band is there before the first tool call.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    await startView($)
    return result
  })

  // A hot reload starts the module over without a new session.start: the next common tool call starts
  // the view. Task tools alone would not do: register.ts answers them without passing them on.
  on('tool.call', { tool: ['Bash', 'PowerShell', 'Read', 'Edit', 'Write', 'Grep', 'Glob'] }, async ($, e, next) => {
    const result = await next(e)
    await startView($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    const shown = await read($, view)
    if (!shown) return inner
    // A view of carried-over tasks only is never "all done": its line shows until this session makes a list.
    const isAllDone =
      shown.tasks.length > 0 && countOf(shown.tasks, 'done') === shown.tasks.length - countOf(shown.tasks, 'dropped')
    if (isAllDone && (await $.clock.now()) - shown.updatedAt > LINGER_MS) return inner
    const ui = $.ui.resolve(e)
    const line =
      shown.tasks.length === 0 && shown.carried.length > 0
        ? carriedLine(ui, $, shown.carried.length)
        : bandLine(ui, $, shown.tasks)
    return (
      <ui.Box flexDirection="column">
        {inner}
        {line}
      </ui.Box>
    )
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const ui = $.ui.resolve(e)
    const shown = await read($, view)
    const tasks = ordered(shown?.tasks ?? [])
    const carried = ordered(shown?.carried ?? [])
    const done = countOf(tasks, 'done')
    const kept = tasks.length - countOf(tasks, 'dropped')
    const close = () => void $.ui.close({ id: PANE }).catch(() => undefined)
    return (
      <ui.Box flexDirection="column">
        {carried.length > 0 ? carriedGroup(ui, carried) : null}
        <ui.Text bold>{tasks.length === 0 ? 'No tasks in this session.' : `${done} of ${kept} done`}</ui.Text>
        {KINDS.map(group => kindGroup(ui, group, tasks))}
        <ui.Button key="tasks-close" label="Close" onPress={close} />
      </ui.Box>
    )
  })
}
