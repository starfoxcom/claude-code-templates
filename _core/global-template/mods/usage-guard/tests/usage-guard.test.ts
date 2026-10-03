import type { On, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import type { Pause } from '../hooks/register'
import { CLAIM, WRAP_UP_ARGS } from '../hooks/register'
import { STOP_COMMANDS, stopCommandsFor } from '../hooks/rules'

// The shipped stop list is empty, and the mod under test loads its own copy of rules.ts, so the
// lookup is tested on its own below and the hook tests check that only the zone probe ran.
const stopsRun = (seen: World) => seen.runs.filter(argv => argv[0] !== 'node')

// 2026-10-02 17:00 UTC; the 5-hour window resets at 19:00 UTC.
const NOW = Date.UTC(2026, 9, 2, 17, 0, 0)
const RESET = '2026-10-02T19:00:00.000Z'
const WAKE = Date.parse(RESET) + 2 * 60_000
const PAUSE_FILE = 'C:/Users/me/.claude/mods-data/usage-guard/pause.json'
const CARD_FILE = 'C:/Users/me/.claude/mods-data/usage-guard/card.json'
const KEY = String(Date.parse(RESET))

type World = {
  files: Map<string, string>
  runs: string[][]
  commands: { command: string; args?: string }[]
  prompts: string[]
  clock: ReturnType<typeof mock.clock>
  limits: SessionRateLimit[]
  /** The claim folders the helper made (`mkdir` wins once per name). */
  claims: Set<string>
  sessionId: string
  /** Times the stop commands were looked up (the shipped list is empty, so none run). */
  stopLookups: number
  /** Runs as a claim is made: another session acting meanwhile. */
  duringClaim?: (name: string) => void
}

function world(on: On, root = 'C:/Repos/my-game'): World {
  const seen: World = {
    files: new Map(),
    runs: [],
    commands: [],
    prompts: [],
    clock: mock.clock(on, { now: NOW }),
    limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }],
    claims: new Set(),
    sessionId: 'sess-a',
    stopLookups: 0,
  }
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  const key = (path: string) => path.replaceAll('\\', '/')
  on('fs.read', ($, e) => {
    const text = seen.files.get(key(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    seen.files.set(key(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    seen.runs.push([...e.argv])
    let out = e.argv[0] === 'node' ? '420 America/Phoenix\n' : ''
    if (e.argv[2] === CLAIM) {
      const name = e.argv[4] ?? ''
      seen.duringClaim?.(name)
      out = seen.claims.has(name) ? 'taken\n' : 'won\n'
      seen.claims.add(name)
    }
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: seen.sessionId }))
  on('session.root', () => {
    seen.stopLookups++
    return { value: root }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: seen.limits } }))
  on('command.list', () => ({
    value: [
      { name: 'session-close', description: '', source: 'user' },
      { name: 'session-start', description: '', source: 'user' },
    ],
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('command.run', ($, e) => {
    seen.commands.push({ command: e.command, args: e.args })
    return {}
  })
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', () => {
    throw new Error('usage-guard must not use the toast')
  })
  on('ui.status', () => ({ value: undefined }))
  // What core draws above the prompt; the card draws above it.
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  // Core's shape: an edit carries no read-only mark; a read carries isReadOnly: true.
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: {} as never, isReadOnly: true }) as never)
  return seen
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: 'C:/Repos/my-game', surface: 'terminal', isInteractive: true })
}

// A session only wraps up once it changed something.
async function doWork($: Engine): Promise<void> {
  await $.tool.call({ tool: 'Edit', file_path: 'C:/Repos/my-game/a.txt', old_string: 'a', new_string: 'b' } as never)
}

async function endTurn($: Engine): Promise<void> {
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
}

function pauseOf(seen: World): Pause | undefined {
  const text = seen.files.get(PAUSE_FILE)
  return text === undefined ? undefined : (JSON.parse(text) as Pause)
}

test('below the line nothing happens', async ($, on) => {
  const seen = world(on)
  await start($)
  await endTurn($)

  expect(pauseOf(seen)).toBeUndefined()
  expect(seen.commands).toEqual([])
})

test('crossing the line wraps up, stops background work and resumes after the reset', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)

  const pause = pauseOf(seen)
  expect(pause?.status).toBe('active')
  expect(pause?.wakeAt).toBe(WAKE)
  expect(seen.claims).toEqual(new Set([`pause-${KEY}`, `${KEY}-sess-a`]))
  expect(seen.stopLookups).toBe(1)
  expect(stopsRun(seen)).toEqual([])
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  expect(cardOf(seen)?.text).toContain('Fri 2026-10-02 12:02 (America/Phoenix)')

  await seen.clock.advance(WAKE - NOW)
  expect(seen.commands.at(-1)).toEqual({ command: 'session-start', args: '' })
  expect(pauseOf(seen)?.status).toBe('done')
})

