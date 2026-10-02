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

declare module 'claude-code' {
  interface PluginState {
    'usage-guard': { band: UsageGuardBand | null }
  }
}
