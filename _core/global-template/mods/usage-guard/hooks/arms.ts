import type { ArmedWake } from '../types'

// An arm survives a restart in `mods-data/usage-guard/arms/<session>.json`: the arm, or `null` once it
// is dropped or done (mods cannot delete files).

/** What a session that started again does with its saved arm. */
export type CatchUp = 'schedule' | 'fire' | 'drop'

/**
 * A wake still ahead is scheduled again. One that passed while the session was closed resumes now, but
 * only within the catch-up window: later than that, work starting out of nowhere could meet the person
 * already back at it, so the arm is dropped and the session says so. A window of 0 never catches up.
 */
export function catchUpOf(wakeAt: number, now: number, catchUpMinutes: number): CatchUp {
  if (wakeAt > now) return 'schedule'
  return catchUpMinutes > 0 && now - wakeAt <= catchUpMinutes * 60_000 ? 'fire' : 'drop'
}

/** A saved arm read back, or undefined for none, a dropped one, or anything that is not an arm. */
export function parseSavedArm(text: string): ArmedWake | undefined {
  try {
    const arm = JSON.parse(text) as Partial<ArmedWake> | null
    if (!arm || typeof arm.kind !== 'string' || typeof arm.resetsAt !== 'string') return undefined
    if (typeof arm.wakeAt !== 'number' || !Number.isFinite(arm.wakeAt)) return undefined
    const armedIn = typeof arm.armedIn === 'string' ? { armedIn: arm.armedIn } : {}
    const isQuestioned = arm.isQuestioned === true
    return { kind: arm.kind, resetsAt: arm.resetsAt, wakeAt: arm.wakeAt, isQuestioned, ...armedIn }
  } catch {
    return undefined
  }
}

export function caughtUpText(limit: string, wakeText: string): string {
  return (
    `The ${limit} reset this session was armed for came at ${wakeText}, while it was closed: resuming ` +
    'the work now.'
  )
}

export function missedArmText(limit: string, wakeText: string, catchUpMinutes: number): string {
  const window = catchUpMinutes > 0 ? `more than ${catchUpMinutes} minutes ago` : 'while it was closed'
  return (
    `This session was armed to resume at ${wakeText}, after the ${limit} reset, but that passed ${window}, ` +
    'so it did not resume by itself. Run /session-start to pick the work back up.'
  )
}

// An armed wake with nothing pending: one line, no hand-off rebuilt and no work started.
export function quietResumeText(limit: string): string {
  return (
    `The ${limit} reset this session was armed for has passed. Nothing is pending here (no open task that is ` +
    'not on hold).'
  )
}

export function quietResumePrompt(limit: string): string {
  return `[usage-guard] ${quietResumeText(limit)} Say so in one line and wait for the person.`
}
