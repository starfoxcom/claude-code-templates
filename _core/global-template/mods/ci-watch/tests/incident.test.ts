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
