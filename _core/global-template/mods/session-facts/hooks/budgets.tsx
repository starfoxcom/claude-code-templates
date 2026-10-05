import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Budgets, PlanWindow } from '../types'

// Written by register.ts; each file names the state with its own literal reference.
const budgets = atom({ plugin: 'session-facts', key: 'budgets' } as const, null)

export type Tone = 'red' | 'yellow' | 'green'
/** A piece of a chip drawn in its own color; one without takes the chip's. `isCell`: the bar's cells. */
export type Part = { text: string; color?: Tone | 'gray'; isCell?: boolean }
/** `bar`: the context fill, which Desktop draws as a bar in place of the cells. */
export type Chip = { text: string; color?: Tone; parts?: Part[]; bar?: { ratio: number; tone: Tone } }

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
    { text: full.repeat(filled), color: tone, isCell: true },
    { text: empty.repeat(BAR_CELLS - filled), color: 'gray', isCell: true },
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
  const ratio = b.tokens / (b.compactsAt ?? b.size)
  const tone = fillTone(ratio)
  return { text, parts, color: tone === 'green' ? undefined : tone, bar: { ratio, tone } }
}

const BAR_WIDTH = 80
const BAR_HEIGHT = 10
const HEX: Record<Tone, string> = { green: '#3fb950', yellow: '#d29922', red: '#f85149' }

/**
 * Desktop's drawing of the context bar: one rounded track, filled to the same share in the same tone as
 * the cells the terminal draws. Only the drawing differs; the figures and tones are the cells'.
 */
export function barSvg(ratio: number, tone: Tone): string {
  const fill = Math.round(Math.min(1, Math.max(0, ratio)) * BAR_WIDTH)
  const track = `<rect x="0" y="2" width="${BAR_WIDTH}" height="6" rx="3" fill="#8b949e" fill-opacity="0.35"/>`
  const filled = fill > 0 ? `<rect x="0" y="2" width="${fill}" height="6" rx="3" fill="${HEX[tone]}"/>` : ''
  const size = `width="${BAR_WIDTH}" height="${BAR_HEIGHT}" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" ${size}>${track}${filled}</svg>`
}

/** One chip per plan window; the reset time shows once a window passes the warning level. */
export function planChip(limit: PlanWindow, b: Budgets): Chip {
  const name = PLAN_NAMES[limit.kind] ?? limit.kind.replace(/_/g, '-')
  const used = Math.round(limit.percentUsed)
  if (used < b.planWarnAt) return { text: `${name} ${used}%` }
  const reset = limit.resetsAt ? ` → resets ${shortLocal(limit.resetsAt, b.offsetMinutes)}` : ''
  return { text: `${name} ${used}%${reset}`, color: used >= b.wrapUpAt ? 'red' : 'yellow' }
}

const CACHE_NOTICE_MS = 15 * 60_000
const MISS_NAMES: Record<string, string> = {
  expired: 'cache expired',
  early: 'cache broke early',
  short: 'cache lasts 5m',
}

/** A recent miss the API's counts confirmed, other than one that comes by design. */
function cacheNotice(b: Budgets, now: number): string | undefined {
  const check = b.cacheCheck
  if (!check?.miss || now - check.at >= CACHE_NOTICE_MS) return undefined
  return MISS_NAMES[check.miss]
}

/**
 * Quiet while the cache is warm. Near the end of its lifetime it counts down and names the cold
 * start: what the next request writes to the cache again if it expires. For a quarter hour after a
 * confirmed miss it says what happened and what it cost.
 */
export function cacheChip(b: Budgets, now: number): Chip | undefined {
  if (b.cacheExpiresAt === undefined || b.tokens === undefined) return undefined
  const notice = cacheNotice(b, now)
  const minutes = Math.floor((b.cacheExpiresAt - now) / 60_000)
  if (minutes <= b.cacheWarnMinutes) {
    const left = minutes <= 0 ? 'likely expired' : `${minutes}m left`
    const text = `${notice ? `${notice} · ` : 'cache '}${left} · cold start ${thousands(b.tokens)}`
    return { text, color: minutes <= 0 ? 'red' : 'yellow' }
  }
  if (!notice) return undefined
  const text = `${notice} · resent ${thousands(b.cacheCheck?.resent ?? 0)}`
  return { text, color: b.cacheCheck?.miss === 'expired' ? undefined : 'yellow' }
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

const PHONE_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'week' }

