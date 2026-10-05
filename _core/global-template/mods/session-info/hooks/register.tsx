import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState, SessionLine } from '../types'
import { GIT_STATUS, modelName, parseStatus, phoneText } from './git'
import { applyFile, register as settings, SETTINGS_PANE } from './settings'

const line = atom({ plugin: 'session-info', key: 'line' } as const, null)
const isExpanded = atom({ plugin: 'session-info', key: 'isExpanded' } as const, false)

const GIT_TIMEOUT_MS = 5_000
const HINT = '[help | settings | set | phone]'
export const HELP = [
  '/session-info: the row with the model, the project and the branch with its changes.',
  '  /session-info settings  open the settings pane',
  '  /session-info set       change a setting: set <name> <value>; alone, list them',
  '  /session-info phone     the same as text, for phone chats',
  '  /session-info help      this list',
].join('\n')

const live: {
  /** The load's one start (the first read, then the timer), awaited by every hook that needs the row. */
  started?: Promise<void>
  effort?: string
  /** The effort picked for the model in settings, as last read; a change there is a new pick. */
  selected?: string
  /** Settings were read once in this load: only a later change counts as a new pick. */
  hasReadPick: boolean
  refreshMs: number
  maxFiles: number
  reading?: Promise<void>
  isReadAgainWanted: boolean
} = {
  refreshMs: 30_000,
  maxFiles: 8,
  isReadAgainWanted: false,
  hasReadPick: false,
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

// The effort picked for `model`: `/effort` and the model picker keep it per model under `modelSettings`,
// an older settings file at the top level. Nothing picked: the model's own default, which only a
// request shows.
export function selectedEffort(config: Record<string, unknown>, model: string): string | undefined {
  const bare = model.replace(/\[[^\]]*\]$/, '')
  const perModel = config.modelSettings as Record<string, { effortLevel?: unknown }> | undefined
  const effort = perModel?.[bare]?.effortLevel ?? config.effortLevel
  return typeof effort === 'string' || typeof effort === 'number' ? String(effort) : undefined
}

// The row shows the effort before the first request: the one picked in settings. A request's own
// effort (after any downgrade for the model) replaces it, until the pick changes again.
// The first read in a load only fills an empty row: a request may already have shown the effort it
// used (after a hot reload, the turn's request lands before the row starts).
function takeEffort(config: Record<string, unknown>, model: string): void {
  const selected = selectedEffort(config, model)
  const isNewPick = live.hasReadPick && selected !== live.selected
  if (isNewPick || live.effort === undefined) live.effort = selected ?? live.effort
  live.selected = selected
  live.hasReadPick = true
}

// A failed read never rejects the hook that asked for it: the row keeps its last reading.
async function readOnce($: EngineInterface): Promise<void> {
  try {
    const config = $.settings.read().catch(() => ({}))
    const [model, root, git] = await Promise.all([$.session.model(), $.session.root(), readGit($)])
    takeEffort((await config) ?? {}, model)
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
// surface and draws only once one attaches: every entry point below starts the row, once per load, and
// waits for that one start (a command that lands mid-start gets the row, not "not read yet").
function start($: EngineInterface): Promise<void> {
  live.started ??= refresh($)
    .then(() => armRefresh($))
    .catch(() => undefined)
  return live.started
}

// A new interval from the settings file takes over at the next tick of the old one. At 0 (no refresh)
// a slow tick still watches for a new interval.
const IDLE_MS = 60_000
function armRefresh($: EngineInterface): void {
  const period = live.refreshMs
  const tick = $.clock.every(period > 0 ? period : IDLE_MS, () => {
    if (live.refreshMs !== period) {
      tick.cancel()
      armRefresh($)
    }
    if (live.refreshMs > 0) void refresh($)
  })
}

// The settings file at the session's start, before any tool call: the settings module follows it from
// there. Read here, since an engine handle is never passed into another file.
async function readSettings($: EngineInterface): Promise<void> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const file = await $.fs.read(`${config}/mods-data/session-info/settings.json`.replace(/\\/g, '/')).catch(() => '')
  const manifest = (dir: string) => $.fs.read(`${$.plugin.root}${dir}/plugin.json`)
  applyFile(String(file), String(await manifest('/.claude-plugin').catch(() => manifest('').catch(() => ''))))
}

export const register: Register = (on, options) => {
  // The settings come from the mod's own file over the loaded options, read again as it changes.
  settings(on, options, values => {
    live.refreshMs = Math.max(0, Number(values.refreshSeconds ?? 30)) * 1000
    live.maxFiles = Math.max(1, Number(values.maxFiles ?? 8))
  })

  on('session.start', async ($, e, next) => {
    // A settings file that cannot be read never costs the start: the loaded options stand.
    await readSettings($).catch(() => undefined)
    const result = await next(e)
    const description = 'The session row: model, project and branch'
    await $.command.register({ name: 'session-info', description, argumentHint: HINT })
    await start($)
    return result
  })

  // `/session-info [help | settings | phone]`; any other argument, or none, gets the help.
  on('command.run', { command: 'session-info' }, async ($, e) => {
    // Typed with no word over Remote Control (the phone, the web, Desktop viewing a CLI session), where no
    // row draws: the bare command answers with the phone text.
    const verb = e.args.trim() || (e.origin?.kind === 'bridge' ? 'phone' : '')
    if (verb === 'phone') {
      await start($)
      const shown = await read($, line)
      const text = shown ? phoneText(shown, live.maxFiles) : 'The session row is not read yet.'
      return { text: `${text}\n/session-info help for more` }
    }
    if (verb !== 'settings') return { text: HELP }
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
    if (live.started) await refresh($)
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

// The row's parts (model, project, branch with its arrows, the changes button) wrap whole in a narrow
// band: a part that does not fit moves to the next line in one piece. Only a part wider than the band
// alone (a long branch name) shrinks, cut short with an ellipsis.
function rowOf(ui: Ui, $: EngineInterface, shown: SessionLine) {
  const { Box, Button, Text } = ui
  const { git } = shown
  const count = git.changed.length
  return (
    <Box key="session-info-row" flexWrap="wrap">
      <Box key="session-info-model" flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{shown.effort ? `${shown.model} ${shown.effort}` : shown.model}</Text>
      </Box>
      <Box key="session-info-project" flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end"> · {shown.project}</Text>
      </Box>
      {git.branch ? (
        <Box key="session-info-branch" flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">
            {' · '}
            {git.branch}
            {count > 0 ? '*' : ''}
          </Text>
          {git.ahead > 0 ? <Text color="green"> ↑{git.ahead}</Text> : null}
          {git.behind > 0 ? <Text color="yellow"> ↓{git.behind}</Text> : null}
        </Box>
      ) : null}
      {count > 0 ? (
        <Box key="session-info-changes-slot" flexShrink={0}>
          <Button
            key="session-info-changes"
            label={`${count} changed`}
            onPress={() => update($, isExpanded, value => !value)}
          />
        </Box>
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
