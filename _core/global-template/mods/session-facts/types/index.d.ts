/** One plan window as the budgets row shows it. */
export type PlanWindow = { kind: string; percentUsed: number; resetsAt?: number }

/**
 * Why a request had to write the conversation to the prompt cache again: the lifetime ran out,
 * the cache broke before 5 minutes, it broke between 5 minutes and the expected lifetime (so it
 * lasts only 5), or by design (session start, a reload, a compaction, a model change).
 */
export type CacheMiss = 'expired' | 'early' | 'short' | 'expected'

/** What the first request after a prompt found in the prompt cache, from the API's counts. */
export type CacheCheck = {
  at: number
  /** Tokens it wrote to the cache. */
  resent: number
  /** Absent when the cache was warm. */
  miss?: CacheMiss
}

/** Everything the budgets row draws, read by register.ts and handed to budgets.tsx through session state. */
export type Budgets = {
  /** Unknown until the first response of the context window. */
  tokens?: number
  size: number
  compactsAt?: number
  /** When the last compaction of the main conversation ran. */
  compactedAt?: number
  limits: PlanWindow[]
  /** When the prompt cache goes cold: the last response plus the cache lifetime. */
  cacheExpiresAt?: number
  /** When Claude Code should compact the idle conversation before the cache goes cold; absent when it would not. */
  idleCompactAt?: number
  /** The last prompt's cache check. */
  cacheCheck?: CacheCheck
  /** Set while usage-guard holds the session until a plan reset. */
  pausedUntil?: number
  /** The host's UTC offset, as `Date.getTimezoneOffset` gives it. */
  offsetMinutes: number
  planWarnAt: number
  wrapUpAt: number
  cacheWarnMinutes: number
}

/** The settings pane's own state: the last refusal per field. */
export type SettingsView = { errors: Record<string, string>; saved?: Record<string, string> }

declare module 'claude-code' {
  interface PluginState {
    'session-facts': { budgets: Budgets | null; settings: SettingsView | null }
  }
}
