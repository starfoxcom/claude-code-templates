import { atom, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, TurnUsage } from 'claude-code'

import type { Budgets, CacheCheck } from '../types'
import { compactedMark, contextText, registerBudgetsView } from './budgets'
import { checkCache, nextLifetime, parseMemory, PREPARE_DIR, READ_CACHE_LINES, writtenLifetime } from './cache'
import { register as settings, SETTINGS_PANE } from './settings'

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
type Compaction = { at: number; tokensAfter?: number }

const UTC: Zone = { offsetMinutes: 0, name: 'UTC (host zone unread)' }

const LIMIT_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'week' }

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
// this is read on the phone. Until the first response after a compaction the engine has no fill
// of its own; the compaction's size stands in.
function contextPart(tokens: number | undefined, fullWindow: number, now: number): string {
  const fill = tokens ?? live.compaction?.tokensAfter
  const text = contextText(fill, live.window?.size ?? fullWindow, live.window?.compactsAt, true)
  const mark = compactedMark(live.compaction?.at, live.zone.offsetMinutes, now)
  return fill === undefined ? `${text}${mark} (unknown until the first response of this window)` : text + mark
}

// A plan session learns its plan figures from its first response; until then the line says so.
// Past it, an empty list means the account has no plan windows (an API key), and the line, like
// the row, names none. A hot reload forgets the last response, so one more line may say unknown.
function planPart(limits: readonly SessionRateLimit[]): string {
  const isFresh = live.lastResponseAt === undefined
  if (limits.length === 0) return isFresh ? ' | plan used: unknown until the first response' : ''
  const parts = limits.map(limit => `${LIMIT_NAMES[limit.kind] ?? limit.kind.replace(/_/g, '-')} ${limit.percentUsed}%`)
  return ` | plan used: ${parts.join(', ')}`
}

// While the compaction is still finishing, the engine's fill can be the one from before it.
async function factsLine($: EngineInterface, isCompacting = false): Promise<string> {
  const now = await $.clock.now()
  const time = formatLocal(now, live.zone)
  try {
    const { context, rateLimits } = await $.session.usage()
    const ctx = contextPart(isCompacting ? undefined : context.tokens, context.window, now)
    return `${time} | ${ctx}${planPart(rateLimits)}`
  } catch {
    return `${time} | ctx unreadable`
  }
}

const BUDGETS_EVERY_MS = 5_000
const DEFAULT_WRAP_UP_AT = 90

// The budgets row (budgets.tsx) reads this; each file names the state with its own literal reference.
const budgets = atom({ plugin: 'session-facts', key: 'budgets' } as const, null)

const live: {
  zone: Zone
  window?: Window
  isSetUp: boolean
  lastResponseAt?: number
  // The main conversation's last compaction.
  compaction?: Compaction
  planWarnAt: number
  cacheWarnMinutes: number
  // The configured cache lifetime, and the one the countdown runs on (5 min once a miss proves it).
  cacheTtlMs: number
  cacheLifetimeMs: number
  cacheCheck?: CacheCheck
  // The model of the last response and whether a compaction ran since: either starts the cache over.
  lastModel?: string
  isWindowFresh: boolean
} = {
  zone: UTC,
  isSetUp: false,
  planWarnAt: 75,
  cacheWarnMinutes: 10,
  cacheTtlMs: 60 * 60_000,
  cacheLifetimeMs: 60 * 60_000,
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

async function refreshBudgets($: EngineInterface): Promise<void> {
  try {
    const [{ context, rateLimits }, wrapUpAt, pausedUntil] = await Promise.all([
      $.session.usage(),
      readWrapUpAt($),
      readPausedUntil($),
    ])
    const next: Budgets = {
      tokens: context.tokens ?? live.compaction?.tokensAfter,
      size: live.window?.size ?? context.window,
      compactsAt: live.window?.compactsAt,
      compactedAt: live.compaction?.at,
      limits: rateLimits.map(limit => ({
        kind: limit.kind,
        percentUsed: limit.percentUsed,
        resetsAt: limit.resetsAt ? Date.parse(limit.resetsAt) : undefined,
      })),
      cacheExpiresAt: live.lastResponseAt === undefined ? undefined : live.lastResponseAt + live.cacheLifetimeMs,
      cacheCheck: live.cacheCheck,
      pausedUntil,
      offsetMinutes: live.zone.offsetMinutes,
      planWarnAt: live.planWarnAt,
      wrapUpAt,
      cacheWarnMinutes: live.cacheWarnMinutes,
    }
    await update($, budgets, () => next)
  } catch {
    // The row keeps its last reading.
  }
}

// The first request after a prompt is the one a cold cache makes pay for the whole conversation.
// `at` is when it was sent: the API judged the cache then, not once the reply was done.
function noteCache(usage: TurnUsage, at: number): void {
  const sinceLastMs = live.lastResponseAt === undefined ? undefined : at - live.lastResponseAt
  const isModelChange = live.lastModel !== undefined && live.lastModel !== usage.model
  const isFreshWindow = live.isWindowFresh || isModelChange
  live.cacheCheck = checkCache(usage, { at, sinceLastMs, lifetimeMs: live.cacheLifetimeMs, isFreshWindow })
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
    await saveMemory($)
    await refreshBudgets($)
  } catch {
    // The countdown keeps the lifetime it had.
  }
}

