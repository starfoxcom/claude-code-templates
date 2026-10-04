import { atom, read, update } from 'claude-code'
import type { ConfigRow, ConfigValue, Elements, EngineInterface as Engine, Register } from 'claude-code'

// The mod's settings in a pane every surface draws (the CLI and the Desktop app alike): the /config
// rows this plugin owns, each changed through $.config.set as the menu would, which reloads the mod
// with the new value. Every mod with settings carries this file, the same apart from PLUGIN and
// TITLE; its command opens the pane by SETTINGS_PANE.

const PLUGIN = 'session-info'
const TITLE = 'Session info settings'
export const SETTINGS_PANE = `${PLUGIN}-settings`
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

// Shown when none of the rows is this plugin's: what /config did list (or why it could not), so one
// look on that surface tells why the pane is empty.
export function emptyNote(listed: readonly Pick<ConfigRow, 'key' | 'provider'>[] | Error): string {
  if (listed instanceof Error) return `No settings for ${PLUGIN} here: /config could not be listed (${listed.message}).`
  const sample = listed.slice(0, 5).map(row => `${row.key} (${row.provider?.plugin ?? 'no owner'})`)
  const such = sample.length > 0 ? `, such as ${sample.join(', ')}` : ''
  return `No settings for ${PLUGIN} here: /config listed ${listed.length} row(s)${such}.`
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

export const register: Register = on => {
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== SETTINGS_PANE || e.surface === 'mobile') return next(e)
    const ui = $.ui.resolve(e) as Ui
    // Read on every draw: /config is the store, so a change made in the menu shows here too.
    const listed = await $.config.list().catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    const rows = listed instanceof Error ? [] : listed.filter(isOwnRow)
    const errors = (await read($, view))?.errors ?? {}
    const close = () => void $.ui.close({ id: SETTINGS_PANE }).catch(() => undefined)
    return (
      <ui.Box flexDirection="column">
        <ui.Text bold>{TITLE}</ui.Text>
        {rows.length === 0 ? (
          <ui.Text dimColor wrap="wrap">
            {emptyNote(listed)}
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
