import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ArmedWake, UsageCard } from '../types'
import type { CompactOutcome, Fill } from './compact'
import { outcomeMark, outcomeOf, outcomeText, PAUSE_INSTRUCTIONS, shouldCompactAtPause } from './compact'
import type { Pause } from './plan'
import {
  CLAIM,
  countOpenTasks,
  covers,
  EMPTY_ARM_NOTE,
  hotLimits,
  NO_WORK_NOTICE,
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
import type { Card, CardButton, Zone } from './texts'
import {
  ARGUMENT_HINT,
  CANCELLED_TEXT,
  cardTone,
  formatLocal,
  HELP,
  pausedText,
  questionText,
  READ_ZONE,
  UNCONFIRMED_NOTICE,
  zoneOf,
} from './texts'

const CHECK_EVERY_MS = 60_000
// A beat after a command or the wrap-up's turn ends before compacting, so the engine is between turns.
const COMPACT_DELAY_MS = 1_000
// How often the card above the prompt re-reads the shared files, so a Dismiss
// or a cancel in one session shows in the others.
const REFRESH_MS = 2_000
const band = atom({ plugin: 'usage-guard', key: 'band' } as const, null)
const armedWake = atom({ plugin: 'usage-guard', key: 'armed' } as const, null)
// Module state: a hot reload starts it over, which is safe because the pause
// itself lives in the shared file.
const live: {
  zone: Zone
  isTurnRunning: boolean
  isStarted: boolean
  /** The session id whose tool calls changed something: a /clear goes on under a new id with none. */
  workSession?: string
  isStatusShown: boolean
  wakeTimer?: Timer
  /** The wake the person armed by hand (`armedWake`), counting down in this module. */
  armTimer?: Timer
  /** A wrap-up due when the running turn ends: the pause it is for. */
  pendingWrapUp?: Pause
  /** A wrap-up started: once its turn ends, the session may compact before the pause. */
  compactAfterTurn?: Pause
  /** How this session's last compaction went, with its time, for /usage-guard to repeat. */
  lastCompaction?: string
  /** Claims this module already holds or found taken, so a 60-second check spawns no helper. */
  handled: Set<string>
  wrapUpAt: number
  delayMinutes: number
  compactAbovePercent: number
} = {
  zone: { offsetMinutes: 0, name: 'UTC' },
  isTurnRunning: false,
  isStarted: false,
  isStatusShown: false,
  handled: new Set(),
  wrapUpAt: 90,
  delayMinutes: 2,
  compactAbovePercent: 25,
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

async function runClaimHelper($: EngineInterface, name: string): Promise<{ exitCode: number; stdout: string }> {
  return $.process.run(['node', '-e', CLAIM, await dataDir($), name.replace(/[^\w-]/g, '_')], { timeoutMs: 10_000 })
}

// True when this session won the claim, false when it was taken, null when the helper failed and
// nothing reached the disk.
async function tryClaim($: EngineInterface, name: string): Promise<boolean | null> {
  if (live.handled.has(name)) return false
  live.handled.add(name)
  try {
    const { exitCode, stdout } = await runClaimHelper($, name)
    return exitCode === 0 ? stdout.trim() !== 'taken' : null
  } catch {
    return null
  }
}

// A helper that fails counts as a win, as before claims existed, so a missing `node` never stops
// the wrap-up.
async function claim($: EngineInterface, name: string): Promise<boolean> {
  return (await tryClaim($, name)) !== false
}

async function readZone($: EngineInterface): Promise<void> {
  try {
    const { exitCode, stdout } = await $.process.run(READ_ZONE, { timeoutMs: 10_000 })
    const zone = exitCode === 0 ? zoneOf(stdout) : undefined
    if (zone) live.zone = zone
  } catch {
    // UTC stays; the times shown say so.
  }
}

function localTime(ms: number): string {
  return formatLocal(ms, live.zone)
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
  await showCard($, `cancelled:${pause.resetsAt}`, CANCELLED_TEXT)
}

async function cancelFromCard($: EngineInterface): Promise<void> {
  const pause = await readPause($)
  if (pause?.status === 'active') await cancelPause($, pause)
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
  await showCard($, `paused:${pause.resetsAt}`, pausedText(pause, localTime(pause.wakeAt)))
  if (live.workSession !== (await $.session.id())) {
    await notice(
      $,
      `${limitName(pause)} plan usage at ${pause.percentUsed}%: nothing to save here, so this session does not ` +
        `wake by itself at ${resumeAt}; /usage-guard arm 5h|week sets it to. /usage-guard cancel skips the ` +
        'automatic resume of the sessions that saved work.',
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
  live.compactAfterTurn = pause
  if (await hasCommand($, 'session-close')) {
    void $.command.run({ command: 'session-close', args: WRAP_UP_ARGS }).catch(() => undefined)
  } else {
    void $.prompt
      .submit({ text: `[usage-guard] ${WRAP_UP_ARGS} Work resumes automatically at ${resumeAt}.` })
      .catch(() => undefined)
  }
}

// Measured against the compaction window, as the context meter is; the model's whole window stands in
// when the engine reports none. The plain summary is estimated locally and costs nothing.
async function readFill($: EngineInterface): Promise<Fill | undefined> {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const size = context.breakdown?.rawMaxTokens ?? context.window
    if (context.tokens === undefined || !size) return undefined
    return { tokens: context.tokens, percent: Math.round((context.tokens / size) * 100) }
  } catch {
    return undefined
  }
}

// Never from a command or a turn's own hook, which the engine refuses: always from a timer after it. The
// engine also refuses while a turn runs; that refusal, like a hook's veto, is reported. How it went is a
// note in the transcript, and /usage-guard repeats it, since a note may not reach every surface.
async function compactNow($: EngineInterface): Promise<CompactOutcome> {
  let outcome: CompactOutcome
  try {
    outcome = outcomeOf(await $.session.compact({ instructions: PAUSE_INSTRUCTIONS }))
  } catch (err) {
    outcome = { kind: 'not-run', reason: err instanceof Error ? err.message : String(err) }
  }
  live.lastCompaction = `${localTime(await $.clock.now())}: ${outcomeText(outcome)}`
  await notice($, outcomeText(outcome))
  return outcome
}

// The wrap-up's turn has ended: a session that resumes by itself compacts now, while its cache is warm,
// so the resume after the reset starts from the summary instead of reading the whole context cold.
// Only this work session gets here; the setting and the time to the wake decide whether it is worth it.
async function compactAtPause($: EngineInterface, owed: Pause): Promise<void> {
  const pause = await readPause($)
  if (pause?.status !== 'active' || resetKey(pause) !== resetKey(owed)) return
  if (!shouldCompactAtPause(await readFill($), live.compactAbovePercent, pause.wakeAt, await $.clock.now())) return
  const outcome = await compactNow($)
  setStatus($, `Plan limit near: paused until ${localTime(pause.wakeAt)} · ${outcomeMark(outcome)}`)
}

// Taken before the turn's own wrap-up starts, so a wrap-up started at this turn's end waits for its own.
function scheduleOwedCompaction($: EngineInterface): void {
  const owed = live.compactAfterTurn
  if (!owed) return
  live.compactAfterTurn = undefined
  $.clock.after(COMPACT_DELAY_MS, () => void compactAtPause($, owed).catch(() => undefined))
}

async function resume($: EngineInterface, resetsAt: string, isArmed = false): Promise<void> {
  // Read first: an arm for this reset counts even if its own timer clears it while this one runs.
  const isArmedHere = isArmed || (await read($, armedWake))?.resetsAt === resetsAt
  const pause = await readPause($)
  if (!pause || pause.resetsAt !== resetsAt || pause.status === 'cancelled') return
  // Each session resumes once per reset, even when an instance left by a hot reload still runs its own
  // timer beside this one. The shared `done` status cannot be the claim: every session resumes.
  const won = await tryClaim($, `resume-${resetKey(pause)}-${await $.session.id()}`)
  if (won === false) return
  if (pause.status === 'active') await writePause($, { ...pause, status: 'done' })
  setStatus($, undefined)
  await showCard($, `reset:${resetsAt}`, 'Plan limits have reset. Sessions are resuming their saved work.')
  // Fails closed: with no resume claim on disk, an instance a hot reload left beside this one could
  // win it too, and find the work claim this one's question made.
  if (won === null) return notice($, UNCONFIRMED_NOTICE)
  // Only a session that saved work, or one armed, goes on by itself. Another session in the project
  // would rebuild the same hand-off and work the same tasks beside it, with nobody watching either.
  const work = isArmedHere || (await hadWork($, pause))
  if (work === null) return notice($, UNCONFIRMED_NOTICE)
  // Worded as what is on record, not what happened: a wrap-up whose own claim failed before a hot
  // reload, or one before a /clear, saved work that left no claim under this session's id.
  if (!work) return notice($, NO_WORK_NOTICE)
  await resumeWork($, 'Plan limits have reset: resuming the saved work.')
}

// A wrap-up with work leaves a claim (this instance remembers it as handled, another finds it taken).
// Asking makes the claim for a session without one, which is harmless: only a session whose resume
// claim is on disk asks, so no other instance gets this far for it.
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
  // An instance left by a hot reload may fire the same arm beside this one: one wins the claim. With no
  // claim on disk the other could win it too, so a failed helper resumes nothing (fails closed).
  const won = await tryClaim($, `arm-${Date.parse(arm.resetsAt)}-${await $.session.id()}`)
  if (won === false) return
  // The arm stays set until the resume has run, so the pause's own timer, firing beside this one, sees it.
  const isPauseReset = pause && pause.resetsAt === arm.resetsAt && pause.status !== 'cancelled'
  if (won === null) await notice($, UNCONFIRMED_NOTICE)
  else if (isPauseReset) await resume($, arm.resetsAt, true)
  else await resumeWork($, `The ${LIMIT_NAMES[arm.kind]} reset you armed for has passed: resuming the saved work.`)
  // Cleared only if still this arm: the person may have set another while the resume ran.
  const now = await read($, armedWake)
  if (now?.resetsAt === arm.resetsAt && now.kind === arm.kind) await setArm($, null)
}

async function setArm($: EngineInterface, arm: ArmedWake | null): Promise<void> {
  await update($, armedWake, () => arm)
}

// The open tasks in this session's list, from the tasks mod's copy: none when that mod keeps lists but
// none for this session. Undefined without the tasks mod, or when the list cannot be read.
async function openTasks($: EngineInterface): Promise<number | undefined> {
  const dir = (await dataDir($)).replace(/usage-guard$/, 'tasks')
  try {
    await $.fs.list(dir)
  } catch {
    return undefined
  }
  try {
    return countOpenTasks(String(await $.fs.read(`${dir}/${await $.session.id()}.json`)))
  } catch {
    return 0
  }
}

// An arm with nothing pending is still set, since the person asked for it, but says so and asks: a card
// above the prompt where there is one, and the answer itself names the command for a surface without it.
// `compact`: the person asked for it, so it runs whatever the context's size or the time to the wake.
async function armByHand($: EngineInterface, which: string, option: string): Promise<string> {
  if (option !== '' && option !== 'compact')
    return `Unknown option "${option}". Use: /usage-guard arm 5h|week [compact]`
  const { rateLimits } = await $.session.usage()
  const planned = planArm(rateLimits, which, live.delayMinutes, await $.clock.now())
  if (typeof planned === 'string') return planned
  const isEmpty = (await openTasks($)) === 0
  await setArm($, isEmpty ? { ...planned, isQuestioned: true } : planned)
  await scheduleArm($, planned)
  const lines = [
    `Armed: this session resumes its saved work at ${localTime(planned.wakeAt)}, after the ` +
      `${LIMIT_NAMES[planned.kind]} reset. /usage-guard disarm cancels it.`,
  ]
  if (isEmpty) lines.push(EMPTY_ARM_NOTE)
  if (option === 'compact') {
    $.clock.after(COMPACT_DELAY_MS, () => void compactNow($).catch(() => undefined))
    lines.push('Compacting this session in a moment; /usage-guard then says how it went.')
  }
  return lines.join('\n')
}

// The card's Keep: the arm stands, and the question goes.
async function keepArm($: EngineInterface): Promise<void> {
  const current = await read($, armedWake)
  if (current?.isQuestioned) await setArm($, { ...current, isQuestioned: false })
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
  await showCard($, `paused:${pause.resetsAt}`, pausedText(pause, localTime(pause.wakeAt)))
  await notice(
    $,
    `Plan limits are nearly used up (${limitName(pause)} at ${pause.percentUsed}%). Work resumes at ` +
      `${localTime(pause.wakeAt)}: a session with saved work then goes on by itself, and one with nothing ` +
      `on record is told. To skip the automatic resume, run /usage-guard cancel.`,
  )
}

// What shows above the prompt: the shared card every session draws (pause, resume, cancel), then this
// session's own question about an arm set with nothing pending.
async function cardsAbove($: EngineInterface): Promise<Card[]> {
  const cards: Card[] = []
  const shown = await read($, band)
  if (shown?.card) {
    const buttons: CardButton[] = [
      { key: 'usage-dismiss', label: 'Dismiss', isPrimary: true, onPress: () => dismissCard($) },
    ]
    if (shown.canCancel) {
      const label = 'Cancel auto-resume (all sessions)'
      buttons.push({ key: 'usage-cancel', label, onPress: () => cancelFromCard($) })
    }
    cards.push({ key: 'usage-card', tone: cardTone(shown.card.id), text: shown.card.text, buttons })
  }
  const arm = await read($, armedWake)
  if (arm?.isQuestioned) {
    const text = questionText(localTime(arm.wakeAt))
    const buttons: CardButton[] = [
      { key: 'usage-arm-keep', label: 'Keep it', isPrimary: true, onPress: () => keepArm($) },
      { key: 'usage-arm-cancel', label: 'Cancel the resume', onPress: () => disarm($) },
    ]
    cards.push({ key: 'usage-arm-question', tone: 'yellow', text, buttons })
  }
  return cards
}

export const register: Register = (on, options) => {
  live.wrapUpAt = Number(options.wrapUpAt ?? 90)
  live.delayMinutes = Number(options.wakeDelayMinutes ?? 2)
  live.compactAbovePercent = Number(options.compactAbovePercent ?? 25)
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

  // The cards: the same bordered look as shared-pc's, drawn above whatever the
  // other mods draw there. Each stays until it is answered or dismissed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    const cards = await cardsAbove($)
    if (cards.length === 0) return inner
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(30, Math.min(64, e.props.bodyColumns - 2))
    return (
      <Box flexDirection="column">
        {cards.map(card => (
          <Box
            key={card.key}
            alignSelf="flex-end"
            width={width}
            flexDirection="column"
            borderStyle="double"
            borderColor={card.tone}
            backgroundColor="black"
            paddingX={1}
          >
            <Text bold color="black" backgroundColor={card.tone}>
              {' USAGE GUARD '}
            </Text>
            <Text bold color={card.tone} wrap="wrap">
              {card.text}
            </Text>
            <Box>
              {card.buttons.map(({ key, label, isPrimary, onPress }) =>
                isPrimary ? (
                  <Button key={key} label={label} variant="primary" onPress={onPress} />
                ) : (
                  <Button key={key} label={label} onPress={onPress} />
                ),
              )}
            </Box>
          </Box>
        ))}
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
    if (!result.deny && !result.isError && result.isReadOnly !== true) live.workSession = await $.session.id()
    return result
  })

  on('turn.complete', async ($, e, next) => {
    live.isTurnRunning = false
    const result = await next(e)
    scheduleOwedCompaction($)
    await runPendingWrapUp($).catch(() => undefined)
    await check($).catch(() => undefined)
    return result
  })

  on('command.run', { command: 'usage-guard' }, async ($, e) => ({ text: await runCommand($, e.args) }))
}

async function registerSurface($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'usage-guard',
    description: 'Usage pause status. Also: cancel, arm 5h|week [compact] (resume after that reset), disarm, settings',
    argumentHint: ARGUMENT_HINT,
  })
}

