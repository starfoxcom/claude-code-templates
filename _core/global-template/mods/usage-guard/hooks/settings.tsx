import { atom, read, update } from 'claude-code'
import type { ConfigRow, ConfigValue, Elements, EngineInterface as Engine, Register } from 'claude-code'

// The mod's settings in a pane every surface draws (the CLI and the Desktop app alike): the /config
// rows this plugin owns, each changed through $.config.set as the menu would, which reloads the mod
// with the new value. Every mod with settings carries this file, the same apart from PLUGIN and
// TITLE; its command opens the pane by SETTINGS_PANE.

const PLUGIN = 'usage-guard'
const TITLE = 'Usage guard settings'
export const SETTINGS_PANE = `${PLUGIN}-settings`
const COMMAND = '/usage-guard settings'
// Only what the pane cannot read back from /config: the last refusal per field. The engine lists a
// module's state from literals, so the plugin name is spelled out here rather than taken from PLUGIN.
const view = atom({ plugin: 'usage-guard', key: 'settings' } as const, null)

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

// Shown over the fields when this surface's /config lists no plugin rows (the Desktop app leaves them out).
// The engine says a row the menu leaves out still answers $.config.set, so a change is tried anyway, and
// the pane says how it went.
export const UNLISTED_NOTE =
  "This app leaves mod settings out of its settings list. A change here is tried anyway: 'Saved.' or the " +
  `reason it was refused shows under the field. The terminal's /config (or ${COMMAND} there) always works.`

type Field = { title?: string; description?: string; type?: string; options?: string[] }
type Manifest = { userConfig?: Record<string, Field> }

// The manifest's fields. The plugin's root holds plugin.json, directly or in .claude-plugin/; unread, each
// field shows by its own name as a text field.
async function fieldsOf($: Engine): Promise<Record<string, Field>> {
  for (const path of [`${$.plugin.root}/.claude-plugin/plugin.json`, `${$.plugin.root}/plugin.json`]) {
    try {
      return (JSON.parse(String(await $.fs.read(path))) as Manifest).userConfig ?? {}
    } catch {
      // Not there: the next place.
    }
  }
  return {}
}

function kindOf(field: Field): ConfigRow['kind'] {
  if (field.type === 'boolean') return 'boolean'
  if (field.options) return 'choice'
  return field.type === 'number' ? 'number' : 'text'
}

/** The rows /config left out, as it would list them: from the manifest and the values the mod loaded with. */
export function unlistedRows(options: Record<string, unknown>, fields: Record<string, Field>): ConfigRow[] {
  return Object.entries(options).map(([name, value]) => {
    const field = fields[name] ?? {}
    return {
      key: `${PLUGIN}.${name}`,
      label: field.title ?? name,
      description: field.description,
      kind: kindOf(field),
      value: value as ConfigValue,
      options: field.options,
      provider: { plugin: PLUGIN, tier: 'user' } as never,
      isLocked: false,
    }
  })
}

// A number field's text as the value to write, or why it cannot be one.
export function parseNumber(text: string): { value: number } | { error: string } {
  const value = Number(text.trim())
  return text.trim() !== '' && Number.isFinite(value) ? { value } : { error: `"${text}" is not a number` }
}

async function showError($: Engine, field: string, error: string | undefined, saved?: string): Promise<void> {
  await update($, view, shown => {
    const errors = { ...(shown?.errors ?? {}) }
    const done = { ...(shown?.saved ?? {}) }
    if (error) errors[field] = error
    else delete errors[field]
    if (saved) done[field] = saved
    else delete done[field]
    return { errors, saved: done }
  })
}

async function setOne($: Engine, key: string, value: ConfigValue): Promise<string | undefined> {
  const answer = await $.config.set({ key, value }).catch((err: Error) => ({ deny: err.message }))
  return answer.deny
}

