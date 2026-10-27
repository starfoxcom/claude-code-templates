import { expect, test } from 'claude-code/testing'

import { wakeText } from '../hooks/register'
import { isResearchDue, type PrRounds, recordRound, redStreak, RESEARCH_EVERY } from '../hooks/rounds'
import type { Watch } from '../types'
import { type Seen, world } from './world'

const RED = 'FAILURE'
const reds = (n: number) => Array.from({ length: n }, () => RED)
const path = 'C:/Users/me/.claude/mods-data/ci-watch/rounds.json'

// The rounds ci-watch saw settle on the PR, oldest first: any result but SUCCESS had a failed check.
function seed(seen: Seen, results: string[]) {
  seen.isReadable = true
  const rounds = results.map((result, i) => ({ sha: `c${i}`, red: result !== 'SUCCESS' }))
  seen.files.set(path, JSON.stringify({ 'o/r#7': { rounds } }))
}

// Newest first, back to the last round that passed.
test('red rounds count back to a green round', () => {
  const of = (results: boolean[]) =>
    results.reduce<PrRounds>((pr, red, i) => recordRound(pr, `c${i}`, red), { rounds: [] })
  expect(redStreak(undefined)).toBe(0)
  expect(redStreak(of([true, true, true, true, true, true]))).toBe(6)
  expect(redStreak(of([true, true, true, false, true, true]))).toBe(2)
  expect(redStreak(of([true, false]))).toBe(0)
  expect(redStreak({ rounds: [] })).toBe(0)
})

// A re-run of a head already counted replaces its round; the list keeps the newest fifty.
test('a re-run replaces its round, and the list stays bounded', () => {
  const twice = recordRound(recordRound({ rounds: [] }, 'a', true), 'a', false)
  expect(twice).toEqual({ rounds: [{ sha: 'a', red: false }] })
  let many = { rounds: [] as { sha: string; red: boolean }[] }
  for (let i = 0; i < 80; i++) many = recordRound(many, `c${i}`, true)
  expect(many.rounds).toHaveLength(50)
  expect(redStreak(many)).toBe(50)
  expect(redStreak({ rounds: 'x' } as never)).toBe(0)
})

// Every RESEARCH_EVERY red rounds in a row the wake asks for a step back, and never in between.
test('the research step is due at 6, 12 and 18 red rounds, and only then', () => {
  const due = [0, 1, 5, 6, 7, 11, 12, 13, 17, 18].filter(isResearchDue)
  expect(due).toEqual([6, 12, 18])
  expect(RESEARCH_EVERY).toBe(6)
})

const failed = (outcome: Watch['outcome']): Watch =>
  ({ repo: 'o/r', number: 7, headSha: 'a1', startedAt: 0, checks: { build: 'fail' }, stablePolls: 2, outcome }) as Watch

test('only a red wake at a due count carries the research step', () => {
  expect(wakeText(failed('failed'), undefined, 6)).toContain('research how the community solves this problem')
  expect(wakeText(failed('failed'), undefined, 6)).toContain('o/r#7 has had 6 fix rounds in a row')
  expect(wakeText(failed('failed'), undefined, 12)).toContain('has had 12 fix rounds')
  for (const red of [0, 5, 7]) expect(wakeText(failed('failed'), undefined, red)).not.toContain('research')
  expect(wakeText(failed('passed'), undefined, 6)).not.toContain('research')
  expect(wakeText(failed('timeout'), undefined, 6)).not.toContain('research')
})

// Nothing is refused any more: a push at any count goes through, and the count's file is no one's to guard.
test('a push at any red count is never refused', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  for (const n of [6, 13]) {
    seed(seen, reds(n))
    for (const tool of ['Bash', 'PowerShell']) {
      const answer = await $.tool.call({ tool, command: 'git push origin feature/x' } as never)
      expect(answer).not.toHaveProperty('deny')
    }
  }
})

// The sixth red round in a row: its own settled watch makes the count six, and the wake asks for research.
test('the wake of the sixth red round in a row asks for the research step', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seed(seen, reds(5))
  seen.bucket = 'fail'
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  for (let i = 0; i < 6; i++) await clock.advance(30_000)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('all checks settled; failed')
  expect(seen.prompts[0]).toContain('has had 6 fix rounds in a row')
})

test('/ci-watch rounds tells the count and when the next step back is due', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seed(seen, reds(7))
  const ask = async (args: string) =>
    ((await $.command.run({ command: 'ci-watch', args, origin: { kind: 'composer' } } as never)) as { text: string })
      .text
  expect(await ask('rounds')).toBe(
    'o/r#7: 7 fix round(s) in a row without every check green; the next step back is due in 5.',
  )
  expect(await ask('rounds 7')).toContain('o/r#7: 7 fix round(s) in a row')
  expect(await ask('rounds reset 7')).toContain('/ci-watch rounds')
  expect(JSON.parse(seen.files.get(path) ?? '{}')['o/r#7'].rounds).toHaveLength(7)
})

// A watch that settles is a round: the session's own pushes fill the count, with no history read.
test('each settled watch of a pushed head adds a round; an unreadable count file reads as none', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  seen.files.set(path, 'not json')
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seen.bucket = 'fail'
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  for (let i = 0; i < 6; i++) await clock.advance(30_000)
  expect(JSON.parse(seen.files.get(path) ?? '{}')['o/r#7']).toEqual({ rounds: [{ sha: 'a1', red: true }] })
})

// A head someone else pushed (a silent watch, past the hour after this session's push) is no round of this
// session's: its red run never counts.
test("a silent watch of someone else's head adds no round", async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seen.bucket = 'pass'
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  for (let i = 0; i < 3; i++) await clock.advance(30_000)
  await clock.advance(2 * 60 * 60_000)
  seen.head = 'b2'
  seen.bucket = 'fail'
  for (let i = 0; i < 25; i++) await clock.advance(30_000)
  const rounds = (JSON.parse(seen.files.get(path) ?? '{}') as Record<string, PrRounds>)['o/r#7']?.rounds
  expect(rounds).toEqual([{ sha: 'a1', red: false }])
})

// A round another session writes while this one is being added is the state it adds to: the file is read
// once, right before the write, with nothing in between that could let that round land unseen.
test("a round adds to the count file as read right before its write", async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seen.bucket = 'fail'
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seed(seen, reds(5))
  seen.order = []
  for (let i = 0; i < 6; i++) await clock.advance(30_000)
  // The wake then reads the count once more, for its research step.
  const steps = seen.order.filter(step => step.endsWith('/rounds.json'))
  expect(steps).toEqual([`read ${path}`, `write ${path}`, `read ${path}`])
  expect(redStreak(JSON.parse(seen.files.get(path) ?? '{}')['o/r#7'])).toBe(6)
})
