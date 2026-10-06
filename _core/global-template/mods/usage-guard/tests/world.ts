import type { On, SessionCompactResult, SessionContextUsage, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import type { Pause } from '../hooks/plan'
import { CLAIM } from '../hooks/plan'

// The faked engine every usage-guard hook test runs in, and the helpers that read it.

// The shipped stop list is empty, and the mod under test loads its own copy of rules.ts, so the
// lookup is tested on its own below and the hook tests check that only the zone probe ran.
export const stopsRun = (seen: World) => seen.runs.filter(argv => argv[0] !== 'node')

// 2026-10-02 17:00 UTC; the 5-hour window resets at 19:00 UTC.
export const NOW = Date.UTC(2026, 9, 2, 17, 0, 0)
export const RESET = '2026-10-02T19:00:00.000Z'
export const WAKE = Date.parse(RESET) + 2 * 60_000
export const PAUSE_FILE = 'C:/Users/me/.claude/mods-data/usage-guard/pause.json'
export const CARD_FILE = 'C:/Users/me/.claude/mods-data/usage-guard/card.json'
export const TASKS_DIR = 'C:/Users/me/.claude/mods-data/tasks'
export const ARMS_DIR = 'C:/Users/me/.claude/mods-data/usage-guard/arms'
export const ARM_FILE = `${ARMS_DIR}/sess-a.json`
export const KEY = String(Date.parse(RESET))
export const SUMMARY = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

export type World = {
  files: Map<string, string>
  runs: string[][]
  commands: { command: string; args?: string }[]
  prompts: string[]
  clock: ReturnType<typeof mock.clock>
  limits: SessionRateLimit[]
  /** The claim folders the helper made (`mkdir` wins once per name). */
  claims: Set<string>
  sessionId: string
  /** Runs as a claim is made: another session acting meanwhile. */
  duringClaim?: (name: string) => void
  /** Claims whose helper fails (exits non-zero) and writes nothing. */
  failClaims?: Set<string>
  context: SessionContextUsage
  /** The instructions of each compaction asked for. */
  compactions: (string | undefined)[]
  /** What a compaction answers; an Error makes the engine refuse it. */
  compactResult: SessionCompactResult | Error
  /** Every text the status line was given, undefined for a cleared one. */
  statuses: (string | undefined)[]
  /** The engine refuses the command's registration, as it may after a reload. */
  refuseRegister?: boolean
  /** The tasks mod keeps its lists here; without it the folder cannot be listed. */
  hasTasksMod?: boolean
  /** How many of the next attempts to make the arms folder fail; a write into it fails until one works. */
  mkdirFailures?: number
  /** The mod's manifest as the main module reads it beside its settings file; none by default. */
  manifest?: string
  isArmsDirMissing?: boolean
  /** Runs inside each file read, before it returns: something else acting while the mod waits on it. */
  duringRead?: (path: string) => unknown
}

export function world(on: On, root = 'C:/Repos/my-game'): World {
  const seen: World = {
    files: new Map(),
    runs: [],
    commands: [],
    prompts: [],
    clock: mock.clock(on, { now: NOW }),
    limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }],
    claims: new Set(),
    sessionId: 'sess-a',
    // 10% of a 1M compaction window: below the default 25%.
    context: { window: 1_000_000, tokens: 100_000, breakdown: { rawMaxTokens: 1_000_000 } as never },
    compactions: [],
    compactResult: { messages: SUMMARY, tokensBefore: 400_000, tokensAfter: 30_000 },
    statuses: [],
  }
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const key = (path: string) => path.replaceAll('\\', '/')
  on('fs.read', async ($, e) => {
    const isManifest = key(e.path).endsWith('/.claude-plugin/plugin.json')
    const text = isManifest ? seen.manifest : seen.files.get(key(e.path))
    await seen.duringRead?.(key(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.list', ($, e) => {
    // The saved arms, as files: what a later session in the project looks through for a missed one.
    if (key(e.path) === ARMS_DIR) {
      const inside = [...seen.files.keys()].filter(p => p.startsWith(`${ARMS_DIR}/`))
      const names = inside.map(p => p.slice(ARMS_DIR.length + 1))
      return { value: names.map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0 })) as never }
    }
    if (!seen.hasTasksMod || key(e.path) !== TASKS_DIR) throw new Error('ENOENT')
    return { value: [] as never }
  })
  on('fs.write', ($, e) => {
    if (seen.isArmsDirMissing && key(e.path).includes('/arms/')) throw new Error('ENOENT')
    seen.files.set(key(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => processRun(seen, e.argv))
  on('session.id', () => ({ value: seen.sessionId }))
  on('session.root', () => {
    return { value: root }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: seen.context, rateLimits: seen.limits } }))
  on('session.compact', ($, e) => {
    seen.compactions.push(e.instructions)
    if (seen.compactResult instanceof Error) throw seen.compactResult
    return seen.compactResult
  })
  on('command.list', () => ({
    value: [
      { name: 'session-close', description: '', source: 'user' },
      { name: 'session-start', description: '', source: 'user' },
    ],
  }))
  on('command.register', ($, e) => {
    if (seen.refuseRegister) throw new Error('already registered')
    registered.push(e)
    return { value: { command: e.name } as never }
  })
  on('command.run', ($, e) => {
    seen.commands.push({ command: e.command, args: e.args })
    return {}
  })
  on('tool.register', ($, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__usage-guard__${e.name}` } as never }
  })
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', () => {
    throw new Error('usage-guard must not use the toast')
  })
  on('ui.status', ($, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  // What core draws above the prompt; the card draws above it.
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  // Core's shape: an edit carries no read-only mark; a read carries isReadOnly: true.
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: {} as never, isReadOnly: true }) as never)
  return seen
}

// The engine's process runner as the mod uses it: the time zone, the claim helper and the arms folder.
function processRun(seen: World, argv: readonly string[]) {
  seen.runs.push([...argv])
  let out = argv[0] === 'node' ? '420 America/Phoenix\n' : ''
  if (argv[0] === 'node' && String(argv[2]).includes('mkdirSync')) {
    seen.isArmsDirMissing = (seen.mkdirFailures ?? 0) > 0
    if (seen.isArmsDirMissing) {
      seen.mkdirFailures = (seen.mkdirFailures ?? 0) - 1
      const failed = { exitCode: 1, stdout: '', stderr: 'EPERM', isStdoutTruncated: false, isStderrTruncated: false }
      return { value: failed }
    }
  }
  if (argv[2] === CLAIM) {
    const name = argv[4] ?? ''
    seen.duringClaim?.(name)
    if (seen.failClaims?.has(name)) {
      const failed = { exitCode: 1, stdout: '', stderr: 'EPERM', isStdoutTruncated: false, isStderrTruncated: false }
      return { value: failed }
    }
    out = seen.claims.has(name) ? 'taken\n' : 'won\n'
    seen.claims.add(name)
  }
  return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: 'C:/Repos/my-game', surface: 'terminal', isInteractive: true })
}

// A session only wraps up once it changed something.
export async function doWork($: Engine): Promise<void> {
  await $.tool.call({ tool: 'Edit', file_path: 'C:/Repos/my-game/a.txt', old_string: 'a', new_string: 'b' } as never)
}

export async function endTurn($: Engine): Promise<void> {
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
}

export function pauseOf(seen: World): Pause | undefined {
  const text = seen.files.get(PAUSE_FILE)
  return text === undefined ? undefined : (JSON.parse(text) as Pause)
}

// The resumes this session submitted: the automatic "continue now" prompt, never /session-start.
// An armed wake with nothing pending: one line, no work started.
export function quietWakes(seen: World): string[] {
  return seen.prompts.filter(text => text.startsWith('[usage-guard] ') && text.includes('wait for the person'))
}

export function resumes(seen: World): string[] {
  return seen.prompts.filter(text => text.startsWith('[usage-guard] ') && text.includes('Continue the pending work'))
}

export function cardOf(seen: World): { id: string; text: string; dismissed: boolean } | undefined {
  const text = seen.files.get(CARD_FILE)
  return text === undefined ? undefined : JSON.parse(text)
}

export async function mountCard($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({
    plugin: 'usage-guard',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never,
  })
}

export const registered: { name: string; argumentHint?: string }[] = []
/** The tools the mod registered, by short name. */
export const tools: string[] = []

// The test runner has timers; the mod sandbox's types do not list them.
declare function setTimeout(callback: () => void, ms: number): unknown

/** A short real wait: room for other work to go ahead (a bound, never what a test waits on to pass). */
export function moment(ms = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
