import { atom, read, update } from 'claude-code'
import type { ConfigRow, ConfigValue, Elements, EngineInterface as Engine, Register } from 'claude-code'

// The mod's settings in a pane every surface draws (the CLI and the Desktop app alike): the /config
// rows this plugin owns, each changed through $.config.set as the menu would, which reloads the mod
// with the new value. Every mod with settings carries this file, the same apart from PLUGIN and
// TITLE; its command opens the pane by SETTINGS_PANE.

const PLUGIN = 'session-info'
const TITLE = 'Session info settings'
export const SETTINGS_PANE = `${PLUGIN}-settings`
const COMMAND = '/session-info settings'
// Only what the pane cannot read back from /config: the last refusal per field. The engine lists a
// module's state from literals, so the plugin name is spelled out here rather than taken from PLUGIN.
const view = atom({ plugin: 'session-info', key: 'settings' } as const, null)

// A row's field: what follows its last dot. The key is `<plugin>.<field>`, and the plugin part may carry
// where the plugin came from (`usage-guard@inline`); field names hold no dot.
export function fieldOf(row: Pick<ConfigRow, 'key'>): string {
  return row.key.slice(row.key.lastIndexOf('.') + 1)
}

// A row this plugin owns: by its owner, or by its key's plugin part, with or without a source.
export function isOwnRow(row: Pick<ConfigRow, 'key' | 'provider'>): boolean {
  const owner = row.key.slice(0, Math.max(row.key.lastIndexOf('.'), 0))
  return row.provider?.plugin === PLUGIN || owner === PLUGIN || owner.startsWith(`${PLUGIN}@`)
}

// True when /config listed fine yet holds no plugin's row at all, ours or another's: that surface leaves
// plugin settings out of its list (the Desktop app does). Other plugins' rows there mean ours are missing
// for some other reason, which emptyNote names; a failed list says nothing about the surface.
export function leavesPluginsOut(listed: readonly Pick<ConfigRow, 'key' | 'provider'>[] | Error): boolean {
  return !(listed instanceof Error) && !listed.some(row => isOwnRow(row) || row.provider?.plugin !== 'engine')
}

// Shown when none of the rows is this plugin's: what /config did list (or why it could not), so one
// look on that surface tells why the pane is empty. The rows other plugins own are the telling ones (none
// at all: that surface lists no plugin settings), so they are named and the engine's own only counted.
export function emptyNote(listed: readonly Pick<ConfigRow, 'key' | 'provider'>[] | Error): string {
  if (listed instanceof Error) return `No settings for ${PLUGIN} here: /config could not be listed (${listed.message}).`
  const fromPlugins = listed.filter(row => row.provider?.plugin !== 'engine')
  const sample = fromPlugins.slice(0, 5).map(row => `${row.key} (${row.provider?.plugin ?? 'no owner'})`)
  const such = sample.length > 0 ? `, such as ${sample.join(', ')}` : ''
  const count = `${listed.length} row(s), ${fromPlugins.length} of them from plugins${such}`
  return `No settings for ${PLUGIN} here: /config listed ${count}.`
}

// Shown over the values when this surface's /config lists no plugin rows (the Desktop app leaves them out):
// the values are read-only here, and the terminal's menu changes them.
export const READ_ONLY_NOTE =
  'This app leaves mod settings out of its settings list, so they show read-only here. Change them in ' +
  `the terminal: /config (or ${COMMAND} there).`

type Manifest = { userConfig?: Record<string, { title?: string }> }

// Each field's title from the manifest, so a read-only value is named as the menu names it. The plugin's
// root holds plugin.json, directly or in .claude-plugin/; unread, a field shows by its own name.
async function titlesOf($: Engine): Promise<Record<string, string>> {
  for (const path of [`${$.plugin.root}/.claude-plugin/plugin.json`, `${$.plugin.root}/plugin.json`]) {
    try {
      const fields = (JSON.parse(String(await $.fs.read(path))) as Manifest).userConfig ?? {}
      return Object.fromEntries(Object.entries(fields).map(([field, spec]) => [field, spec.title ?? field]))
    } catch {
      // Not there: the next place.
    }
  }
  return {}
}

/** A value as the read-only view shows it: a switch as On or Off, anything else as its text. */
export function shownValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return value === undefined || value === null || value === '' ? '(not set)' : String(value)
}

