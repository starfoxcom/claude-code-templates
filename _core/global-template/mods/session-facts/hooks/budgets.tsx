import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { Budgets, PlanWindow } from '../types'

// Written by register.ts; each file names the state with its own literal reference.
const budgets = atom({ plugin: 'session-facts', key: 'budgets' } as const, null)

export type Tone = 'red' | 'yellow' | 'green'
/** A piece of a chip drawn in its own color; one without takes the chip's. */
export type Part = { text: string; color?: Tone | 'gray' }
export type Chip = { text: string; color?: Tone; parts?: Part[] }

const BAR_CELLS = 10
const SQUARES: Record<Tone, string> = { green: '🟩', yellow: '🟨', red: '🟥' }
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

/** How full the context is against the compaction point: yellow at three quarters, red at nine tenths. */
export function fillTone(ratio: number): Tone {
  return ratio >= 0.9 ? 'red' : ratio >= 0.75 ? 'yellow' : 'green'
}

/**
 * Context fill against the compaction point, the figure the app's context meter shows. The row
 * draws the filled cells in the fill's tone; the facts line, read on the phone where text has no
 * color, draws the same cells as colored squares (`isSquares`). Same figures, same tone.
 */
export function contextParts(tokens: number | undefined, size: number, compactsAt?: number, isSquares = false): Part[] {
  if (tokens === undefined) return [{ text: 'ctx --' }]
  const ratio = tokens / (compactsAt ?? size)
  const tone = fillTone(ratio)
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(ratio * BAR_CELLS)))
  const [full, empty] = isSquares ? [SQUARES[tone], '⬜'] : ['▰', '▱']
  const left = compactsAt ? ` · ${thousands(Math.max(0, compactsAt - tokens))} to compact` : ''
  return [
    { text: 'ctx ' },
    { text: full.repeat(filled), color: tone },
    { text: empty.repeat(BAR_CELLS - filled), color: 'gray' },
    { text: ` ${Math.round((tokens / size) * 100)}%${left}` },
  ]
}

export function contextText(tokens: number | undefined, size: number, compactsAt?: number, isSquares = false): string {
  return contextParts(tokens, size, compactsAt, isSquares)
    .map(part => part.text)
    .join('')
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

// The bar always carries the fill's tone; the words turn only once it needs an eye.
export function contextChip(b: Budgets, now: number): Chip {
  const mark = compactedMark(b.compactedAt, b.offsetMinutes, now)
  const parts = [...contextParts(b.tokens, b.size, b.compactsAt), { text: mark }]
  const text = parts.map(part => part.text).join('')
  if (b.tokens === undefined) return { text, parts }
  const tone = fillTone(b.tokens / (b.compactsAt ?? b.size))
  return { text, parts, color: tone === 'green' ? undefined : tone }
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
              <Text color={chip.color}>{index > 0 ? ' · ' : ''}</Text>
              {(chip.parts ?? [{ text: chip.text }])
                .filter(part => part.text)
                .map((part, at) => (
                  <Text key={`session-facts-chip-${index}-${at}`} color={part.color ?? chip.color}>
                    {part.text}
                  </Text>
                ))}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
