import type { On, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import type { Pause } from '../hooks/plan'
import { CLAIM, planArm, WRAP_UP_ARGS } from '../hooks/plan'
import { STOP_COMMANDS, stopCommandsFor } from '../hooks/rules'
import type { SessionRecord } from '../hooks/sessions'
import { ALIVE_MS, planTakeover } from '../hooks/sessions'

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
  on('fs.list', ($, e) => {
    const dir = `${key(e.path)}/`
    const names = [...seen.files.keys()].filter(path => path.startsWith(dir)).map(path => path.slice(dir.length))
    return { value: names.map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0 })) as never }
  })
  on('process.run', ($, e) => {
    seen.runs.push([...e.argv])
    let out = e.argv[0] === 'node' ? '420 America/Phoenix\n' : ''
    // With no name the helper only makes the folders.
    if (e.argv[2] === CLAIM && e.argv[4] !== undefined) {
      const name = e.argv[4]
      seen.duringClaim?.(name)
      out = seen.claims.has(name) ? 'taken\n' : 'won\n'
      seen.claims.add(name)
    }
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: seen.sessionId }))
  on('session.root', () => {
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
  on('command.register', ($, e) => {
    registered.push(e)
    return { value: { command: e.name } as never }
  })
  on('tool.register', () => ({ value: { tool: 'mcp__usage-guard__arm' } }) as never)
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
  expect(seen.claims).toEqual(new Set([`pause-${KEY}`, `${KEY}-sess-a`, `stop-${KEY}-c__repos_my-game`]))
  expect(stopsRun(seen)).toEqual([])
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  expect(cardOf(seen)?.text).toContain('Fri 2026-10-02 12:02 (America/Phoenix)')

  await seen.clock.advance(WAKE - NOW)
  // The session goes on by itself: no /session-start, whose plan would wait for the person's OK.
  expect(resumes(seen)).toHaveLength(1)
  expect(resumes(seen)[0]).toContain("without waiting for the person's OK")
  expect(seen.commands.map(c => c.command)).toEqual(['session-close'])
  expect(pauseOf(seen)?.status).toBe('done')
})

test('another session in the same project wraps up once and leaves the stop commands to the first', async ($, on) => {
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
  // The first session already stopped this project.
  seen.claims.add(`stop-${KEY}-c__repos_my-game`)
  await doWork($)
  await seen.clock.advance(60_000)
  await endTurn($)

  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  expect(seen.claims).toEqual(new Set([`stop-${KEY}-c__repos_my-game`, `${KEY}-sess-a`]))
  expect(pauseOf(seen)).toEqual(other)
})

