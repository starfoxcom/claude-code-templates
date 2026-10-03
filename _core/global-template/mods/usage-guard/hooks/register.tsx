import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { UsageCard } from '../types'
import { stopCommandsFor } from './rules'

// One shared file tells every session on the machine that a pause is on, so
// a session that never crossed the line itself still wraps up. Which sessions
// have wrapped up is kept as claims beside it (see `claim`), never in this file,
// so no two sessions rewrite it at once.
export type Pause = {
  status: 'active' | 'done' | 'cancelled'
  kinds: string[]
  percentUsed: number
  resetsAt: string
  wakeAt: number
  triggeredBy: string
}

const CHECK_EVERY_MS = 60_000
// How often the card above the prompt re-reads the shared files, so a Dismiss
// or a cancel in one session shows in the others.
const REFRESH_MS = 2_000
const band = atom({ plugin: 'usage-guard', key: 'band' } as const, null)
const READ_ZONE = [
  'node',
  '-e',
  'console.log(new Date().getTimezoneOffset() + " " + Intl.DateTimeFormat().resolvedOptions().timeZone)',
]
const LIMIT_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly' }

export const WRAP_UP_ARGS =
  'Plan usage limit nearly reached (automatic wrap-up). Commit locally only: no push, no PR, no CI. ' +
  'Save the hand-off so /session-start can resume, stop every background task and monitor, keep it short.'

type Zone = { offsetMinutes: number; name: string }

export function hotLimits(limits: readonly SessionRateLimit[], wrapUpAt: number): SessionRateLimit[] {
  return limits.filter(limit => limit.resetsAt !== undefined && limit.percentUsed >= wrapUpAt)
}

export function planPause(hot: readonly SessionRateLimit[], delayMinutes: number, sessionId: string): Pause {
  const latest = [...hot].sort((a, b) => Date.parse(b.resetsAt ?? '') - Date.parse(a.resetsAt ?? ''))[0]
  const resetsAt = latest?.resetsAt ?? ''
  return {
    status: 'active',
    kinds: hot.map(limit => limit.kind),
    percentUsed: Math.max(...hot.map(limit => limit.percentUsed)),
    resetsAt,
    wakeAt: Date.parse(resetsAt) + delayMinutes * 60_000,
    triggeredBy: sessionId,
  }
}

function limitName(pause: Pause): string {
  return pause.kinds.map(kind => LIMIT_NAMES[kind] ?? kind.replace(/_/g, '-')).join(' + ')
}

// Module state: a hot reload starts it over, which is safe because the pause
// itself lives in the shared file.
const live: {
  zone: Zone
  isTurnRunning: boolean
  isStarted: boolean
  hasWork: boolean
  isStatusShown: boolean
  wakeTimer?: Timer
  /** A wrap-up due when the running turn ends: the pause it is for. */
  pendingWrapUp?: Pause
  /** Claims this module already holds or found taken, so a 60-second check spawns no helper. */
  handled: Set<string>
  wrapUpAt: number
  delayMinutes: number
} = {
  zone: { offsetMinutes: 0, name: 'UTC' },
  isTurnRunning: false,
  isStarted: false,
  // Set by the first tool call that changed something; a session that only
  // read has nothing to save, so near a limit it waits instead of wrapping up.
  hasWork: false,
  isStatusShown: false,
  handled: new Set(),
  wrapUpAt: 90,
  delayMinutes: 2,
}

