import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState, SessionLine } from '../types'
import { GIT_STATUS, modelName, parseStatus } from './git'
import { register as settings, SETTINGS_PANE } from './settings'

const line = atom({ plugin: 'session-info', key: 'line' } as const, null)
const isExpanded = atom({ plugin: 'session-info', key: 'isExpanded' } as const, false)

const GIT_TIMEOUT_MS = 5_000

const live: {
  isStarted: boolean
  effort?: string
  refreshMs: number
  maxFiles: number
  reading?: Promise<void>
  isReadAgainWanted: boolean
} = {
  isStarted: false,
  refreshMs: 30_000,
  maxFiles: 8,
  isReadAgainWanted: false,
}

function baseName(folder: string): string {
  return folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder
}

async function readGit($: EngineInterface): Promise<GitState> {
  try {
    const { exitCode, stdout } = await $.process.run(GIT_STATUS, { timeoutMs: GIT_TIMEOUT_MS })
    return exitCode === 0 ? parseStatus(stdout) : parseStatus('')
  } catch {
    return parseStatus('')
  }
}

// A failed read never rejects the hook that asked for it: the row keeps its last reading.
async function readOnce($: EngineInterface): Promise<void> {
  try {
    const [model, root, git] = await Promise.all([$.session.model(), $.session.root(), readGit($)])
    const next: SessionLine = { model: modelName(model), effort: live.effort, project: baseName(root), git }
    await update($, line, () => next)
  } catch {
    // Read again at the next turn, shell command or tick.
  }
}

async function readUntilCurrent($: EngineInterface): Promise<void> {
  do {
    live.isReadAgainWanted = false
    await readOnce($)
  } while (live.isReadAgainWanted)
}

// One git read at a time, so an older reading never lands over a newer one. A refresh asked for while
// one runs is folded into a single read after it, which starts after every request it answers.
async function refresh($: EngineInterface): Promise<void> {
  if (live.reading) {
    live.isReadAgainWanted = true
    return live.reading
  }
  live.reading = readUntilCurrent($).finally(() => {
    live.reading = undefined
  })
  return live.reading
}

// A hot reload starts the module over without a new session.start, and a Desktop session starts with no
// surface and draws only once one attaches: every entry point below starts the row, once per load.
async function start($: EngineInterface): Promise<void> {
  if (live.isStarted) return
  live.isStarted = true
  await refresh($)
  if (live.refreshMs > 0) $.clock.every(live.refreshMs, () => void refresh($))
}

export const register: Register = (on, options) => {
  live.refreshMs = Math.max(0, Number(options.refreshSeconds ?? 30)) * 1000
  live.maxFiles = Math.max(1, Number(options.maxFiles ?? 8))
  settings(on, options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const description = 'Session row: /session-info settings opens its settings'
    await $.command.register({ name: 'session-info', description })
    await start($)
    return result
  })

  on('command.run', { command: 'session-info' }, async ($, e, next) => {
    if (e.args.trim() !== 'settings') return next(e)
    await $.ui.open({ id: SETTINGS_PANE, title: 'Session info settings', focus: true })
    return { text: 'Opened the session-info settings.' }
  })

  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    await start($)
    return result
  })

  // The main loop's own requests only: a subagent's effort is not the session's.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) live.effort = String(e.effort)
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (live.isStarted) await refresh($)
    else await start($)
    return result
  })

  // A checkout, commit or pull in the shell moves the branch before the turn ends.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    const shown = await read($, line)
    if (e.props.hasSurvey || !shown) return inner
    const ui = $.ui.resolve(e)
    return (
      <ui.Box flexDirection="column">
        {inner}
        {rowOf(ui, $, shown)}
        {(await read($, isExpanded)) ? filesOf(ui, shown.git.changed) : null}
      </ui.Box>
    )
  })
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

function rowOf(ui: Ui, $: EngineInterface, shown: SessionLine) {
  const { Box, Button, Text } = ui
  const { git } = shown
  const count = git.changed.length
  return (
    <Box>
      <Text>
        {shown.effort ? `${shown.model} ${shown.effort}` : shown.model} · {shown.project}
      </Text>
      {git.branch ? (
        <Text>
          {' · '}
          {git.branch}
          {count > 0 ? '*' : ''}
        </Text>
      ) : null}
      {git.ahead > 0 ? <Text color="green"> ↑{git.ahead}</Text> : null}
      {git.behind > 0 ? <Text color="yellow"> ↓{git.behind}</Text> : null}
      {count > 0 ? (
        <Button
          key="session-info-changes"
          label={`${count} changed`}
          onPress={() => update($, isExpanded, value => !value)}
        />
      ) : null}
    </Box>
  )
}

function filesOf(ui: Ui, changed: readonly string[]) {
  const { Box, Text } = ui
  const shown = changed.slice(0, live.maxFiles)
  const rest = changed.length - shown.length
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {shown.map(entry => (
        <Box key={`session-info-file-${entry}`}>
          <Text dimColor wrap="truncate-end">
            {entry}
          </Text>
        </Box>
      ))}
      {rest > 0 ? <Text dimColor>… and {rest} more</Text> : null}
    </Box>
  )
}
