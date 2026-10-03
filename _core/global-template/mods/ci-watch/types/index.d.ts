// One watched PR, saved per session and drawn by view.tsx above the prompt.
export type Watch = {
  repo: string
  number: number
  headSha: string
  startedAt: number
  checks: Record<string, string>
  stablePolls: number
  // When the checks last went quiet; unset while any runs.
  quietSince?: number
  outcome?: 'passed' | 'failed' | 'timeout'
  settledAt?: number
  /** Set when the watch starts; names its wake claim (see `claimWake`). */
  id?: string
}

/** The settings pane's own state: the last refusal per field. */
export type SettingsView = { errors: Record<string, string> }

declare module 'claude-code' {
  interface PluginState {
    'ci-watch': { watches: Watch[]; expanded: string[]; settings: SettingsView | null }
  }
}
