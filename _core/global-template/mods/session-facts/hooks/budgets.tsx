import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { Budgets, PlanWindow } from '../types'

// Written by register.ts; each file names the state with its own literal reference.
const budgets = atom({ plugin: 'session-facts', key: 'budgets' } as const, null)

export type Chip = { text: string; color?: 'red' | 'yellow' | 'green' }

const BAR_CELLS = 10
const PLAN_NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'week' }

function thousands(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}

/** `Fri 10:00` in the host's zone. */
export function shortLocal(epochMs: number, offsetMinutes: number): string {
  const local = new Date(epochMs - offsetMinutes * 60_000)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][local.getUTCDay()]
  return `${day} ${local.toISOString().slice(11, 16)}`
}

function bar(ratio: number): string {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(ratio * BAR_CELLS)))
  return '▰'.repeat(filled) + '▱'.repeat(BAR_CELLS - filled)
}

/**
 * Context fill against the compaction point, the figure the app's context meter shows. The facts
 * line carries the same text, so the State line reads like the row.
 */
export function contextText(tokens: number | undefined, size: number, compactsAt?: number): string {
  if (tokens === undefined) return 'ctx --'
  const left = compactsAt ? ` · ${thousands(Math.max(0, compactsAt - tokens))} to compact` : ''
  return `ctx ${bar(tokens / (compactsAt ?? size))} ${Math.round((tokens / size) * 100)}%${left}`
}

const JUST_COMPACTED_MS = 15 * 60_000

/**
 * ` · just compacted 09:00` for a quarter hour after a compaction, on the row and the facts line
 * alike: every figure in the compaction's summary is from before it ran.
 */
export function compactedMark(compactedAt: number | undefined, offsetMinutes: number, now: number): string {
  if (compactedAt === undefined || now - compactedAt >= JUST_COMPACTED_MS) return ''
  return ` · just compacted ${shortLocal(compactedAt, offsetMinutes).slice(4)}`
}

export function contextChip(b: Budgets, now: number): Chip {
  const text = contextText(b.tokens, b.size, b.compactsAt) + compactedMark(b.compactedAt, b.offsetMinutes, now)
  if (b.tokens === undefined) return { text }
  const ratio = b.tokens / (b.compactsAt ?? b.size)
  return { text, color: ratio >= 0.9 ? 'red' : ratio >= 0.75 ? 'yellow' : undefined }
}

/** One chip per plan window; the reset time shows once a window passes the warning level. */
export function planChip(limit: PlanWindow, b: Budgets): Chip {
  const name = PLAN_NAMES[limit.kind] ?? limit.kind.replace(/_/g, '-')
  const used = Math.round(limit.percentUsed)
  if (used < b.planWarnAt) return { text: `${name} ${used}%` }
  const reset = limit.resetsAt ? ` → resets ${shortLocal(limit.resetsAt, b.offsetMinutes)}` : ''
  return { text: `${name} ${used}%${reset}`, color: used >= b.wrapUpAt ? 'red' : 'yellow' }
}

/** Shown only once the prompt cache is about to go cold. */
export function cacheChip(b: Budgets, now: number): Chip | undefined {
  if (b.cacheExpiresAt === undefined || b.tokens === undefined) return undefined
  const minutes = Math.floor((b.cacheExpiresAt - now) / 60_000)
  if (minutes > b.cacheWarnMinutes) return undefined
  return minutes <= 0 ? { text: 'cache cold', color: 'red' } : { text: `cache ${minutes}m`, color: 'yellow' }
}

export function pauseChip(b: Budgets, now: number): Chip | undefined {
  if (b.pausedUntil === undefined || b.pausedUntil <= now) return undefined
  return { text: `PAUSED → ${shortLocal(b.pausedUntil, b.offsetMinutes)}`, color: 'red' }
}

export function chipsOf(b: Budgets, now: number): Chip[] {
  const pause = pauseChip(b, now)
  const plan = pause ? [pause] : b.limits.map(limit => planChip(limit, b))
  const cache = cacheChip(b, now)
  return [contextChip(b, now), ...plan, ...(cache ? [cache] : [])]
}

export function registerBudgetsView(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    const shown = await read($, budgets)
    if (e.props.hasSurvey || !shown) return inner
    const { Box, Text } = $.ui.resolve(e)
    const chips = chipsOf(shown, await $.clock.now())
    return (
      <Box flexDirection="column">
        {inner}
        <Box>
          {chips.map((chip, index) => (
            <Box key={`session-facts-chip-${index}`}>
              <Text color={chip.color}>
                {index > 0 ? ' · ' : ''}
                {chip.text}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
