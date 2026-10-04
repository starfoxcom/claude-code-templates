import type { CommandInfo, Elements, EngineInterface as Engine, Register } from 'claude-code'

// `/mods`: a pane listing every loaded mod, what it does, and the slash commands the mods add. The
// engine keeps no list of loaded plugins, so the pane reads the mod folders from
// CLAUDE_CODE_PLUGIN_DIRS and each folder's plugin.json. `$.command.list()` does not say which plugin
// added a command: a command named after a mod is listed under it, and every other plugin command
// is listed apart.

const PANE = 'mods-list'
const HINT = '[help]'
export const HELP = [
  '/mods: lists the loaded mods, what each one does, and the slash commands they add.',
  '  /mods       open the list',
  '  /mods help  this list',
].join('\n')

export type ModInfo = { name: string; description: string }

// The folder list as the engine splits it: `;` on Windows (a drive letter holds a `:`), `:` elsewhere.
export function modFolders(value: string | undefined, isWindows: boolean): string[] {
  return (value ?? '')
    .split(isWindows ? ';' : ':')
    .map(folder => folder.trim())
    .filter(Boolean)
}

// A leading `~` as the engine reads it when it loads the mods; `$.fs.read` takes the path as written.
export function expandHome(folder: string, home: string): string {
  return /^~(?:[\\/]|$)/.test(folder) ? home + folder.slice(1) : folder
}

async function readMod($: Engine, folder: string): Promise<ModInfo> {
  const path = `${folder.replaceAll('\\', '/').replace(/\/+$/, '')}/.claude-plugin/plugin.json`
  try {
    const manifest = JSON.parse(String(await $.fs.read(path))) as Partial<ModInfo>
    return { name: String(manifest.name), description: String(manifest.description ?? '') }
  } catch {
    const name = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folder
    return { name, description: 'No readable plugin.json in its folder.' }
  }
}

async function readMods($: Engine): Promise<ModInfo[]> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const folders = modFolders(await $.env.get('CLAUDE_CODE_PLUGIN_DIRS'), isWindows)
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '~'
  return Promise.all(folders.map(folder => readMod($, expandHome(folder, home))))
}

// Every surface but mobile draws the pane; the mobile app gets the engine's own.
type Ui = Elements['terminal'] | Elements['desktop'] | Elements['vscode']

function commandLine(ui: Ui, command: CommandInfo) {
  return (
    <ui.Box key={`mods-command-${command.name}`} flexDirection="row">
      <ui.Text>{`  /${command.name}  `}</ui.Text>
      <ui.Text dimColor wrap="wrap">
        {command.description}
      </ui.Text>
    </ui.Box>
  )
}

function modRow(ui: Ui, mod: ModInfo, commands: readonly CommandInfo[]) {
  return (
    <ui.Box key={`mods-row-${mod.name}`} flexDirection="column" marginTop={1}>
      <ui.Text bold>{mod.name}</ui.Text>
      <ui.Text dimColor wrap="wrap">
        {mod.description}
      </ui.Text>
      {commands.map(command => commandLine(ui, command))}
    </ui.Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const description = 'The loaded mods and the commands they add'
    // A refused name costs only the command, never the session start.
    await $.command.register({ name: 'mods', description, argumentHint: HINT }).catch(() => undefined)
    return result
  })

  // `/mods [help]`; with no argument, the pane. Any argument gets the help.
  on('command.run', { command: 'mods' }, async ($, e) => {
    if (e.args.trim() !== '') return { text: HELP }
    await $.ui.open({ id: PANE, title: 'Mods', focus: true })
    return { text: 'Opened the mods list.' }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE || e.surface === 'mobile') return next(e)
    const ui = $.ui.resolve(e) as Ui
    const mods = await readMods($)
    const names = new Set(mods.map(mod => mod.name))
    const listed = await $.command.list().catch((): CommandInfo[] => [])
    const commands = listed.filter(command => command.source === 'plugin')
    const others = commands.filter(command => !names.has(command.name))
    const close = () => void $.ui.close({ id: PANE }).catch(() => undefined)
    return (
      <ui.Box flexDirection="column">
        <ui.Text bold>{`${mods.length} mods loaded`}</ui.Text>
        {mods.map(mod => modRow(ui, mod, commands.filter(command => command.name === mod.name)))}
        {others.length > 0 ? (
          <ui.Box key="mods-others" flexDirection="column" marginTop={1}>
            <ui.Text bold>Other plugin commands</ui.Text>
            {others.map(command => commandLine(ui, command))}
          </ui.Box>
        ) : null}
        <ui.Box marginTop={1}>
          <ui.Button key="mods-close" label="Close" onPress={close} />
        </ui.Box>
      </ui.Box>
    )
  })
}
