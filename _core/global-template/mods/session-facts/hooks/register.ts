import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

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

async function shareWindow($: EngineInterface, window: Window | undefined): Promise<void> {
  if (!window) return
  try {
    const configured = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    const dir = `${configured ?? `${home}/.claude`}/mods-data/session-facts`.replaceAll('\\', '/')
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

const live: { zone: Zone; window?: Window; isSetUp: boolean } = { zone: UTC, isSetUp: false }

// A hot reload starts the module over without a new session.start, so the
// first prompt after one sets up too.
async function setUp($: EngineInterface): Promise<void> {
  live.isSetUp = true
  live.zone = await readZone($)
  live.window = await readWindow($)
  await shareWindow($, live.window)
  $.clock.every(HOUR_MS, () => {
    void readZone($).then(read => {
      live.zone = read
    })
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setUp($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!live.isSetUp) await setUp($)
    // Settings can change mid-session; the fresh reading lands next prompt.
    void readWindow($).then(async read => {
      live.window = read ?? live.window
      await shareWindow($, live.window)
    })
    const fact =
      `[session-facts] ${await factsLine($, live.zone, live.window)} | ` +
      'base every time-of-day reference and every State line figure on THIS line'
    return next({ ...e, context: [...(e.context ?? []), fact] })
  })
}
