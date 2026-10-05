import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ArmedWake, UsageCard } from '../types'
import { catchUpOf, caughtUpText, missedArmText, parseSavedArm, quietResumePrompt, quietResumeText } from './arms'
import type { CompactOutcome, Fill } from './compact'
import { measured, outcomeMark, outcomeOf, outcomeText, PAUSE_INSTRUCTIONS, shouldCompactAtPause } from './compact'
import type { Pause } from './plan'
import { CLAIM, countOpenTasks, covers, EMPTY_ARM_NOTE, hotLimits, joinPause, LIMIT_NAMES, limitName } from './plan'
import { NO_WORK_NOTICE, planArm, planPause, projectOf, resetKey, resumePrompt, WRAP_UP_ARGS } from './plan'
import { stopCommandsFor } from './rules'
import { drawArmLine, drawCards } from './cards'
import { register as phone } from './phone'
import { applyFile, register as settings, SETTINGS_PANE } from './settings'
import type { Card, CardButton } from './texts'
import { applyValues, type Live, newLive } from './live'
import { ARGUMENT_HINT, armLineText, CANCELLED_TEXT, cardTone, formatLocal, HELP, pausedText } from './texts'
import { questionText, READ_ZONE, UNCONFIRMED_NOTICE, zoneOf } from './texts'

const CHECK_EVERY_MS = 60_000
// A beat after a command or the wrap-up's turn ends before compacting, so the engine is between turns.
const COMPACT_DELAY_MS = 1_000
// How often the card above the prompt re-reads the shared files, so a Dismiss
// or a cancel in one session shows in the others.
const REFRESH_MS = 2_000
const MKDIR_SCRIPT = 'require("fs").mkdirSync(process.argv[1],{recursive:true})'
const band = atom({ plugin: 'usage-guard', key: 'band' } as const, null)
const armedWake = atom({ plugin: 'usage-guard', key: 'armed' } as const, null)
const armNote = atom({ plugin: 'usage-guard', key: 'armNote' } as const, null)
// Module state (its type in live.ts): a hot reload starts it over, which is safe because the pause
// itself lives in the shared file.
const live: Live = newLive()

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
async function compactNow($: EngineInterface, pausedUntil?: string): Promise<CompactOutcome> {
  const before = (await readFill($))?.tokens
  let outcome: CompactOutcome
  try {
    outcome = outcomeOf(await $.session.compact({ instructions: PAUSE_INSTRUCTIONS }), before)
  } catch (err) {
    outcome = { kind: 'not-run', reason: err instanceof Error ? err.message : String(err) }
  }
  live.measuring = outcome.kind === 'measuring' ? { before: outcome.before, pausedUntil } : undefined
  await reportCompaction($, outcome)
  return outcome
}

async function reportCompaction($: EngineInterface, outcome: CompactOutcome): Promise<void> {
  live.lastCompaction = `${localTime(await $.clock.now())}: ${outcomeText(outcome)}`
  await notice($, outcomeText(outcome))
}

// The first reply after a compaction carries its real size: only then is it called freed or not.
async function measureCompaction($: EngineInterface): Promise<void> {
  const pending = live.measuring
  const after = pending && (await readFill($))?.tokens
  if (!pending || after === undefined) return
  live.measuring = undefined
  if (pending.before === undefined) return
  const outcome = measured(pending.before, after)
  await reportCompaction($, outcome)
  if (pending.pausedUntil && live.isStatusShown)
    setStatus($, `Plan limit near: paused until ${pending.pausedUntil} · ${outcomeMark(outcome)}`)
}

