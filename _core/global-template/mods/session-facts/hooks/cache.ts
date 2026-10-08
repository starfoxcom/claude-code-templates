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
  /** The transcript confirmed the lifetime, so a miss inside it is a break, never a shorter cache. */
  isLifetimeRead?: boolean
}

function missCause(c: CacheContext): CacheMiss {
  if (c.isFreshWindow || c.sinceLastMs === undefined) return 'expected'
  if (c.sinceLastMs >= c.lifetimeMs) return 'expired'
  return c.sinceLastMs < SHORT_LIFETIME_MS || c.isLifetimeRead ? 'early' : 'short'
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

const LONG_LIFETIME_MS = 60 * 60_000

// Claude Code compacts an idle conversation before a one-hour cache goes cold: nine tenths into the
// lifetime, once the context holds at least the minimum (200k by default; its
// `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` raises or lowers it, never under 100k).
const IDLE_COMPACT_FRACTION = 0.9
export const IDLE_COMPACT_MIN_TOKENS = 200_000
const IDLE_COMPACT_FLOOR = 100_000

/** The context size Claude Code's idle compaction starts at, from its environment variable. */
export function idleCompactMin(raw: string | undefined): number {
  const tokens = Number(raw)
  if (!raw || !Number.isFinite(tokens) || tokens <= 0) return IDLE_COMPACT_MIN_TOKENS
  return Math.max(IDLE_COMPACT_FLOOR, tokens)
}

/**
 * When Claude Code should compact the idle conversation instead of letting the cache go cold:
 * only on the one-hour lifetime and at the minimum size. Its own clock may run a little apart from
 * the last response, so the row calls the time approximate.
 */
export function idleCompactAt(
  lastResponseAt: number,
  lifetimeMs: number,
  tokens: number | undefined,
  minTokens: number,
): number | undefined {
  if (lifetimeMs !== LONG_LIFETIME_MS || tokens === undefined || tokens < minTokens) return undefined
  return lastResponseAt + lifetimeMs * IDLE_COMPACT_FRACTION
}

// The engine's own idle compaction gets this long past its time before the mod steps in.
const IDLE_FALLBACK_GRACE_MS = 60_000

/**
 * Whether the mod compacts the idle conversation itself, as Claude Code 2.1.293 stopped doing: a grace
 * minute past the engine's time, while the cache is still warm, once per reply. A compaction since the
 * reply leaves no idle time to act on.
 */
export function isIdleCompactDue(
  now: number,
  idleAt: number | undefined,
  expiresAt: number | undefined,
  lastResponseAt: number | undefined,
  triedFor: number | undefined,
): boolean {
  if (idleAt === undefined || expiresAt === undefined || lastResponseAt === undefined) return false
  return triedFor !== lastResponseAt && now >= idleAt + IDLE_FALLBACK_GRACE_MS && now < expiresAt
}

/**
 * Prints the transcript's last lines that carry cache counts. The engine hands mods only the total a
 * request wrote to the cache; the transcript keeps the API's split by lifetime.
 */
export const READ_CACHE_LINES = [
  'node',
  '-e',
  [
    "const fs = require('fs'); const p = process.argv[1]; const size = fs.statSync(p).size",
    'const n = Math.min(size, 1 << 20); const b = Buffer.alloc(n); const fd = fs.openSync(p, "r")',
    'fs.readSync(fd, b, 0, n, size - n); fs.closeSync(fd)',
    'const lines = b.toString("utf8").split("\\n").filter(l => l.includes(\'"cache_creation"\'))',
    'console.log(lines.slice(-5).join("\\n"))',
  ].join('; '),
]

/**
 * The lifetime the API last wrote the main conversation's cache with, from transcript lines: one hour
 * on a plan within its included usage, five minutes past it or on an API key. Unknown when no line
 * names a write.
 */
export function writtenLifetime(lines: string): number | undefined {
  for (const line of lines.split('\n').reverse()) {
    let entry: { isSidechain?: boolean; message?: { usage?: { cache_creation?: Record<string, number> } } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const written = entry.message?.usage?.cache_creation
    if (entry.isSidechain || !written) continue
    if ((written.ephemeral_1h_input_tokens ?? 0) > 0) return LONG_LIFETIME_MS
    if ((written.ephemeral_5m_input_tokens ?? 0) > 0) return SHORT_LIFETIME_MS
  }
  return undefined
}

/**
 * The lifetime the countdown runs on next, when the transcript cannot tell: the short one once a miss
 * inside the expected lifetime proves it, back to the configured one once a warm request outlives
 * the short one.
 */
export function nextLifetime(check: CacheCheck, sinceLastMs: number | undefined, current: number, configured: number) {
  if (check.miss === 'short') return SHORT_LIFETIME_MS
  if (check.miss === undefined && sinceLastMs !== undefined && sinceLastMs > SHORT_LIFETIME_MS) return configured
  return current
}

/** What a reload would forget and the cache check needs: written after each reply, read back on set-up. */
export type CacheMemory = {
  lastResponseAt: number
  lifetimeMs: number
  /** The lifetime came from the transcript, not from the guess. */
  isLifetimeRead: boolean
  lastModel?: string
  check?: CacheCheck
}

const MISSES = new Set(['expired', 'early', 'short', 'expected'])

/** The saved memory, or nothing when the file is missing, torn or from another shape. */
export function parseMemory(text: string): CacheMemory | undefined {
  try {
    const saved = JSON.parse(text) as Partial<CacheMemory>
    if (!Number.isFinite(saved.lastResponseAt) || !Number.isFinite(saved.lifetimeMs)) return undefined
    const check = saved.check
    const isCheck = check && Number.isFinite(check.at) && Number.isFinite(check.resent)
    const isMiss = check?.miss === undefined || MISSES.has(check.miss)
    return {
      lastResponseAt: Number(saved.lastResponseAt),
      lifetimeMs: Number(saved.lifetimeMs),
      isLifetimeRead: saved.isLifetimeRead === true,
      lastModel: typeof saved.lastModel === 'string' ? saved.lastModel : undefined,
      check: isCheck && isMiss ? check : undefined,
    }
  } catch {
    return undefined
  }
}

// The engine's fs makes no missing folders, and a session's file outlives it: one node run per load
// makes the folder and removes other sessions' files older than two days (`<folder> <this session>`).
export const PREPARE_DIR = [
  'node',
  '-e',
  [
    'const fs = require("fs"), p = require("path"); const [d, keep] = process.argv.slice(1)',
    'fs.mkdirSync(d, { recursive: true }); const cut = Date.now() - 2 * 864e5',
    'for (const n of fs.readdirSync(d)) { if (n === keep + ".json") continue',
    'try { const f = p.join(d, n); if (fs.statSync(f).mtimeMs < cut) fs.unlinkSync(f) } catch {} }',
  ].join('; '),
]
