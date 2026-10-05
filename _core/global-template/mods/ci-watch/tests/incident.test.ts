import { expect, test } from 'claude-code/testing'

import { actionsIncident } from '../hooks/incident'
import { summary } from '../hooks/view'
import { world } from './world'

// GitHub's own incidents: a watch whose checks sit pending names an Actions outage instead of waiting
// out the time limit in silence.

const ACTIONS = JSON.stringify({
  incidents: [
    { name: 'Disruption with Pages', status: 'investigating', components: [{ name: 'Pages' }] },
    { name: 'Incident with Actions', status: 'investigating', components: [{ name: 'Actions' }] },
  ],
})

test('an unresolved incident is about Actions by its component or its name', () => {
  expect(actionsIncident(ACTIONS)).toBe('Incident with Actions')
  const byName = { incidents: [{ name: 'Delays in GitHub Actions jobs', status: 'monitoring' }] }
  expect(actionsIncident(JSON.stringify(byName))).toBe('Delays in GitHub Actions jobs')
  const other = { incidents: [{ name: 'Disruption with Pages', status: 'investigating', components: [] }] }
  expect(actionsIncident(JSON.stringify(other))).toBeUndefined()
  const resolved = { incidents: [{ name: 'Incident with Actions', status: 'resolved' }] }
  expect(actionsIncident(JSON.stringify(resolved))).toBeUndefined()
  for (const text of ['', '{ broken', '{}']) expect(actionsIncident(text)).toBeUndefined()
})

test('the row names the incident while the checks wait', () => {
  const watch = { repo: 'o/r', number: 7, headSha: 'a1', startedAt: 0, checks: { build: 'pending' }, stablePolls: 0 }
  expect(summary({ ...watch, incident: 'Incident with Actions' })).toEqual({
    text: '⚠️ PR 7 · 0/1 done · GitHub incident: Incident with Actions',
    color: 'yellow',
  })
})

const POLL_MS = 30_000
const OWNER = 'C:/Users/me/.claude/mods-data/ci-watch/s1.owner'
const STATE = 'C:/Users/me/.claude/mods-data/ci-watch/s1.json'

test('checks pending past 15 minutes during an Actions incident wake the session once, early', async ($, on) => {
  const { seen, clock } = world(on)
  seen.status = ACTIONS
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  // A normal wait: GitHub is not asked.
  for (let i = 0; i < 25; i++) await clock.advance(POLL_MS)
  expect([seen.statusReads, seen.prompts]).toEqual([0, []])
  for (let i = 0; i < 10; i++) await clock.advance(POLL_MS)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('GitHub reports an open incident: "Incident with Actions"')
  // Once per watch; GitHub is not asked again for it.
  const reads = seen.statusReads
  for (let i = 0; i < 20; i++) await clock.advance(POLL_MS)
  expect([seen.prompts.length, seen.statusReads]).toEqual([1, reads])
  // The checks settle later: the usual wake still goes out.
  seen.bucket = 'pass'
  for (let i = 0; i < 3; i++) await clock.advance(POLL_MS)
  expect(seen.prompts).toHaveLength(2)
  expect(seen.prompts[1]).toContain('all 1 checks settled with no failure')
})

test('a watch only confirming finished checks is not called stuck', async ($, on) => {
  const { seen, clock } = world(on)
  seen.status = ACTIONS
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  for (let i = 0; i < 30; i++) await clock.advance(POLL_MS)
  seen.bucket = 'pass'
  for (let i = 0; i < 4; i++) await clock.advance(POLL_MS)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('all 1 checks settled with no failure')
})

test('with no incident the status is read at most every five minutes, and nothing wakes', async ($, on) => {
  const { seen, clock } = world(on)
  seen.status = JSON.stringify({ incidents: [] })
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  for (let i = 0; i < 50; i++) await clock.advance(POLL_MS)
  // 15 to 25 minutes in: reads at about 15 and 20 minutes.
  expect(seen.statusReads).toBeLessThanOrEqual(3)
  expect(seen.statusReads).toBeGreaterThan(0)
  expect(seen.prompts).toEqual([])
})