// A number field's text as the value to write, or why it cannot be one.
export function parseNumber(text: string): { value: number } | { error: string } {
  const value = Number(text.trim())
  return text.trim() !== '' && Number.isFinite(value) ? { value } : { error: `"${text}" is not a number` }
}

async function showError($: Engine, field: string, error: string | undefined): Promise<void> {
  await update($, view, shown => {
    const errors = { ...(shown?.errors ?? {}) }
    if (error) errors[field] = error
    else delete errors[field]
    return { errors }
  })
}

async function save($: Engine, row: ConfigRow, value: ConfigValue): Promise<void> {
  const answer = await $.config.set({ key: row.key, value }).catch((err: Error) => ({ deny: err.message }))
  await showError($, fieldOf(row), answer.deny)
}

async function saveText($: Engine, row: ConfigRow, text: string): Promise<void> {
  if (row.kind !== 'number') return save($, row, text)
  const parsed = parseNumber(text)
  if ('error' in parsed) return showError($, fieldOf(row), parsed.error)
  return save($, row, parsed.value)
}

// Every surface but mobile draws fields; the mobile app gets the engine's own pane.
type Ui = Elements['terminal'] | Elements['desktop'] | Elements['vscode']

function control(ui: Ui, $: Engine, row: ConfigRow) {
  const key = `${PLUGIN}-set-${fieldOf(row)}`
  if (row.isLocked) return <ui.Text dimColor>{String(row.value)} (set by your organization)</ui.Text>
  if (row.kind === 'boolean') {
    const options = [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ]
    const pick = (value: string) => void save($, row, value === 'on')
    return <ui.Select key={key} options={options} value={row.value ? 'on' : 'off'} onSelect={pick} />
  }
  if (row.kind === 'choice') {
    const options = (row.options ?? []).map(option => ({ value: option }))
    const pick = (value: string) => void save($, row, value)
    return <ui.Select key={key} options={options} value={String(row.value)} onSelect={pick} />
  }
  const submit = (text: string) => void saveText($, row, text)
  return <ui.Input key={key} value={String(row.value)} submitLabel="save" onSubmit={submit} />
}

function readOnlyRows(ui: Ui, options: Record<string, unknown>, titles: Record<string, string>) {
  return Object.entries(options).map(([field, value]) => (
    <ui.Box key={`setting-${field}`} flexDirection="column" marginTop={1}>
      <ui.Text bold>{titles[field] ?? field}</ui.Text>
      <ui.Text>{shownValue(value)}</ui.Text>
    </ui.Box>
  ))
}

export const register: Register = (on, options) => {
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== SETTINGS_PANE || e.surface === 'mobile') return next(e)
    const ui = $.ui.resolve(e) as Ui
    // Read on every draw: /config is the store, so a change made in the menu shows here too.
    const listed = await $.config.list().catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    const rows = listed instanceof Error ? [] : listed.filter(isOwnRow)
    const errors = (await read($, view))?.errors ?? {}
    // This surface leaves plugin rows out of /config: the values show read-only.
    const isReadOnly = leavesPluginsOut(listed) && Object.keys(options).length > 0
    const titles = isReadOnly ? await titlesOf($) : {}
    const close = () => void $.ui.close({ id: SETTINGS_PANE }).catch(() => undefined)
    return (
      <ui.Box flexDirection="column">
        <ui.Text bold>{TITLE}</ui.Text>
        {rows.length === 0 ? (
          <ui.Text dimColor wrap="wrap">
            {isReadOnly ? READ_ONLY_NOTE : emptyNote(listed)}
          </ui.Text>
        ) : null}
        {isReadOnly ? readOnlyRows(ui, options, titles) : null}
        {rows.map(row => (
          <ui.Box key={`setting-${fieldOf(row)}`} flexDirection="column" marginTop={1}>
            <ui.Text bold>{row.label}</ui.Text>
            {row.description ? (
              <ui.Text dimColor wrap="wrap">
                {row.description}
              </ui.Text>
            ) : null}
            {control(ui, $, row)}
            {errors[fieldOf(row)] ? <ui.Text color="red">{errors[fieldOf(row)]}</ui.Text> : null}
          </ui.Box>
        ))}
        <ui.Box marginTop={1}>
          <ui.Button key={`${PLUGIN}-settings-close`} label="Close" onPress={close} />
        </ui.Box>
      </ui.Box>
    )
  })
}
