import { atom, read, update } from 'claude-code'
import type { ConfigKind, Elements, EngineInterface as Engine, On, Register } from 'claude-code'

// The mod's settings: a JSON file of its own under mods-data, the one place they are kept. The pane (every
// surface that draws fields, the terminal and the Desktop app alike) and `/<command> set <name> <value>`
// (the phone, where no field draws) both write it. Every session reads it at its start, after a reload at
// its first tool call or command, and once a minute, so a change reaches the sessions already running.
// The /config menu cannot be that place: the Desktop app's lists no plugin rows and refuses to set them, so
// the mod's rows are hidden there. The options the mod loaded with (the manifest's defaults, or a value set
// in /config before) stay underneath. Built from usage-guard/hooks/settings.tsx, which hooks the prompt
// itself; here the mod's own session.start reads the file through applyFile, since a mod hooks an event
// once without a matcher and these mods already hook theirs. Its command opens the pane by SETTINGS_PANE.

const PLUGIN = 'guards'
const TITLE = 'Guards settings'
// The slash command, without the slash.
const NAME = 'guards'
export const SETTINGS_PANE = `${PLUGIN}-settings`
const REFRESH_MS = 60_000
const MKDIR_SCRIPT = 'require("fs").mkdirSync(process.argv[1],{recursive:true})'
// The last save's outcome per field, shown under it until the pane opens again. The engine lists a
// module's state from literals, so the plugin name is spelled out here rather than taken from PLUGIN.
const view = atom({ plugin: 'guards', key: 'settings' } as const, null)

type Options = Parameters<Register>[1]
export type Values = Record<string, unknown>
export type Field = { title?: string; description?: string; type?: string; options?: string[] }
type Fields = Record<string, Field>
type Manifest = { userConfig?: Fields }
type Parsed = { value: unknown } | { error: string }

export function kindOf(field: Field): ConfigKind {
  if (field.type === 'boolean') return 'boolean'
  if (field.options) return 'choice'
  return field.type === 'number' ? 'number' : 'text'
}

/** Typed or picked text as the field's kind holds it, or why it cannot be one. */
export function parseValue(field: Field, text: string): Parsed {
  const trimmed = text.trim()
  const kind = kindOf(field)
  if (kind === 'number') {
    const value = Number(trimmed)
    return trimmed !== '' && Number.isFinite(value) ? { value } : { error: `"${text}" is not a number` }
  }
  if (kind === 'boolean') {
    if (/^(on|true|yes)$/i.test(trimmed)) return { value: true }
    if (/^(off|false|no)$/i.test(trimmed)) return { value: false }
    return { error: `"${text}" is not on or off` }
  }
  if (kind === 'choice')
    return field.options?.includes(trimmed)
      ? { value: trimmed }
      : { error: `"${text}" is not one of: ${(field.options ?? []).join(', ')}` }
  return { value: text }
}

function fits(field: Field, value: unknown): boolean {
  const kind = kindOf(field)
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (kind === 'boolean') return typeof value === 'boolean'
  if (kind === 'choice') return typeof value === 'string' && (field.options ?? []).includes(value)
  return typeof value === 'string'
}

/** What the mod runs with: each saved value that fits a declared field, over the options it loaded with. */
export function effectiveValues(options: Values, saved: Values, fields: Fields): Values {
  const values = { ...options }
  for (const [name, value] of Object.entries(saved)) {
    const field = fields[name]
    if (field && fits(field, value)) values[name] = value
  }
  return values
}

/** A value as text and the phone show it: a switch as on or off. */
export function shownValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  return value === undefined || value === null || value === '' ? '(not set)' : String(value)
}

/** `/<command> set` with no name: every setting, its value and its title. */
export function settingsList(values: Values, fields: Fields): string {
  const names = Object.keys(fields)
  const width = Math.max(0, ...names.map(name => name.length))
  const rows = names.map(name => `  ${name.padEnd(width)}  ${shownValue(values[name])}  ${fields[name]?.title ?? ''}`)
  return [`${PLUGIN} settings (change one with /${NAME} set <name> <value>):`, ...rows].join('\n').trimEnd()
}

