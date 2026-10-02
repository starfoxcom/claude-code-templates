import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Watch } from '../hooks/register'
import { deepTierOf, earlyFailures, mergedNumber, settle, targetFolder, wakeText } from '../hooks/register'

const BASE: Watch = { repo: 'o/r', number: 7, headSha: 'a1', startedAt: 0, checks: {}, stablePolls: 0 }
const HOUR = 60 * 60_000

test('passed only after two quiet polls in a row', () => {
  const first = settle(BASE, { build: 'pass', review: 'pass' }, 1, HOUR)
  expect(first.outcome).toBeUndefined()
  const second = settle(first, { build: 'pass', review: 'skipping' }, 2, HOUR)
  expect(second.outcome).toBe('passed')
})

test('a pending check resets the quiet count; a failure wakes early but settles only when the rest do', () => {
  const quiet = settle(BASE, { build: 'pass' }, 1, HOUR)
  expect(settle(quiet, { build: 'pass', late: 'pending' }, 2, HOUR).stablePolls).toBe(0)
  const early = settle(BASE, { build: 'fail', review: 'pending' }, 1, HOUR)
  expect(early.outcome).toBeUndefined()
  expect(earlyFailures(early)).toEqual(['build'])
  expect(wakeText(early)).toContain('still running: review')
  const reported: Watch = { ...early, reported: ['build'] }
  expect(earlyFailures(settle(reported, { build: 'fail', review: 'pending' }, 2, HOUR))).toEqual([])
  const final = settle(reported, { build: 'fail', review: 'fail' }, 3, HOUR)
  expect(final.outcome).toBe('failed')
  expect(wakeText(final)).toContain('failed: build, review')
  const deep = settle(BASE, { 'Evaluate review outcome': 'fail', 'Claude On-Demand': 'pending' }, 1, HOUR)
  expect(earlyFailures(deep)).toEqual([])
})

test('the deep-tier pattern comes from the option, falling back to the default', () => {
  const deep = settle(BASE, { review: 'fail', 'Slow audit': 'pending' }, 1, HOUR)
  expect(earlyFailures(deep)).toEqual(['review'])
  expect(earlyFailures(deep, deepTierOf('slow audit'))).toEqual([])
  expect(deepTierOf('').source).toBe('on-demand|deep')
  expect(deepTierOf('(').source).toBe('on-demand|deep')
})

test('no checks reported is never a pass; the time limit wakes with what is stuck', () => {
  expect(settle(BASE, {}, 1, HOUR).outcome).toBeUndefined()
  const stuck = settle(BASE, { review: 'pending' }, HOUR + 1, HOUR)
  expect(stuck.outcome).toBe('timeout')
  expect(wakeText(stuck)).toContain('review')
})

type Seen = {
  prompts: string[]
  files: Map<string, string>
  bucket: string
  /** Extra check rows beside `build`. */
  rows: { name: string; bucket: string }[]
  /** Reads see the written files (default: no file can be read). */
  isReadable: boolean
  /** Runs inside each `gh pr checks` call: another instance acting while this one waits on gh. */
  duringChecks?: () => void
}

function world(on: On) {
  const seen: Seen = { prompts: [], files: new Map(), bucket: 'pending', rows: [], isReadable: false }
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: 's1' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ci-watch__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('fs.write', ($, e) => {
    seen.files.set(e.path.replaceAll('\\', '/'), e.text)
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const text = seen.isReadable ? seen.files.get(e.path.replaceAll('\\', '/')) : undefined
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('process.run', ($, e) => {
    const args = e.argv.join(' ')
    if (args.includes('pr checks')) seen.duringChecks?.()
    const stdout = args.includes('pr checks')
      ? JSON.stringify([{ name: 'build', bucket: seen.bucket }, ...seen.rows])
      : JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', headRefOid: 'a1' })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  return { seen, clock }
}

test('a push starts a watch and the session is woken once when it passes', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)

  const saved = JSON.parse(seen.files.get('C:/Users/me/.claude/mods-data/ci-watch/s1.json') ?? '{}')
  expect(saved.watches?.[0]?.number).toBe(7)

  await clock.advance(60_000)
  expect(seen.prompts).toEqual([])
  seen.bucket = 'pass'
  await clock.advance(60_000)
  await clock.advance(60_000)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('o/r#7: all 1 checks settled')
  await clock.advance(60_000)
  expect(seen.prompts.length).toBe(1)
})

const STATE = 'C:/Users/me/.claude/mods-data/ci-watch/s1.json'

// What another live instance (left running by a hot reload) writes once it has woken the session.
function otherInstanceRecords(seen: Seen, change: Partial<Watch>) {
  const saved = JSON.parse(seen.files.get(STATE) ?? '{}') as { watches: Watch[] }
  seen.files.set(STATE, JSON.stringify({ watches: saved.watches.map(w => ({ ...w, ...change })) }))
}

test('an early failure another instance already reported during the gh calls is not sent again', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'fail'
  seen.rows = [{ name: 'review', bucket: 'pending' }]
  seen.duringChecks = () => otherInstanceRecords(seen, { checks: { build: 'fail', review: 'pending' }, reported: ['build'] })
  await clock.advance(60_000)

  expect(seen.prompts).toEqual([])
})

test('a settlement another instance already woke the session for is not sent again', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'pass'
  await clock.advance(60_000)
  seen.duringChecks = () => otherInstanceRecords(seen, { outcome: 'passed', settledAt: 1 })
  await clock.advance(60_000)

  expect(seen.prompts).toEqual([])
})

test('an early failure still wakes the session when no other instance sent it', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'fail'
  seen.rows = [{ name: 'review', bucket: 'pending' }]
  await clock.advance(60_000)
  await clock.advance(60_000)

  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('build failed; still running: review')
})

test('a merge names its PR, or 0 for the branch PR; other commands are not merges', () => {
  expect(mergedNumber('gh pr merge 1278 --merge --delete-branch')).toBe(1278)
  expect(mergedNumber('gh pr merge --merge #42')).toBe(42)
  expect(mergedNumber('gh pr merge --merge --delete-branch')).toBe(0)
  expect(mergedNumber('gh pr view 1278 --json mergeable')).toBeUndefined()
  expect(mergedNumber('git merge origin/develop')).toBeUndefined()
})

test('a push in another folder is looked up there', () => {
  expect(targetFolder('git -C "C:/repo wt" push -u origin feature/x')).toBe('C:/repo wt')
  expect(targetFolder('cd ../wt-ci && git push')).toBe('../wt-ci')
  expect(targetFolder("Set-Location 'D:/wt'; git push")).toBe('D:/wt')
  expect(targetFolder('git -C /c/Users/me/wt push -q')).toBe('c:/Users/me/wt')
  expect(targetFolder('git push -u origin feature/x')).toBeUndefined()
})