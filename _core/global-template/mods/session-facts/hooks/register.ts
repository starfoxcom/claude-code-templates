import { atom, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Budgets } from '../types'
import { registerBudgetsView } from './budgets'
import { register as settings, SETTINGS_PANE } from './settings'

// The hooks run in a sandbox with no time zone of its own, so the host's
// UTC offset and zone name are read once per load and again every hour
// (travel, a DST change). The compaction window is read live from the engine
// at each prompt and shared with the status line through a small per-session
// file, since the status line's own input does not carry it.
const HOUR_MS = 60 * 60 * 1000
const READ_ZONE = [
  'node',
  '-e',
  'console.log(new Date().getTimezoneOffset() + " " + Intl.DateTimeFormat().resolvedOptions().timeZone)',
]

type Zone = { offsetMinutes: number; name: string }
type Window = { size: number; compactsAt?: number }

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

// The engine's fs makes no missing folders, so the data folder is made through node, once per load.
export const MKDIR_SCRIPT = 'require("fs").mkdirSync(process.argv[1],{recursive:true})'
const madeDirs = new Set<string>()
async function ensureDir($: EngineInterface, dir: string): Promise<void> {
  if (madeDirs.has(dir)) return
  const { exitCode } = await $.process.run(['node', '-e', MKDIR_SCRIPT, dir], { timeoutMs: 10_000 })
  if (exitCode === 0) madeDirs.add(dir)
}

async function shareWindow($: EngineInterface, window: Window | undefined): Promise<void> {
  if (!window) return
  try {
    const configured = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    const dir = `${configured ?? `${home}/.claude`}/mods-data/session-facts`.replaceAll('\\', '/')
    await ensureDir($, dir)
    await $.fs.write(`${dir}/${await $.session.id()}.json`, JSON.stringify(window))
  } catch {
    // The status line falls back to settings when the file is missing.
  }
}

function formatLocal(nowMs: number, zone: Zone): string {
  const local = new Date(nowMs - zone.offsetMinutes * 60_000)
  return `${local.toISOString().slice(0, 19).replace('T', ' ')} ${zone.name}`
}

function thousands(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}

function contextPart(tokens: number | undefined, fullWindow: number, window: Window | undefined): string {
  if (tokens === undefined) return 'ctx unknown until the first response of this window'
  const size = window?.size ?? fullWindow
  const percent = Math.round((tokens / size) * 100)
  const compacts = window?.compactsAt ? `; auto-compacts at ${thousands(window.compactsAt)}` : ''
  return `ctx ${percent}% (${thousands(tokens)} of ${thousands(size)}${compacts})`
}

function planPart(limits: readonly SessionRateLimit[]): string {
  if (limits.length === 0) return ''
  const parts = limits.map(limit => `${LIMIT_NAMES[limit.kind] ?? limit.kind.replace(/_/g, '-')} ${limit.percentUsed}%`)
  return ` | plan used: ${parts.join(', ')}`
}

async function factsLine($: EngineInterface, zone: Zone, window: Window | undefined): Promise<string> {
  const time = formatLocal(await $.clock.now(), zone)
  try {
    const { context, rateLimits } = await $.session.usage()
    return `${time} | ${contextPart(context.tokens, context.window, window)}${planPart(rateLimits)}`
  } catch {
    return `${time} | ctx unreadable`
  }
}

const BUDGETS_EVERY_MS = 30_000
const DEFAULT_WRAP_UP_AT = 90

// The budgets row (budgets.tsx) reads this; each file names the state with its own literal reference.
const budgets = atom({ plugin: 'session-facts', key: 'budgets' } as const, null)

const live: {
  zone: Zone
  window?: Window
  isSetUp: boolean
  lastResponseAt?: number
  planWarnAt: number
  cacheWarnMinutes: number
  cacheTtlMs: number
} = { zone: UTC, isSetUp: false, planWarnAt: 75, cacheWarnMinutes: 10, cacheTtlMs: 60 * 60_000 }

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
      tokens: context.tokens,
      size: live.window?.size ?? context.window,
      compactsAt: live.window?.compactsAt,
      limits: rateLimits.map(limit => ({
        kind: limit.kind,
        percentUsed: limit.percentUsed,
        resetsAt: limit.resetsAt ? Date.parse(limit.resetsAt) : undefined,
      })),
      cacheExpiresAt: live.lastResponseAt === undefined ? undefined : live.lastResponseAt + live.cacheTtlMs,
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

// A hot reload starts the module over without a new session.start, so the
// first prompt after one sets up too.
async function setUp($: EngineInterface): Promise<void> {
  live.isSetUp = true
  live.zone = await readZone($)
  live.window = await readWindow($)
  await shareWindow($, live.window)
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

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    live.lastResponseAt = await $.clock.now()
    await refreshBudgets($)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (!live.isSetUp) await setUp($)
    // Settings can change mid-session; the fresh reading lands next prompt.
    void readWindow($).then(async read => {
      live.window = read ?? live.window
      await shareWindow($, live.window)
    })
    void refreshBudgets($)
    const fact =
      `[session-facts] ${await factsLine($, live.zone, live.window)} | ` +
      'base every time-of-day reference and every State line figure on THIS line'
    return next({ ...e, context: [...(e.context ?? []), fact] })
  })
}