// The wrap-up's turn has ended: a session that resumes by itself compacts now, while its cache is warm,
// so the resume after the reset starts from the summary instead of reading the whole context cold.
// Only this work session gets here; the setting and the time to the wake decide whether it is worth it.
async function compactAtPause($: EngineInterface, owed: Pause): Promise<void> {
  const pause = await readPause($)
  if (pause?.status !== 'active' || resetKey(pause) !== resetKey(owed)) return
  if (!shouldCompactAtPause(await readFill($), live.compactAbovePercent, pause.wakeAt, await $.clock.now())) return
  const outcome = await compactNow($, localTime(pause.wakeAt))
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
  const held = await read($, armedWake)
  const isArmedHere = isArmed || held?.resetsAt === resetsAt
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
  const work = await hadWork($, pause)
  const text = 'Plan limits have reset: resuming the saved work.'
  if (work === true) return resumeWork($, text)
  if (isArmedHere) return resumeArmed($, limitName(pause), text, held?.armedIn)
  if (work === null) return notice($, UNCONFIRMED_NOTICE)
  // Worded as what is on record, not what happened: a wrap-up whose own claim failed before a hot
  // reload, or one before a /clear, saved work that left no claim under this session's id.
  return notice($, NO_WORK_NOTICE)
}

// An armed session goes on with its work, or, with nothing pending, only says so: the person asked for
// the wake-up, and a full resume would rebuild a hand-off for no work. A /clear starts an empty task
// list, so the list of the session the arm was set in counts too. Callers pass it: the arm may be gone.
async function resumeArmed($: EngineInterface, limit: string, text: string, armedIn?: string): Promise<void> {
  if ((await openTasks($)) !== 0 || (armedIn && (await openTasks($, armedIn)) !== 0)) return resumeWork($, text)
  await notice($, quietResumeText(limit))
  void $.prompt.submit({ text: quietResumePrompt(limit) }).catch(() => undefined)
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
    // From the arm as it stands, not as this timer was set: its question, its sessions are kept.
    const later: ArmedWake = { ...current, resetsAt: pause.resetsAt, wakeAt: pause.wakeAt }
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
  else {
    const limit = LIMIT_NAMES[arm.kind] ?? arm.kind
    const text = `The ${limit} reset you armed for has passed: resuming the saved work.`
    await resumeArmed($, limit, text, current.armedIn)
  }
  // Cleared only if still this arm: the person may have set another while the resume ran.
  const now = await read($, armedWake)
  if (now?.resetsAt === arm.resetsAt && now.kind === arm.kind) await setArm($, null)
}

// The arm in plugin state names the session its saved copy is filed under. A hot reload keeps that state
// while it starts this module over, and a /clear changes the id, so every save and move reads the file
// from the arm itself: the copy under an earlier id is always the one cleared. An arm whose save failed
// keeps naming the earlier file while that may still hold it, so the next save or disarm clears it.
async function setArm($: EngineInterface, arm: ArmedWake | null): Promise<void> {
  const before = await read($, armedWake)
  const filed = arm && { ...arm, session: await $.session.id() }
  await update($, armedWake, () => filed)
  const isSaved = await saveArm($, filed, before?.session)
  if (isSaved || !filed || !before?.session) return
  const isSame = (now: ArmedWake | null) => now?.session === filed.session && now.wakeAt === filed.wakeAt
  await update($, armedWake, now => (now && isSame(now) ? { ...now, session: before.session } : now))
}

async function armPath($: EngineInterface, sessionId?: string): Promise<string> {
  return `${await dataDir($)}/arms/${sessionId ?? (await $.session.id())}.json`
}

// False when a write failed, never a throw: the arm still stands in this process. The earlier copy is
// cleared first, in the folder that already holds it, so a failed folder check never leaves it live.
async function saveArm($: EngineInterface, arm: ArmedWake | null, earlier?: string): Promise<boolean> {
  try {
    if (!arm) return (await $.fs.write(await armPath($, earlier), 'null'), true)
    if (earlier && earlier !== arm.session) await $.fs.write(await armPath($, earlier), 'null')
    if (!live.isArmsDirMade) {
      const made = await $.process.run(['node', '-e', MKDIR_SCRIPT, `${await dataDir($)}/arms`], { timeoutMs: 10_000 })
      live.isArmsDirMade = made.exitCode === 0
      if (!live.isArmsDirMade) return false // Tried again at the next save.
    }
    await $.fs.write(await armPath($, arm.session), JSON.stringify(arm, null, 2))
    return true
  } catch {
    return false
  }
}

