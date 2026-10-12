import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AdoptOffer, SavedOffer, SavedWork } from '../types'
import { ADOPT_GRACE_MS, adoptReason, offerText, parseSavedArm, pickOffer } from './arms'
import { drawCards } from './cards'
import type { Pause } from './plan'
import { armFor, CLAIM, resumePrompt } from './plan'
import { keptReason, parseSaved, pickSaved, resumeClaim, SAVED_FILE, savedOfferText } from './saved'
import { shouldResumeOwn, takeOverReason, workClaims } from './saved'
import type { Card } from './texts'
import { formatLocal, READ_ZONE, type Zone, zoneOf } from './texts'

// A session armed to resume (/usage-guard arm) that was closed before its wake never resumes: its arm
// waits in mods-data/usage-guard/arms/<session>.json. Nor does one that saved its work at a pause's
// wrap-up and was closed before the reset: its record waits in its work claim (saved.ts). A later
// session in the same project offers either on a card above the prompt (and through
// `/usage-guard adopt` where no card draws). Never by itself: the person decides where the work goes on.

// Looked for every 15 minutes, from a timer started by an event (a card hook stays pure, starting
// nothing): an offer waits on the person anyway, and a session start always looks at once. A pause on
// the way adds one look just past its wake, so saved work its closed session missed shows at once.
const SCAN_EVERY_MS = 15 * 60_000
const state = atom({ plugin: 'usage-guard', key: 'adopt' } as const, null)
const scan = { isTimed: false, zone: undefined as Zone | undefined, lookAfter: 0 }
const NOTHING_OFFERED = 'No closed session in this project has a missed resume.'

type Choice = 'take' | 'keep' | 'drop'

