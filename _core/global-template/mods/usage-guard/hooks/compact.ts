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

/** How a compaction went; `freed` only when the context is known to have shrunk. */
export type CompactOutcome =
  | { kind: 'freed'; before: number; after: number }
  | { kind: 'not-freed'; before?: number; after?: number }
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

export function outcomeOf(result: SessionCompactResult): CompactOutcome {
  if (result.skip !== undefined) return { kind: 'not-run', reason: result.skip }
  const { tokensBefore: before, tokensAfter: after } = result
  if (before !== undefined && after !== undefined && after < before) return { kind: 'freed', before, after }
  return { kind: 'not-freed', before, after }
}

function thousands(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}

// A compaction is claimed only when the sizes show it freed context: one whose size afterwards is not
// reported, or did not drop, says so instead.
export function outcomeText(outcome: CompactOutcome): string {
  if (outcome.kind === 'freed')
    return `Compacted: context went from ${thousands(outcome.before)} to ${thousands(outcome.after)} tokens.`
  if (outcome.kind === 'not-run') return `Not compacted: ${outcome.reason}`
  const { before, after } = outcome
  const isKnown = before !== undefined && after !== undefined
  const sizes = isKnown ? ` (${thousands(before)} before, ${thousands(after)} after)` : ''
  const known = after === undefined ? ': its size afterwards was not reported' : ''
  return `The compaction did not free context${sizes}${known}, so the session keeps its full context.`
}

/** The few words the status line adds after a compaction. */
export function outcomeMark(outcome: CompactOutcome): string {
  if (outcome.kind === 'freed') return `compacted to ${thousands(outcome.after)}`
  return outcome.kind === 'not-run' ? 'not compacted' : 'compaction freed nothing'
}
