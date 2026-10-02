import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const CONTRACTS = {
  'my-game': {
    'session-close': [
      { step: 'the board check', match: 'board_check\\.py', tools: ['Bash', 'PowerShell'] },
      { step: 'a commit', match: 'git commit' },
    ],
  },
}

type World = { prompts: string[] }

function world(on: On): World {
  const seen: World = { prompts: [] }
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('fs.read', ($, e) => {
    if (e.path.replaceAll('\\', '/') !== 'C:/Users/me/.claude/skill-contracts.json') throw new Error('ENOENT')
    return { value: JSON.stringify(CONTRACTS) }
  })
  on('session.root', () => ({ value: 'C:/Repos/my-game' }))
  on('command.run', () => ({}) as never)
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }) as never)
  return seen
}

async function runSkill($: Engine): Promise<void> {
  await $.command.run({ command: 'session-close', args: '' } as never)
}

async function shell($: Engine, command: string): Promise<void> {
  await $.tool.call({ tool: 'Bash', command } as never)
}

async function endTurn($: Engine): Promise<void> {
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'done' } as never)
}

test('a run that shows every step ends quietly', async ($, on) => {
  const seen = world(on)
  await runSkill($)
  await shell($, 'python tools/board/board_check.py')
  await shell($, 'git commit -q -F msg.txt')
  await endTurn($)
  expect(seen.prompts).toEqual([])
})

test('a run with a missing step gets one follow-up naming it', async ($, on) => {
  const seen = world(on)
  await runSkill($)
  await shell($, 'git commit -q -F msg.txt')
  await endTurn($)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('no sign of the board check')
  await endTurn($)
  expect(seen.prompts.length).toBe(1)
})

test('a skill with no contract is left alone', async ($, on) => {
  const seen = world(on)
  await $.command.run({ command: 'find', args: 'x' } as never)
  await endTurn($)
  expect(seen.prompts).toEqual([])
})