test("a session opened during a pause in another project stops that project's work", async ($, on) => {
  const seen = world(on, 'C:/Repos/web-app')
  const pause: Pause = {
    status: 'active',
    kinds: ['five_hour'],
    percentUsed: 93,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  seen.claims.add(`stop-${KEY}-c__repos_my-game`)
  await start($)
  expect(seen.claims.has(`stop-${KEY}-c__repos_web-app`)).toBe(true)
})

test('two projects with the same folder name each stop their own work', async ($, on) => {
  const seen = world(on, 'D:/Clients/x/my-game')
  const pause: Pause = {
    status: 'active',
    kinds: ['five_hour'],
    percentUsed: 93,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  // C:/Repos/my-game already stopped its own work.
  seen.claims.add(`stop-${KEY}-c__repos_my-game`)
  await start($)
  expect(seen.claims.has(`stop-${KEY}-d__clients_x_my-game`)).toBe(true)
})

test('a pause another session wrote for an earlier reset is extended; each wraps up once', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  const WEEKLY = '2026-10-03T19:00:00.000Z'
  // While this session claims its pause, another one writes its own for the 5-hour reset.
  const other: Pause = {
    status: 'active',
    kinds: ['five_hour'],
    percentUsed: 91,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-b',
  }
  seen.duringClaim = name => {
    if (name.startsWith('pause-')) seen.files.set(PAUSE_FILE, JSON.stringify(other))
  }
  seen.limits = [
    { kind: 'five_hour', percentUsed: 91, resetsAt: RESET },
    { kind: 'seven_day', percentUsed: 92, resetsAt: WEEKLY },
  ]
  await endTurn($)
  const joined = pauseOf(seen)
  expect(joined?.resetsAt).toBe(WEEKLY)
  expect(joined?.episode).toBe(RESET)
  expect(joined?.triggeredBy).toBe('sess-b')
  // Claims stay keyed on the first reset: the next checks wrap up nothing more.
  expect(seen.claims.has(`${KEY}-sess-a`)).toBe(true)
  await seen.clock.advance(5 * 60_000)
  expect(seen.commands.filter(c => c.command === 'session-close')).toHaveLength(1)
})

test('a pause another session wrote for a later reset is kept, and this session wraps up once', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  const WEEKLY = '2026-10-03T19:00:00.000Z'
  const other: Pause = {
    status: 'active',
    kinds: ['seven_day'],
    percentUsed: 92,
    resetsAt: WEEKLY,
    wakeAt: Date.parse(WEEKLY) + 120_000,
    triggeredBy: 'sess-b',
  }
  seen.duringClaim = name => {
    if (name.startsWith('pause-')) seen.files.set(PAUSE_FILE, JSON.stringify(other))
  }
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  expect(pauseOf(seen)).toEqual(other)
  await seen.clock.advance(5 * 60_000)
  expect(seen.commands.filter(c => c.command === 'session-close')).toHaveLength(1)
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
  expect(resumes(seen)).toHaveLength(1)
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
  expect(resumes(seen)).toEqual([])
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
  expect(resumes(seen)).toHaveLength(1)
})

// The resumes this session submitted: the automatic "continue now" prompt, never /session-start.
function resumes(seen: World): string[] {
  return seen.prompts.filter(text => text.startsWith('[usage-guard] ') && text.includes('Continue the pending work'))
}

function cardOf(seen: World): { id: string; text: string; dismissed: boolean } | undefined {
  const text = seen.files.get(CARD_FILE)
  return text === undefined ? undefined : JSON.parse(text)
}

async function mountCard($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({
    plugin: 'usage-guard',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never,
  })
}

// The card draws through the engine's own validation on each surface the CLI and the Desktop app use.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pause shows a card that stays until dismissed, for every session, on ${surface}`, async ($, on) => {
    const seen = world(on)
    await start($)
    seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
    await endTurn($)

    expect(cardOf(seen)?.id).toBe(`paused:${RESET}`)
    expect(cardOf(seen)?.text).toContain('Work resumes on its own at Fri 2026-10-02 12:02')
    await seen.clock.advance(30_000)
    const ui = await mountCard($, surface)
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
}

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
  expect(resumes(seen)).toEqual([])
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

test('a session that loses the pause claim still stops its own project once', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  // The other session, in another project, won the pause claim and has not written the file yet.
  seen.claims.add(`pause-${KEY}`)
  seen.claims.add(`stop-${KEY}-c__repos_other-project`)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)

  expect(seen.claims.has(`stop-${KEY}-c__repos_my-game`)).toBe(true)
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
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