// A /clear moves the session to a new id with no session.start: the saved copy follows the standing arm
// there (the classic SessionStart hook sees the new id; the next turn or minute check catch a miss), so a
// restart that resumes the newest conversation still finds it.
async function followSession($: EngineInterface, sessionId?: string): Promise<void> {
  const arm = await read($, armedWake)
  const current = sessionId ?? (await $.session.id())
  if (!arm?.session || arm.session === current) return
  // State moves only once the copy has: a failed save is tried again by the next turn or minute check.
  const moved = { ...arm, session: current }
  if (!(await saveArm($, moved, arm.session))) return
  await update($, armedWake, now => (now?.session === arm.session ? moved : now))
}

// A session started again (a restart, a resume) finds the arm it saved: scheduled again, caught up
// within the setting's window, or dropped with a note. A hot reload keeps the arm in state instead.
async function restoreArm($: EngineInterface): Promise<ArmedWake | undefined> {
  const text = await $.fs.read(await armPath($)).catch(() => '')
  const parsed = parseSavedArm(String(text))
  if (!parsed) return undefined
  const saved = { ...parsed, session: await $.session.id() }
  const limit = LIMIT_NAMES[saved.kind] ?? saved.kind
  const action = catchUpOf(saved.wakeAt, await $.clock.now(), live.catchUpMinutes)
  if (action === 'drop') {
    await setArm($, null)
    await notice($, missedArmText(limit, localTime(saved.wakeAt), live.catchUpMinutes))
    return undefined
  }
  await update($, armedWake, () => saved)
  if (action === 'fire') await notice($, caughtUpText(limit, localTime(saved.wakeAt)))
  return saved
}

