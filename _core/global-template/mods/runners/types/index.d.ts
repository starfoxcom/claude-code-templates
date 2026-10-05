/** One runner entry's last reading, as the band row shows it. */
export type RunnerView = {
  label: string
  /** Every process the entry names is running. */
  isOn: boolean
  /** Runners GitHub reports online, and how many of those are running a job. */
  online?: number
  busy?: number
  /** Runs waiting for a runner. */
  queued?: number
  /** The soonest scheduled run on the default branch, ms since the epoch (cron is UTC). */
  nextRun?: number
  /** When Start was pressed: GitHub reports the runners offline for a minute or two after. */
  startedAt?: number
  /** Stop was pressed while a job ran; the next press stops anyway. */
  isConfirming?: boolean
}

/** The settings pane's own state: the last refusal per field, shown under that field. */
export type SettingsView = {
  errors: Record<string, string>
  /** A save's outcome per field, shown under it until the pane opens again. */
  saved?: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    runners: { view: { rows: RunnerView[] } | null; settings: SettingsView | null }
  }
}
