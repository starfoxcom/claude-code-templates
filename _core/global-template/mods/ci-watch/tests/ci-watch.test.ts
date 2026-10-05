import { expect, test } from 'claude-code/testing'
import type { Watch } from '../types'
import {
  claimWake,
  HELP,
  isPushOrPr,
  mergedNumber,
  settle,
  targetFolder,
  wakeText,
} from '../hooks/register'
import { type Seen, world } from './world'

const BASE: Watch = { repo: 'o/r', number: 7, headSha: 'a1', startedAt: 0, checks: {}, stablePolls: 0 }
const HOUR = 60 * 60_000
// The default poll interval.
const POLL_MS = 30_000

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

test('once a check ran on this head, the first poll with every check done settles', () => {
  const running = settle(BASE, { build: 'pass', review: 'pending' }, 1, HOUR, 60_000, true)
  expect(running.hasRun).toBe(true)
  expect(running.outcome).toBeUndefined()
  const done = settle(running, { build: 'pass', review: 'fail' }, 2, HOUR, 60_000, true)
  expect(done.outcome).toBe('failed')
})

test('a running check read before GitHub names the new head does not count', () => {
  const stale = settle(BASE, { build: 'pending' }, 1, HOUR, 60_000, false)
  expect(stale.hasRun).toBeUndefined()
  expect(settle(stale, { build: 'pass' }, 2, HOUR, 60_000, true).outcome).toBeUndefined()
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

test('a push starts a watch and the session is woken once when it passes', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)

  const saved = JSON.parse(seen.files.get('C:/Users/me/.claude/mods-data/ci-watch/s1.json') ?? '{}')
  expect(saved.watches?.[0]?.number).toBe(7)

  await clock.advance(POLL_MS)
  expect(seen.prompts).toEqual([])
  seen.bucket = 'pass'
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('o/r#7: all 1 checks settled')
  await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(1)
})

test('a push that moves no commit keeps the settled watch: no second wake', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'pass'
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(1)
  // "Everything up-to-date": the head is the same commit.
  await $.tool.call({ tool: 'Bash', command: 'git push --tags' } as never)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(1)
  // Asked by name, the same head is watched again.
  await $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 7, repo: 'o/r' } as never)
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(2)
})

test('a push GitHub has not seen yet restarts the settled watch once the new head shows', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'fail'
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(1)
  // The fix is pushed, but GitHub still names the old commit when the push asks.
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.head = 'b2'
  seen.bucket = 'pending'
  await clock.advance(POLL_MS)
  const saved = JSON.parse(seen.files.get(STATE) ?? '{}')
  expect(saved.watches?.[0]?.headSha).toBe('b2')
  seen.bucket = 'pass'
  for (let poll = 0; poll < 3; poll++) await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(2)
  expect(seen.prompts[1]).toContain('with no failure')
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
  for (let poll = 0; poll < 4; poll++) await clock.advance(POLL_MS)
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
  for (let i = 0; i < 4; i++) await clock.advance(POLL_MS)
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
  for (let i = 0; i < 4; i++) await clock.advance(POLL_MS)
  expect(seen.prompts).toEqual([])
  seen.isWriteDown = false
  await clock.advance(POLL_MS)
  expect(JSON.parse(seen.files.get(STATE) ?? '{}').watches).toEqual([])
})

test("other sessions' old files are swept once per load, never this session's", async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  expect(seen.order.filter(step => step.startsWith('sweep'))).toEqual([
    'sweep C:/Users/me/.claude/mods-data/ci-watch 2 s1',
  ])
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
  await clock.advance(POLL_MS)
  for (let i = 0; i < 4; i++) await clock.advance(POLL_MS)
  expect(seen.prompts).toEqual([])
  expect(JSON.parse(seen.files.get(STATE) ?? '{}').watches).toEqual([])
})

test('a watch started while a poll reads the saved file is kept by that poll', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.duringStateRead = () => {
    seen.duringStateRead = undefined
    return $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 8, repo: 'o/r' } as never)
  }
  await clock.advance(POLL_MS)
  const saved = JSON.parse(seen.files.get(STATE) ?? '{}') as { watches: Watch[] }
  expect(saved.watches.map(w => w.number).sort()).toEqual([7, 8])
})

test('a poll in flight when a newer load takes over neither saves nor wakes', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'pass'
  await clock.advance(POLL_MS)
  const before = seen.files.get(STATE)
  // The newer load claims the owner file while this poll waits on gh.
  seen.duringChecks = () => {
    seen.duringChecks = undefined
    seen.files.set(OWNER, 'a-newer-instance')
  }
  await clock.advance(POLL_MS)
  expect(seen.prompts).toEqual([])
  expect(seen.files.get(STATE)).toBe(before)
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
  await clock.advance(POLL_MS)
  const saved = JSON.parse(seen.files.get(STATE) ?? '{}') as { watches: Watch[] }
  expect(saved.watches.map(w => w.number).sort()).toEqual([7, 8])
})

test('a settlement another instance woke the session for during the gh calls is not sent again', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'pass'
  await clock.advance(POLL_MS)
  seen.duringChecks = () => otherInstanceRecords(seen, { outcome: 'passed', settledAt: 1 })
  await clock.advance(POLL_MS)

  expect(seen.prompts).toEqual([])
})

test('a failure wakes the session once, on the first poll after every check is done', async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'fail'
  seen.rows = [{ name: 'review', bucket: 'pending' }]
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)
  expect(seen.prompts).toEqual([])

  // A check was seen running on this head, so the results are this commit's: no quiet wait.
  seen.rows = [{ name: 'review', bucket: 'pass' }]
  await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(1)
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('all checks settled; failed: build')
})