// A plan window as ten squares in its chip's tone, with the reset time the row shows only past the warning.
function phonePlanLine(limit: PlanWindow, b: Budgets): string {
  const name = PHONE_NAMES[limit.kind] ?? limit.kind.replace(/_/g, '-')
  const used = Math.round(limit.percentUsed)
  const tone = planChip(limit, b).color ?? 'green'
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round(used / 10)))
  const bar = SQUARES[tone].repeat(filled) + '⬜'.repeat(BAR_CELLS - filled)
  const reset = limit.resetsAt ? ` · resets ${shortLocal(limit.resetsAt, b.offsetMinutes)}` : ''
  return `${name} ${bar} ${used}%${reset}`
}

function phoneCacheLine(b: Budgets, now: number): string {
  const chip = cacheChip(b, now)
  if (chip) return `${chip.color ? `${SQUARES[chip.color]} ` : ''}${chip.text}`
  if (b.cacheExpiresAt === undefined) return 'cache --'
  return `cache: warm · ${Math.max(0, Math.floor((b.cacheExpiresAt - now) / 60_000))}m left`
}

/**
 * The budgets row as plain text for a phone chat, which draws no row: the same chips' figures and tones,
 * colour as squares, plus what the row keeps until it matters (every reset time, the cache's time left).
 */
export function phoneText(b: Budgets, now: number): string {
  const context = contextText(b.tokens, b.size, b.compactsAt, true) + compactedMark(b.compactedAt, b.offsetMinutes, now)
  const plans = b.limits.length > 0 ? b.limits.map(limit => phonePlanLine(limit, b)) : ['5-hour --', 'week --']
  const until = pauseChip(b, now) && b.pausedUntil !== undefined ? shortLocal(b.pausedUntil, b.offsetMinutes) : ''
  const lines = [`📊 Budgets · ${shortLocal(now, b.offsetMinutes).slice(4)}`, context]
  return [...lines, ...(until ? [`🟥 PAUSED until ${until}`] : plans), phoneCacheLine(b, now)].join('\n')
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

// One piece of a chip. Where the surface draws vectors (Desktop, the editor), the cells become one bar in
// their place; the terminal keeps its cells, and the phone app keeps text like its chat.
function drawPart(ui: Ui, chip: Chip, part: Part, key: string, isRich: boolean) {
  if (isRich && part.isCell && chip.bar && 'Svg' in ui) {
    if (part.color === 'gray') return null
    const alt = `context ${Math.round(chip.bar.ratio * 100)}% of the way to compaction`
    const source = barSvg(chip.bar.ratio, chip.bar.tone)
    return <ui.Svg key={key} source={source} alt={alt} width={BAR_WIDTH} height={BAR_HEIGHT} />
  }
  if (!part.text) return null
  return (
    <ui.Text key={key} color={part.color ?? chip.color} wrap="truncate-end">
      {part.text}
    </ui.Text>
  )
}

// In a narrow band (a side pane takes room) the row wraps by whole chips: a chip that does not fit moves
// to the next line in one piece. Only a chip wider than the band alone shrinks, cut short with an ellipsis.
export function registerBudgetsView(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    const shown = await read($, budgets)
    if (e.props.hasSurvey || !shown) return inner
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const isRich = e.surface === 'desktop' || e.surface === 'vscode'
    const chips = chipsOf(shown, await $.clock.now())
    return (
      <Box flexDirection="column">
        {inner}
        <Box key="session-facts-row" flexWrap="wrap">
          {chips.map((chip, index) => (
            <Box key={`session-facts-chip-${index}`} flexShrink={1} minWidth={0}>
              <Text color={chip.color}>{index > 0 ? ' · ' : ''}</Text>
              {(chip.parts ?? [{ text: chip.text }]).map((part, at) =>
                drawPart(ui, chip, part, `session-facts-chip-${index}-${at}`, isRich),
              )}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
