import type { ArmedWake } from '../types'

// One file per session under mods-data/usage-guard/sessions/: its project, when it last checked in,
// and its armed wake. The wake outlives the process: a restart of the session (`claude --resume`
// keeps the id) finds it again, and a new session alone in the project takes over one a closed
// session left there. The engine follows `$` only within one file, so the reads and writes live in
// register.tsx; this file holds the decisions.
export type SessionRecord = {
  session: string
  /** The project folder, as `projectOf` spells it. */
  project: string
  /** When the session last checked in; 0 once it has ended. */
  beatAt: number
  arm: ArmedWake | null
}

/** A session that has not checked in for this long is closed: an open one checks in every minute. */
export const ALIVE_MS = 3 * 60_000

// The whole path names the project: two repos may share a folder name (`~/work/app`, `~/clients/x/app`).
export function projectOf(root: string): string {
  return root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function recordName(session: string): string {
  return `${session.replace(/[^\w-]/g, '_')}.json`
}

/**
 * What a starting session picks up from the records: its own wake from before a restart, or else the
 * wakes closed sessions left in its project, latest first: the latest is after every window they waited
 * on has reset, so taking it never wakes into one still used up. Those move only when no other session in
 * the project is open: which of two open sessions should carry the work is not this mod's guess.
 */
export function planTakeover(
  records: readonly SessionRecord[],
  session: string,
  project: string,
  now: number,
): { own?: ArmedWake; left: SessionRecord[] } {
  const own = records.find(record => record.session === session)?.arm ?? undefined
  if (own) return { own, left: [] }
  const others = records.filter(record => record.project === project && record.session !== session)
  if (others.some(record => record.beatAt > now - ALIVE_MS)) return { left: [] }
  const left = others.filter(record => record.arm).sort((a, b) => (b.arm?.wakeAt ?? 0) - (a.arm?.wakeAt ?? 0))
  return { left }
}
