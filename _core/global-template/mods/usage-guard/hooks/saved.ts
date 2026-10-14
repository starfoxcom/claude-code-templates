import type { SavedOffer, SavedWork } from '../types'
import { ADOPT_GRACE_MS, ADOPT_MAX_AGE_MS } from './arms'
import type { Pause } from './plan'
import { limitName, projectOf, resetKey } from './plan'

// A session that saved its work at a wrap-up resumes it at the reset only while it is open. Closed by
// then, its work waits: a later session in the same project offers it on a card (take it here, keep it
// for its own session, or drop it), never by itself, since the person may have moved on. The record sits
// inside the session's `work-<reset>-<session>` claim folder, so the claim helper's sweep removes both.

/** The file a work claim holds, beside nothing else: `claims/work-<reset>-<session>/saved.json`. */
export const SAVED_FILE = 'saved.json'
/** A kept record resumes its own session when that session is opened again, within this long of the wake. */
export const KEPT_MAX_AGE_MS = 7 * 24 * 3_600_000

export function savedRecord(pause: Pause, session: string, root: string): SavedWork {
  const { resetsAt, wakeAt, kinds } = pause
  return { session, root, key: resetKey(pause), resetsAt, wakeAt, kinds }
}

/** A saved record, or undefined for a dropped one ('null') or anything unreadable. */
export function parseSaved(text: string): SavedWork | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<SavedWork> | null
    if (!parsed || typeof parsed !== 'object') return undefined
    const { session, root, key, wakeAt } = parsed
    if (typeof session !== 'string' || typeof root !== 'string' || typeof key !== 'string') return undefined
    return typeof wakeAt === 'number' ? (parsed as SavedWork) : undefined
  } catch {
    return undefined
  }
}

const WORK_CLAIM = /^work-(\d+)-(.+)$/

/** The work claims among the claim folders' names, as `{ name, owner }`. */
export function workClaims(names: readonly string[]): { name: string; owner: string }[] {
  return names.flatMap(name => {
    const match = WORK_CLAIM.exec(name)
    return match ? [{ name, owner: match[2] as string }] : []
  })
}

/**
 * When the record's work came due: the shared pause's own wake while it is still the same pause (another
 * session may have moved it to a later reset), else the record's. Undefined while it has not come, and
 * for a pause someone cancelled: no automatic resume then, so nothing missed one.
 */
export function dueAt(record: SavedWork, pause: Pause | undefined, now: number): number | undefined {
  const isSamePause = pause !== undefined && resetKey(pause) === record.key
  if (isSamePause && pause.status === 'cancelled') return undefined
  const wakeAt = isSamePause ? pause.wakeAt : record.wakeAt
  return wakeAt <= now ? wakeAt : undefined
}

/**
 * The saved work a closed session in this project left unresumed: past the grace (an open session
 * resumes it on time), within a day of its wake, not kept for its own session, and with no resume claim
 * taken for it. The newest wake wins.
 */
export function pickSaved(
  records: readonly SavedWork[],
  claimNames: ReadonlySet<string>,
  context: { me: string; root: string; pause: Pause | undefined; now: number },
): SavedOffer | undefined {
  const { me, root, pause, now } = context
  let best: SavedOffer | undefined
  for (const record of records) {
    if (record.session === me || record.isKept) continue
    if (projectOf(record.root) !== projectOf(root)) continue
    if (claimNames.has(resumeClaim(record))) continue
    const due = dueAt(record, pause, now)
    if (due === undefined || now - due < ADOPT_GRACE_MS || now - due > ADOPT_MAX_AGE_MS) continue
    if (!best || due > best.dueAt) best = { record, dueAt: due }
  }
  return best
}

/** The claim the record's own session takes when the reset resumes it: one resume, wherever it runs. */
export function resumeClaim(record: SavedWork): string {
  return `resume-${record.key}-${record.session}`
}

/** Kept for its own session and still recent: that session, opened again, resumes the work by itself. */
export function shouldResumeOwn(record: SavedWork, pause: Pause | undefined, now: number): boolean {
  const due = dueAt(record, pause, now)
  return record.isKept === true && due !== undefined && now - due <= KEPT_MAX_AGE_MS
}

function limitOf(record: SavedWork): string {
  return record.kinds?.length ? `the ${limitName({ kinds: record.kinds } as Pause)} ` : 'the '
}

export function savedOfferText(record: SavedWork, wakeText: string): string {
  return (
    `An earlier session in this project saved its work at ${limitOf(record)}wrap-up and was closed before ` +
    `the reset at ${wakeText} resumed it. Take that work over here, keep it for that session (it resumes ` +
    'when you open it again), or drop it?'
  )
}

/** What the session that takes the work over is told: the work is the earlier session's, rebuilt from its records. */
export function takeOverReason(record: SavedWork, wakeText: string): string {
  return (
    `An earlier session in this project saved its work at ${limitOf(record)}wrap-up and was closed before ` +
    `the reset at ${wakeText} resumed it; the person chose to take that work over here. Its task list is ` +
    `mods-data/tasks/${record.session}.json, and its hand-off is the one it saved at that wrap-up.`
  )
}

/** What a session told to keep its own work hears when it is opened again. */
export function keptReason(wakeText: string): string {
  return (
    `This session saved its work at the wrap-up and was closed before the reset at ${wakeText} resumed it; ` +
    'the person kept that work for this session, so it resumes now.'
  )
}

export const SAVED_OFFER_LINE =
  '🟨 A closed session in this project saved work that never resumed: /usage-guard adopt takes it here, ' +
  '/usage-guard adopt keep leaves it for that session, /usage-guard adopt drop forgets it.'
