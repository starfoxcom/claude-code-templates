import { expect, test } from 'claude-code/testing'

import { isPush, pushesBranch } from '../hooks/command'
import { redRounds, ROUND_LIMIT, type RoundNode } from '../hooks/rounds'
import { rollupOf, world } from './world'

const nodes = (results: (string | null)[]): RoundNode[] =>
  results.map((result, i) => ({ commit: { oid: `c${i}`, statusCheckRollup: rollupOf(result) } }))

const RED = 'FAILURE'
const reds = (n: number) => Array.from({ length: n }, () => RED)
const path = 'C:/Users/me/.claude/mods-data/ci-watch/rounds.json'

// Newest first, back to the last round that passed or the user's reset; commits with no checks or with
// checks still running are not rounds.
test('red rounds count back to a green round or the reset', () => {
  expect(redRounds(nodes([]))).toBe(0)
  expect(redRounds(nodes(reds(6)))).toBe(6)
  expect(redRounds(nodes([...reds(3), 'SUCCESS', ...reds(2)]))).toBe(2)
  expect(redRounds(nodes([RED, null, RED, 'ERROR', 'PENDING']))).toBe(3)
  expect(redRounds(nodes(reds(8)), { sha: 'c4' })).toBe(3)
  expect(redRounds(nodes(reds(8)), { sha: 'c7' })).toBe(0)
})

// The reset at c5, then `git reset --hard c2` and a new commit d1 force-pushed: c5 leaves the PR, and c2..c0
// ran their checks before the reset.
test('a history rewritten after the reset does not bring back the rounds before it', () => {
  const at = (s: number) => `2026-10-08T10:00:0${s}Z`
  const ran = (oid: string, startedAt: string): RoundNode => ({
    commit: { oid, statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [{ conclusion: RED, startedAt }] } } },
  })
  const rewritten = [ran('c0', at(0)), ran('c1', at(1)), ran('c2', at(2)), ran('d1', at(8))]
  expect(redRounds(rewritten, { sha: 'c5', at: Date.parse(at(5)) })).toBe(1)
  expect(redRounds(rewritten, { sha: 'c5' })).toBe(4)
  // A status context reports its own time; a commit with no time is read as before.
  const contexts = { nodes: [{ state: 'ERROR', createdAt: at(1) }] }
  const status: RoundNode = { commit: { oid: 's', statusCheckRollup: { state: 'ERROR', contexts } } }
  expect(redRounds([status, ...nodes(reds(2))], { at: Date.parse(at(5)) })).toBe(2)
})

// A quick second push cancels the first one's runs (`concurrency: cancel-in-progress`): GitHub shows that
// commit red, but nothing in it failed.
test('a commit whose runs a newer push cancelled is no round', () => {
  expect(redRounds(nodes([RED, 'CANCELLED', RED, 'CANCELLED', RED]))).toBe(3)
  expect(redRounds(nodes([...reds(3), ...Array.from({ length: 6 }, () => 'CANCELLED')]))).toBe(3)
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
    // Git's short spellings of the branch, and an option whose value is the next word.
    'git push origin HEAD:heads/feature/x',
    'git push origin heads/feature/x',
    'git push --recurse-submodules on-demand origin',
  ]) {
    expect([command, pushesBranch(command, 'feature/x')]).toEqual([command, true])
  }
  for (const command of ['git push origin 2>$null', 'git push origin *>&1 | Out-Null', 'git push origin $b']) {
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
    'git push git@github.com:o/r.git --tags',
    'git push ssh://git@github.com/o/r.git feature/other',
  ]) {
    expect([command, pushesBranch(command, 'feature/x')]).toEqual([command, false])
  }
})

test(`a push to a PR past ${ROUND_LIMIT} red rounds is refused, one below passes`, async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seen.rollups = ['SUCCESS', ...reds(ROUND_LIMIT - 1)]
  const below = await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  expect(below).not.toHaveProperty('deny')
  seen.rollups = ['SUCCESS', ...reds(ROUND_LIMIT)]
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
  seen.rollups = reds(ROUND_LIMIT)
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
  seen.rollups = reds(ROUND_LIMIT)
  seen.ghCalls = []
  expect(await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)).not.toHaveProperty('deny')
  expect(seen.ghCalls).toEqual([])
})

test('owner and repo names go to GitHub as strings, so an all-digit one still counts', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
  const query = seen.ghCalls.find(c => c.includes('api graphql')) ?? ''
  expect(query).toContain('-f owner=o -f name=r -F number=7')
})

test('a command that is no push asks GitHub nothing', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  expect(seen.ghCalls.filter(c => c.includes('graphql'))).toEqual([])
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
  seen.rollups = reds(7)
  const ask = async (args: string) =>
    ((await $.command.run({ command: 'ci-watch', args } as never)) as { text: string }).text
  expect(await ask('rounds')).toContain('o/r#7: 7 fix round(s) in a row')
  expect(await ask('rounds 7')).toContain('o/r#7: 7 fix round(s) in a row')
  expect(await ask('rounds reset 7')).toBe('Only the user resets the fix-round count.')
  expect(seen.files.has(path)).toBe(false)
  expect(await ask('rounds again')).toContain('/ci-watch rounds')
})

test("the user's reset clears the count from the head it was typed on", async ($, on) => {
  const { seen } = world(on)
  seen.isReadable = true
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  seen.rollups = reds(7)
  seen.head = 'c6'
  const typed = { command: 'ci-watch', args: 'rounds reset 7', origin: { kind: 'composer' } }
  const answer = (await $.command.run(typed as never)) as { text: string }
  expect(answer.text).toContain('Reset the fix-round count of o/r#7')
  expect(JSON.parse(seen.files.get(path) ?? '{}')).toEqual({ 'o/r#7': { sha: 'c6', at: 1_000 } })
  expect(await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)).not.toHaveProperty('deny')
  seen.rollups = reds(13)
  const past = (await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)) as { deny?: string }
  expect(past.deny).toContain('6 fix rounds in a row')
})
