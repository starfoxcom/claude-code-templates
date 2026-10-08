import { expect, test } from 'claude-code/testing'

import { isPush } from '../hooks/command'
import { redRounds, ROUND_LIMIT, type RoundNode } from '../hooks/rounds'
import { world } from './world'

const nodes = (states: (string | null)[]): RoundNode[] =>
  states.map((state, i) => ({ commit: { oid: `c${i}`, statusCheckRollup: state === null ? null : { state } } }))

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
  expect(redRounds(nodes(reds(8)), 'c4')).toBe(3)
  expect(redRounds(nodes(reds(8)), 'c7')).toBe(0)
})

test('only a push is held to the limit, not a PR create or a message naming a push', () => {
  expect(isPush('git push origin feature/x')).toBe(true)
  expect(isPush('git -C repo push -q origin x 2>&1 | tail -1')).toBe(true)
  expect(isPush('gh pr create --base develop --title t --body-file b.md')).toBe(false)
  expect(isPush('git commit -m "push the fix"')).toBe(false)
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
    { tool: 'Bash', command: `echo '{}' > ${path}` },
    { tool: 'PowerShell', command: `Set-Content '${path}' '{}'` },
  ]
  for (const call of calls) {
    const answer = (await $.tool.call(call as never)) as { deny?: string }
    expect([call.tool, answer.deny]).toEqual([call.tool, expect.stringContaining('only `/ci-watch rounds reset`')])
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
  expect(JSON.parse(seen.files.get(path) ?? '{}')).toEqual({ 'o/r#7': 'c6' })
  expect(await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)).not.toHaveProperty('deny')
  seen.rollups = reds(13)
  const past = (await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)) as { deny?: string }
  expect(past.deny).toContain('6 fix rounds in a row')
})
