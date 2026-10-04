import type { ModelUsage } from 'claude-code'

import type { CacheCheck, CacheMiss } from '../types'

/** The prompt cache's short lifetime; a plan past its included usage gets this one. */
export const SHORT_LIFETIME_MS = 5 * 60_000

/** What is known about the first request after a prompt, beside the API's counts. */
export type CacheContext = {
  at: number
  /** Since the last response; unknown at session start or after a reload. */
  sinceLastMs?: number
  /** The lifetime the countdown runs on. */
  lifetimeMs: number
  /** A compaction or a model change since the last response: the cache starts over by design. */
  isFreshWindow: boolean
}

function missCause(c: CacheContext): CacheMiss {
  if (c.isFreshWindow || c.sinceLastMs === undefined) return 'expected'
  if (c.sinceLastMs >= c.lifetimeMs) return 'expired'
  return c.sinceLastMs < SHORT_LIFETIME_MS ? 'early' : 'short'
}

/**
 * Warm or cold, from the API's own counts for the first request after a prompt: a warm request
 * reads the conversation from the cache and writes only the new message; a cold one writes more
 * than it reads, because the cache no longer held the conversation.
 */
export function checkCache(usage: ModelUsage, c: CacheContext): CacheCheck {
  const resent = usage.cache_creation_input_tokens
  if (resent <= usage.cache_read_input_tokens) return { at: c.at, resent }
  return { at: c.at, resent, miss: missCause(c) }
}

/**
 * The lifetime the countdown runs on next: the short one once a miss inside the expected lifetime
 * proves it, back to the configured one once a warm request outlives the short one.
 */
export function nextLifetime(check: CacheCheck, sinceLastMs: number | undefined, current: number, configured: number) {
  if (check.miss === 'short') return SHORT_LIFETIME_MS
  if (check.miss === undefined && sinceLastMs !== undefined && sinceLastMs > SHORT_LIFETIME_MS) return configured
  return current
}
