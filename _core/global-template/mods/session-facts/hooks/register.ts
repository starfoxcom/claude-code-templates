import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { Budgets, CacheCheck } from '../types'
import { compactedMark, contextText, phoneText, registerBudgetsView } from './budgets'
import {
  checkCache,
  IDLE_COMPACT_MIN_TOKENS,
  idleCompactAt,
  idleCompactMin,
  isIdleCompactDue,
  nextLifetime,
  parseMemory,
  PREPARE_DIR,
  READ_CACHE_LINES,
  writtenLifetime,
} from './cache'
import type { SharedPlan } from './plan'
import { parseSharedPlan, planPart, SHARED_PLAN_FILE, sharedPlanText } from './plan'
import { applyFile, register as settings, SETTINGS_PANE } from './settings'

// The hooks run in a sandbox with no time zone of its own, so the host's
// UTC offset and zone name are read once per load and again every hour
// (travel, a DST change). The compaction window is read live from the engine
// at each prompt.
const HOUR_MS = 60 * 60 * 1000
const READ_ZONE = [
  'node',
  '-e',
  'console.log(new Date().getTimezoneOffset() + " " + Intl.DateTimeFormat().resolvedOptions().timeZone)',
]

type Zone = { offsetMinutes: number; name: string }
type Window = { size: number; compactsAt?: number }
type Compaction = { at: number }

const UTC: Zone = { offsetMinutes: 0, name: 'UTC (host zone unread)' }

const HINT = '[help | settings | set | phone]'
export const HELP = [
  '/session-facts: the budgets row (context, plan usage, cache) and the time and budgets line on every prompt.',
  '  /session-facts settings  open the settings pane',
  '  /session-facts set       change a setting: set <name> <value>; alone, list them',
  '  /session-facts phone     the same as text, for phone chats',
  '  /session-facts help      this list',
].join('\n')

async function readZone($: EngineInterface): Promise<Zone> {
  try {
    const { exitCode, stdout } = await $.process.run(READ_ZONE, { timeoutMs: 10_000 })
    const [offset, name] = stdout.trim().split(' ')
    const offsetMinutes = Number(offset)
    if (exitCode !== 0 || !Number.isFinite(offsetMinutes) || !name) return UTC
    return { offsetMinutes, name }
  } catch {
    return UTC
  }
}

// The compaction window is what the app's context meter measures against.
async function readWindow($: EngineInterface): Promise<Window | undefined> {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const breakdown = context.breakdown
    if (!breakdown) return undefined
    return { size: breakdown.rawMaxTokens, compactsAt: breakdown.autoCompactThreshold }
  } catch {
    return undefined
  }
}

function formatLocal(nowMs: number, zone: Zone): string {
  const local = new Date(nowMs - zone.offsetMinutes * 60_000)
  return `${local.toISOString().slice(0, 19).replace('T', ' ')} ${zone.name}`
}

// The budgets row's figures, its bar drawn as colored squares since the State line copied from
// this is read on the phone. Until the first response after a compaction the fill is unknown: the
// compaction's own size counts only the kept messages, never the system prompt, tools and rules every
// request carries, so it read far below the real fill (4% for a real 27%, 2026-10-04).
function contextPart(tokens: number | undefined, fullWindow: number, now: number): { text: string; isKnown: boolean } {
  const fill = tokens
  const text = contextText(fill, live.window?.size ?? fullWindow, live.window?.compactsAt, true)
  const mark = compactedMark(live.compaction?.at, live.zone.offsetMinutes, now)
  const unknown = fill === undefined ? ' (unknown until the first response of this window)' : ''
  return { text: text + mark + unknown, isKnown: fill !== undefined }
}

// `isPartial`: a figure is unknown or borrowed, so a later line in the same turn can do better.
type FactsLine = { text: string; isPartial: boolean }

