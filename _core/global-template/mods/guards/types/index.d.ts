/** The settings pane's own state: the last refusal per field, shown under that field. */
export type SettingsView = {
  errors: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    guards: { settings: SettingsView | null }
  }
}
