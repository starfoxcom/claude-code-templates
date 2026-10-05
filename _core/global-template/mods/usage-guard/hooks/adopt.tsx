import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AdoptOffer } from '../types'
import { adoptReason, offerText, parseSavedArm, pickOffer } from './arms'
import { drawCards } from './cards'
import { CLAIM, LIMIT_NAMES, resumePrompt } from './plan'
import type { Card } from './texts'
import { formatLocal, READ_ZONE, type Zone, zoneOf } from './texts'

// A session armed to resume (/usage-guard arm) that was closed before its wake never resumes: its arm
// waits in mods-data/usage-guard/arms/<session>.json. A later session in the same project offers it on a
// card above the prompt (and through `/usage-guard adopt` where no card draws). Never by itself: the
// person decides whether the closed session's work goes on here.

// Looked for every 15 minutes, from a timer started by an event (a card hook stays pure, starting
// nothing): an offer waits on the person anyway, and a session start always looks at once.
const SCAN_EVERY_MS = 15 * 60_000
const state = atom({ plugin: 'usage-guard', key: 'adopt' } as const, null)
const scan = { isTimed: false, zone: undefined as Zone | undefined }

async function dataDir($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/usage-guard`.replace(/\\/g, '/')
}

async function wakeText($: EngineInterface, offer: AdoptOffer): Promise<string> {
  if (!scan.zone) {
    const run = await $.process.run(READ_ZONE, { timeoutMs: 10_000 }).catch(() => undefined)
    scan.zone = (run?.exitCode === 0 ? zoneOf(run.stdout) : undefined) ?? { offsetMinutes: 0, name: 'UTC' }
  }
  return formatLocal(offer.arm.wakeAt, scan.zone)
}

// The offer and its card text; an answered one (a note shown) is left alone until its Dismiss, or until
// a command asks (`isAsked`): the command answers with the note itself, and where no card draws (the
// phone) nothing else would ever clear it.
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
  if (!offer) return void (await update($, state, () => null))
  const text = offerText(LIMIT_NAMES[offer.arm.kind] ?? offer.arm.kind, await wakeText($, offer))
  await update($, state, () => ({ offer, text, note: null }))
}

// Once per module load: a session's start or a surface joining, or the first tool call after a hot reload.
function startScans($: EngineInterface): void {
  if (scan.isTimed) return
  scan.isTimed = true
  const tick = () => void lookForOffer($).catch(() => undefined)
  $.clock.after(0, tick)
  $.clock.every(SCAN_EVERY_MS, tick)
}

// One resume per arm across sessions: the claim is the one the arm's own session takes when its wake
// fires, so a session that was only asleep, not closed, never resumes it a second time.
async function claimArm($: EngineInterface, offer: AdoptOffer): Promise<boolean | null> {
  const name = `arm-${Date.parse(offer.arm.resetsAt)}-${offer.owner}`.replace(/[^\w-]/g, '_')
  try {
    const run = await $.process.run(['node', '-e', CLAIM, await dataDir($), name], { timeoutMs: 10_000 })
    return run.exitCode === 0 ? run.stdout.trim() !== 'taken' : null
  } catch {
    return null
  }
}

// The offer may be a minute old: its session may have come back and set the arm again, or moved it to a
// later reset. Only the arm still saved as offered is claimed or dropped; anything else is left alone.
// The arm is then cleared where it was saved, so its own session, started again, finds nothing to run.
async function answer($: EngineInterface, isAdopted: boolean): Promise<string> {
  const offer = (await read($, state))?.offer
  if (!offer) return 'No closed session in this project has a missed resume.'
  const limit = LIMIT_NAMES[offer.arm.kind] ?? offer.arm.kind
  const when = await wakeText($, offer)
  const file = `${await dataDir($)}/arms/${offer.owner}.json`
  const saved = parseSavedArm(String(await $.fs.read(file).catch(() => '')))
  const isSame = saved?.resetsAt === offer.arm.resetsAt && saved.wakeAt === offer.arm.wakeAt
  const won = !isSame ? undefined : isAdopted ? await claimArm($, offer) : true
  let note = 'Dropped: that resume will not be offered again.'
  if (!isSame) note = 'That resume changed meanwhile (its session came back or set it again): nothing was done.'
  else if (won === false) note = 'Another session already resumed that work.'
  else if (won === null) note = 'Could not confirm no other session resumed it, so it was not resumed here.'
  else if (isAdopted) note = 'Resuming the closed session’s work here.'
  if (won === true) await $.fs.write(file, 'null').catch(() => undefined)
  await update($, state, () => ({ offer: null, text: null, note }))
  // From a timer: a prompt submitted inside the command's own run never arrives.
  const text = resumePrompt(adoptReason(limit, when, offer.owner))
  if (isAdopted && won === true) $.clock.after(0, () => void $.prompt.submit({ text }).catch(() => undefined))
  return note
}

async function cards($: EngineInterface): Promise<Card[]> {
  const now = await read($, state)
  if (now?.note) {
    const clear = () => update($, state, () => null)
    const dismiss = { key: 'usage-adopt-ok', label: 'Dismiss', isPrimary: true, onPress: clear }
    return [{ key: 'usage-adopt-note', tone: 'blue', text: now.note, buttons: [dismiss] }]
  }
  if (!now?.offer || !now.text) return []
  const buttons = [
    { key: 'usage-adopt-yes', label: 'Resume it here', isPrimary: true, onPress: () => answer($, true) },
    { key: 'usage-adopt-drop', label: 'Drop it', onPress: () => answer($, false) },
  ]
  return [{ key: 'usage-adopt', tone: 'yellow', text: now.text, buttons }]
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

  // `/usage-guard adopt [drop]` where no card draws (the phone); every other word goes on down the chain,
  // after a look for an offer, so the phone text can name it.
  on('command.run', { command: 'usage-guard' }, async ($, e, next) => {
    const [verb, option] = e.args.trim().split(/\s+/)
    startScans($)
    await lookForOffer($, true).catch(() => undefined)
    if (verb !== 'adopt') return next(e)
    if (option && option !== 'drop') return { text: 'Use: /usage-guard adopt [drop]' }
    return { text: await answer($, option !== 'drop') }
  })
}