// While the compaction is still finishing, the engine's fill can be the one from before it.
async function factsLine($: EngineInterface, isCompacting = false): Promise<FactsLine> {
  const now = await $.clock.now()
  const time = formatLocal(now, live.zone)
  try {
    const { context, rateLimits } = await $.session.usage()
    const ctx = contextPart(isCompacting ? undefined : context.tokens, context.window, now)
    const borrowedAt = live.sharedPlan && formatLocal(live.sharedPlan.at, live.zone).slice(11, 16)
    const plan = planPart(rateLimits, live.hasReplied, live.sharedPlan, borrowedAt)
    return { text: `${time} | ${ctx.text}${plan.text}`, isPartial: !ctx.isKnown || !plan.isOwn }
  } catch {
    return { text: `${time} | ctx unreadable`, isPartial: true }
  }
}

// The newest figures another session recorded, read while this one has none of its own.
async function loadSharedPlan($: EngineInterface): Promise<void> {
  if (!dataDir || live.hasReplied) return
  const text = String(await $.fs.read(`${dataDir}/${SHARED_PLAN_FILE}`).catch(() => ''))
  live.sharedPlan = parseSharedPlan(text, await $.clock.now())
}

// This session's own figures, for the next fresh session to borrow.
async function saveSharedPlan($: EngineInterface): Promise<void> {
  if (!dataDir) return
  try {
    const { rateLimits } = await $.session.usage()
    if (rateLimits.length === 0) return
    await $.fs.write(`${dataDir}/${SHARED_PLAN_FILE}`, sharedPlanText(rateLimits, await $.clock.now()))
  } catch {
    // The next turn records them.
  }
}

const BUDGETS_EVERY_MS = 5_000
// How old the newest facts line gets in a long turn before a tool result carries a newer one.
const REFRESH_LINE_AFTER_MS = 10 * 60_000
const DEFAULT_WRAP_UP_AT = 90

// The budgets row (budgets.tsx) reads this; each file names the state with its own literal reference.
const budgets = atom({ plugin: 'session-facts', key: 'budgets' } as const, null)

const live: {
  zone: Zone
  window?: Window
  isSetUp: boolean
  lastResponseAt?: number
  // A response came in this process (the remembered `lastResponseAt` may be from before it).
  hasReplied: boolean
  // The main conversation's last compaction.
  compaction?: Compaction
  planWarnAt: number
  cacheWarnMinutes: number
  // The configured cache lifetime, and the one the countdown runs on (5 min once a miss proves it).
  cacheTtlMs: number
  cacheLifetimeMs: number
  // The lifetime came from the transcript: the guess from misses no longer moves it.
  isLifetimeRead: boolean
  cacheCheck?: CacheCheck
  // The context size Claude Code's idle compaction starts at.
  idleCompactMinTokens: number
  // The reply the mod's own idle compaction last ran for: once per reply.
  idleTriedFor?: number
  // The model of the last response and whether a compaction ran since: either starts the cache over.
  lastModel?: string
  isWindowFresh: boolean
  // Another session's plan figures, borrowed until this one replies.
  sharedPlan?: SharedPlan
  // When the newest facts line went out, and whether it had a figure to improve on.
  lastLine?: { at: number; isPartial: boolean }
} = {
  zone: UTC,
  isSetUp: false,
  planWarnAt: 75,
  cacheWarnMinutes: 10,
  cacheTtlMs: 60 * 60_000,
  cacheLifetimeMs: 60 * 60_000,
  isLifetimeRead: false,
  idleCompactMinTokens: IDLE_COMPACT_MIN_TOKENS,
  hasReplied: false,
  isWindowFresh: false,
}

// usage-guard's own threshold, so the row turns red where the guard steps in.
async function readWrapUpAt($: EngineInterface): Promise<number> {
  try {
    const configs = (await $.settings.read()).pluginConfigs as Record<string, { options?: { wrapUpAt?: unknown } }>
    return Number(configs?.['usage-guard']?.options?.wrapUpAt) || DEFAULT_WRAP_UP_AT
  } catch {
    return DEFAULT_WRAP_UP_AT
  }
}

async function readPausedUntil($: EngineInterface): Promise<number | undefined> {
  try {
    const configured = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    const file = `${configured ?? `${home}/.claude`}/mods-data/usage-guard/pause.json`.replaceAll('\\', '/')
    const pause = JSON.parse(String(await $.fs.read(file))) as { status?: string; wakeAt?: number }
    return pause.status === 'active' ? pause.wakeAt : undefined
  } catch {
    return undefined
  }
}

