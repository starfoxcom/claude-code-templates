import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Watch } from '../hooks/register'
import { MKDIR_SCRIPT, claimWake, isPushOrPr, mergedNumber, settle, targetFolder, wakeText } from '../hooks/register'

const BASE: Watch = { repo: 'o/r', number: 7, headSha: 'a1', startedAt: 0, checks: {}, stablePolls: 0 }
const HOUR = 60 * 60_000

test('passed only after two quiet polls in a row', () => {
  const first = settle(BASE, { build: 'pass', review: 'pass' }, 1, HOUR, 1)
  expect(first.outcome).toBeUndefined()
  const second = settle(first, { build: 'pass', review: 'skipping' }, 2, HOUR, 1)
  expect(second.outcome).toBe('passed')
})

test('a failure settles only after every check is done, two quiet polls in a row', () => {
  const quiet = settle(BASE, { build: 'pass' }, 1, HOUR, 1)
  expect(settle(quiet, { build: 'pass', late: 'pending' }, 2, HOUR, 1).stablePolls).toBe(0)
  const running = settle(BASE, { build: 'fail', review: 'pending' }, 1, HOUR, 1)
  expect(running.outcome).toBeUndefined()
  const once = settle(running, { build: 'fail', review: 'fail' }, 2, HOUR, 1)
  expect(once.outcome).toBeUndefined()
  const final = settle(once, { build: 'fail', review: 'fail' }, 3, HOUR, 1)
  expect(final.outcome).toBe('failed')
  expect(wakeText(final)).toContain('failed: build, review')
})

test('two quiet polls seconds apart do not settle: the checks must stay quiet a full poll interval', () => {
  const POLL = 60_000
  const first = settle(BASE, { build: 'fail', review: 'fail' }, 1_000, HOUR, POLL)
  const second = settle(first, { build: 'fail', review: 'fail' }, 6_000, HOUR, POLL)
  expect(second.outcome).toBeUndefined()
  // The new commit's runs show up: the quiet time starts over.
  const pushed = settle(second, { build: 'fail', review: 'pending' }, 30_000, HOUR, POLL)
  expect(pushed.quietSince).toBeUndefined()
  const again = settle(pushed, { build: 'pass', review: 'pass' }, 90_000, HOUR, POLL)
  expect(settle(again, { build: 'pass', review: 'pass' }, 120_000, HOUR, POLL).outcome).toBeUndefined()
  expect(settle(again, { build: 'pass', review: 'pass' }, 150_000, HOUR, POLL).outcome).toBe('passed')
})