async function filePath($: Engine): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/${PLUGIN}/settings.json`.replace(/\\/g, '/')
}

function parseObject(text: string): Values {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Values) : {}
  } catch {
    return {}
  }
}

async function readSaved($: Engine): Promise<Values> {
  return parseObject(String(await $.fs.read(await filePath($)).catch(() => '')))
}

// The manifest's fields, read once per load. The plugin's root holds plugin.json, directly or in
// .claude-plugin/.
let manifestFields: Fields | undefined
async function fieldsOf($: Engine): Promise<Fields> {
  if (manifestFields) return manifestFields
  for (const path of [`${$.plugin.root}/.claude-plugin/plugin.json`, `${$.plugin.root}/plugin.json`]) {
    try {
      manifestFields = (JSON.parse(String(await $.fs.read(path))) as Manifest).userConfig ?? {}
      return manifestFields
    } catch {
      // Not there: the next place.
    }
  }
  return {}
}

// The file is read again just before the write, so a change another session saved a moment ago stays.
// Its folder is made on the first save that finds it missing.
async function writeValue($: Engine, name: string, value: unknown): Promise<string | undefined> {
  const path = await filePath($)
  const text = `${JSON.stringify({ ...(await readSaved($)), [name]: value }, null, 2)}\n`
  try {
    await $.fs.write(path, text)
    return undefined
  } catch {
    try {
      await $.process.run(['node', '-e', MKDIR_SCRIPT, path.slice(0, path.lastIndexOf('/'))], { timeoutMs: 10_000 })
      await $.fs.write(path, text)
      return undefined
    } catch (err) {
      return `Could not save: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

async function showResult($: Engine, name: string, result: { error?: string; saved?: string }): Promise<void> {
  await update($, view, shown => {
    const errors = { ...(shown?.errors ?? {}) }
    const saved = { ...(shown?.saved ?? {}) }
    delete errors[name]
    delete saved[name]
    if (result.error) errors[name] = result.error
    if (result.saved) saved[name] = result.saved
    return { errors, saved }
  })
}

// The surfaces that draw fields. The mobile app has no Input or Select, so it is left to the engine's
// own pane, and `/<command> set` serves it.
type Ui = Elements['terminal'] | Elements['desktop'] | Elements['vscode']

// What register was handed, for the functions below: the loaded options and how the mod takes new values.
const loaded: { options: Values; apply: (values: Values) => void; isTicking: boolean } = {
  options: {},
  apply: () => undefined,
  isTicking: false,
}

/**
 * Runs the mod with the settings file's text over the options it loaded with, the fields taken from the
 * manifest's text. For the main module, which reads the file where this one cannot hook (see register).
 */
export function applyFile(fileText: string, manifestText: string): void {
  const fields = (parseObject(manifestText).userConfig ?? {}) as Fields
  loaded.apply(effectiveValues(loaded.options, parseObject(fileText), fields))
}

async function currentValues($: Engine): Promise<Values> {
  return effectiveValues(loaded.options, await readSaved($), await fieldsOf($))
}

async function refresh($: Engine): Promise<void> {
  loaded.apply(await currentValues($))
}

async function start($: Engine): Promise<void> {
  await refresh($).catch(() => undefined)
  if (loaded.isTicking) return
  loaded.isTicking = true
  $.clock.every(REFRESH_MS, () => void refresh($).catch(() => undefined))
}

// Reads the file and checks it again once a minute, once per module load: from the first tool call or
// command (a hot reload starts the module over without a session.start).
async function followSettings($: Engine): Promise<void> {
  if (!loaded.isTicking) await start($)
}

// Parse, save, and run with the new value at once; the other sessions read it within a minute.
async function change($: Engine, name: string, text: string): Promise<Parsed> {
  const field = (await fieldsOf($))[name]
  if (!field) return { error: `No setting named "${name}".` }
  const parsed = parseValue(field, text)
  if ('error' in parsed) return parsed
  const error = await writeValue($, name, parsed.value)
  if (error) return { error }
  await refresh($)
  return parsed
}

async function saveFromPane($: Engine, name: string, text: string): Promise<void> {
  const parsed = await change($, name, text)
  const saved = 'error' in parsed ? undefined : `Saved: ${shownValue(parsed.value)}.`
  await showResult($, name, 'error' in parsed ? { error: parsed.error } : { saved })
}