test('a cancel of an extended pause holds against a session still reading the earlier reset', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  expect(seen.commands).toHaveLength(1)
  // Another session extended the pause to the weekly reset, then the person cancelled it.
  const WEEKLY = '2026-10-03T19:00:00.000Z'
  const wakeAt = Date.parse(WEEKLY) + 120_000
  const extended = { ...pauseOf(seen), resetsAt: WEEKLY, wakeAt, episode: RESET }
  seen.files.set(PAUSE_FILE, JSON.stringify(extended))
  await $.command.run({ command: 'usage-guard', args: 'cancel' } as never)
  // This idle session's reading still names the 5-hour reset.
  await seen.clock.advance(WAKE - NOW + 60_000)

  expect(pauseOf(seen)?.status).toBe('cancelled')
  expect(pauseOf(seen)?.resetsAt).toBe(WEEKLY)
  expect(resumes(seen)).toEqual([])
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
  expect(resumes(seen)).toHaveLength(1)
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

test('a wrap-up owed by a running turn still runs when another session extends the pause', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.turn.start({ turnId: 't1' } as never)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await seen.clock.advance(60_000)
  // Before the turn ends, another session crosses the weekly line and extends the pause in place.
  const WEEKLY = '2026-10-03T19:00:00.000Z'
  const wakeAt = Date.parse(WEEKLY) + 120_000
  seen.files.set(PAUSE_FILE, JSON.stringify({ ...pauseOf(seen), resetsAt: WEEKLY, wakeAt, episode: RESET }))
  await endTurn($)

  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  await seen.clock.advance(60_000)
  expect(seen.commands).toHaveLength(1)
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

test('an armed session resumes after the reset it named, below the line and without a pause', async ($, on) => {
  const seen = world(on)
  await start($)
  const answer = await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  expect(answer).toEqual(expect.objectContaining({ text: expect.stringContaining('Armed') }))

  await seen.clock.advance(WAKE - NOW - 1)
  expect(resumes(seen)).toEqual([])
  await seen.clock.advance(1)
  expect(resumes(seen)).toHaveLength(1)
  // Nothing is shared: no pause, no wrap-up, no card for the other sessions.
  expect(pauseOf(seen)).toBeUndefined()
  expect(seen.commands.filter(c => c.command === 'session-close')).toEqual([])
})

test('disarm drops the armed wake', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  const answer = await $.command.run({ command: 'usage-guard', args: 'disarm' } as never)
  expect(answer).toEqual(expect.objectContaining({ text: expect.stringContaining('Disarmed') }))
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
})

test('an arm for the reset a pause already resumes at does not resume the session twice', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)
  expect(pauseOf(seen)?.status).toBe('active')

  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
})

test('arming names a known reset, or says why it cannot', () => {
  const limits: SessionRateLimit[] = [
    { kind: 'five_hour', percentUsed: 40, resetsAt: RESET },
    { kind: 'seven_day', percentUsed: 10 },
  ]
  expect(planArm(limits, '5h', 2, NOW)).toEqual({ kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE })
  expect(planArm(limits, 'week', 2, NOW)).toBe('No weekly reset is known yet, so there is nothing to arm.')
  const usage = 'Name the reset to wake at: /usage-guard arm 5h or /usage-guard arm week.'
  expect(planArm(limits, '', 2, NOW)).toBe(usage)
  expect(planArm(limits, 'day', 2, NOW)).toBe(usage)
  // A reading that still names a reset already past is no reset to wait for.
  const past = Date.parse(RESET)
  expect(planArm(limits, '5h', 2, past)).toBe('No 5-hour reset is known yet, so there is nothing to arm.')
  expect(planArm(limits, '5h', 2, past - 1)).toEqual({ kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE })
  // A reset time that does not read as a date is no reset either.
  const unreadable: SessionRateLimit[] = [{ kind: 'five_hour', percentUsed: 40, resetsAt: 'soon' }]
  expect(planArm(unreadable, '5h', 2, NOW)).toBe('No 5-hour reset is known yet, so there is nothing to arm.')
})

test('an arm resumes the session once when a pause for its reset began after the last check', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  await seen.clock.advance(WAKE - NOW - 30_000)
  // Another session paused for the same reset after this session's last check.
  const pause: Pause = {
    status: 'active',
    kinds: ['five_hour'],
    percentUsed: 92,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  await seen.clock.advance(30_000)
  expect(resumes(seen)).toHaveLength(1)
  expect(pauseOf(seen)?.status).toBe('done')
})