// The countdown runs from the last response. A compaction since then starts the cache over by design,
// so the countdown waits for the next response.
function cacheTimes(tokens: number | undefined): Pick<Budgets, 'cacheExpiresAt' | 'idleCompactAt'> {
  if (live.lastResponseAt === undefined || live.isWindowFresh) return {}
  const { lastResponseAt, cacheLifetimeMs } = live
  return {
    cacheExpiresAt: lastResponseAt + cacheLifetimeMs,
    idleCompactAt: idleCompactAt(lastResponseAt, cacheLifetimeMs, tokens, live.idleCompactMinTokens),
  }
}

async function refreshBudgets($: EngineInterface): Promise<void> {
  try {
    const [{ context, rateLimits }, wrapUpAt, pausedUntil] = await Promise.all([
      $.session.usage(),
      readWrapUpAt($),
      readPausedUntil($),
    ])
    const next: Budgets = {
      tokens: context.tokens,
      size: live.window?.size ?? context.window,
      compactsAt: live.window?.compactsAt,
      compactedAt: live.compaction?.at,
      limits: rateLimits.map(limit => ({
        kind: limit.kind,
        percentUsed: limit.percentUsed,
        resetsAt: limit.resetsAt ? Date.parse(limit.resetsAt) : undefined,
      })),
      ...cacheTimes(context.tokens),
      cacheCheck: live.cacheCheck,
      pausedUntil,
      offsetMinutes: live.zone.offsetMinutes,
      planWarnAt: live.planWarnAt,
      wrapUpAt,
      cacheWarnMinutes: live.cacheWarnMinutes,
    }
    await update($, budgets, () => next)
    await idleCompact($, next)
  } catch {
    // The row keeps its last reading.
  }
}

// Claude Code 2.1.293 no longer compacts an idle conversation itself (mods NOTES, 2026-10-07): a minute
// past its time, with no compaction since the last reply, the mod does, once per reply. The engine
// refuses it while a turn runs; the next reply then starts the count over.
async function idleCompact($: EngineInterface, shown: Budgets): Promise<void> {
  const { idleCompactAt: idleAt, cacheExpiresAt: expiresAt } = shown
  if (!isIdleCompactDue(await $.clock.now(), idleAt, expiresAt, live.lastResponseAt, live.idleTriedFor)) return
  live.idleTriedFor = live.lastResponseAt
  await $.session.compact().catch(() => undefined)
}

// The first request after a prompt is the one a cold cache makes pay for the whole conversation.
// `at` is when it was sent: the API judged the cache then, not once the reply was done.
function noteCache(usage: TurnUsage, at: number): void {
  const sinceLastMs = live.lastResponseAt === undefined ? undefined : at - live.lastResponseAt
  const isModelChange = live.lastModel !== undefined && live.lastModel !== usage.model
  const isFreshWindow = live.isWindowFresh || isModelChange
  const { cacheLifetimeMs: lifetimeMs, isLifetimeRead } = live
  live.cacheCheck = checkCache(usage, { at, sinceLastMs, lifetimeMs, isFreshWindow, isLifetimeRead })
  if (!live.isLifetimeRead)
    live.cacheLifetimeMs = nextLifetime(live.cacheCheck, sinceLastMs, live.cacheLifetimeMs, live.cacheTtlMs)
  live.lastModel = usage.model
  live.isWindowFresh = false
}

// The lifetime the API wrote the cache with, read off the transcript once the turn is on disk;
// the guess from misses stands while the transcript cannot be read.
async function readLifetime($: EngineInterface, transcript: string): Promise<void> {
  try {
    const { exitCode, stdout } = await $.process.run([...READ_CACHE_LINES, transcript], { timeoutMs: 5_000 })
    const written = exitCode === 0 ? writtenLifetime(stdout) : undefined
    if (written === undefined) return
    live.cacheLifetimeMs = written
    live.isLifetimeRead = true
    await saveMemory($)
    await refreshBudgets($)
  } catch {
    // The countdown keeps the lifetime it had.
  }
}