// A row /config left out is tried by its plain key, then with the source an inline plugin's key carries.
// Each refusal is kept word for word: on that surface it is the finding.
async function save($: Engine, row: ConfigRow, value: ConfigValue, isUnlisted = false): Promise<void> {
  const deny = await setOne($, row.key, value)
  if (!isUnlisted) return showError($, fieldOf(row), deny)
  if (!deny) return showError($, fieldOf(row), undefined, `Saved: ${String(value)}.`)
  const inline = `${PLUGIN}@inline.${fieldOf(row)}`
  const again = await setOne($, inline, value)
  if (!again) return showError($, fieldOf(row), undefined, `Saved: ${String(value)} (as ${inline}).`)
  return showError($, fieldOf(row), `Refused. ${row.key}: ${deny} ${inline}: ${again}`)
}

async function saveText($: Engine, row: ConfigRow, text: string, isUnlisted: boolean): Promise<void> {
  if (row.kind !== 'number') return save($, row, text, isUnlisted)
  const parsed = parseNumber(text)
  if ('error' in parsed) return showError($, fieldOf(row), parsed.error)
  return save($, row, parsed.value, isUnlisted)
}

// The surfaces that draw fields. The mobile app has no Input or Select, so it is left to the engine's
// own pane.
type Ui = Elements['terminal'] | Elements['desktop'] | Elements['vscode']

function control(ui: Ui, $: Engine, row: ConfigRow, isUnlisted: boolean) {
  const key = `${PLUGIN}-set-${fieldOf(row)}`
  if (row.isLocked) return <ui.Text dimColor>{String(row.value)} (set by your organization)</ui.Text>
  if (row.kind === 'boolean') {
    const options = [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ]
    const pick = (value: string) => void save($, row, value === 'on', isUnlisted)
    return <ui.Select key={key} options={options} value={row.value ? 'on' : 'off'} onSelect={pick} />
  }
  if (row.kind === 'choice') {
    const options = (row.options ?? []).map(option => ({ value: option }))
    const pick = (value: string) => void save($, row, value, isUnlisted)
    return <ui.Select key={key} options={options} value={String(row.value)} onSelect={pick} />
  }
  const submit = (text: string) => void saveText($, row, text, isUnlisted)
  return <ui.Input key={key} value={String(row.value)} submitLabel="save" onSubmit={submit} />
}

export const register: Register = (on, options) => {
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== SETTINGS_PANE || e.surface === 'mobile') return next(e)
    const ui = $.ui.resolve(e) as Ui
    // Read on every draw: /config is the store, so a change made in the menu shows here too.
    const listed = await $.config.list().catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    const listedRows = listed instanceof Error ? [] : listed.filter(isOwnRow)
    const shown = await read($, view)
    const errors = shown?.errors ?? {}
    // This surface leaves plugin rows out of /config: the pane draws ours from the manifest and tries each
    // change anyway.
    const isUnlisted = leavesPluginsOut(listed) && Object.keys(options).length > 0
    const rows = isUnlisted ? unlistedRows(options, await fieldsOf($)) : listedRows
    const close = () => void $.ui.close({ id: SETTINGS_PANE }).catch(() => undefined)
    return (
      <ui.Box flexDirection="column">
        <ui.Text bold>{TITLE}</ui.Text>
        {isUnlisted || rows.length === 0 ? (
          <ui.Text dimColor wrap="wrap">
            {isUnlisted ? UNLISTED_NOTE : emptyNote(listed)}
          </ui.Text>
        ) : null}
        {rows.map(row => (
          <ui.Box key={`setting-${fieldOf(row)}`} flexDirection="column" marginTop={1}>
            <ui.Text bold>{row.label}</ui.Text>
            {row.description ? (
              <ui.Text dimColor wrap="wrap">
                {row.description}
              </ui.Text>
            ) : null}
            {control(ui, $, row, isUnlisted)}
            {errors[fieldOf(row)] ? <ui.Text color="red" wrap="wrap">{errors[fieldOf(row)]}</ui.Text> : null}
            {shown?.saved?.[fieldOf(row)] ? <ui.Text color="green">{shown.saved[fieldOf(row)]}</ui.Text> : null}
          </ui.Box>
        ))}
        <ui.Box marginTop={1}>
          <ui.Button key={`${PLUGIN}-settings-close`} label="Close" onPress={close} />
        </ui.Box>
      </ui.Box>
    )
  })
}
