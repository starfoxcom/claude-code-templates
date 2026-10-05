import type { SessionRateLimit } from 'claude-code'

// Plan usage belongs to the account, so every session sees the same figures. A fresh session has none
// of its own until its first response; meanwhile it borrows the newest figures another session
// recorded, while they are recent. Kept free of the engine so it tests alone.

export const SHARED_PLAN_FILE = 'plan.json'
export const SHARED_PLAN_MAX_AGE_MS = 30 * 60_000

export type SharedPlan = { at: number; limits: SessionRateLimit[] }

const LIMIT_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'week' }

export function sharedPlanText(limits: readonly SessionRateLimit[], now: number): string {
  return JSON.stringify({ at: now, limits })
}

// The recorded figures still worth showing: recent, and only the windows whose reset has not passed
// (past it, usage started over, and the old percentage would overstate it).
export function parseSharedPlan(text: string, now: number): SharedPlan | undefined {
  try {
    const saved = JSON.parse(text) as Partial<SharedPlan>
    const { at, limits } = saved
    if (typeof at !== 'number' || !Array.isArray(limits) || at > now || now - at > SHARED_PLAN_MAX_AGE_MS)
      return undefined
    // Written as "not passed" so a reset time that does not parse keeps the window.
    const current = limits.filter(
      limit =>
        typeof limit?.kind === 'string' &&
        typeof limit.percentUsed === 'number' &&
        !(Date.parse(limit.resetsAt ?? '') <= now),
    )
    return current.length > 0 ? { at, limits: current } : undefined
  } catch {
    return undefined
  }
}

function usageList(limits: readonly SessionRateLimit[]): string {
  const name = (kind: string) => LIMIT_NAMES[kind] ?? kind.replace(/_/g, '-')
  return limits.map(limit => `${name(limit.kind)} ${limit.percentUsed}%`).join(', ')
}

// A plan session learns its plan figures from its first response; until then the line borrows another
// session's, naming when they were recorded, or says they are unknown. Past it, an empty list means the
// account has no plan windows (an API key), and the line, like the row, names none. "Replied" is this
// process's own: the engine's figures start empty in each one. `borrowedAt` is the recording's local
// HH:MM. `isOwn` is false while the figures are not this session's own.
export function planPart(
  limits: readonly SessionRateLimit[],
  hasReplied: boolean,
  shared?: SharedPlan,
  borrowedAt?: string,
): { text: string; isOwn: boolean } {
  if (limits.length > 0) return { text: ` | plan used: ${usageList(limits)}`, isOwn: true }
  if (hasReplied) return { text: '', isOwn: true }
  if (!shared) return { text: ' | plan used: unknown until the first response', isOwn: false }
  return { text: ` | plan used: ${usageList(shared.limits)} (another session's, at ${borrowedAt})`, isOwn: false }
}
