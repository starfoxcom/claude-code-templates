import type { SessionCompactResult } from 'claude-code'

// The longer of the two prompt-cache lifetimes. A wake sooner than this may still find the cache warm,
// so compacting first would only pay for a summary. Which lifetime a session has is not known here, so
// the longer one decides: a session with the shorter one only misses a compaction it could have had.
export const CACHE_LIFE_MS = 60 * 60_000

// What the summary keeps for a session that goes on by itself after the reset.
export const PAUSE_INSTRUCTIONS =
  'The session pauses for a plan limit and resumes its saved work on its own after the reset. Keep what ' +
  'that resume needs: the task in progress, its next step, and what waits on the person.'

/** The context's fill: tokens, and their share of the compaction window as the context meter shows it. */
export type Fill = { tokens: number; percent: number }

/**
 * How a compaction went. One that ran is `measuring` until the next reply: the engine's own size afterwards
 * counts only the kept messages, never the system prompt, tools and rules every request carries (it said
 * 22k for a real 125k, 2026-10-04), so the first request after it is the size that counts.
 */
export type CompactOutcome =
  | { kind: 'freed'; before: number; after: number }
  | { kind: 'not-freed'; before: number; after: number }
  | { kind: 'measuring'; before?: number }
  | { kind: 'not-run'; reason: string }

/**
 * Whether a pause compacts this session first: the setting is on (above 0), the context has reached it,
 * and the wake is further off than the cache lasts, so the resume would read the whole context cold.
 */
export function shouldCompactAtPause(
  fill: Fill | undefined,
  abovePercent: number,
  wakeAt: number,
  now: number,
): boolean {
  if (abovePercent <= 0 || !fill) return false
  return fill.percent >= abovePercent && wakeAt - now > CACHE_LIFE_MS
}

/** A compaction's result, with the context's size just before it as the meter read it. */
export function outcomeOf(result: SessionCompactResult, before?: number): CompactOutcome {
  if (result.skip !== undefined) return { kind: 'not-run', reason: result.skip }
  return { kind: 'measuring', before: before ?? result.tokensBefore }
}

/** The first reply's size settles it: freed only when the context really shrank. */
export function measured(before: number, after: number): CompactOutcome {
  return after < before ? { kind: 'freed', before, after } : { kind: 'not-freed', before, after }
}

function thousands(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}

export function outcomeText(outcome: CompactOutcome): string {
  if (outcome.kind === 'freed')
    return `Compacted: context went from ${thousands(outcome.before)} to ${thousands(outcome.after)} tokens.`
  if (outcome.kind === 'not-run') return `Not compacted: ${outcome.reason}`
  if (outcome.kind === 'measuring') {
    const was = outcome.before !== undefined ? ` from ${thousands(outcome.before)} tokens` : ''
    return `Compacted${was}; the new size shows after the next reply.`
  }
  const sizes = `${thousands(outcome.before)} before, ${thousands(outcome.after)} after`
  return `The compaction did not free context (${sizes}), so the session keeps its full context.`
}

/** The few words the status line adds after a compaction. */
export function outcomeMark(outcome: CompactOutcome): string {
  if (outcome.kind === 'freed') return `compacted to ${thousands(outcome.after)}`
  if (outcome.kind === 'measuring') return 'compacted'
  return outcome.kind === 'not-run' ? 'not compacted' : 'compaction freed nothing'
}