// The open tasks in a session's list (this one's by default), from the tasks mod's copy: none when that
// mod keeps lists but none for the session. Undefined without the tasks mod, or when the list cannot be read.
async function openTasks($: EngineInterface, sessionId?: string): Promise<number | undefined> {
  const dir = (await dataDir($)).replace(/usage-guard$/, 'tasks')
  try {
    await $.fs.list(dir)
  } catch {
    return undefined
  }
  try {
    return countOpenTasks(String(await $.fs.read(`${dir}/${sessionId ?? (await $.session.id())}.json`)))
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
  const base = { ...planned, armedIn: await $.session.id() }
  const arm = isEmpty ? { ...base, isQuestioned: true } : base
  await setArm($, arm)
  await scheduleArm($, arm)
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
// A press always answers: the card turns into a one-line confirmation, and the same line is a note in
// the transcript for a surface that draws no card.
async function keepArm($: EngineInterface): Promise<void> {
  const current = await read($, armedWake)
  if (!current?.isQuestioned) return
  await setArm($, { ...current, isQuestioned: false })
  await confirmPress($, `Kept: this session resumes at ${localTime(current.wakeAt)}.`)
}

async function cancelFromArmCard($: EngineInterface): Promise<void> {
  await confirmPress($, await disarm($))
}

async function confirmPress($: EngineInterface, text: string): Promise<void> {
  await update($, armNote, () => text)
  await notice($, text)
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
  await readSettings($)
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
    await claim($, `pause-${resetKey(planned)}`)
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

// The settings file, for what runs before any prompt (a start, a reload) and each check: see settings.tsx.
async function readSettings($: EngineInterface): Promise<void> {
  const file = await $.fs.read(`${await dataDir($)}/settings.json`).catch(() => '')
  const manifest = (dir: string) => $.fs.read(`${$.plugin.root}${dir}/plugin.json`)
  applyFile(String(file), String(await manifest('/.claude-plugin').catch(() => manifest('').catch(() => ''))))
}

// The time zone and the two timers (pause check, shared card refresh), once per module load.
async function startTimers($: EngineInterface): Promise<void> {
  if (live.isStarted) return
  live.isStarted = true
  await readSettings($)
  await readZone($)
  await refresh($)
  const pause = await readPause($)
  if (pause?.status === 'active' && pause.wakeAt > (await $.clock.now())) await act($, pause)
  // A wake armed before a hot reload: the module's timer went with the old instance. Before a restart:
  // the state went with the process, and the saved arm stands in.
  const arm = (await read($, armedWake)) ?? (await restoreArm($))
  if (arm) await scheduleArm($, arm)
  $.clock.every(CHECK_EVERY_MS, () => void followSession($).then(() => check($)).catch(() => undefined))
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
      { key: 'usage-arm-cancel', label: 'Cancel the resume', onPress: () => cancelFromArmCard($) },
    ]
    cards.push({ key: 'usage-arm-question', tone: 'yellow', text, buttons })
  }
  const note = await read($, armNote)
  if (note) {
    const clear = () => update($, armNote, () => null)
    const dismiss = { key: 'usage-arm-note-dismiss', label: 'Dismiss', isPrimary: true, onPress: clear }
    cards.push({ key: 'usage-arm-note', tone: 'blue', text: note, buttons: [dismiss] })
  }
  return cards
}

// The slim line while an arm stands, so a scheduled wake is never out of sight. It gives way to the arm's
// own question and to the shared pause card, which already say when the session resumes.
async function armLine($: EngineInterface): Promise<string | undefined> {
  const arm = await read($, armedWake)
  if (!arm || arm.isQuestioned || (await read($, band))?.card) return undefined
  return armLineText(arm.wakeAt, arm.kind, live.zone)
}

export const register: Register = (on, options) => {
  // The settings come from the mod's own file over the loaded options, read again as it changes.
  settings(on, options, values => applyValues(live, values))
  phone(on, options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await readZone($)
    const pause = await readPause($)
    if (pause?.status === 'active') await meetPause($, pause)
    // The timers (and with them a saved arm) first: a refused command must never cost the arm's wake,
    // and a start after a reload may find /usage-guard already registered.
    await startTimers($)
    await registerSurface($).catch(() => undefined)
    return result
  })

  // The cards, drawn above whatever the other mods draw there, each staying until it is answered or
  // dismissed; then, under those mods' rows, the slim line of a standing arm.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    const cards = await cardsAbove($)
    const line = await armLine($)
    if (cards.length === 0 && !line) return inner
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const width = Math.max(30, Math.min(64, e.props.bodyColumns - 2))
    return (
      <Box flexDirection="column">
        {drawCards(ui, cards, width)}
        {inner}
        {line ? drawArmLine(ui, line, () => cancelFromArmCard($)) : null}
      </Box>
    )
  })

  on('turn.start', async ($, e, next) => {
    live.isTurnRunning = true
    // A hot reload starts the module over without a session.start: the first turn after it restarts
    // the timers and reads the time zone again.
    await startTimers($).catch(() => undefined)
    await followSession($).catch(() => undefined)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') await followSession($, e.session_id).catch(() => undefined)
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
    // Taken before anything below can start a wrap-up: a compaction owed by one runs after its own turn.
    scheduleOwedCompaction($)
    // A reload in the middle of a turn: the turn's start ran in the module before it, so its end restarts
    // the timers, or a saved arm would wait idle past its wake.
    await startTimers($).catch(() => undefined)
    await measureCompaction($).catch(() => undefined)
    await runPendingWrapUp($).catch(() => undefined)
    await check($).catch(() => undefined)
    return result
  })

  // A hot reload while idle leaves no turn to restart the timers: the command does, so its answer (and a
  // disarm) sees the arm restored from its saved copy, and the arm's timer runs again.
  on('command.run', { command: 'usage-guard' }, async ($, e) => {
    await startTimers($).catch(() => undefined)
    return { text: await runCommand($, e.args) }
  })
}

async function registerSurface($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'usage-guard',
    description:
      'Usage pause status. Also: cancel, arm 5h|week [compact] (resume after that reset), disarm, settings, set',
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
