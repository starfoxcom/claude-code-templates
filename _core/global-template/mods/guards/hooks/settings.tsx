import { atom, read, update } from 'claude-code'
import type { ConfigRow, ConfigValue, Elements, EngineInterface as Engine, Register } from 'claude-code'

// The mod's settings in a pane every surface draws (the CLI and the Desktop app alike): the /config
// rows this plugin owns, each changed through $.config.set as the menu would, which reloads the mod
// with the new value. Every mod with settings carries this file, the same apart from PLUGIN and
// TITLE; its command opens the pane by SETTINGS_PANE.

const PLUGIN = 'guards'
const TITLE = 'Guards settings'
export const SETTINGS_PANE = `${PLUGIN}-settings`
// Only what the pane cannot read back from /config: the last refusal per field. The engine lists a
// module's state from literals, so the plugin name is spelled out here rather than taken from PLUGIN.
const view = atom({ plugin: 'guards', key: 'settings' } as const, null)

export function fieldOf(row: Pick<ConfigRow, 'key'>): string {
  return row.key.slice(PLUGIN.length + 1)
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

// The surfaces that draw fields. The mobile app has no Input or Select, so it is left to the engine's
// own pane.
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
    const rows = (await $.config.list()).filter(row => row.key.startsWith(`${PLUGIN}.`))
    const errors = (await read($, view))?.errors ?? {}
    const close = () => void $.ui.close({ id: SETTINGS_PANE }).catch(() => undefined)
    return (
      <ui.Box flexDirection="column">
        <ui.Text bold>{TITLE}</ui.Text>
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
