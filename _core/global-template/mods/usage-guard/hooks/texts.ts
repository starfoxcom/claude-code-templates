import type { ArmedWake } from '../types'
import type { Pause } from './plan'
import { armFor, limitName, reasonText } from './plan'

// What the person reads: the cards, the notes, the command's help, and the local time they all show.

// The clock's offset and zone name, asked of node once per load: the engine reports neither.
export const READ_ZONE = [
  'node',
  '-e',
  'console.log(new Date().getTimezoneOffset() + " " + Intl.DateTimeFormat().resolvedOptions().timeZone)',
]

export type Zone = { offsetMinutes: number; name: string }

/** The zone `READ_ZONE` printed, or undefined when it printed something else. */
export function zoneOf(stdout: string): Zone | undefined {
  const [offset, name] = stdout.trim().split(' ')
  return Number.isFinite(Number(offset)) && name ? { offsetMinutes: Number(offset), name } : undefined
}

/** A time as the cards and notes show it: weekday, date and minute in the zone, which is named. */
export function formatLocal(ms: number, zone: Zone): string {
  const local = new Date(ms - zone.offsetMinutes * 60_000)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][local.getUTCDay()]
  return `${day} ${local.toISOString().slice(0, 16).replace('T', ' ')} (${zone.name})`
}

/** The arm's slim line: the wake as weekday and minute, what it waits for, and the start of its reason. */
export function armLineText(arm: ArmedWake, zone: Zone): string {
  const [day, , minute] = formatLocal(arm.wakeAt, zone).split(' ')
  const reason = !arm.reason ? '' : ` · "${arm.reason.length > 40 ? `${arm.reason.slice(0, 39)}…` : arm.reason}"`
  return `⏰ resumes ${day} ${minute} · ${armFor(arm.kind)}${reason}`
}

/** Plain /usage-guard's answer: the pause or its absence, then a standing arm and the last compaction. */
export function statusText(s: {
  pause?: Pause
  armAt?: number
  lastCompaction?: string
  wrapUpAt: number
  zone: Zone
}): string {
  const armed = s.armAt === undefined ? '' : ` Armed to resume at ${formatLocal(s.armAt, s.zone)}.`
  const compacted = s.lastCompaction ? `\nLast compaction, ${s.lastCompaction}` : ''
  if (s.pause?.status !== 'active')
    return `No usage pause. Sessions wrap up at ${s.wrapUpAt}% of any plan window.${armed}${compacted}`
  const resumes = `Resumes at ${formatLocal(s.pause.wakeAt, s.zone)}.`
  return `Paused: ${limitName(s.pause)} at ${s.pause.percentUsed}%. ${resumes}${armed}${compacted}`
}

export function pausedText(pause: Pause, wakeText: string): string {
  return (
    `${limitName(pause)} plan usage at ${pause.percentUsed}%. Sessions save their work and pause. Work ` +
    `resumes on its own at ${wakeText}.`
  )
}

/** The note a session leaves when it joins a pause another session started. */
export function joinedPauseText(pause: Pause, wakeText: string): string {
  return (
    `Plan limits are nearly used up (${limitName(pause)} at ${pause.percentUsed}%). Work resumes at ` +
    `${wakeText}: a session with saved work then goes on by itself, and one with nothing ` +
    `on record is told. To skip the automatic resume, run /usage-guard cancel.`
  )
}

/** The answer to `/usage-guard arm`: the wake's full date and how far off it is, so a wrong one shows. */
export function armedText(arm: ArmedWake, wakeText: string, untilText: string): string {
  const reason = arm.reason ? ` ${reasonText(arm.reason)}` : ''
  return (
    `Armed: this session resumes its saved work at ${wakeText} (${untilText}), ${armFor(arm.kind)}.${reason} ` +
    '/usage-guard disarm cancels it.'
  )
}

export const CANCELLED_TEXT =
  'Automatic resume cancelled for every session. Run /session-start in a session when you want to pick its ' +
  'saved work back up.'

// When a claim helper fails at the wake: whether this session should go on by itself is not known.
export const UNCONFIRMED_NOTICE =
  'Plan limits have reset. Whether this session should go on by itself could not be confirmed, so it waits ' +
  'for you; resume it by hand.'

// The card asking about an arm set with nothing pending.
export function questionText(wakeText: string): string {
  return (
    `Armed to resume at ${wakeText}, but nothing is pending here (no open task that is not on hold), so the ` +
    'wake-up will have nothing to do.'
  )
}

export type Tone = 'green' | 'blue' | 'yellow'

// yellow: the person may act (cancel the resume, run /session-start); blue: information; green: good news.
export function cardTone(id: string): Tone {
  if (id.startsWith('reset:')) return 'green'
  return id.startsWith('cancelled:') ? 'blue' : 'yellow'
}

export type CardButton = { key: string; label: string; isPrimary?: boolean; onPress: () => unknown }
export type Card = { key: string; tone: Tone; text: string; buttons: CardButton[] }

export const COMMAND_TEXT =
  'Usage pause status. Also: cancel, arm 5h|week|HH:MM [compact] ["reason"], disarm, settings, set'
export const ARGUMENT_HINT =
  '[help | settings | set | phone | arm 5h|week|HH:MM [compact] ["reason"] | disarm | cancel | adopt]'
export const HELP = [
  '/usage-guard: pauses a session before a plan window runs out and resumes it after the reset.',
  '  /usage-guard                      the pause status and the wrap-up level',
  '  /usage-guard cancel               cancel the active pause: no automatic resume',
  '  /usage-guard arm 5h|week          resume this session after that window resets',
  '  /usage-guard arm HH:MM            resume it at that 24-hour time (21:05), the next time it comes',
  '  /usage-guard arm ... compact      the same, and compact the session now',
  '  /usage-guard arm ... "reason"     the same; the wake hands the session the quoted reason',
  '  /usage-guard disarm               drop the armed resume',
  '  /usage-guard adopt [drop]         run here the resume a closed session missed (drop: forget it)',
  '  /usage-guard settings             open the settings pane',
  '  /usage-guard set <name> <value>   change a setting; with no name, list them',
  '  /usage-guard phone                the same as text, for phone chats',
  '  /usage-guard help                 this list',
].join('\n')
