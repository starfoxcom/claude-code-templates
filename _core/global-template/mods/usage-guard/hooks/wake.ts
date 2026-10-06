import type { SessionRateLimit } from 'claude-code'

import type { ArmedWake } from '../types'
import { CLOCK, planArm, REASON_MAX } from './plan'
import type { Zone } from './texts'

// `/usage-guard arm` read whole, and the wake it plans. An arm waits for a plan window's reset (5h, week)
// or for a time of day in 24-hour form, and may carry a reason in double quotes: the quotes mark where
// it starts and ends, so the command reads the same typed alone or written inside a longer message.
// Free of the engine, so it tests alone.

export type ArmRequest = { which: string; isCompact: boolean; reason?: string }

const USAGE =
  'Use: /usage-guard arm 5h|week|HH:MM [compact] ["reason"], for example /usage-guard arm 21:05 "check CI"'
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/
// A 12-hour time, in one word ("9pm", "9:05pm") or two ("9:05 pm"): never read, only turned into 24-hour.
const TWELVE = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i
// Straight quotes, and the curly ones a phone keyboard types in their place.
const QUOTE = /["“”]/

/** The reason as the wake will hand it on: one line, trimmed. Undefined when empty; a string past the cap. */
export function reasonOf(raw: string): { reason?: string } | string {
  const reason = raw.replace(/\s+/g, ' ').trim()
  if (reason.length > REASON_MAX) return `Keep the reason under ${REASON_MAX} characters (it has ${reason.length}).`
  return reason ? { reason } : {}
}

// The 24-hour spelling of a 12-hour time, for the refusal: "9:05 pm" is 21:05.
function twentyFour(text: string): string | undefined {
  const found = TWELVE.exec(text)
  const hour = Number(found?.[1])
  if (!found || hour < 1 || hour > 12) return undefined
  const minute = found[2] ?? '00'
  return `${String((hour % 12) + (found[3]?.toLowerCase() === 'p' ? 12 : 0)).padStart(2, '0')}:${minute}`
}

// The quoted reason at the end of the arguments, from the first quote to the last. A string when the
// quotes are not closed, or something follows the closing one.
function splitReason(text: string): { head: string; reason?: string } | string {
  const open = text.search(QUOTE)
  if (open < 0) return { head: text }
  const tail = text.slice(open + 1)
  const close = Math.max(tail.lastIndexOf('"'), tail.lastIndexOf('”'), tail.lastIndexOf('“'))
  if (close < 0 || tail.slice(close + 1).trim()) return `Close the reason's quotes, with nothing after them. ${USAGE}`
  const reason = reasonOf(tail.slice(0, close))
  return typeof reason === 'string' ? reason : { head: text.slice(0, open), ...reason }
}

/** The words after `/usage-guard arm`: what to wake at, `compact`, and the quoted reason; or why not. */
export function parseArmArgs(rest: string): ArmRequest | string {
  const split = splitReason(rest.trim())
  if (typeof split === 'string') return split
  const [which = '', ...more] = split.head.trim().split(/\s+/).filter(Boolean)
  if (!which) return USAGE
  const twelve = twentyFour(which) ?? twentyFour(`${which} ${more[0] ?? ''}`)
  if (twelve) return `Use 24-hour time: /usage-guard arm ${twelve}.`
  const extra = more.filter(word => word !== 'compact')
  if (extra.length > 0 && split.reason === undefined)
    return `Put the reason in double quotes: /usage-guard arm ${which} "${extra.join(' ')}"`
  if (extra.length > 0 || more.length > 1) return USAGE
  return { which, isCompact: more.length === 1, ...(split.reason === undefined ? {} : { reason: split.reason }) }
}

/**
 * The `arm` tool's input, read as the command would read it. Never `compact`: a tool runs mid-turn, where
 * the engine refuses a compaction.
 */
export function toolRequest(input: { at?: unknown; reason?: unknown }): ArmRequest | string {
  if (typeof input.at !== 'string') return `Pass "at": 5h, week, or a 24-hour time such as 21:05.`
  const request = parseArmArgs(input.at.replace(new RegExp(QUOTE, 'g'), ''))
  if (typeof request === 'string') return request
  if (request.isCompact) return 'The arm tool cannot compact (a tool runs mid-turn): pass the time alone.'
  const reason = typeof input.reason === 'string' ? reasonOf(input.reason) : {}
  if (typeof reason === 'string') return reason
  return { ...request, ...reason }
}

/**
 * The next time the clock reads `hour:minute` in the zone: today if it is still ahead, else tomorrow. The
 * zone's offset is the one read now, so a daylight-saving change before the wake moves it by that hour.
 */
export function nextClockTime(hour: number, minute: number, now: number, zone: Zone): number {
  const offset = zone.offsetMinutes * 60_000
  const day = new Date(now - offset)
  day.setUTCHours(hour, minute, 0, 0)
  const local = day.getTime() <= now - offset ? day.getTime() + 86_400_000 : day.getTime()
  return local + offset
}

/** The wake an arm request sets, reason included, or why there is none. */
export function planWake(
  request: ArmRequest,
  limits: readonly SessionRateLimit[],
  delayMinutes: number,
  now: number,
  zone: Zone,
): ArmedWake | string {
  const reason = request.reason === undefined ? {} : { reason: request.reason }
  if (request.which === '5h' || request.which === 'week') {
    const planned = planArm(limits, request.which, delayMinutes, now)
    return typeof planned === 'string' ? planned : { ...planned, ...reason }
  }
  const time = TIME.exec(request.which)
  if (!time) return `Name what to wake at: 5h, week, or a 24-hour time such as 21:05. ${USAGE}`
  const wakeAt = nextClockTime(Number(time[1]), Number(time[2]), now, zone)
  return { kind: CLOCK, resetsAt: new Date(wakeAt).toISOString(), wakeAt, ...reason }
}

/** How far off a wake is: "in 10 h 20 min", "in 2 d 3 h", "in 0 min". */
export function untilText(wakeAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((wakeAt - now) / 60_000))
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const rest = minutes % 60
  const parts = [days ? `${days} d` : '', hours ? `${hours} h` : '', rest || minutes === 0 ? `${rest} min` : '']
  return `in ${parts.filter(Boolean).join(' ')}`
}

// The tool that lets Claude set the same arm: listed as mcp__usage-guard__arm.
export const ARM_TOOL_NAME = /^mcp__usage-guard__arm$/
export const ARM_TOOL = {
  name: 'arm',
  description:
    'Wake this session later by itself: after the 5-hour or weekly plan reset, or at a time of day (24-hour ' +
    'HH:MM, the next time it comes). The wake hands the session the reason. One arm per session: a new one ' +
    'replaces it. Use it when the person asks for a wake-up, or writes `/usage-guard arm ...` inside a ' +
    'message and means it (not when they only mention the command); pass the same values. The answer names ' +
    'the exact date and how far off it is: tell the person.',
  inputSchema: {
    type: 'object',
    properties: {
      at: { type: 'string', description: '"5h", "week", or a 24-hour time "HH:MM" such as "21:05".' },
      reason: { type: 'string', description: `What to do at the wake, up to ${REASON_MAX} characters.` },
    },
    required: ['at'],
  },
}