test('another session sees the shared pause, wraps up once, leaves the stop commands to the first', async ($, on) => {
  const seen = world(on)
  await start($)
  const other: Pause = {
    status: 'active',
    kinds: ['seven_day'],
    percentUsed: 92,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(other))
  await doWork($)
  await seen.clock.advance(60_000)
  await endTurn($)

  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  expect(seen.stopLookups).toBe(0)
  expect(seen.claims).toEqual(new Set([`${KEY}-sess-a`]))
  expect(pauseOf(seen)).toEqual(other)
})

test('a session opened during a pause only waits, then resumes', async ($, on) => {
  const seen = world(on)
  const pause: Pause = {
    status: 'active',
    kinds: ['five_hour'],
    percentUsed: 93,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  await start($)

  expect(seen.commands).toEqual([])
  expect(cardOf(seen)?.text).toContain('Work resumes on its own at Fri 2026-10-02 12:02')
  await seen.clock.advance(WAKE - NOW)
  expect(seen.commands).toEqual([{ command: 'session-start', args: '' }])
})

test('a session opened after the reset is told to resume by hand', async ($, on) => {
  const seen = world(on)
  const pause: Pause = {
    status: 'active',
    kinds: ['five_hour'],
    percentUsed: 93,
    resetsAt: RESET,
    wakeAt: NOW - 1,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  await start($)

  expect(cardOf(seen)?.text).toContain('Run /session-start to resume')
  expect(pauseOf(seen)?.status).toBe('done')
  expect(seen.commands).toEqual([])
})

test('cancel stops the automatic resume', async ($, on) => {
  const seen = world(on)
  await start($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 95, resetsAt: RESET }]
  await endTurn($)
  const answer = await $.command.run({ command: 'usage-guard', args: 'cancel' } as never)

  expect(answer.text).toContain('cancelled')
  await seen.clock.advance(WAKE - NOW)
  expect(seen.commands.filter(c => c.command === 'session-start')).toEqual([])
})

test('a session that changed nothing only waits near the limit, then resumes', async ($, on) => {
  const seen = world(on)
  await start($)
  // Reading counts as no work.
  await $.tool.call({ tool: 'Read', file_path: 'C:/Repos/my-game/a.txt' } as never)
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)

  expect(pauseOf(seen)?.status).toBe('active')
  expect(seen.commands).toEqual([])
  expect(cardOf(seen)?.id).toBe(`paused:${RESET}`)
  await seen.clock.advance(WAKE - NOW)
  expect(seen.commands).toEqual([{ command: 'session-start', args: '' }])
})

function cardOf(seen: World): { id: string; text: string; dismissed: boolean } | undefined {
  const text = seen.files.get(CARD_FILE)
  return text === undefined ? undefined : JSON.parse(text)
}

async function mountCard($: Engine) {
  return $.ui.mount({
    plugin: 'usage-guard',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never,
  })
}

test('the pause shows a card that stays until dismissed, for every session', async ($, on) => {
  const seen = world(on)
  await start($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)

  expect(cardOf(seen)?.id).toBe(`paused:${RESET}`)
  expect(cardOf(seen)?.text).toContain('Work resumes on its own at Fri 2026-10-02 12:02')
  await seen.clock.advance(30_000)
  const ui = await mountCard($)
  expect(await ui.find({ key: 'usage-dismiss' })).toBeDefined()
  expect(await ui.find({ key: 'usage-cancel' })).toBeDefined()

  await ui.press({ key: 'usage-dismiss' })
  expect(cardOf(seen)?.dismissed).toBe(true)
  // Another session reaching the same event does not raise the dismissed card again.
  seen.sessionId = 'sess-b'
  await seen.clock.advance(60_000)
  expect(seen.claims.has(`${KEY}-sess-b`)).toBe(true)
  expect(cardOf(seen)?.dismissed).toBe(true)
})

test('the card cancels the automatic resume', async ($, on) => {
  const seen = world(on)
  await start($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)
  const ui = await mountCard($)
  await ui.press({ key: 'usage-cancel' })

  expect(pauseOf(seen)?.status).toBe('cancelled')
  expect(cardOf(seen)?.id).toBe(`cancelled:${RESET}`)
  await seen.clock.advance(WAKE - NOW)
  expect(seen.commands.filter(c => c.command === 'session-start')).toEqual([])
})

test('the resume replaces the pause card', async ($, on) => {
  const seen = world(on)
  await start($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)
  await seen.clock.advance(WAKE - NOW)

  expect(cardOf(seen)).toEqual({
    id: `reset:${RESET}`,
    text: 'Plan limits have reset. Sessions are resuming their saved work.',
    dismissed: false,
  })
})

