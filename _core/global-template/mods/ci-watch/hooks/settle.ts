// When a watch's checks have settled, and how a poll's results lay over the watches it read. Pure, no
// engine access.

import type { Watch } from '../types'

export const PENDING = new Set(['pending'])
export const FAILED = new Set(['fail', 'cancel'])
const SETTLE_POLLS = 2

// The poll's results laid over the watches as they are now: a watch started meanwhile is kept, one
// stopped or dropped meanwhile stays gone. A pending wake is memory's: one sent meanwhile stays sent. So is
// an incident's note, while the watch is still unsettled on the same head (the poll drops it otherwise).
// The polled copy itself is kept whenever nothing differs: the poll finds its settled watches by identity.
export function reconcile(current: Watch[], polled: Watch[]): Watch[] {
  const same = (a: Watch, b: Watch) =>
    a.id !== undefined ? a.id === b.id : b.id === undefined && a.repo === b.repo && a.number === b.number
  return current.map(w => {
    const p = polled.find(p => same(p, w))
    if (!p) return w
    const isNoteMemorys = !p.outcome && p.headSha === w.headSha
    const incidentPending = isNoteMemorys ? w.incidentPending : p.incidentPending
    // A note made meanwhile (another poll of this load noted and sent it) is kept, or it would be made again.
    const incident = isNoteMemorys ? (w.incident ?? p.incident) : p.incident
    const isKept =
      Boolean(p.wakePending) === Boolean(w.wakePending) &&
      Boolean(p.incidentPending) === Boolean(incidentPending) &&
      p.incident === incident
    return isKept ? p : { ...p, wakePending: w.wakePending, incidentPending, incident }
  })
}

export function settle(
  watch: Watch,
  checks: Record<string, string>,
  now: number,
  timeoutMs: number,
  quietMs: number,
): Watch {
  const names = Object.keys(checks)
  const isQuiet = names.length > 0 && names.every(name => !PENDING.has(checks[name] ?? ''))
  const stablePolls = isQuiet ? watch.stablePolls + 1 : 0
  const quietSince = isQuiet ? (watch.quietSince ?? now) : undefined
  const next: Watch = { ...watch, checks, stablePolls, quietSince }
  // Nothing wakes the session while any check or workflow still runs: a fix pushed mid-run restarts the
  // rest. The checks must stay quiet for two polls a full poll interval apart: right after a push GitHub
  // can still answer with the old commit's results, and a check can go back to pending seconds after it
  // finished (a review that escalates to a deeper one). Instances left by a hot reload poll seconds apart.
  const hasFailed = names.some(name => FAILED.has(checks[name] ?? ''))
  const isConfirmed = stablePolls >= SETTLE_POLLS && now - (quietSince ?? now) >= quietMs
  if (isQuiet && isConfirmed)
    return { ...next, outcome: hasFailed ? 'failed' : 'passed', settledAt: now }
  if (now - watch.startedAt > timeoutMs) return { ...next, outcome: 'timeout', settledAt: now }
  return next
}