test('an incident wake held through a push never goes out as the new commit settling', async ($, on) => {
  const { seen, clock } = world(on)
  seen.status = ACTIONS
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  // The incident is noted while a turn runs (no tool result carries it), then a new commit lands.
  await $.turn.start({ turnId: 't1', prompt: 'work' } as never)
  for (let i = 0; i < 31; i++) await clock.advance(POLL_MS)
  seen.head = 'b2'
  await clock.advance(POLL_MS)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await clock.advance(POLL_MS)
  expect(seen.prompts.filter(text => text.includes('settled with no failure'))).toEqual([])
})

test('a load retired while GitHub status was read does not save over the newer one', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  for (let i = 0; i < 30; i++) await clock.advance(POLL_MS)
  // The status read takes long enough for a hot reload to claim the session.
  seen.status = ACTIONS
  seen.duringStatus = () => void seen.files.set(OWNER, 'a-newer-instance')
  await clock.advance(POLL_MS)
  expect(seen.statusReads).toBe(1)
  expect(seen.files.get(STATE)).not.toContain('Incident with Actions')
  expect(seen.prompts).toEqual([])
})

test('refused incident wakes leave the settlement wake all of its tries', async ($, on) => {
  const { seen, clock } = world(on)
  seen.status = ACTIONS
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  // A hook drops every prompt for a while: the incident wake runs out of tries.
  seen.refusals = 99
  for (let i = 0; i < 40; i++) await clock.advance(POLL_MS)
  expect(seen.prompts).toEqual([])
  // The checks settle; the first try is refused, a later one goes in.
  seen.refusals = 1
  seen.bucket = 'pass'
  for (let i = 0; i < 6; i++) await clock.advance(POLL_MS)
  expect(seen.prompts.filter(text => text.includes('settled with no failure'))).toHaveLength(1)
})

test('the row says confirming, not the incident, once every check has passed', () => {
  const watch = { repo: 'o/r', number: 7, headSha: 'a1', startedAt: 0, checks: { build: 'pass' }, stablePolls: 1 }
  expect(summary({ ...watch, incident: 'Incident with Actions' })).toEqual({
    text: '⏳ PR 7 · all 1 passed, confirming',
    color: 'green',
  })
})

test('a held incident wake stays off a moved head when another watch changes during that poll', async ($, on) => {
  const { seen, clock } = world(on)
  seen.status = ACTIONS
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  await $.turn.start({ turnId: 't1', prompt: 'work' } as never)
  for (let i = 0; i < 31; i++) await clock.advance(POLL_MS)
  // The head moves, and while that poll waits on gh a watch starts on another PR (the list changes).
  seen.head = 'b2'
  seen.duringChecks = () => {
    seen.duringChecks = undefined
    return $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 8, repo: 'o/q' } as never)
  }
  await clock.advance(POLL_MS)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await clock.advance(POLL_MS)
  expect(seen.prompts.filter(text => text.includes('settled with no failure'))).toEqual([])
})

test('an incident note taken by a tool while the watch settles still leaves the settlement wake', async ($, on) => {
  const { seen, clock } = world(on)
  seen.status = ACTIONS
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'text' }) as never)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  await $.turn.start({ turnId: 't1', prompt: 'work' } as never)
  for (let i = 0; i < 31; i++) await clock.advance(POLL_MS)
  seen.bucket = 'pass'
  await clock.advance(POLL_MS)
  // The settling poll waits on gh while a tool call carries the incident note into the turn.
  let carried: unknown
  seen.duringChecks = async () => {
    seen.duringChecks = undefined
    carried = await $.tool.call({ tool: 'Read', file_path: 'C:/repo/a.txt' } as never)
  }
  await clock.advance(POLL_MS)
  expect(JSON.stringify(carried)).toContain('GitHub reports an open incident')
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await clock.advance(POLL_MS)
  expect(seen.prompts.filter(text => text.includes('settled with no failure'))).toHaveLength(1)
})

test('an incident another load noted while this one read GitHub is not sent twice', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  for (let i = 0; i < 30; i++) await clock.advance(POLL_MS)
  // The other load (both active: the owner file could not be written) notes and sends it meanwhile.
  seen.status = ACTIONS
  seen.duringStatus = () => {
    const saved = JSON.parse(seen.files.get(STATE) ?? '{}') as { watches: { incident?: string }[] }
    for (const watch of saved.watches) watch.incident = 'Incident with Actions'
    seen.files.set(STATE, JSON.stringify(saved))
  }
  for (let i = 0; i < 3; i++) await clock.advance(POLL_MS)
  expect(seen.prompts).toEqual([])
  expect(seen.files.get(STATE)).toContain('Incident with Actions')
})