test('no checks reported is never a pass; the time limit wakes with what is stuck', () => {
  expect(settle(BASE, {}, 1, HOUR, 1).outcome).toBeUndefined()
  const stuck = settle(BASE, { review: 'pending' }, HOUR + 1, HOUR, 1)
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
  duringChecks?: () => unknown
  /** `gh pr checks` fails (network, auth) with nothing on stdout. */
  isChecksDown?: boolean
  /** Folder makes and file writes, in order. */
  order: string[]
  /** Every write fails (a folder that cannot be made). */
  isWriteDown?: boolean
  /** What `gh pr view --json state` reports. */
  prState: string
}

function world(on: On) {
  const seen: Seen = {
    prompts: [],
    files: new Map(),
    bucket: 'pending',
    rows: [],
    isReadable: false,
    order: [],
    prState: 'OPEN',
  }
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: 's1' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ci-watch__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('fs.write', ($, e) => {
    if (seen.isWriteDown) throw new Error('ENOENT')
    seen.files.set(e.path.replaceAll('\\', '/'), e.text)
    seen.order.push(`write ${e.path.replaceAll('\\', '/')}`)
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const text = seen.isReadable ? seen.files.get(e.path.replaceAll('\\', '/')) : undefined
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('process.run', async ($, e) => {
    const args = e.argv.join(' ')
    if (e.argv[2] === MKDIR_SCRIPT) seen.order.push(`mkdir ${e.argv[3]}`)
    if (args.includes('pr checks')) await seen.duringChecks?.()
    if (args.includes('pr checks') && seen.isChecksDown) {
      return {
        value: {
          exitCode: 1,
          stdout: '',
          stderr: 'error connecting to api.github.com',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    const stdout = args.includes('pr checks')
      ? JSON.stringify([{ name: 'build', bucket: seen.bucket }, ...seen.rows])
      : JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', headRefOid: 'a1', state: seen.prState })
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

const OWNER = 'C:/Users/me/.claude/mods-data/ci-watch/s1.owner'

test('an instance a newer load has replaced stops polling and never wakes the session', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seen.isReadable = true
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  expect(seen.files.get(OWNER)).toBeTruthy()
  // A hot reload: the newer instance names itself in the owner file.
  seen.files.set(OWNER, 'a-newer-instance')
  seen.bucket = 'fail'
  for (let poll = 0; poll < 4; poll++) await clock.advance(60_000)
  expect(seen.prompts).toEqual([])
  // Its hooks pass through too: a push starts no watch here.
  const before = seen.files.get(STATE)
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/y' } as never)
  expect(seen.files.get(STATE)).toBe(before)
})

test('a watch whose save failed is kept from memory and still wakes the session', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  seen.files.set('C:/Users/me/.claude/mods-data/ci-watch/s1.json', JSON.stringify({ watches: [] }))
  seen.isWriteDown = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'pass'
  for (let i = 0; i < 4; i++) await clock.advance(60_000)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('o/r#7: all 1 checks settled')
})

test('watches stopped while saving fails stay stopped, and the save is tried again', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.isWriteDown = true
  await $.command.run({ command: 'ci-watch', args: 'stop' } as never)
  seen.bucket = 'fail'
  for (let i = 0; i < 4; i++) await clock.advance(60_000)
  expect(seen.prompts).toEqual([])
  seen.isWriteDown = false
  await clock.advance(60_000)
  expect(JSON.parse(seen.files.get(STATE) ?? '{}').watches).toEqual([])
})

test('the data folder is made before the first save, and a failed save never fails the push', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  expect(seen.order[0]).toBe('mkdir C:/Users/me/.claude/mods-data/ci-watch')
  expect(seen.order.slice(1)).toContain('write C:/Users/me/.claude/mods-data/ci-watch/s1.json')

  seen.isWriteDown = true
  const pushed = await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  expect(pushed.isError ?? false).toBe(false)
})

const STATE = 'C:/Users/me/.claude/mods-data/ci-watch/s1.json'

// What another live instance (left running by a hot reload) writes once it has woken the session.
function otherInstanceRecords(seen: Seen, change: Partial<Watch>) {
  const saved = JSON.parse(seen.files.get(STATE) ?? '{}') as { watches: Watch[] }
  seen.files.set(STATE, JSON.stringify({ watches: saved.watches.map(w => ({ ...w, ...change })) }))
}

test('a stop made while a poll waits on gh is not undone by that poll', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'fail'
  // The stop finishes while the poll's gh call is still out.
  seen.duringChecks = () => {
    seen.duringChecks = undefined
    return $.command.run({ command: 'ci-watch', args: 'stop' } as never)
  }
  await clock.advance(60_000)
  for (let i = 0; i < 4; i++) await clock.advance(60_000)
  expect(seen.prompts).toEqual([])
  expect(JSON.parse(seen.files.get(STATE) ?? '{}').watches).toEqual([])
})

test('a watch started while a poll waits on gh is kept by that poll', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.duringChecks = () => {
    seen.duringChecks = undefined
    return $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 8, repo: 'o/r' } as never)
  }
  await clock.advance(60_000)
  const saved = JSON.parse(seen.files.get(STATE) ?? '{}') as { watches: Watch[] }
  expect(saved.watches.map(w => w.number).sort()).toEqual([7, 8])
})

test('a settlement another instance woke the session for during the gh calls is not sent again', async ($, on) => {
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

test('a failure wakes the session once, only after every check is done', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'fail'
  seen.rows = [{ name: 'review', bucket: 'pending' }]
  await clock.advance(60_000)
  await clock.advance(60_000)
  expect(seen.prompts).toEqual([])

  seen.rows = [{ name: 'review', bucket: 'pass' }]
  await clock.advance(60_000)
  expect(seen.prompts).toEqual([])
  await clock.advance(60_000)
  await clock.advance(60_000)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('all checks settled; failed: build')
})

test('a failed checks read is not a quiet poll: stale results never settle a watch', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'pass'
  await clock.advance(60_000)
  seen.isChecksDown = true
  await clock.advance(60_000)
  await clock.advance(60_000)
  expect(seen.prompts).toEqual([])

  seen.isChecksDown = false
  await clock.advance(60_000)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('o/r#7: all 1 checks settled')
})

test('each settled watch is claimed for one wake per process', () => {
  const watch: Watch = { ...BASE, id: 'claim-test', outcome: 'passed', settledAt: 1 }
  expect(claimWake(watch)).toBe(true)
  expect(claimWake({ ...watch })).toBe(false)
  expect(claimWake({ ...watch, headSha: 'b2' })).toBe(true)
  expect(claimWake({ ...watch, id: 'claim-test-restarted' })).toBe(true)
})

test('a merge drops the watch only once GitHub says the PR is merged', async ($, on) => {
  const { seen } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  const watched = () => (JSON.parse(seen.files.get(STATE) ?? '{}') as { watches: Watch[] }).watches.map(w => w.number)

  // `--auto` only queues the merge: the PR is still open, so the watch still wakes the session.
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 7 --auto --merge' } as never)
  expect(watched()).toEqual([7])

  seen.prState = 'MERGED'
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 7 --merge' } as never)
  expect(watched()).toEqual([])
})

test('a merge names its PR, or 0 for the branch PR; other commands are not merges', () => {
  expect(mergedNumber('gh pr merge 1278 --merge --delete-branch')).toBe(1278)
  expect(mergedNumber('gh pr merge --merge #42')).toBe(42)
  expect(mergedNumber('gh pr merge --merge --delete-branch')).toBe(0)
  expect(mergedNumber('gh pr view 1278 --json mergeable')).toBeUndefined()
  expect(mergedNumber('git merge origin/develop')).toBeUndefined()
  expect(mergedNumber('gh -R o/r pr merge 9 --merge')).toBe(9)
  expect(mergedNumber('git commit -m "docs: how gh pr merge works"')).toBeUndefined()
  expect(mergedNumber("gh pr comment 5 --body 'run gh pr merge 3 after'")).toBeUndefined()
})

test('a push or a new PR is the subcommand, never words inside a message', () => {
  expect(isPushOrPr('git push origin feature/x')).toBe(true)
  expect(isPushOrPr('git -C "C:/repo wt" push -u origin feature/x')).toBe(true)
  expect(isPushOrPr('git add -u && git commit -m "fix: x" && git push')).toBe(true)
  expect(isPushOrPr('gh pr create --base develop --title "t" --body-file b.md')).toBe(true)
  expect(isPushOrPr('gh -R o/r pr create -t t -b b')).toBe(true)
  expect(isPushOrPr('git commit -m "docs: explain the push guard"')).toBe(false)
  expect(isPushOrPr("gh pr comment 5 --body 'create the gh pr create docs'")).toBe(false)
  expect(isPushOrPr("git commit -F - <<'EOF'\nfix: then git push it\nEOF")).toBe(false)
  expect(isPushOrPr('git log --oneline origin/x..HEAD')).toBe(false)
})

test('a push in another folder is looked up there', () => {
  expect(targetFolder('git -C "C:/repo wt" push -u origin feature/x', true)).toBe('C:/repo wt')
  expect(targetFolder('cd ../wt-ci && git push', true)).toBe('../wt-ci')
  expect(targetFolder("Set-Location 'D:/wt'; git push", true)).toBe('D:/wt')
  expect(targetFolder('git -C /c/Users/me/wt push -q', true)).toBe('c:/Users/me/wt')
  expect(targetFolder('git push -u origin feature/x', true)).toBeUndefined()
  // Elsewhere a one-letter top folder is real.
  expect(targetFolder('git -C /u/me/wt push -q', false)).toBe('/u/me/wt')
})