test('a failed checks read is not a quiet poll: stale results never settle a watch', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.bucket = 'pass'
  await clock.advance(POLL_MS)
  seen.isChecksDown = true
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)
  expect(seen.prompts).toEqual([])

  seen.isChecksDown = false
  await clock.advance(POLL_MS)
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
  // A here-string feeds one word: the lines after it are still commands.
  expect(isPushOrPr('git commit -F - <<< fixup\ngit push')).toBe(true)
  expect(isPushOrPr('git commit -F - <<<"fixup"\ngit push')).toBe(true)
  expect(mergedNumber('git commit -F - <<< fixup\ngh pr merge 7 --merge')).toBe(7)
  // A `<<WORD` inside a message opens no here-doc; a real one, quoted delimiter and all, still does.
  expect(isPushOrPr('git commit -m "pipe it with <<EOF later"\ngit push')).toBe(true)
  expect(isPushOrPr("git commit -F - <<'EOF'\nthen git push\nEOF")).toBe(false)
  // Each shell's own escape: a backtick escapes nothing in Bash, a backslash nothing in PowerShell.
  const twoMessages = 'git commit -m "docs(ci): describe `ci-watch`" -m "The mod watches after git push."'
  expect(isPushOrPr(twoMessages)).toBe(false)
  expect(isPushOrPr('git commit -m "a `"quoted`" git push word"', true)).toBe(false)
  expect(isPushOrPr('git commit -m "C:\\dir\\" -m "then git push it"', true)).toBe(false)
  expect(isPushOrPr('git commit -m "C:\\dir\\" ; git push', true)).toBe(true)
})

test('a push in another folder is looked up there', () => {
  expect(targetFolder('git -C "C:/repo wt" push -u origin feature/x', true)).toBe('C:/repo wt')
  expect(targetFolder('cd ../wt-ci && git push', true)).toBe('../wt-ci')
  expect(targetFolder("Set-Location 'D:/wt'; git push", true)).toBe('D:/wt')
  expect(targetFolder('git -C /c/Users/me/wt push -q', true)).toBe('c:/Users/me/wt')
  expect(targetFolder('git push -u origin feature/x', true)).toBeUndefined()
  // A `cd` on a line of its own, and every `cd` before the push, in order; none after it.
  expect(targetFolder('cd ../wt-ci\ngit push -u origin feature/x', true)).toBe('../wt-ci')
  expect(targetFolder('cd a; cd b; git push', true)).toBe('a/b')
  expect(targetFolder('cd a\ncd /c/wt\ngit push', true)).toBe('c:/wt')
  expect(targetFolder('git push && cd ../other', true)).toBeUndefined()
  // Words inside a message or a here-doc steer nothing; a `-C` on another statement is not the push's.
  expect(targetFolder('git commit -m "fix: git push hook"\ncd ../wt\ngit push', true)).toBe('../wt')
  expect(targetFolder('git commit -m "see git -C x"\ncd ../wt\ngit push', true)).toBe('../wt')
  expect(targetFolder('git -C other status; cd wt; git push', true)).toBe('wt')
  expect(targetFolder('git commit -m "fix; cd foo" && git push', true)).toBeUndefined()
  expect(targetFolder("git commit -F - <<'EOF'\ncd elsewhere\nEOF\ngit push", true)).toBeUndefined()
  expect(targetFolder("Set-Location 'D:/a b'; git push", true, true)).toBe('D:/a b')
  // Elsewhere a one-letter top folder is real.
  expect(targetFolder('git -C /u/me/wt push -q', false)).toBe('/u/me/wt')
})

test('/ci-watch shows its verbs in the menu, and help or an unknown verb lists them', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  expect(seen.commands).toEqual([{ name: 'ci-watch', argumentHint: '[help | settings | stop | phone]' }])
  for (const args of ['help', 'stopp']) {
    const answer = await $.command.run({ command: 'ci-watch', args } as never)
    expect(answer).toEqual(expect.objectContaining({ text: HELP }))
  }
})

test('/ci-watch answers in the row words, and phone adds each check and the link', async ($, on) => {
  const { seen, clock } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  const ask = async (args: string) =>
    ((await $.command.run({ command: 'ci-watch', args } as never)) as { text: string }).text.split('\n')
  expect(await ask('phone')).toEqual(['No PR is being watched.', '/ci-watch help for more'])
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.rows = [
    { name: 'review', bucket: 'pass' },
    { name: 'build', bucket: 'pending' },
  ]
  await clock.advance(POLL_MS)
  // A count of finished checks, never of passed ones under the word "done".
  expect(await ask('')).toEqual(['⏳ PR 7 · 1/2 done (o/r)'])
  // The checks in the row's own order, which is the order they were first seen.
  const phone = await ask('phone')
  expect(phone[0]).toBe('⏳ PR 7 · 1/2 done')
  expect(phone.slice(1, 3).sort()).toEqual(['   ⏳ build', '   ✅ review'])
  expect(phone.slice(3)).toEqual(['   https://github.com/o/r/pull/7', '/ci-watch help for more'])
})

test('a bare /ci-watch typed over Remote Control answers with the phone text', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  const bridge = { command: 'ci-watch', args: '', origin: { kind: 'bridge' } }
  const answer = (await $.command.run(bridge as never)) as { text: string }
  expect(answer.text.split('\n')).toEqual(['No PR is being watched.', '/ci-watch help for more'])
})