test('an armed wake that comes due during a pause leaves the resume to the pause', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  // Another session paused for the weekly reset, which falls three hours after the armed one.
  const weekly = '2026-10-02T22:00:00.000Z'
  const weeklyWake = Date.parse(weekly) + 2 * 60_000
  const pause: Pause = {
    status: 'active',
    kinds: ['seven_day'],
    percentUsed: 95,
    resetsAt: weekly,
    wakeAt: weeklyWake,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))

  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
  await seen.clock.advance(weeklyWake - WAKE)
  expect(resumes(seen)).toHaveLength(1)
})

test('an armed wake another instance of this module already fired does not resume again', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  // The instance a hot reload left behind won the claim first.
  seen.claims.add(`arm-${KEY}-sess-a`)
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
})

test('a cancel in this session also drops its armed wake', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)
  await $.command.run({ command: 'usage-guard', args: 'cancel' } as never)
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
})

test("another session's cancel leaves this session's own arm in place", async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  // Session B paused for the same reset and cancelled it; this session never crossed the line.
  const cancelled: Pause = {
    status: 'cancelled',
    kinds: ['five_hour'],
    percentUsed: 92,
    resetsAt: RESET,
    wakeAt: WAKE,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(cancelled))
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
})

test('an arm that met a longer pause still resumes the session after another session cancels it', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  const later = '2026-10-02T22:00:00.000Z'
  const laterWake = Date.parse(later) + 2 * 60_000
  const pause: Pause = {
    status: 'active',
    kinds: ['seven_day'],
    percentUsed: 95,
    resetsAt: later,
    wakeAt: laterWake,
    triggeredBy: 'sess-b',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
  // The status still names the arm, now at the pause's wake.
  const status = await $.command.run({ command: 'usage-guard', args: '' } as never)
  expect(status).toEqual(expect.objectContaining({ text: expect.stringContaining('Armed to resume') }))
  // Session B cancels the pause: no pause resume comes, and the arm resumes this session once.
  seen.files.set(PAUSE_FILE, JSON.stringify({ ...pause, status: 'cancelled' }))
  await seen.clock.advance(laterWake - WAKE)
  expect(resumes(seen)).toHaveLength(1)
})

const registered: { name: string; argumentHint?: string }[] = []

test('/usage-guard shows its arguments in the menu and lists them on help', async ($, on) => {
  world(on)
  await start($)
  const hint = registered.find(command => command.name === 'usage-guard')?.argumentHint
  expect(hint).toBe('[help | settings | arm 5h|week | disarm | cancel]')
  const help = await $.command.run({ command: 'usage-guard', args: 'help' } as never)
  const lines = ['/usage-guard cancel', '/usage-guard arm 5h|week', '/usage-guard disarm', '/usage-guard settings']
  for (const line of lines)
    expect(help).toEqual(expect.objectContaining({ text: expect.stringContaining(line) }))
})

const SESSIONS_DIR = 'C:/Users/me/.claude/mods-data/usage-guard/sessions'
const ARM_5H = { kind: 'five_hour', resetsAt: RESET, wakeAt: WAKE }

function recordOf(seen: World, session: string): SessionRecord | undefined {
  const text = seen.files.get(`${SESSIONS_DIR}/${session}.json`)
  return text === undefined ? undefined : (JSON.parse(text) as SessionRecord)
}

// A record an earlier process left on disk.
function leave(seen: World, record: SessionRecord): void {
  seen.files.set(`${SESSIONS_DIR}/${record.session}.json`, JSON.stringify(record))
}

test('an arm set by hand is saved with the session, so a restart of that session still resumes', async ($, on) => {
  const seen = world(on)
  leave(seen, { session: 'sess-a', project: 'c:/repos/my-game', beatAt: 0, arm: ARM_5H })
  await start($)

  expect(recordOf(seen, 'sess-a')?.arm).toEqual(ARM_5H)
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
  expect(recordOf(seen, 'sess-a')?.arm).toBeNull()
})

