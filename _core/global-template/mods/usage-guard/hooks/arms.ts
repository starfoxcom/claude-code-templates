import type { AdoptOffer, ArmedWake } from '../types'
import { projectOf } from './plan'

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
    const root = typeof arm.root === 'string' ? { root: arm.root } : {}
    const isQuestioned = arm.isQuestioned === true
    return { kind: arm.kind, resetsAt: arm.resetsAt, wakeAt: arm.wakeAt, isQuestioned, ...armedIn, ...root }
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

// A closed session's arm is offered once its own wake is safely past (an open session fires on time) and
// while it is recent: an older one would restart work the person has long moved on from.
export const ADOPT_GRACE_MS = 2 * 60_000
export const ADOPT_MAX_AGE_MS = 24 * 3_600_000

/**
 * The saved arm another session in this project left behind: its wake passed and it never ran. Each
 * file is `<session>.json`; the newest wake wins. Undefined when there is none.
 */
export function pickOffer(
  files: { name: string; text: string }[],
  me: string,
  root: string,
  now: number,
): AdoptOffer | undefined {
  let best: AdoptOffer | undefined
  for (const { name, text } of files) {
    const owner = name.replace(/\.json$/, '')
    const arm = parseSavedArm(text)
    if (!arm?.root || owner === me || !name.endsWith('.json')) continue
    if (projectOf(arm.root) !== projectOf(root)) continue
    const age = now - arm.wakeAt
    if (age < ADOPT_GRACE_MS || age > ADOPT_MAX_AGE_MS) continue
    if (!best || arm.wakeAt > best.arm.wakeAt) best = { owner, arm }
  }
  return best
}

export function offerText(limit: string, wakeText: string): string {
  return (
    `An earlier session in this project was armed to resume at ${wakeText}, after the ${limit} reset, and was ` +
    'closed before it ran. Resume its work here?'
  )
}

// The resume an adopting session runs: the work is the earlier session's, so it is rebuilt from its records.
export function adoptReason(limit: string, wakeText: string, owner: string): string {
  return (
    `An earlier session in this project was armed to resume at ${wakeText}, after the ${limit} reset, and was ` +
    `closed before it ran; the person chose to resume it here. Its task list is mods-data/tasks/${owner}.json.`
  )
}
