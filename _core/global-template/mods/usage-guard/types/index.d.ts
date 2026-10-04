/**
 * The card every session draws above the prompt while a usage event matters: the pause, the
 * automatic resume, a cancelled resume. It lives in `mods-data/usage-guard/card.json`, so one
 * Dismiss clears it in every session. Claude Code's own toast vanishes after a few seconds.
 */
export type UsageCard = {
  /** Event key, e.g. `paused:<resetsAt>`; a card with the same id is never written twice. */
  id: string
  text: string
  dismissed: boolean
}

export type UsageGuardBand = {
  card: UsageCard | null
  /** True while the pause is on and its automatic resume can still be cancelled. */
  canCancel: boolean
}

/** The settings pane's own state: the last refusal per field, shown under that field. */
export type SettingsView = {
  errors: Record<string, string>
}

/**
 * A wake that resumes this session's work after a reset, armed by hand (`/usage-guard arm 5h|week`).
 * Kept in state so a hot reload (a settings change, an edit)
 * re-arms it.
 */
export type ArmedWake = {
  /** The limit's kind: `five_hour` or `seven_day`. */
  kind: string
  resetsAt: string
  wakeAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-guard': { band: UsageGuardBand | null; settings: SettingsView | null; armed: ArmedWake | null }
  }
}