test('arming and disarming by hand write the record, and every minute the session checks in', async ($, on) => {
  const seen = world(on)
  await start($)
  expect(recordOf(seen, 'sess-a')).toEqual({ session: 'sess-a', project: 'c:/repos/my-game', beatAt: NOW, arm: null })

  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  expect(recordOf(seen, 'sess-a')?.arm).toEqual(ARM_5H)
  await seen.clock.advance(60_000)
  expect(recordOf(seen, 'sess-a')?.beatAt).toBe(NOW + 60_000)
  await $.command.run({ command: 'usage-guard', args: 'disarm' } as never)
  expect(recordOf(seen, 'sess-a')?.arm).toBeNull()
})

test('the automatic pause arms a session it wraps up; a restart after the reset still resumes it', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  expect(recordOf(seen, 'sess-a')?.arm).toEqual({ ...ARM_5H, byPause: true })
})

test('a session restarted after the reset of its pause resumes once, with no "by hand" card', async ($, on) => {
  const seen = world(on)
  // The reset passed while the session was closed: its wake was two minutes ago.
  const resetsAt = '2026-10-02T16:56:00.000Z'
  const wakeAt = NOW - 2 * 60_000
  const pause: Pause = {
    status: 'active',
    kinds: ['five_hour'],
    percentUsed: 93,
    resetsAt,
    wakeAt,
    triggeredBy: 'sess-a',
  }
  seen.files.set(PAUSE_FILE, JSON.stringify(pause))
  const arm = { kind: 'five_hour', resetsAt, wakeAt, byPause: true }
  leave(seen, { session: 'sess-a', project: 'c:/repos/my-game', beatAt: 0, arm })
  await start($)
  await seen.clock.advance(0)

  expect(resumes(seen)).toHaveLength(1)
  expect(cardOf(seen)?.id).toBe(`reset:${resetsAt}`)
  expect(pauseOf(seen)?.status).toBe('done')
})

test("a new session alone in the project takes over a closed session's arm, and only once", async ($, on) => {
  const seen = world(on)
  leave(seen, { session: 'sess-old', project: 'c:/repos/my-game', beatAt: NOW - 10 * 60_000, arm: ARM_5H })
  await start($)

  expect(recordOf(seen, 'sess-a')?.arm).toEqual(ARM_5H)
  expect(recordOf(seen, 'sess-old')?.arm).toBeNull()
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
})

test('with another session open in the project, or the arm in another project, nothing moves', async ($, on) => {
  const seen = world(on)
  leave(seen, { session: 'sess-old', project: 'c:/repos/my-game', beatAt: 0, arm: ARM_5H })
  leave(seen, { session: 'sess-open', project: 'c:/repos/my-game', beatAt: NOW - 30_000, arm: null })
  leave(seen, { session: 'sess-far', project: 'c:/repos/other', beatAt: 0, arm: ARM_5H })
  await start($)

  expect(recordOf(seen, 'sess-a')?.arm).toBeNull()
  expect(recordOf(seen, 'sess-old')?.arm).toEqual(ARM_5H)
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
})

test('a disarm during a pause sticks: the minute check does not arm the session again', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  expect(recordOf(seen, 'sess-a')?.arm).toEqual({ ...ARM_5H, byPause: true })

  await $.command.run({ command: 'usage-guard', args: 'disarm' } as never)
  await seen.clock.advance(60_000)
  expect(recordOf(seen, 'sess-a')?.arm).toBeNull()
  // Nor does the pause's own wake: the session stays put at the reset.
  await seen.clock.advance(WAKE - NOW - 60_000)
  expect(resumes(seen)).toEqual([])
})

test("another session's cancel drops the arm the pause gave this session", async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  const pause = pauseOf(seen)
  seen.files.set(PAUSE_FILE, JSON.stringify({ ...pause, status: 'cancelled' }))

  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
  expect(recordOf(seen, 'sess-a')?.arm).toBeNull()
})

