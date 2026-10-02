import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Watch } from '../hooks/register'
import { mergedNumber, settle, wakeText } from '../hooks/register'

const BASE: Watch = { repo: 'o/r', number: 7, headSha: 'a1', startedAt: 0, checks: {}, stablePolls: 0 }
const HOUR = 60 * 60_000

test('passed only after two quiet polls in a row', () => {
  const first = settle(BASE, { build: 'pass', review: 'pass' }, 1, HOUR)
  expect(first.outcome).toBeUndefined()
  const second = settle(first, { build: 'pass', review: 'skipping' }, 2, HOUR)
  expect(second.outcome).toBe('passed')
})

test('a pending check resets the quiet count, a failed one settles at once', () => {
  const quiet = settle(BASE, { build: 'pass' }, 1, HOUR)
  expect(settle(quiet, { build: 'pass', late: 'pending' }, 2, HOUR).stablePolls).toBe(0)
  const failed = settle(BASE, { build: 'fail', review: 'pending' }, 1, HOUR)
  expect(failed.outcome).toBe('failed')
  expect(wakeText(failed)).toContain('build failed')
})

test('no checks reported is never a pass; the time limit wakes with what is stuck', () => {
  expect(settle(BASE, {}, 1, HOUR).outcome).toBeUndefined()
  const stuck = settle(BASE, { review: 'pending' }, HOUR + 1, HOUR)
  expect(stuck.outcome).toBe('timeout')
  expect(wakeText(stuck)).toContain('review')
})

function world(on: On) {
  const seen = { prompts: [] as string[], files: new Map<string, string>(), bucket: 'pending' }
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
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('process.run', ($, e) => {
    const args = e.argv.join(' ')
    const stdout = args.includes('pr checks')
      ? JSON.stringify([{ name: 'build', bucket: seen.bucket }])
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

test('a merge names its PR, or 0 for the branch PR; other commands are not merges', () => {
  expect(mergedNumber('gh pr merge 1278 --merge --delete-branch')).toBe(1278)
  expect(mergedNumber('gh pr merge --merge #42')).toBe(42)
  expect(mergedNumber('gh pr merge --merge --delete-branch')).toBe(0)
  expect(mergedNumber('gh pr view 1278 --json mergeable')).toBeUndefined()
  expect(mergedNumber('git merge origin/develop')).toBeUndefined()
})