import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ArmedWake, UsageCard } from '../types'
import type { Pause } from './plan'
import {
  CLAIM,
  covers,
  hotLimits,
  joinPause,
  LIMIT_NAMES,
  limitName,
  planArm,
  planPause,
  projectOf,
  resetKey,
  resumePrompt,
  WRAP_UP_ARGS,
} from './plan'
import { stopCommandsFor } from './rules'
import { register as settings, SETTINGS_PANE } from './settings'

const CHECK_EVERY_MS = 60_000
// How often the card above the prompt re-reads the shared files, so a Dismiss
// or a cancel in one session shows in the others.
const REFRESH_MS = 2_000
const band = atom({ plugin: 'usage-guard', key: 'band' } as const, null)
const armedWake = atom({ plugin: 'usage-guard', key: 'armed' } as const, null)
const READ_ZONE = [
  'node',
  '-e',
  'console.log(new Date().getTimezoneOffset() + " " + Intl.DateTimeFormat().resolvedOptions().timeZone)',
]

type Zone = { offsetMinutes: number; name: string }

// Module state: a hot reload starts it over, which is safe because the pause
// itself lives in the shared file.
const live: {
  zone: Zone
  isTurnRunning: boolean
  isStarted: boolean
  hasWork: boolean
  isStatusShown: boolean
  wakeTimer?: Timer
  /** The wake the person armed by hand (`armedWake`), counting down in this module. */
  armTimer?: Timer
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

async function dataDir($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/usage-guard`.replace(/\\/g, '/')
}

async function pausePath($: EngineInterface): Promise<string> {
  return `${await dataDir($)}/pause.json`
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

async function runClaimHelper($: EngineInterface, name?: string): Promise<{ exitCode: number; stdout: string }> {
  const argv = ['node', '-e', CLAIM, await dataDir($), ...(name ? [name.replace(/[^\w-]/g, '_')] : [])]
  return $.process.run(argv, { timeoutMs: 10_000 })
}

// True when this session won the claim; a helper that fails counts as a win, as
// before claims existed, so a missing `node` never stops the wrap-up.
async function claim($: EngineInterface, name: string): Promise<boolean> {
  if (live.handled.has(name)) return false
  live.handled.add(name)
  try {
    const { exitCode, stdout } = await runClaimHelper($, name)
    return exitCode !== 0 || stdout.trim() !== 'taken'
  } catch {
    return true
  }
}

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

// A cancel here also drops this session's own armed wake: the person at this session asked for no
// automatic resume. An arm in another session is that session's own explicit request and stays.
async function cancelPause($: EngineInterface, pause: Pause): Promise<void> {
  live.wakeTimer?.cancel()
  await disarm($)
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
  if (!(await claim($, `stop-${resetKey(pause)}-${projectOf(root)}`))) return
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
  await claim($, `work-${resetKey(pause)}-${await $.session.id()}`)
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

// The wrap-up a turn that ended owed, unless the pause was cancelled or ended meanwhile. Another
// session may have extended it to a later reset: the same episode still owes this wrap-up.
async function runPendingWrapUp($: EngineInterface): Promise<void> {
  const pending = live.pendingWrapUp
  if (!pending) return
  live.pendingWrapUp = undefined
  const pause = await readPause($)
  if (pause?.status !== 'active' || resetKey(pause) !== resetKey(pending)) return
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

async function resume($: EngineInterface, resetsAt: string, isArmed = false): Promise<void> {
  // Read first: an arm for this reset counts even if its own timer clears it while this one runs.
  const isArmedHere = isArmed || (await read($, armedWake))?.resetsAt === resetsAt
  const pause = await readPause($)
  if (!pause || pause.resetsAt !== resetsAt || pause.status === 'cancelled') return
  // Each session resumes once per reset, even when an instance left by a hot reload still runs its own
  // timer beside this one. The shared `done` status cannot be the claim: every session resumes.
  if (!(await claim($, `resume-${resetKey(pause)}-${await $.session.id()}`))) return
  if (pause.status === 'active') await writePause($, { ...pause, status: 'done' })
  setStatus($, undefined)
  await showCard($, `reset:${resetsAt}`, 'Plan limits have reset. Sessions are resuming their saved work.')
  // Only a session that saved work, or one armed, goes on by itself. Another session in the project
  // would rebuild the same hand-off and work the same tasks beside it, with nobody watching either.
  const work = isArmedHere || (await hadWork($, pause))
  if (work === null) return notice($, 'Plan limits have reset. Whether this session saved work could not be ' +
    'confirmed, so it waits for you; resume it by hand.')
  if (!work) return notice($, 'Plan limits have reset. This session saved no work, so it waits for you.')
  await resumeWork($, 'Plan limits have reset: resuming the saved work.')
}

// A wrap-up with work leaves a claim (this instance remembers it as handled, another finds it taken).
// Asking makes the claim for a session without one, which is harmless: its resume claim is taken.
// Unknown (null) when the helper fails: a session told it saved nothing would never be resumed by hand.
async function hadWork($: EngineInterface, pause: Pause): Promise<boolean | null> {
  const name = `work-${resetKey(pause)}-${await $.session.id()}`
  if (live.handled.has(name)) return true
  live.handled.add(name)
  try {
    const { exitCode, stdout } = await runClaimHelper($, name)
    return exitCode === 0 ? stdout.trim() === 'taken' : null
  } catch {
    return null
  }
}

// Never the project's /session-start: a ritual that proposes a plan and waits for an OK would wake the
// session only to stop it again. The engine runs a plugin's prompt once the session is idle, so a
// person typing meanwhile is never cut off.
async function resumeWork($: EngineInterface, text: string): Promise<void> {
  await notice($, text)
  void $.prompt.submit({ text: resumePrompt(text) }).catch(() => undefined)
}

async function armWake($: EngineInterface, pause: Pause): Promise<void> {
  live.wakeTimer?.cancel()
  const wait = Math.max(0, pause.wakeAt - (await $.clock.now()))
  live.wakeTimer = $.clock.after(wait, () => {
    live.wakeTimer = undefined
    void resume($, pause.resetsAt)
  })
}

async function scheduleArm($: EngineInterface, arm: ArmedWake): Promise<void> {
  live.armTimer?.cancel()
  const wait = Math.max(0, arm.wakeAt - (await $.clock.now()))
  live.armTimer = $.clock.after(wait, () => {
    live.armTimer = undefined
    void wakeArmed($, arm).catch(() => undefined)
  })
}

// An armed wake that came due: this session resumes, unless the arm was dropped or replaced, or a
// pause owns the resume. A pause still on (another session may have extended it past this reset)
// would be worked through, so the arm moves to the pause's own wake: there it stands down if the
// pause resumes the session, and still fires if another session cancelled the pause meanwhile. A
// pause for this same reset resumes through the pause path: its claim makes that a no-op when this
// session's own pause wake already resumed it, and still resumes a session that never saw the pause.
async function wakeArmed($: EngineInterface, arm: ArmedWake): Promise<void> {
  const current = await read($, armedWake)
  if (current?.resetsAt !== arm.resetsAt || current.kind !== arm.kind) {
    // The instance a hot reload left behind may have fired first and moved the arm, with the timer
    // for the new wake in that instance only: this one takes it up (the arm claim keeps one resume).
    // A command in this instance that re-armed or disarmed leaves a timer set or nothing to take.
    if (current && !live.armTimer) await scheduleArm($, current)
    return
  }
  const pause = await readPause($)
  if (pause?.status === 'active' && pause.wakeAt > (await $.clock.now())) {
    const later: ArmedWake = { ...arm, resetsAt: pause.resetsAt, wakeAt: pause.wakeAt }
    await setArm($, later)
    await scheduleArm($, later)
    return
  }
  // An instance left by a hot reload may fire the same arm beside this one: one wins the claim.
  if (!(await claim($, `arm-${Date.parse(arm.resetsAt)}-${await $.session.id()}`))) return
  // The arm stays set until the resume has run, so the pause's own timer, firing beside this one, sees it.
  if (pause && pause.resetsAt === arm.resetsAt && pause.status !== 'cancelled') await resume($, pause.resetsAt, true)
  else await resumeWork($, `The ${LIMIT_NAMES[arm.kind]} reset you armed for has passed: resuming the saved work.`)
  await setArm($, null)
}

async function setArm($: EngineInterface, arm: ArmedWake | null): Promise<void> {
  await update($, armedWake, () => arm)
}

async function armByHand($: EngineInterface, which: string): Promise<string> {
  const { rateLimits } = await $.session.usage()
  const planned = planArm(rateLimits, which, live.delayMinutes, await $.clock.now())
  if (typeof planned === 'string') return planned
  await setArm($, planned)
  await scheduleArm($, planned)
  return (
    `Armed: this session resumes its saved work at ${localTime(planned.wakeAt)}, after the ` +
    `${LIMIT_NAMES[planned.kind]} reset. /usage-guard disarm cancels it.`
  )
}

// Drops the arm set by hand. A pause's own resume is the pause's: /usage-guard cancel stops it.
async function disarm($: EngineInterface): Promise<string> {
  const current = await read($, armedWake)
  live.armTimer?.cancel()
  live.armTimer = undefined
  await setArm($, null)
  return current ? 'Disarmed: this session will not resume on its own.' : 'Nothing was armed.'
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
    // same high reading, nor by a stale one for a reset it was extended past.
    if (covers(pause, planned)) return
    pause = planned
    // Of several sessions crossing the line together, one writes the pause. The
    // others write the same pause only if the winner has not yet, so a cancel
    // written in between is not undone.
    const isWinner = await claim($, `pause-${resetKey(planned)}`)
    // Read again after the claim: another session may have paused for a different reset meanwhile.
    const shared = await readPause($)
    const isSharedLive = shared?.status === 'active' && shared.wakeAt > now
    if (isSharedLive) {
      pause = joinPause(shared, planned)
      if (pause !== shared) await writePause($, pause)
    } else if (!covers(shared, planned)) {
      await writePause($, pause)
    } else return // A cancel written since the winner's pause, or since it was extended, is honoured.
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
  // A wake armed before a hot reload: the module's timer went with the old instance.
  const arm = await read($, armedWake)
  if (arm) await scheduleArm($, arm)
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
  // A project no session had open when the pause began still has its background work stopped.
  await stopBackground($, pause)
  setStatus($, `Plan limit near: paused until ${localTime(pause.wakeAt)}`)
  await showCard($, `paused:${pause.resetsAt}`, pausedText(pause))
  await notice(
    $,
    `Plan limits are nearly used up (${limitName(pause)} at ${pause.percentUsed}%). They reset at ` +
      `${localTime(pause.wakeAt)}: sessions with saved work then resume on their own, and this one, with ` +
      `nothing saved, is told. To skip the automatic resume, run /usage-guard cancel.`,
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
  settings(on, options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await readZone($)
    const pause = await readPause($)
    if (pause?.status === 'active') await meetPause($, pause)
    await registerSurface($)
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

  on('command.run', { command: 'usage-guard' }, async ($, e) => ({ text: await runCommand($, e.args) }))
}

async function registerSurface($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'usage-guard',
    description: 'Usage pause status. Also: cancel, arm 5h|week (resume after that reset), disarm, settings',
    argumentHint: ARGUMENT_HINT,
  })
}

const ARGUMENT_HINT = '[help | settings | arm 5h|week | disarm | cancel]'
const HELP = [
  '/usage-guard: pauses a session before a plan window runs out and resumes it after the reset.',
  '  /usage-guard              the pause status and the wrap-up level',
  '  /usage-guard cancel       cancel the active pause: no automatic resume',
  '  /usage-guard arm 5h|week  resume this session after that window resets',
  '  /usage-guard disarm       drop the armed resume',
  '  /usage-guard settings     open the settings pane',
  '  /usage-guard help         this list',
].join('\n')

// `/usage-guard [help | settings | arm 5h|week | disarm | cancel]`; with no argument, the status.
async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [verb = '', which = ''] = args.trim().split(/\s+/)
  if (verb === 'help') return HELP
  if (verb === 'settings') {
    await $.ui.open({ id: SETTINGS_PANE, title: 'Usage guard settings', focus: true })
    return 'Opened the usage-guard settings.'
  }
  if (verb === 'arm') return armByHand($, which)
  if (verb === 'disarm') return disarm($)
  const arm = await read($, armedWake)
  const armedText = arm ? ` Armed to resume at ${localTime(arm.wakeAt)}.` : ''
  const pause = await readPause($)
  if (!pause || pause.status !== 'active')
    return `No usage pause. Sessions wrap up at ${live.wrapUpAt}% of any plan window.${armedText}`
  if (verb === 'cancel') {
    await cancelPause($, pause)
    return 'Usage pause cancelled: no automatic resume.'
  }
  return `Paused: ${limitName(pause)} at ${pause.percentUsed}%. Resumes at ${localTime(pause.wakeAt)}.${armedText}`
}