// This session's cache memory, in the mods' data folder; unknown until the folder is ready.
let memoryFile: string | undefined

async function prepareMemory($: EngineInterface): Promise<void> {
  try {
    const configured = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    const dir = `${configured ?? `${home}/.claude`}/mods-data/session-facts`.replaceAll('\\', '/')
    const id = await $.session.id()
    const { exitCode } = await $.process.run([...PREPARE_DIR, dir, id], { timeoutMs: 10_000 })
    if (exitCode === 0) memoryFile = `${dir}/${id}.json`
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
  live.lastModel = saved.lastModel
  live.cacheCheck = saved.check
}

async function saveMemory($: EngineInterface): Promise<void> {
  if (!memoryFile || live.lastResponseAt === undefined) return
  const { lastResponseAt, cacheLifetimeMs: lifetimeMs, lastModel, cacheCheck: check } = live
  const text = JSON.stringify({ lastResponseAt, lifetimeMs, lastModel, check })
  await $.fs.write(memoryFile, text).catch(() => undefined)
}

// A hot reload starts the module over without a new session.start, so the
// first prompt after one sets up too.
async function setUp($: EngineInterface): Promise<void> {
  live.isSetUp = true
  live.zone = await readZone($)
  live.window = await readWindow($)
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

export const register: Register = (on, options) => {
  live.planWarnAt = Number(options.planWarnAt ?? 75)
  live.cacheWarnMinutes = Number(options.cacheWarnMinutes ?? 10)
  live.cacheTtlMs = Number(options.cacheTtlMinutes ?? 60) * 60_000
  live.cacheLifetimeMs = live.cacheTtlMs
  registerBudgetsView(on)
  settings(on, options)

  on('session.start', async ($, e, next) => {
    const description = 'Budgets row: /session-facts settings opens its settings'
    await $.command.register({ name: 'session-facts', description })
    await setUp($)
    return next(e)
  })

  on('command.run', { command: 'session-facts' }, async ($, e, next) => {
    if (e.args.trim() !== 'settings') return next(e)
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
    live.lastResponseAt = await $.clock.now()
    await saveMemory($)
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
    const fact =
      `[session-facts] ${await factsLine($)} | ` +
      'base every time-of-day reference and every State line figure on THIS line'
    return next({ ...e, context: [...(e.context ?? []), fact] })
  })

  // The turn that compacts goes on with no prompt and so no facts line, so one
  // follows the summary; the row and later lines carry the mark for a quarter hour.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute') return result
    // `skip` tells the two result shapes apart: past it, the result is a compaction that
    // stands, whose `messages` and `tokensAfter` the types guarantee.
    if (result.skip !== undefined || result.messages.length === 0) return result
    live.compaction = { at: await $.clock.now(), tokensAfter: result.tokensAfter }
    live.isWindowFresh = true
    const fact =
      `[session-facts] ${await factsLine($, true)} | ` +
      'every figure in the summary above is from before the compaction; base the State line on THIS line'
    const [summary, rest] = [result.messages.slice(0, 1), result.messages.slice(1)]
    return { ...result, messages: [...summary, { role: 'user', text: fact, toolUses: [] }, ...rest] }
  })
}
