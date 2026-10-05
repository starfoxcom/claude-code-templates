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
  /** A change saved on a surface whose /config lists no plugin rows, where the field cannot show it. */
  saved?: Record<string, string>
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
  /** Armed with nothing pending: the card above the prompt asks to keep or cancel it, until answered. */
  isQuestioned?: boolean
  /** The session id the arm was set in: its task list still counts at the wake after a /clear. */
  armedIn?: string
  /** The session id the arm's saved copy is filed under; a /clear moves it to the new one. */
  session?: string
  /** The project folder the arm was set in: a later session there is offered an arm that never ran. */
  root?: string
}

/** Another session's arm in this project whose wake passed while that session was closed. */
export type AdoptOffer = {
  /** The session id the arm is filed under. */
  owner: string
  arm: ArmedWake
}

declare module 'claude-code' {
  interface PluginState {
    'usage-guard': {
      band: UsageGuardBand | null
      settings: SettingsView | null
      armed: ArmedWake | null
      /** What the last press on the arm card did, shown in its place until dismissed. */
      armNote: string | null
      /** A closed session's arm that never ran, offered here; then what the press did. */
      adopt: { offer: AdoptOffer | null; text: string | null; note: string | null } | null
    }
  }
}
