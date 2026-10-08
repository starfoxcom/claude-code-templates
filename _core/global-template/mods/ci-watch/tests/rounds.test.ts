import { expect, test } from 'claude-code/testing'

import { isPush, pushesBranch } from '../hooks/command'
import { type PrRounds, recordRound, redStreak, ROUND_LIMIT } from '../hooks/rounds'
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

// Newest first, back to the last round that passed; the user's reset empties the list.
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

test('only a push is held to the limit, not a PR create or a message naming a push', () => {
  expect(isPush('git push origin feature/x')).toBe(true)
  expect(isPush('git -C repo push -q origin x 2>&1 | tail -1')).toBe(true)
  expect(isPush('gh pr create --base develop --title t --body-file b.md')).toBe(false)
  expect(isPush('git commit -m "push the fix"')).toBe(false)
})

test("only a push that updates the PR's own branch adds to its rounds", () => {
  for (const command of [
    'git push',
    'git push origin feature/x',
    'git push -u origin feature/x',
    'git push origin HEAD',
    'git push -o ci.skip origin +feature/x',
    'git push origin x:refs/heads/feature/x',
    'git push --all origin',
    'git add -A && git commit -m x && git push -q origin feature/x 2>&1 | tail -1',
    // Redirects and a comment after the remote: still the branch itself.
    'git push origin 2>&1 | tail -3',
    'git push origin > log 2>&1',
    'git push origin >/dev/null 2>&1',
    'git push origin   # retry',
    'git push origin :',
    // Words the shell fills in when it runs cannot be read for sure: they count as this branch.
    'git push origin "feature/x"',
    'git push -u origin "$(git branch --show-current)"',
    'git push -u origin $(git branch --show-current)',
    'git push origin $branch',
    'git push origin @',
    // A remote given as an SSH address: `@` inside a word is plain.
    'git push git@github.com:o/r.git',
    'git push git@github.com:o/r.git HEAD',
    // A group of short flags: the `o` takes the next word, or the rest of the group, as its value.
    'git push -fo ci.skip origin',
    'git push -uoci.skip origin',
    // Git's short spellings of the branch, and an option whose value is the next word.
    'git push origin HEAD:heads/feature/x',
    'git push origin heads/feature/x',
    'git push --recurse-submodules on-demand origin',
    // An option git knows, with its value after `=`, keeps the rest readable.
    'git push --force-with-lease=feature/x:abc origin feature/x',
    // An option outside git's list (or `--`, or an abbreviation) cannot be read for sure.
    'git push -4o origin feature/other',
    'git push --frobnicate origin feature/other',
    'git push -- origin feature/other',
    'git push --forc origin feature/other',
  ]) {
    expect([command, pushesBranch(command, 'feature/x')]).toEqual([command, true])
  }
  // In PowerShell a comma makes several arguments of one word.
  for (const command of [
    'git push origin 2>$null',
    'git push origin *>&1 | Out-Null',
    'git push origin $b',
    'git push origin x,feature/x',
  ]) {
    expect([command, pushesBranch(command, 'feature/x', true)]).toEqual([command, true])
  }
  for (const command of [
    'git push origin v1.3.0',
    'git push --tags',
    'git push origin --tags',
    'git push origin HEAD:feature/new-direction',
    'git push origin feature/other',
    'git push origin --delete feature/x',
    'git push origin :feature/x',
    'git push origin +:feature/x',
    'git push -d origin "$b"',
    'git push origin v1.3.0 2>&1 | tail -3',
    'git push git@github.com:o/r.git v1.0',
    'git push -fd origin feature/x',
    'git push git@github.com:o/r.git --tags',
    'git push ssh://git@github.com/o/r.git feature/other',
    'git push -4 -v --atomic origin feature/other',
    'git push -6o ci.skip origin feature/other',
  ]) {
    expect([command, pushesBranch(command, 'feature/x')]).toEqual([command, false])
  }
})

test(`a push to a PR past ${ROUND_LIMIT} red rounds is refused, one below passes`, async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seed(seen, ['SUCCESS', ...reds(ROUND_LIMIT - 1)])
  const below = await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  expect(below).not.toHaveProperty('deny')
  seed(seen, ['SUCCESS', ...reds(ROUND_LIMIT)])
  for (const tool of ['Bash', 'PowerShell']) {
    const past = (await $.tool.call({ tool, command: 'git push origin feature/x' } as never)) as { deny?: string }
    expect(past.deny).toContain('endless round hunt')
    expect(past.deny).toContain('o/r#7 has had 6 fix rounds in a row')
    expect(past.deny).toContain('/ci-watch rounds reset 7')
  }
  const created = await $.tool.call({ tool: 'Bash', command: 'gh pr create -t t --body-file b.md' } as never)
  expect(created).not.toHaveProperty('deny')
})

