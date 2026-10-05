import type { SessionRateLimit } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Pause } from '../hooks/plan'
import { NO_WORK_NOTICE, planArm, WRAP_UP_ARGS } from '../hooks/plan'
import { STOP_COMMANDS, stopCommandsFor } from '../hooks/rules'
import {
  cardOf,
  doWork,
  endTurn,
  KEY,
  mountCard,
  NOW,
  PAUSE_FILE,
  pauseOf,
  registered,
  RESET,
  resumes,
  start,
  stopsRun,
  WAKE,
  world,
} from './world'


// For tests that run hours or days of minute checks through the fake clock.
const LONG = { timeoutMs: 15_000 }

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
  // `work-`: it wrapped up with work, so it resumes by itself after the reset.
  expect(seen.claims).toEqual(
    new Set([`pause-${KEY}`, `${KEY}-sess-a`, `stop-${KEY}-c__repos_my-game`, `work-${KEY}-sess-a`]),
  )
  expect(stopsRun(seen)).toEqual([])
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  expect(cardOf(seen)?.text).toContain('Fri 2026-10-02 12:02 (America/Phoenix)')

  await seen.clock.advance(WAKE - NOW)
  // The session goes on by itself: no /session-start, whose plan would wait for the person's OK.
  expect(resumes(seen)).toHaveLength(1)
  expect(resumes(seen)[0]).toContain('do not wait for a plan approval')
  // Only the plan approval is waived: the steps a project keeps for the person still wait for them.
  expect(resumes(seen)[0]).toContain("Every step the project's rules keep for the person")
  expect(resumes(seen)[0]).toContain('still stops and waits for them')
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
  expect(seen.claims).toEqual(new Set([`stop-${KEY}-c__repos_my-game`, `${KEY}-sess-a`, `work-${KEY}-sess-a`]))
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

test('a session opened during a pause only waits; at the reset it is told, not set to work', async ($, on) => {
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
  // Another session carries the saved work; this one only learns the limits reset.
  expect(resumes(seen)).toEqual([])
  expect(cardOf(seen)?.id).toBe(`reset:${RESET}`)
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
  expect(resumes(seen)).toEqual([])
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

test('a session that changed nothing only waits near the limit, and is not set to work after', async ($, on) => {
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
  // Another session carries the saved work; this one only learns the limits reset.
  expect(resumes(seen)).toEqual([])
  expect(cardOf(seen)?.id).toBe(`reset:${RESET}`)
})

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

test('the card cancels the automatic resume', LONG, async ($, on) => {
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
  expect(resumes(seen)).toEqual([])
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
  // It wrapped up with work: the claim says so, though the reload emptied the module's memory.
  seen.claims.add(`work-${KEY}-sess-a`)
  await $.turn.start({ turnId: 't2' } as never)

  expect(seen.commands).toEqual([])
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toHaveLength(1)
})

test('work whose claim failed before a hot reload is never called no work at the reset', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  // The wrap-up's own work claim fails: it counts as a win in memory and leaves nothing on disk.
  seen.failClaims = new Set([`work-${KEY}-sess-a`])
  seen.limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: RESET }]
  await endTurn($)
  expect(seen.commands).toEqual([{ command: 'session-close', args: WRAP_UP_ARGS }])
  expect(seen.claims.has(`work-${KEY}-sess-a`)).toBe(false)
})

test('after a hot reload, a session with no work on record waits and says what is on record', async ($, on) => {
  const seen = world(on)
  // The state the test above leaves, after a hot reload emptied the module's memory: the session
  // wrapped up, but its work claim never reached the disk.
  const pause = { status: 'active', kinds: ['five_hour'], percentUsed: 93, resetsAt: RESET, wakeAt: WAKE }
  seen.files.set(PAUSE_FILE, JSON.stringify({ ...pause, triggeredBy: 'sess-a' }))
  seen.claims.add(`${KEY}-sess-a`)
  await $.turn.start({ turnId: 't2' } as never)
  await seen.clock.advance(WAKE - NOW)

  expect(resumes(seen)).toEqual([])
  // It asked for its work claim and found none on record (it won it now), so it took the notice path.
  expect(seen.claims.has(`work-${KEY}-sess-a`)).toBe(true)
  // The test engine keeps no transcript, so the notice is checked as text: what is on record, never
  // a claim that the session saved nothing.
  expect(NO_WORK_NOTICE).toContain('No saved work is on record for this session')
  expect(NO_WORK_NOTICE).not.toContain('saved no work')
})

test('a failed resume claim resumes nothing and leaves no work claim for another instance to find', async ($, on) => {
  const seen = world(on)
  const pause = { status: 'active', kinds: ['five_hour'], percentUsed: 93, resetsAt: RESET, wakeAt: WAKE }
  seen.files.set(PAUSE_FILE, JSON.stringify({ ...pause, triggeredBy: 'sess-a' }))
  seen.claims.add(`${KEY}-sess-a`)
  seen.failClaims = new Set([`resume-${KEY}-sess-a`])
  await $.turn.start({ turnId: 't2' } as never)
  await seen.clock.advance(WAKE - NOW)

  expect(resumes(seen)).toEqual([])
  // Had it asked, an instance a hot reload left beside it would win the resume claim for real, find
  // this work claim taken and resume a session that saved nothing.
  expect(seen.claims.has(`work-${KEY}-sess-a`)).toBe(false)
  expect(pauseOf(seen)?.status).toBe('done')
})

test('a failed arm claim resumes nothing, so a second instance cannot resume the session twice', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.command.run({ command: 'usage-guard', args: 'arm 5h' } as never)
  seen.failClaims = new Set([`arm-${KEY}-sess-a`])
  await seen.clock.advance(WAKE - NOW)

  expect(resumes(seen)).toEqual([])
  expect(seen.claims.has(`arm-${KEY}-sess-a`)).toBe(false)
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

  expect(resumes(seen)).toEqual([])
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

test('an armed wake that comes due during a pause leaves the resume to the pause', LONG, async ($, on) => {
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

test('/usage-guard shows its arguments in the menu and lists them on help', async ($, on) => {
  world(on)
  await start($)
  const hint = registered.find(command => command.name === 'usage-guard')?.argumentHint
  expect(hint).toBe('[help | settings | set | phone | arm 5h|week [compact] | disarm | cancel | adopt]')
  const help = await $.command.run({ command: 'usage-guard', args: 'help' } as never)
  const lines = [
    '/usage-guard cancel',
    '/usage-guard arm 5h|week',
    '/usage-guard arm 5h|week compact',
    '/usage-guard disarm',
    '/usage-guard settings',
    '/usage-guard phone',
    '/usage-guard adopt [drop]',
  ]
  for (const line of lines)
    expect(help).toEqual(expect.objectContaining({ text: expect.stringContaining(line) }))
})

test('after a /clear the new session id has no work: it only waits, and is not set to work', async ($, on) => {
  const seen = world(on)
  await start($)
  await doWork($)
  // A /clear: the process goes on under a new session id, with no session.start.
  seen.sessionId = 'sess-b'
  seen.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: RESET }]
  await endTurn($)
  expect(seen.commands.filter(c => c.command === 'session-close')).toEqual([])
  await seen.clock.advance(WAKE - NOW)
  expect(resumes(seen)).toEqual([])
})