// The mod's data folder and this session's cache memory in it; unknown until the folder is ready.
let dataDir: string | undefined
let memoryFile: string | undefined

async function prepareMemory($: EngineInterface): Promise<void> {
  try {
    const configured = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    const dir = `${configured ?? `${home}/.claude`}/mods-data/session-facts`.replaceAll('\\', '/')
    const id = await $.session.id()
    const { exitCode } = await $.process.run([...PREPARE_DIR, dir, id], { timeoutMs: 10_000 })
    if (exitCode !== 0) return
    dataDir = dir
    memoryFile = `${dir}/${id}.json`
  } catch {
    // The memory stays off; the countdown starts over after a reload, as before.
  }
}

// A reload forgets the last reply; without it the countdown hides and a break right after reads as
// a fresh start. So the facts the cache check needs are read back on set-up, when not already known.
async function restoreMemory($: EngineInterface): Promise<void> {
  if (!memoryFile || live.lastResponseAt !== undefined) return
  const saved = parseMemory(String(await $.fs.read(memoryFile).catch(() => '')))
  if (!saved) return
  live.lastResponseAt = saved.lastResponseAt
  live.cacheLifetimeMs = saved.lifetimeMs
  live.isLifetimeRead = saved.isLifetimeRead
  live.lastModel = saved.lastModel
  live.cacheCheck = saved.check
}

async function saveMemory($: EngineInterface): Promise<void> {
  if (!memoryFile || live.lastResponseAt === undefined) return
  const { lastResponseAt, cacheLifetimeMs: lifetimeMs, isLifetimeRead, lastModel, cacheCheck: check } = live
  const text = JSON.stringify({ lastResponseAt, lifetimeMs, isLifetimeRead, lastModel, check })
  await $.fs.write(memoryFile, text).catch(() => undefined)
}

// A hot reload starts the module over without a new session.start, so the
// first prompt after one sets up too.
async function setUp($: EngineInterface): Promise<void> {
  live.isSetUp = true
  // The settings file first, so a set-up after a reload never runs on the options the module loaded with.
  // One that cannot be read never costs the set-up: the loaded options stand.
  await readSettings($).catch(() => undefined)
  live.zone = await readZone($)
  live.window = await readWindow($)
  const idleMin = await $.env.get('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS').catch(() => undefined)
  live.idleCompactMinTokens = idleCompactMin(idleMin)
  await prepareMemory($)
  await restoreMemory($)
  await refreshBudgets($)
  $.clock.every(HOUR_MS, () => {
    void readZone($).then(read => {
      live.zone = read
    })
  })
  $.clock.every(BUDGETS_EVERY_MS, () => void refreshBudgets($))
}

// The settings file at set-up (the session's start, or the first prompt after a reload), before any tool
// call: the settings module follows it from there. Read here, since an engine handle is never passed into another file.
async function readSettings($: EngineInterface): Promise<void> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const file = await $.fs.read(`${config}/mods-data/session-facts/settings.json`.replace(/\\/g, '/')).catch(() => '')
  const manifest = (dir: string) => $.fs.read(`${$.plugin.root}${dir}/plugin.json`)
  applyFile(String(file), String(await manifest('/.claude-plugin').catch(() => manifest('').catch(() => ''))))
}

