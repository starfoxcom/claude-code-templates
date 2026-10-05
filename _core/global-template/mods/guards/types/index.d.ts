/** The settings pane's own state: the last refusal per field, shown under that field. */
export type SettingsView = {
  errors: Record<string, string>
  /** A save's outcome per field, shown under it until the pane opens again. */
  saved?: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    guards: { settings: SettingsView | null }
  }
}