async function dataDir($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/usage-guard`.replace(/\\/g, '/')
}

async function timeText($: EngineInterface, ms: number): Promise<string> {
  if (!scan.zone) {
    const run = await $.process.run(READ_ZONE, { timeoutMs: 10_000 }).catch(() => undefined)
    scan.zone = (run?.exitCode === 0 ? zoneOf(run.stdout) : undefined) ?? { offsetMinutes: 0, name: 'UTC' }
  }
  return formatLocal(ms, scan.zone)
}

async function readPause($: EngineInterface): Promise<Pause | undefined> {
  try {
    return JSON.parse(String(await $.fs.read(`${await dataDir($)}/pause.json`))) as Pause
  } catch {
    return undefined
  }
}

const savedPath = async ($: EngineInterface, record: SavedWork) =>
  `${await dataDir($)}/claims/work-${record.key}-${record.session}/${SAVED_FILE}`

// The work claims' saved records (this session's own, or every other session's), and every claim's name.
async function savedRecords($: EngineInterface, isOwn: boolean) {
  const dir = `${await dataDir($)}/claims`
  const names = new Set((await $.fs.list(dir).catch(() => [])).map(entry => entry.name))
  const me = await $.session.id()
  const records: SavedWork[] = []
  for (const { name, owner } of workClaims([...names])) {
    if ((owner === me) !== isOwn) continue
    const record = parseSaved(String(await $.fs.read(`${dir}/${name}/${SAVED_FILE}`).catch(() => '')))
    if (record) records.push(record)
  }
  return { records, names }
}

async function lookForSaved($: EngineInterface, now: number): Promise<SavedOffer | undefined> {
  const { records, names } = await savedRecords($, false)
  const context = { me: await $.session.id(), root: await $.session.root(), pause: await readPause($), now }
  return pickSaved(records, names, context)
}

// The offer and its card text; an answered one (a note shown) is left alone until its Dismiss, or until
// a command asks (`isAsked`): the command answers with the note itself, and where no card draws (the
// phone) nothing else would ever clear it. A missed arm comes first, then saved work.
async function lookForOffer($: EngineInterface, isAsked = false): Promise<void> {
  if (!isAsked && (await read($, state))?.note) return
  const now = await $.clock.now()
  const dir = `${await dataDir($)}/arms`
  const entries = await $.fs.list(dir).catch(() => [])
  const files: { name: string; text: string }[] = []
  for (const { name, kind } of entries) {
    if (kind !== 'file') continue
    files.push({ name, text: String(await $.fs.read(`${dir}/${name}`).catch(() => '')) })
  }
  const offer = pickOffer(files, await $.session.id(), await $.session.root(), now)
  if (offer) {
    const text = offerText(armFor(offer.arm.kind), await timeText($, offer.arm.wakeAt))
    return void (await update($, state, () => ({ offer, saved: null, text, note: null })))
  }
  const saved = await lookForSaved($, now)
  if (!saved) return void (await update($, state, () => null))
  const text = savedOfferText(saved.record, await timeText($, saved.dueAt))
  await update($, state, () => ({ offer: null, saved, text, note: null }))
}

// One more look just past a coming pause's wake, once per wake: the 15-minute scan alone could leave
// saved work its closed session missed waiting that long.
async function lookAfterWake($: EngineInterface): Promise<void> {
  const pause = await readPause($)
  const now = await $.clock.now()
  if (pause?.status !== 'active' || pause.wakeAt <= now || scan.lookAfter === pause.wakeAt) return
  scan.lookAfter = pause.wakeAt
  $.clock.after(pause.wakeAt - now + ADOPT_GRACE_MS + 1_000, () => void lookForOffer($).catch(() => undefined))
}

// Once per module load: a session's start or a surface joining, or the first tool call after a hot reload.
function startScans($: EngineInterface): void {
  if (scan.isTimed) return
  scan.isTimed = true
  const tick = () => void lookForOffer($).then(() => lookAfterWake($)).catch(() => undefined)
  $.clock.after(0, () => void resumeOwnKept($).catch(() => undefined))
  $.clock.after(0, tick)
  $.clock.every(SCAN_EVERY_MS, tick)
}

// One resume per piece of work across sessions: the arm's claim is the one its own session takes when
// its wake fires, saved work's the one the reset's resume takes, so a session that was only asleep, not
// closed, never resumes it a second time.
async function claimOnce($: EngineInterface, claim: string): Promise<boolean | null> {
  const name = claim.replace(/[^\w-]/g, '_')
  try {
    const run = await $.process.run(['node', '-e', CLAIM, await dataDir($), name], { timeoutMs: 10_000 })
    return run.exitCode === 0 ? run.stdout.trim() !== 'taken' : null
  } catch {
    return null
  }
}

// From a timer: a prompt submitted inside the command's own run never arrives.
function submitLater($: EngineInterface, reason: string): void {
  const text = resumePrompt(reason)
  $.clock.after(0, () => void $.prompt.submit({ text }).catch(() => undefined))
}

// This session's own saved work, kept for it while it was closed: opened again, it resumes it.
async function resumeOwnKept($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const pause = await readPause($)
  const { records } = await savedRecords($, true)
  const kept = records.find(record => shouldResumeOwn(record, pause, now))
  if (!kept || (await claimOnce($, resumeClaim(kept))) !== true) return
  await $.fs.write(await savedPath($, kept), 'null').catch(() => undefined)
  submitLater($, keptReason(await timeText($, kept.wakeAt)))
}

// The offer may be a minute old: its session may have come back and set the arm again, or moved it to a
// later reset. Only the arm still saved as offered is claimed or dropped; anything else is left alone.
// The arm is then cleared where it was saved, so its own session, started again, finds nothing to run.
async function answerArm($: EngineInterface, offer: AdoptOffer, isAdopted: boolean): Promise<string> {
  const when = await timeText($, offer.arm.wakeAt)
  const file = `${await dataDir($)}/arms/${offer.owner}.json`
  const saved = parseSavedArm(String(await $.fs.read(file).catch(() => '')))
  const isSame = saved?.resetsAt === offer.arm.resetsAt && saved.wakeAt === offer.arm.wakeAt
  const claim = `arm-${Date.parse(offer.arm.resetsAt)}-${offer.owner}`
  const won = !isSame ? undefined : isAdopted ? await claimOnce($, claim) : true
  let note = 'Dropped: that resume will not be offered again.'
  if (!isSame) note = 'That resume changed meanwhile (its session came back or set it again): nothing was done.'
  else if (won === false) note = 'Another session already resumed that work.'
  else if (won === null) note = 'Could not confirm no other session resumed it, so it was not resumed here.'
  else if (isAdopted) note = 'Resuming the closed session’s work here.'
  if (won === true) await $.fs.write(file, 'null').catch(() => undefined)
  if (isAdopted && won === true)
    submitLater($, adoptReason(armFor(offer.arm.kind), when, offer.owner, offer.arm.reason))
  return note
}

// Saved work as offered, unless it was kept, taken or dropped meanwhile. Keep marks it for its own
// session; take claims its one resume and runs it here; drop clears it, so nothing resumes it.
async function answerSaved($: EngineInterface, offer: SavedOffer, choice: Choice): Promise<string> {
  const file = await savedPath($, offer.record)
  const now = parseSaved(String(await $.fs.read(file).catch(() => '')))
  if (!now || now.isKept || now.wakeAt !== offer.record.wakeAt)
    return 'That saved work changed meanwhile (kept, taken or dropped elsewhere): nothing was done.'
  if (choice === 'keep') {
    await $.fs.write(file, JSON.stringify({ ...now, isKept: true }, null, 2))
    return 'Kept: that session resumes the work when you open it again.'
  }
  if (choice === 'drop') {
    await $.fs.write(file, 'null')
    return 'Dropped: that saved work will not be offered or resumed again.'
  }
  const won = await claimOnce($, resumeClaim(now))
  if (won === false) return 'Another session already resumed that work.'
  if (won === null) return 'Could not confirm no other session resumed it, so it was not taken over here.'
  await $.fs.write(file, 'null').catch(() => undefined)
  submitLater($, takeOverReason(now, await timeText($, offer.dueAt)))
  return 'Taking the closed session’s work over here.'
}

async function answer($: EngineInterface, choice: Choice): Promise<string> {
  const shown = await read($, state)
  let note = NOTHING_OFFERED
  if (shown?.offer) {
    if (choice === 'keep') return 'Keep is for saved work. Use: /usage-guard adopt [drop]'
    note = await answerArm($, shown.offer, choice === 'take')
  } else if (shown?.saved) {
    note = await answerSaved($, shown.saved, choice).catch(() => 'Could not update that saved work: nothing was done.')
  } else return note
  await update($, state, () => ({ offer: null, saved: null, text: null, note }))
  return note
}

async function cards($: EngineInterface): Promise<Card[]> {
  const now = await read($, state)
  if (now?.note) {
    // The next offer, if any, shows once this answer is dismissed.
    const clear = () => update($, state, () => null).then(() => lookForOffer($))
    const dismiss = { key: 'usage-adopt-ok', label: 'Dismiss', isPrimary: true, onPress: clear }
    return [{ key: 'usage-adopt-note', tone: 'blue', text: now.note, buttons: [dismiss] }]
  }
  if (!now?.text || !(now.offer || now.saved)) return []
  const drop = { key: 'usage-adopt-drop', label: 'Drop it', onPress: () => answer($, 'drop') }
  if (now.offer) {
    const yes = { key: 'usage-adopt-yes', label: 'Resume it here', isPrimary: true, onPress: () => answer($, 'take') }
    return [{ key: 'usage-adopt', tone: 'yellow', text: now.text, buttons: [yes, drop] }]
  }
  const take = { key: 'usage-adopt-take', label: 'Take it here', isPrimary: true, onPress: () => answer($, 'take') }
  const keep = { key: 'usage-adopt-keep', label: 'Keep it there', onPress: () => answer($, 'keep') }
  return [{ key: 'usage-adopt', tone: 'yellow', text: now.text, buttons: [take, keep, drop] }]
}

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    const shown = await cards($)
    if (shown.length === 0) return inner
    const ui = $.ui.resolve(e)
    const width = Math.max(30, Math.min(64, e.props.bodyColumns - 2))
    return (
      <ui.Box flexDirection="column">
        {drawCards(ui, shown, width)}
        {inner}
      </ui.Box>
    )
  })

  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e)
    startScans($)
    return result
  })

  // Desktop, the editor and the phone app start like an SDK session; their surface joins afterwards.
  on('session.attach', { surface: ['desktop', 'vscode', 'mobile'] }, async ($, e, next) => {
    const result = await next(e)
    startScans($)
    return result
  })

  // A hot reload starts the module over without a session.start: the next common tool call starts it.
  on('tool.call', { tool: ['Bash', 'PowerShell', 'Read', 'Edit', 'Write', 'Grep', 'Glob'] }, async ($, e, next) => {
    const result = await next(e)
    startScans($)
    return result
  })

  // `/usage-guard adopt [keep | drop]` where no card draws (the phone); every other word goes on down the
  // chain, after a look for an offer, so the phone text can name it.
  on('command.run', { command: 'usage-guard' }, async ($, e, next) => {
    const [verb, option] = e.args.trim().split(/\s+/)
    startScans($)
    await lookForOffer($, true).catch(() => undefined)
    if (verb !== 'adopt') return next(e)
    if (option && option !== 'drop' && option !== 'keep') return { text: 'Use: /usage-guard adopt [keep | drop]' }
    return { text: await answer($, (option as Choice | undefined) ?? 'take') }
  })
}