export const register: Register = (on, options) => {
  registerBudgetsView(on)
  // The settings come from the mod's own file over the loaded options, read again as it changes.
  settings(on, options, values => {
    live.planWarnAt = Number(values.planWarnAt ?? 75)
    live.cacheWarnMinutes = Number(values.cacheWarnMinutes ?? 10)
    const ttlMs = Number(values.cacheTtlMinutes ?? 60) * 60_000
    // A new TTL starts the countdown over until a response tells the session's own lifetime. The file is
    // applied again every minute: an unchanged TTL leaves a lifetime the responses already pointed to.
    if (ttlMs !== live.cacheTtlMs && !live.isLifetimeRead) live.cacheLifetimeMs = ttlMs
    live.cacheTtlMs = ttlMs
  })

  on('session.start', async ($, e, next) => {
    const description = 'The budgets row and the facts line on every prompt'
    await $.command.register({ name: 'session-facts', description, argumentHint: HINT }).catch(() => undefined)
    await setUp($)
    return next(e)
  })

  // `/session-facts [help | settings | phone]`; any other argument, or none, gets the help.
  on('command.run', { command: 'session-facts' }, async ($, e) => {
    // Typed with no word over Remote Control (the phone, the web, Desktop viewing a CLI session), where no
    // row draws: the bare command answers with the phone text.
    const verb = e.args.trim() || (e.origin?.kind === 'bridge' ? 'phone' : '')
    if (verb === 'phone') {
      await refreshBudgets($)
      const shown = await read($, budgets)
      const text = shown ? phoneText(shown, await $.clock.now()) : 'The budgets are not read yet.'
      return { text: `${text}\n/session-facts help for more` }
    }
    if (verb !== 'settings') return { text: HELP }
    await $.ui.open({ id: SETTINGS_PANE, title: 'Session facts settings', focus: true })
    return { text: 'Opened the session-facts settings.' }
  })

  // A Desktop session starts with no surface; the row fills in once the app attaches.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (!live.isSetUp) await setUp($)
    else await refreshBudgets($)
    return result
  })

  // The main conversation's turn is over and written down; a subagent stops through SubagentStop.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.transcript_path) void readLifetime($, e.transcript_path)
    return result
  })

  // Main's own requests only; a subagent keeps a cache of its own.
  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now()
    const result = yield* next(e)
    if (e.agentId === undefined && e.index === 0 && result.usage) noteCache(result.usage, sentAt)
    return result
  })

  // A compaction later in a turn starts the cache over for that turn only; by its end the cache is warm.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    live.isWindowFresh = false
    live.hasReplied = true
    live.lastResponseAt = await $.clock.now()
    live.sharedPlan = undefined
    await saveMemory($)
    await saveSharedPlan($)
    await refreshBudgets($)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (!live.isSetUp) await setUp($)
    // Settings can change mid-session; the fresh reading lands next prompt.
    void readWindow($).then(read => {
      live.window = read ?? live.window
    })
    void refreshBudgets($)
    await loadSharedPlan($)
    const line = await factsLine($)
    live.lastLine = { at: await $.clock.now(), isPartial: line.isPartial }
    const fact =
      `[session-facts] ${line.text} | ` + 'base every time-of-day reference and every State line figure on THIS line'
    return next({ ...e, context: [...(e.context ?? []), fact] })
  })

  // The prompt's line is read before the first response; a fresh session's has no figures of its own,
  // and in a long turn its time falls behind. So once the figures are in, or the line is a while old,
  // a newer one rides on the next tool result of main's turn.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || 'deny' in result || !live.lastLine) return result
    const now = await $.clock.now()
    const isOld = now - live.lastLine.at >= REFRESH_LINE_AFTER_MS
    if (!live.lastLine.isPartial && !isOld) return result
    const line = await factsLine($)
    if (line.isPartial && !isOld) return result
    live.lastLine = { at: now, isPartial: line.isPartial }
    const fact = `[session-facts] ${line.text} | newer than the prompt's line: base the State line on THIS line`
    return { ...result, context: [...(result.context ?? []), fact] }
  })

  // The turn that compacts goes on with no prompt and so no facts line, so one
  // follows the summary; the row and later lines carry the mark for a quarter hour.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute') return result
    // `skip` tells the two result shapes apart: past it, the result is a compaction that
    // stands, whose `messages` the types guarantee.
    if (result.skip !== undefined || result.messages.length === 0) return result
    live.compaction = { at: await $.clock.now() }
    live.isWindowFresh = true
    const line = await factsLine($, true)
    live.lastLine = { at: live.compaction.at, isPartial: line.isPartial }
    const fact =
      `[session-facts] ${line.text} | ` +
      'every figure in the summary above is from before the compaction; base the State line on THIS line'
    const [summary, rest] = [result.messages.slice(0, 1), result.messages.slice(1)]
    return { ...result, messages: [...summary, { role: 'user', text: fact, toolUses: [] }, ...rest] }
  })
}