test('a session whose entry in the shared pause was overwritten does not wrap up twice', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  // Another session wrote the shared pause at the same moment, from an older read.
  seen.files.set(PAUSE_FILE, JSON.stringify({ ...pauseOf(seen), triggeredBy: 'sess-b', handled: ['sess-b'] }))
  await seen.clock.advance(60_000)
  await endTurn($)

  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
})

test('of two sessions crossing the line together, only the claim winner stops background work', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  // The other session won the pause claim and has not written the file yet.
  seen.claims.add(`pause-${KEY}`)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)

  expect(seen.stopLookups).toBe(0)
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  await seen.clock.advance(WAKE - NOW)
  expect(seen.commands.at(-1)).toEqual({ command: 'session-start', args: '' })
})

test('a session that loses the pause claim honours a cancel written since the winner paused', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  // The other session won the claim and wrote its pause; the person cancelled it before this check.
  seen.claims.add(`pause-${KEY}`)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  // Its pause lands, already cancelled, while this session makes its claim.
  seen.duringClaim = name => {
    if (name !== `pause-${KEY}`) return
    const cancelled = {
      status: 'cancelled',
      kinds: ['five_hour'],
      percentUsed: 91,
      resetsAt: RESET,
      wakeAt: WAKE,
      triggeredBy: 'sess-b',
    }
    seen.files.set(PAUSE_FILE, JSON.stringify(cancelled))
  }
  await endTurn($)

  expect(pauseOf(seen)?.status).toBe('cancelled')
  expect(seen.commands).toEqual([])
  expect(seen.claims.has(`${KEY}-sess-a`)).toBe(false)
  await seen.clock.advance(WAKE - NOW)
  expect(seen.commands).toEqual([])
})

test('after a hot reload during a pause, the first turn arms the wake timer again', async ($, on) => {
  const seen = world(on)
  // This session wrapped up before the reload; the reload dropped its timer and skipped session.start.
  const pause = {
    status: 'active',
    kinds: ['five_hour'],
    percentUsed: 93,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-a',
    handled: ['sess-a'],
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  seen.claims.add(`${KEY}-sess-a`)
  await $.turn.start({ turnId: 't2' } as never)

  expect(seen.commands).toEqual([])
  await seen.clock.advance(WAKE - NOW)
  expect(seen.commands).toEqual([{ command: 'session-start', args: '' }])
})

test('a session resumes once per reset, even beside an instance left by a hot reload', async ($, on) => {
  const seen = world(on)
  const pause = {
    status: 'done',
    kinds: ['five_hour'],
    percentUsed: 93,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-a',
    handled: ['sess-a'],
  }
  seen.files.set(PAUSE_FILE, JSON.stringify({ ...pause, status: 'active' }))
  seen.claims.add(`${KEY}-sess-a`)
  await $.turn.start({ turnId: 't2' } as never)
  // The instance from before the reload woke first: it claimed this session's resume and marked the pause done.
  seen.claims.add(`resume-${KEY}-sess-a`)
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  await seen.clock.advance(WAKE - NOW)

  expect(seen.commands).toEqual([])
})

test('stop commands are found by the project folder name, case-insensitively, and only for that project', () => {
  const table = { 'My-Game': [['docker', 'compose', 'stop']] }
  expect(stopCommandsFor('C:\\Repos\\my-game', table)).toEqual([['docker', 'compose', 'stop']])
  expect(stopCommandsFor('/home/me/repos/MY-GAME/', table)).toEqual([['docker', 'compose', 'stop']])
  expect(stopCommandsFor('C:/Repos/app', table)).toEqual([])
  expect(Object.keys(STOP_COMMANDS)).toEqual([])
  expect(stopCommandsFor('C:/Repos/my-game')).toEqual([])
})

test('crossing the line mid-turn waits for the turn to end before the wrap-up runs', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.turn.start({ turnId: 't1' } as never)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  // The 60-second check fires while the turn is still running.
  await seen.clock.advance(60_000)

  expect(pauseOf(seen)?.status).toBe('active')
  expect(cardOf(seen)?.id).toBe(`paused:${RESET}`)
  expect(seen.commands).toEqual([])

  await endTurn($)
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  // Once only: later checks find the wrap-up done.
  await seen.clock.advance(60_000)
  await endTurn($)
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
})

test('a wrap-up owed by a running turn is dropped when the pause is cancelled before it ends', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.turn.start({ turnId: 't1' } as never)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await seen.clock.advance(60_000)
  await $.command.run({ command: 'usage-guard', args: 'cancel' } as never)
  await endTurn($)

  expect(seen.commands.filter(c => c.command === 'session-close')).toEqual([])
})