function control(ui: Ui, $: Engine, name: string, field: Field, value: unknown) {
  const key = `${PLUGIN}-set-${name}`
  const kind = kindOf(field)
  if (kind === 'boolean' || kind === 'choice') {
    const choices = kind === 'boolean' ? ['on', 'off'] : (field.options ?? [])
    const pick = (choice: string) => void saveFromPane($, name, choice)
    return <ui.Select key={key} options={choices.map(value => ({ value }))} value={shownValue(value)} onSelect={pick} />
  }
  const submit = (text: string) => void saveFromPane($, name, text)
  return <ui.Input key={key} value={shownValue(value)} submitLabel="save" onSubmit={submit} />
}

// `/<command> set [<name> <value>]`, for the phone: no name lists the settings. A pane opened again starts
// clean, with no outcome of an earlier save under its fields.
async function setCommand($: Engine, args: string): Promise<string | undefined> {
  const [verb = '', name = '', ...rest] = args.trim().split(/\s+/)
  if (verb === 'settings') await update($, view, () => null)
  if (verb !== 'set') return undefined
  if (!name) return settingsList(await currentValues($), await fieldsOf($))
  await start($)
  const parsed = await change($, name, rest.join(' '))
  if ('error' in parsed) return `${parsed.error} /${NAME} set lists the settings.`
  return `Saved: ${name} is ${shownValue(parsed.value)} for every session (the others within a minute).`
}

async function drawPane(ui: Ui, $: Engine) {
  // Read on every draw: a change saved in another session shows here too.
  const fields = await fieldsOf($)
  const values = await currentValues($)
  const shown = await read($, view)
  const close = () => void $.ui.close({ id: SETTINGS_PANE }).catch(() => undefined)
  return (
    <ui.Box flexDirection="column">
      <ui.Text bold>{TITLE}</ui.Text>
      <ui.Text dimColor wrap="wrap">
        {`Saved for every session. From the phone: /${NAME} set <name> <value>.`}
      </ui.Text>
      {Object.entries(fields).map(([name, field]) => (
        <ui.Box key={`setting-${name}`} flexDirection="column" marginTop={1}>
          <ui.Text bold>{field.title ?? name}</ui.Text>
          {field.description ? (
            <ui.Text dimColor wrap="wrap">
              {field.description}
            </ui.Text>
          ) : null}
          {control(ui, $, name, field, values[name])}
          {shown?.errors[name] ? (
            <ui.Text color="red" wrap="wrap">
              {shown.errors[name]}
            </ui.Text>
          ) : null}
          {shown?.saved?.[name] ? <ui.Text color="green">{shown.saved[name]}</ui.Text> : null}
        </ui.Box>
      ))}
      <ui.Box marginTop={1}>
        <ui.Button key={`${PLUGIN}-settings-close`} label="Close" onPress={close} />
      </ui.Box>
    </ui.Box>
  )
}

// The file is read at the session's start (by the mod's own session.start, through applyFile), at the
// first tool call, at the mod's command and the pane, and once a minute from the first tool call or command.
export function register(on: On, options: Options, apply: (values: Values) => void): void {
  loaded.options = options
  loaded.apply = apply
  apply(options)

  // Narrowed by tool, so it sits beside the mod's own tool.call hook: a hot reload starts the module over
  // without a session.start, and its first common tool call picks the file up again. Agent and Workflow
  // are here so the helper block reads the file before it decides.
  on(
    'tool.call',
    { tool: ['Bash', 'PowerShell', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Agent', 'Workflow'] },
    async ($, e, next) => {
      await followSettings($)
      return next(e)
    },
  )

  // The mod's own /config rows are hidden: a change there would not reach the file this mod runs from.
  on('config.describe', async ($, e, next) => {
    const shown = await next(e)
    const owner = e.key.slice(0, Math.max(e.key.lastIndexOf('.'), 0))
    return owner === PLUGIN || owner.startsWith(`${PLUGIN}@`) ? { ...shown, isHidden: true } : shown
  })

  on('command.run', { command: NAME }, async ($, e, next) => {
    await followSettings($)
    if (e.args.trim().split(/\s+/)[0] !== 'set') return (await setCommand($, e.args), next(e))
    return { text: (await setCommand($, e.args)) ?? '' }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== SETTINGS_PANE || e.surface === 'mobile') return next(e)
    return drawPane($.ui.resolve(e) as Ui, $)
  })
}
