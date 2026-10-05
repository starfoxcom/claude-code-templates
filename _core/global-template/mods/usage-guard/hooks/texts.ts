import type { Pause } from './plan'
import { LIMIT_NAMES, limitName } from './plan'

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

/** The arm's slim line: the wake as weekday and minute, and the reset it follows. */
export function armLineText(wakeAt: number, kind: string, zone: Zone): string {
  const [day, , minute] = formatLocal(wakeAt, zone).split(' ')
  return `⏰ resumes ${day} ${minute} · after the ${LIMIT_NAMES[kind] ?? kind} reset`
}

export function pausedText(pause: Pause, wakeText: string): string {
  return (
    `${limitName(pause)} plan usage at ${pause.percentUsed}%. Sessions save their work and pause. Work ` +
    `resumes on its own at ${wakeText}.`
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

export const ARGUMENT_HINT = '[help | settings | set | phone | arm 5h|week [compact] | disarm | cancel]'
export const HELP = [
  '/usage-guard: pauses a session before a plan window runs out and resumes it after the reset.',
  '  /usage-guard                      the pause status and the wrap-up level',
  '  /usage-guard cancel               cancel the active pause: no automatic resume',
  '  /usage-guard arm 5h|week          resume this session after that window resets',
  '  /usage-guard arm 5h|week compact  the same, and compact the session now',
  '  /usage-guard disarm               drop the armed resume',
  '  /usage-guard settings             open the settings pane',
  '  /usage-guard set <name> <value>   change a setting; with no name, list them',
  '  /usage-guard phone                the same as text, for phone chats',
  '  /usage-guard help                 this list',
].join('\n')