async function pausePath($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/usage-guard/pause.json`.replace(/\\/g, '/')
}

async function readPause($: EngineInterface): Promise<Pause | undefined> {
  try {
    return JSON.parse(String(await $.fs.read(await pausePath($)))) as Pause
  } catch {
    return undefined
  }
}

async function writePause($: EngineInterface, pause: Pause): Promise<void> {
  await $.fs.write(await pausePath($), JSON.stringify(pause, null, 2))
}

// Claims under mods-data/usage-guard/claims/. `mkdir` is atomic, so of several
// sessions acting on one pause at the same moment exactly one wins each claim:
// `pause-<reset>`, the session that writes the pause and stops its project's
// background work; `<reset>-<session>`, that session has wrapped up (or, opened
// during the pause, only waits). The helper also makes the data folder, which
// the engine's fs cannot, and sweeps claims older than two weeks.
export const CLAIM =
  'const fs=require("fs"),p=require("path");const [d,n]=process.argv.slice(1);const c=p.join(d,"claims");' +
  'fs.mkdirSync(c,{recursive:true});for(const x of fs.readdirSync(c)){try{const f=p.join(c,x);' +
  'if(Date.now()-fs.statSync(f).mtimeMs>12096e5)fs.rmdirSync(f)}catch{}}' +
  'try{fs.mkdirSync(p.join(c,n));console.log("won")}catch(e){if(e.code!=="EEXIST")throw e;console.log("taken")}'

// True when this session won the claim; a helper that fails counts as a win, as
// before claims existed, so a missing `node` never stops the wrap-up.
async function claim($: EngineInterface, name: string): Promise<boolean> {
  if (live.handled.has(name)) return false
  live.handled.add(name)
  const dir = (await pausePath($)).replace(/\/pause\.json$/, '')
  try {
    const { exitCode, stdout } = await $.process.run(['node', '-e', CLAIM, dir, name.replace(/[^\w-]/g, '_')], {
      timeoutMs: 10_000,
    })
    return exitCode !== 0 || stdout.trim() !== 'taken'
  } catch {
    return true
  }
}

const resetKey = (pause: Pause) => String(Date.parse(pause.resetsAt))

async function readZone($: EngineInterface): Promise<void> {
  try {
    const { exitCode, stdout } = await $.process.run(READ_ZONE, { timeoutMs: 10_000 })
    const [offset, name] = stdout.trim().split(' ')
    if (exitCode === 0 && Number.isFinite(Number(offset)) && name) live.zone = { offsetMinutes: Number(offset), name }
  } catch {
    // UTC stays; the times shown say so.
  }
}

function localTime(ms: number): string {
  const local = new Date(ms - live.zone.offsetMinutes * 60_000)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][local.getUTCDay()]
  return `${day} ${local.toISOString().slice(0, 16).replace('T', ' ')} (${live.zone.name})`
}

// A note in this session's transcript. What the person sees is the card above
// the prompt, drawn in every session; Claude Code's toast vanishes in seconds.
async function notice($: EngineInterface, text: string): Promise<void> {
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } }).catch(() => undefined)
}

function setStatus($: EngineInterface, text: string | undefined): void {
  $.ui.status(text)
  live.isStatusShown = text !== undefined
}

async function cardPath($: EngineInterface): Promise<string> {
  return (await pausePath($)).replace(/pause\.json$/, 'card.json')
}

async function readCard($: EngineInterface): Promise<UsageCard | undefined> {
  try {
    return JSON.parse(String(await $.fs.read(await cardPath($)))) as UsageCard
  } catch {
    return undefined
  }
}

// One card per event, shared by every session: the first session to reach the
// event writes it, so a card someone already dismissed is not raised again by
// the next session reaching the same event.
async function showCard($: EngineInterface, id: string, text: string): Promise<void> {
  if ((await readCard($))?.id === id) return
  await $.fs.write(await cardPath($), JSON.stringify({ id, text, dismissed: false }, null, 2))
  await refresh($)
}

async function dismissCard($: EngineInterface): Promise<void> {
  const card = await readCard($)
  if (card && !card.dismissed)
    await $.fs.write(await cardPath($), JSON.stringify({ ...card, dismissed: true }, null, 2))
  await refresh($)
}

async function refresh($: EngineInterface): Promise<void> {
  const card = await readCard($)
  const pause = await readPause($)
  const isPaused = pause?.status === 'active' && pause.wakeAt > (await $.clock.now())
  // A pause cancelled or ended from another session clears this one's status too.
  if (!isPaused && live.isStatusShown) setStatus($, undefined)
  const shown = card && !card.dismissed ? card : null
  await update($, band, () => (shown ? { card: shown, canCancel: isPaused } : null))
}

async function cancelPause($: EngineInterface, pause: Pause): Promise<void> {
  live.wakeTimer?.cancel()
  await writePause($, { ...pause, status: 'cancelled' })
  setStatus($, undefined)
  await showCard(
    $,
    `cancelled:${pause.resetsAt}`,
    'Automatic resume cancelled for every session. Run /session-start in a session when you want to pick its ' +
      'saved work back up.',
  )
}

async function cancelFromCard($: EngineInterface): Promise<void> {
  const pause = await readPause($)
  if (pause?.status === 'active') await cancelPause($, pause)
}

function pausedText(pause: Pause): string {
  return (
    `${limitName(pause)} plan usage at ${pause.percentUsed}%. Sessions save their work and pause. Work ` +
    `resumes on its own at ${localTime(pause.wakeAt)}.`
  )
}

async function hasCommand($: EngineInterface, name: string): Promise<boolean> {
  const commands = await $.command.list().catch(() => [])
  return commands.some(command => command.name === name)
}

// Every session stops its own project's background work, once per project per reset: sessions in two
// projects each stop their own, and of two sessions in one project only the first runs the commands.
async function stopBackground($: EngineInterface, pause: Pause): Promise<void> {
  const root = await $.session.root()
  const folder = (root.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? '').toLowerCase()
  if (!(await claim($, `stop-${resetKey(pause)}-${folder}`))) return
  for (const argv of stopCommandsFor(root)) {
    await $.process.run(argv, { timeoutMs: 60_000 }).catch(() => undefined)
  }
}

async function wrapUp($: EngineInterface, pause: Pause): Promise<void> {
  const resumeAt = localTime(pause.wakeAt)
  setStatus($, `Plan limit near: paused until ${resumeAt}`)
  await showCard($, `paused:${pause.resetsAt}`, pausedText(pause))
  if (!live.hasWork) {
    await notice(
      $,
      `${limitName(pause)} plan usage at ${pause.percentUsed}%: nothing to save here, waiting. Work resumes on ` +
        `its own at ${resumeAt}. To skip the automatic resume, run /usage-guard cancel.`,
    )
    return
  }
  await notice(
    $,
    `${limitName(pause)} plan usage at ${pause.percentUsed}%: saving work now. Work resumes on its own at ` +
      `${resumeAt}. To skip the automatic resume, run /usage-guard cancel.`,
  )
  // Mid-turn, the wrap-up never starts beside the running turn: the turn is told to finish its
  // step, and turn.complete runs the wrap-up once it has ended.
  if (live.isTurnRunning) {
    live.pendingWrapUp = pause
    const note =
      `[usage-guard] Plan usage at ${pause.percentUsed}%. Finish the current step and end this turn ` +
      `now; the wrap-up runs right after.`
    await $.session
      .append({ message: { type: 'user', content: [{ type: 'text', text: note }] } })
      .catch(() => undefined)
    return
  }
  await startWrapUp($, pause)
}

// The wrap-up a turn that ended owed, unless the pause was cancelled or ended meanwhile.
async function runPendingWrapUp($: EngineInterface): Promise<void> {
  const pending = live.pendingWrapUp
  if (!pending) return
  live.pendingWrapUp = undefined
  const pause = await readPause($)
  if (pause?.status !== 'active' || pause.resetsAt !== pending.resetsAt) return
  await startWrapUp($, pause)
}

async function startWrapUp($: EngineInterface, pause: Pause): Promise<void> {
  const resumeAt = localTime(pause.wakeAt)
  if (await hasCommand($, 'session-close')) {
    void $.command.run({ command: 'session-close', args: WRAP_UP_ARGS }).catch(() => undefined)
  } else {
    void $.prompt
      .submit({ text: `[usage-guard] ${WRAP_UP_ARGS} Work resumes automatically at ${resumeAt}.` })
      .catch(() => undefined)
  }
}

async function resume($: EngineInterface, resetsAt: string): Promise<void> {
  const pause = await readPause($)
  if (!pause || pause.resetsAt !== resetsAt || pause.status === 'cancelled') return
  // Each session resumes once per reset, even when an instance left by a hot reload still runs its own
  // timer beside this one. The shared `done` status cannot be the claim: every session resumes.
  if (!(await claim($, `resume-${resetKey(pause)}-${await $.session.id()}`))) return
  if (pause.status === 'active') await writePause($, { ...pause, status: 'done' })
  setStatus($, undefined)
  await showCard($, `reset:${resetsAt}`, 'Plan limits have reset. Sessions are resuming their saved work.')
  await notice($, 'Plan limits have reset: resuming the saved work.')
  if (await hasCommand($, 'session-start')) {
    void $.command.run({ command: 'session-start' }).catch(() => undefined)
  } else {
    void $.prompt
      .submit({ text: '[usage-guard] Plan limits have reset. Resume the saved work from your hand-off.' })
      .catch(() => undefined)
  }
}

async function armWake($: EngineInterface, pause: Pause): Promise<void> {
  live.wakeTimer?.cancel()
  const wait = Math.max(0, pause.wakeAt - (await $.clock.now()))
  live.wakeTimer = $.clock.after(wait, () => {
    live.wakeTimer = undefined
    void resume($, pause.resetsAt)
  })
}

// This session's part in a live pause: it wraps up once, and its wake timer is
// armed. A hot reload starts this module without its timer, while the earlier
// instance's timer may still run: a pause this session already handled gets its
// timer back here, and the resume claim keeps the two from resuming twice.
async function act($: EngineInterface, pause: Pause): Promise<void> {
  if (await claim($, `${resetKey(pause)}-${await $.session.id()}`)) {
    await armWake($, pause)
    await stopBackground($, pause)
    await wrapUp($, pause)
  } else if (!live.wakeTimer) await armWake($, pause)
}

async function check($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const sessionId = await $.session.id()
  let pause = await readPause($)
  const isLive = pause?.status === 'active' && pause.wakeAt > now

  if (!isLive) {
    const { rateLimits } = await $.session.usage()
    const hot = hotLimits(rateLimits, live.wrapUpAt).filter(limit => Date.parse(limit.resetsAt ?? '') > now)
    if (hot.length === 0) return
    const planned = planPause(hot, live.delayMinutes, sessionId)
    // One pause per reset: a cancelled or finished one is not re-armed by the
    // same high reading.
    if (pause?.resetsAt === planned.resetsAt) return
    pause = planned
    // Of several sessions crossing the line together, one writes the pause. The
    // others write the same pause only if the winner has not yet, so a cancel
    // written in between is not undone.
    if (await claim($, `pause-${resetKey(planned)}`)) {
      await writePause($, pause)
    } else {
      // The loser acts on the shared file, never on its own plan: a cancel written
      // since the winner's pause stands.
      const shared = await readPause($)
      if (shared?.resetsAt !== planned.resetsAt) await writePause($, pause)
      else if (shared.status !== 'active') return
      else pause = shared
    }
  }
  if (pause) await act($, pause)
}

// The time zone and the two timers (pause check, shared card refresh), once per module load.
async function startTimers($: EngineInterface): Promise<void> {
  if (live.isStarted) return
  live.isStarted = true
  await readZone($)
  await refresh($)
  const pause = await readPause($)
  if (pause?.status === 'active' && pause.wakeAt > (await $.clock.now())) await act($, pause)
  $.clock.every(CHECK_EVERY_MS, () => void check($).catch(() => undefined))
  $.clock.every(REFRESH_MS, () => void refresh($).catch(() => undefined))
}

// A session that starts during a pause: it has nothing to save yet, so it only waits for the reset.
// One that starts after the reset is told to resume by hand.
async function meetPause($: EngineInterface, pause: Pause): Promise<void> {
  if (pause.wakeAt <= (await $.clock.now())) {
    await writePause($, { ...pause, status: 'done' })
    const text = 'Plan limits have reset since the last wrap-up. Run /session-start to resume the saved work.'
    await showCard($, `missed:${pause.resetsAt}`, text)
    await notice($, text)
    return
  }
  await claim($, `${resetKey(pause)}-${await $.session.id()}`)
  await armWake($, pause)
  setStatus($, `Plan limit near: paused until ${localTime(pause.wakeAt)}`)
  await showCard($, `paused:${pause.resetsAt}`, pausedText(pause))
  await notice(
    $,
    `Plan limits are nearly used up (${limitName(pause)} at ${pause.percentUsed}%). Work resumes on its own ` +
      `at ${localTime(pause.wakeAt)}; /session-start then picks up the saved work. To skip the automatic ` +
      `resume, run /usage-guard cancel.`,
  )
}

// yellow: the person may act (cancel the resume, run /session-start); blue: information; green: good news.
function cardTone(id: string): 'green' | 'blue' | 'yellow' {
  if (id.startsWith('reset:')) return 'green'
  return id.startsWith('cancelled:') ? 'blue' : 'yellow'
}

export const register: Register = (on, options) => {
  live.wrapUpAt = Number(options.wrapUpAt ?? 90)
  live.delayMinutes = Number(options.wakeDelayMinutes ?? 2)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await readZone($)
    const pause = await readPause($)
    if (pause?.status === 'active') await meetPause($, pause)
    await $.command.register({
      name: 'usage-guard',
      description: 'Show the usage pause, or cancel it: /usage-guard cancel',
    })

    await startTimers($)
    return result
  })

  // The card: the same bordered look as shared-pc's, drawn above whatever the
  // other mods draw there. It stays until someone dismisses it, in any session.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    const shown = await read($, band)
    if (!shown?.card) return inner
    const tone = cardTone(shown.card.id)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box
          alignSelf="flex-end"
          width={Math.max(30, Math.min(64, e.props.bodyColumns - 2))}
          flexDirection="column"
          borderStyle="double"
          borderColor={tone}
          backgroundColor="black"
          paddingX={1}
        >
          <Text bold color="black" backgroundColor={tone}>
            {' USAGE GUARD '}
          </Text>
          <Text bold color={tone} wrap="wrap">
            {shown.card.text}
          </Text>
          <Box>
            <Button key="usage-dismiss" label="Dismiss" variant="primary" onPress={() => dismissCard($)} />
            {shown.canCancel && (
              <Button key="usage-cancel" label="Cancel auto-resume (all sessions)" onPress={() => cancelFromCard($)} />
            )}
          </Box>
        </Box>
        {inner}
      </Box>
    )
  })

  on('turn.start', async ($, e, next) => {
    live.isTurnRunning = true
    // A hot reload starts the module over without a session.start: the first turn after it restarts
    // the timers and reads the time zone again.
    await startTimers($).catch(() => undefined)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    // Core marks a call read-only (true) or leaves the flag out, never false: any
    // answered call without the mark may have changed something.
    if (!result.deny && !result.isError && result.isReadOnly !== true) live.hasWork = true
    return result
  })

  on('turn.complete', async ($, e, next) => {
    live.isTurnRunning = false
    const result = await next(e)
    await runPendingWrapUp($).catch(() => undefined)
    await check($).catch(() => undefined)
    return result
  })

  on('command.run', { command: 'usage-guard' }, async ($, e) => {
    const pause = await readPause($)
    if (!pause || pause.status !== 'active')
      return { text: `No usage pause. Sessions wrap up at ${live.wrapUpAt}% of any plan window.` }
    if (e.args.trim() === 'cancel') {
      await cancelPause($, pause)
      return { text: 'Usage pause cancelled: no automatic resume.' }
    }
    return { text: `Paused: ${limitName(pause)} at ${pause.percentUsed}%. Resumes at ${localTime(pause.wakeAt)}.` }
  })
}
