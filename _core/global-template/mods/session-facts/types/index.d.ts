/** One plan window as the budgets row shows it. */
export type PlanWindow = { kind: string; percentUsed: number; resetsAt?: number }

/** Everything the budgets row draws, read by register.ts and handed to budgets.tsx through session state. */
export type Budgets = {
  /** Unknown until the first response of the context window. */
  tokens?: number
  size: number
  compactsAt?: number
  limits: PlanWindow[]
  /** When the prompt cache goes cold: the last response plus the cache lifetime. */
  cacheExpiresAt?: number
  /** Set while usage-guard holds the session until a plan reset. */
  pausedUntil?: number
  /** The host's UTC offset, as `Date.getTimezoneOffset` gives it. */
  offsetMinutes: number
  planWarnAt: number
  wrapUpAt: number
  cacheWarnMinutes: number
}

/** The settings pane's own state: the last refusal per field. */
export type SettingsView = { errors: Record<string, string> }

declare module 'claude-code' {
  interface PluginState {
    'session-facts': { budgets: Budgets | null; settings: SettingsView | null }
  }
}