test('an ending session is closed at once, keeps its arm, and checks in no more', async ($, on) => {
  const seen = world(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-a', resume: { id: 'sess-a' } } as never)
  const closed = { session: 'sess-a', project: 'c:/repos/my-game', beatAt: 0, arm: ARM_5H }
  expect(recordOf(seen, 'sess-a')).toEqual(closed)
  // A minute timer still firing while the process exits would make it look open: it writes nothing.
  await seen.clock.advance(60_000)
  expect(recordOf(seen, 'sess-a')).toEqual(closed)
})

test('after a /clear the process takes its arm along when it is the only session in the project', async ($, on) => {
  const seen = world(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)

  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: { id: 'sess-a' } } as never)
  seen.sessionId = 'sess-b'
  await $.turn.start({ text: 'hi', turnId: 't2' })
  expect(recordOf(seen, 'sess-b')?.arm).toEqual(ARM_5H)
  expect(recordOf(seen, 'sess-a')?.arm).toBeNull()
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
})

test('after a /clear beside another open session in the project, the arm stays for later', async ($, on) => {
  const seen = world(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  leave(seen, { session: 'sess-open', project: 'c:/repos/my-game', beatAt: NOW, arm: null })

  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: { id: 'sess-a' } } as never)
  seen.sessionId = 'sess-b'
  await seen.clock.advance(60_000)
  expect(recordOf(seen, 'sess-b')?.arm).toBeNull()
  expect(recordOf(seen, 'sess-a')).toEqual({ session: 'sess-a', project: 'c:/repos/my-game', beatAt: 0, arm: ARM_5H })
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
})

test('a takeover needs every other session of the project closed, and takes the latest wake first', () => {
  const project = 'c:/repos/my-game'
  const later = { kind: 'seven_day', resetsAt: '2026-10-04T18:00:00.000Z', wakeAt: Date.UTC(2026, 9, 4, 18, 2) }
  const record = (session: string, beatAt: number, arm: SessionRecord['arm'], at = project): SessionRecord => ({
    session,
    project: at,
    beatAt,
    arm,
  })
  const closedAt = NOW - ALIVE_MS
  // Its own arm wins over everything else.
  expect(planTakeover([record('me', 0, ARM_5H), record('x', 0, later)], 'me', project, NOW)).toEqual({
    own: ARM_5H,
    left: [],
  })
  // Checked in exactly ALIVE_MS ago is closed; a millisecond later it is still open.
  const closed = planTakeover([record('x', closedAt, later), record('y', 0, ARM_5H)], 'me', project, NOW)
  expect(closed.left.map(r => r.session)).toEqual(['x', 'y'])
  expect(planTakeover([record('x', closedAt + 1, null), record('y', 0, ARM_5H)], 'me', project, NOW)).toEqual({
    left: [],
  })
  // Another project's sessions neither block nor move; no records, nothing to take.
  expect(planTakeover([record('x', NOW, ARM_5H, 'c:/repos/other')], 'me', project, NOW)).toEqual({ left: [] })
  expect(planTakeover([], 'me', project, NOW)).toEqual({ left: [] })
})

test('the session arms itself with the arm tool, and the arm counts as no work to save', async ($, on) => {
  const seen = world(on)
  await start($)
  const arm = (action: string, window?: string) =>
    $.tool.call({ tool: 'mcp__usage-guard__arm', action, ...(window ? { window } : {}) } as never) as Promise<{
      result: string
    }>

  expect((await arm('arm', 'day')).result).toContain('/usage-guard arm 5h')
  expect((await arm('arm', '5h')).result).toContain('Armed')
  expect((await arm('status')).result).toContain('Armed to resume at Fri 2026-10-02 12:02')
  expect(recordOf(seen, 'sess-a')?.arm).toEqual(ARM_5H)

  // Near the line the session only waits: arming changed nothing the wrap-up must save.
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)
  expect(seen.commands.filter(c => c.command === 'session-close')).toEqual([])
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
  expect((await arm('disarm')).result).toBe('Nothing was armed.')
})