test("past the limit, a tag, another branch, another folder's push or a closed PR is not refused", async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seed(seen, reds(ROUND_LIMIT))
  const deny = async (command: string) =>
    ((await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }).deny
  expect(await deny('git push origin v1.3.0')).toBeUndefined()
  expect(await deny('git push origin HEAD:feature/new-direction')).toBeUndefined()
  // The other folder's branch has no PR yet: the session folder's PR is never asked about instead.
  seen.noPrIn = '../wt'
  expect(await deny('git -C ../wt push -u origin feature/b')).toBeUndefined()
  seen.prState = 'CLOSED'
  expect(await deny('git push origin feature/x')).toBeUndefined()
  seen.prState = 'OPEN'
  expect(await deny('git push origin feature/x')).toContain('endless round hunt')
})

// A hot reload leaves the older instance's hooks running beside the newer one's: only the live one judges,
// so a fix to a false refusal is never overruled by the code it replaced.
test('an instance a newer load has replaced judges no push', async ($, on) => {
  const { seen } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  // This instance takes the owner file on its first push, then a hot reload's newer one takes it over.
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seen.files.set('C:/Users/me/.claude/mods-data/ci-watch/s1.owner', 'a-newer-instance')
  seed(seen, reds(ROUND_LIMIT))
  seen.ghCalls = []
  expect(await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)).not.toHaveProperty('deny')
  expect(seen.ghCalls).toEqual([])
})

test("the count's file is the user's: no tool call may write it", async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  const calls = [
    { tool: 'Write', file_path: path, content: '{}' },
    { tool: 'Edit', file_path: path.replaceAll('/', '\\'), old_string: 'a', new_string: 'b' },
    { tool: 'NotebookEdit', notebook_path: path, new_source: '' },
    { tool: 'Bash', command: `echo '{}' > ${path}` },
    { tool: 'Bash', command: `cat ${path} > /tmp/x; cp /tmp/x ${path}` },
    { tool: 'PowerShell', command: `Set-Content '${path}' '{}'` },
  ]
  for (const call of calls) {
    const answer = (await $.tool.call(call as never)) as { deny?: string }
    expect([call.tool, answer.deny]).toEqual([call.tool, expect.stringContaining('only `/ci-watch rounds reset`')])
  }
})

test("a plain read of the count's file passes", async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  for (const call of [
    { tool: 'Bash', command: `cat ${path}` },
    { tool: 'PowerShell', command: `Get-Content '${path}'` },
  ]) {
    const answer = (await $.tool.call(call as never)) as { deny?: string }
    expect([call.command, answer.deny]).toEqual([call.command, undefined])
  }
})

test('/ci-watch rounds tells the count; a reset not typed by the user changes nothing', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seed(seen, reds(7))
  const ask = async (args: string) =>
    ((await $.command.run({ command: 'ci-watch', args } as never)) as { text: string }).text
  expect(await ask('rounds')).toContain('o/r#7: 7 fix round(s) in a row')
  expect(await ask('rounds 7')).toContain('o/r#7: 7 fix round(s) in a row')
  expect(await ask('rounds reset 7')).toBe('Only the user resets the fix-round count.')
  expect(JSON.parse(seen.files.get(path) ?? '{}')['o/r#7'].rounds).toHaveLength(7)
  expect(await ask('rounds again')).toContain('/ci-watch rounds')
})

test("the user's reset clears the count", async ($, on) => {
  const { seen } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seed(seen, reds(7))
  seen.head = 'c6'
  const typed = { command: 'ci-watch', args: 'rounds reset 7', origin: { kind: 'composer' } }
  const answer = (await $.command.run(typed as never)) as { text: string }
  expect(answer.text).toContain('Reset the fix-round count of o/r#7')
  expect(JSON.parse(seen.files.get(path) ?? '{}')).toEqual({ 'o/r#7': { rounds: [] } })
  expect(await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)).not.toHaveProperty('deny')
  seed(seen, reds(ROUND_LIMIT))
  const past = (await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)) as { deny?: string }
  expect(past.deny).toContain('6 fix rounds in a row')
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

// A reset another session writes while a round is being added is the state the round adds to: the file
// is read once, right before the write, with nothing in between that could let a reset land unseen.
test("a round adds to the count file as read right before its write", async ($, on) => {
  const { seen, clock } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seen.bucket = 'fail'
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  seed(seen, reds(5))
  seen.order = []
  for (let i = 0; i < 6; i++) await clock.advance(30_000)
  expect(seen.order.filter(step => step.endsWith('/rounds.json'))).toEqual([`read ${path}`, `write ${path}`])
  expect(redStreak(JSON.parse(seen.files.get(path) ?? '{}')['o/r#7'])).toBe(6)
})