// `/usage-guard [help | settings | arm 5h|week [compact] | disarm | cancel]`; with no argument, the status.
async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [verb = '', which = '', option = ''] = args.trim().split(/\s+/)
  if (verb === 'help') return HELP
  if (verb === 'settings') {
    await $.ui.open({ id: SETTINGS_PANE, title: 'Usage guard settings', focus: true })
    return 'Opened the usage-guard settings.'
  }
  if (verb === 'arm') return armByHand($, which, option)
  if (verb === 'disarm') return disarm($)
  const arm = await read($, armedWake)
  const armedText = arm ? ` Armed to resume at ${localTime(arm.wakeAt)}.` : ''
  const compacted = live.lastCompaction ? `\nLast compaction, ${live.lastCompaction}` : ''
  const pause = await readPause($)
  if (!pause || pause.status !== 'active')
    return `No usage pause. Sessions wrap up at ${live.wrapUpAt}% of any plan window.${armedText}${compacted}`
  if (verb === 'cancel') {
    await cancelPause($, pause)
    return 'Usage pause cancelled: no automatic resume.'
  }
  const resumes = `Resumes at ${localTime(pause.wakeAt)}.`
  return `Paused: ${limitName(pause)} at ${pause.percentUsed}%. ${resumes}${armedText}${compacted}`
}
