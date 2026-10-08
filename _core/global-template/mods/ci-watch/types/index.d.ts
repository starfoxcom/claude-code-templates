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
  /** When this session last pushed to the PR or asked to watch it: a new head within the hour is its own. */
  pushedAt?: number
  /** Restarted on a head someone else pushed: it keeps the row current and wakes no session. */
  isSilent?: boolean
  /** Settled, its wake not sent yet: it goes out once no turn runs. Saved, so a reload sends it. */
  wakePending?: boolean
  /** An open GitHub incident touching Actions while this watch's checks sat pending; its name. */
  incident?: string
  /**
   * The incident's note, not sent yet. Its own flag: `wakePending` is only ever set on a settled watch, and
   * every path that keeps or drops a wake relies on that. Dropped once the watch settles or its head moves.
   */
  incidentPending?: boolean
}

/** The settings pane's own state: the last refusal per field. */
export type SettingsView = { errors: Record<string, string>; saved?: Record<string, string> }

declare module 'claude-code' {
  interface PluginState {
    'ci-watch': { watches: Watch[]; expanded: string[]; settings: SettingsView | null }
  }
}
