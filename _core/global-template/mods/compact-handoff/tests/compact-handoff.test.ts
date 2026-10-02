import type { On, SessionMessage } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { PERSON_MARK, personWords } from '../hooks/register'

const SESSION = 'sess-1'

function said(text: string): SessionMessage {
  return { role: 'user', text, toolUses: [] }
}

const CONVERSATION: SessionMessage[] = [
  said('Lock the far rings at 2/1/1/1, the load chip was too slow.'),
  { role: 'assistant', text: 'Locked.', toolUses: [] },
  { role: 'user', text: 'file contents', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'x', isError: false, result: 'x' }] },
  said('<system-reminder>not the person</system-reminder>'),
  said('Keep cloud shadows ON from frame one.\n[session-facts] 2026-10-02 10:00 | ctx 40%\n[tasks] Open: #1 Bake the rings.'),
  // Prompts the other mods submit are not the person's words either.
  said('[ci-watch] #12: all 3 checks settled with no failure. Verify it is mergeable.'),
  said('[usage-guard] Plan usage limit nearly reached (automatic wrap-up).\n[session-facts] 2026-10-02 10:05 | ctx 41%'),
]

type World = {
  writes: { path: string; text: string }[]
  runs: (readonly string[])[]
  forks: string[]
  registered: string[]
  clock: ReturnType<typeof mock.clock>
}
type Run = { exitCode: number; stdout: string } | 'reject'

function world(on: On, helperRuns: Record<string, Run> = {}): World {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 17, 0, 0) })
  const seen: World = { writes: [], runs: [], forks: [], registered: [], clock }
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: SESSION }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 100_000, window: 1_000_000, breakdown: { autoCompactThreshold: 500_000 } as never },
      rateLimits: [],
    },
  }))
  on('fs.write', ($, e) => {
    seen.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    seen.runs.push(e.argv)
    const run = helperRuns[e.argv[2] ?? ''] ?? { exitCode: 0, stdout: 'found it\n' }
    if (run === 'reject') throw new Error('spawn node ENOENT')
    const out = { ...run, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    return { value: out }
  })
  on('model.fork', ($, e) => {
    seen.forks.push(e.prompt)
    return { value: { isAnswered: true, text: '## Doing\nshadow hand-off', usage: {} as never } }
  })
  on('tool.register', ($, e) => {
    seen.registered.push(e.name)
    return { value: { tool: `mcp__compact-handoff__${e.name}` } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return seen
}

async function start($: Engine) {
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
}

test('on: the hand-off instructions reach the summarizer and the person is kept word for word', { options: { mode: 'on' } }, async ($, on) => {
  const seen = world(on)
  let instructions: string | undefined
  on('session.compact', ($, e) => {
    instructions = e.instructions
    return { messages: [{ role: 'user', text: 'SUMMARY', toolUses: [] }, said('kept tail')] }
  })
  await start($)
  const result = await $.session.compact({ trigger: 'manual', instructions: 'stress the rings', messages: CONVERSATION } as never)

  expect(instructions).toContain('## Read next')
  expect(instructions).toContain('about 12500 tokens')
  expect(instructions).toContain('stress the rings')
  const texts = (result.messages ?? []).map(m => m.text)
  expect(texts[0]).toBe('SUMMARY')
  expect(texts[1]).toContain(PERSON_MARK)
  expect(texts[1]).toContain('Lock the far rings at 2/1/1/1')
  expect(texts[1]).toContain('Keep cloud shadows ON from frame one.')
  expect(texts[1]).not.toContain('[session-facts]')
  expect(texts[1]).not.toContain('[tasks]')
  expect(texts[1]).not.toContain('[ci-watch]')
  expect(texts[1]).not.toContain('[usage-guard]')
  expect(texts[1]).not.toContain('automatic wrap-up')
  expect(texts[1]).not.toContain('system-reminder')
  expect(texts[1]).not.toContain('file contents')
  expect(texts[2]).toBe('kept tail')
  expect(seen.writes.at(-1)?.path.replaceAll('\\', '/')).toBe('C:/Users/me/.claude/mods-data/compact-handoff/sess-1.md')
})

test('on: an ahead-of-time summary gets the same hand-off brief, so the real compaction can reuse it', { options: { mode: 'on' } }, async ($, on) => {
  const seen = world(on)
  let instructions: string | undefined
  on('session.compact', ($, e) => {
    instructions = e.instructions
    return { messages: [{ role: 'user', text: 'SUMMARY', toolUses: [] }] }
  })
  await start($)
  await $.session.compact({ trigger: 'precompute', messages: CONVERSATION } as never)

  expect(instructions).toContain('## Read next')
  expect(seen.writes.at(-1)?.path.replaceAll('\\', '/')).toBe('C:/Users/me/.claude/mods-data/compact-handoff/sess-1-precompute.md')
})

test('shadow: the stock compaction stands and the hand-off is recorded beside it', { options: { mode: 'shadow' } }, async ($, on) => {
  const seen = world(on)
  let instructions: string | undefined = 'unset'
  on('session.compact', ($, e) => {
    instructions = e.instructions
    return { messages: [{ role: 'user', text: 'STOCK SUMMARY', toolUses: [] }] }
  })
  await start($)
  const result = await $.session.compact({ trigger: 'auto', messages: CONVERSATION } as never)

  expect(instructions).toBeUndefined()
  expect(result.messages?.[0]?.text).toBe('STOCK SUMMARY')
  expect(result.messages?.length).toBe(1)
  expect(seen.forks[0]).toContain('## Owed to the person')
  const file = seen.writes.at(-1)
  expect(file?.path.replaceAll('\\', '/')).toContain('/mods-data/compact-handoff/sess-1-2026-10-02T17-00-00-000Z-shadow.md')
  expect(file?.text).toContain('STOCK SUMMARY')
  expect(file?.text).toContain('shadow hand-off')
  expect(file?.text).toContain('Lock the far rings')
})

test('the recall tool searches the transcript through the helper', { options: { mode: 'on' } }, async ($, on) => {
  const seen = world(on)
  await start($)
  expect(seen.registered).toEqual(['recall'])
  const answer = await $.tool.call({ tool: 'mcp__compact-handoff__recall', query: 'far rings' } as never)

  expect((answer as { result?: unknown }).result).toBe('found it')
  const call = seen.runs.find(argv => argv.includes('recall'))
  expect(call?.slice(2)).toEqual(['recall', SESSION, '6000', 'far rings'])
})

test('the transcript list is used when the helper finds it', { options: { mode: 'on' } }, async ($, on) => {
  world(on, { persons: { exitCode: 0, stdout: '["typed while a turn ran"]\n' } })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'SUMMARY', toolUses: [] }] }))
  await start($)
  const result = await $.session.compact({ trigger: 'manual', messages: CONVERSATION } as never)

  expect(result.messages?.[1]?.text).toContain('typed while a turn ran')
  expect(result.messages?.[1]?.text).not.toContain('Lock the far rings')
})

test("a failed helper falls back to the compaction's own messages", { options: { mode: 'on' } }, async ($, on) => {
  // No transcript under this session id: the helper exits non-zero.
  world(on, { persons: { exitCode: 1, stdout: '[]\n' } })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'SUMMARY', toolUses: [] }] }))
  await start($)
  const result = await $.session.compact({ trigger: 'manual', messages: CONVERSATION } as never)

  expect(result.messages?.[1]?.text).toContain('Lock the far rings at 2/1/1/1')
  expect(result.messages?.[1]?.text).toContain('Keep cloud shadows ON from frame one.')
})

test('a sweep that cannot start node does not fail the session start', { options: { mode: 'on' } }, async ($, on) => {
  const seen = world(on, { sweep: 'reject' })
  await start($)
  // The sweep is not awaited by session.start; let its chain run (an unhandled rejection fails the file).
  await seen.clock.settle()

  expect(seen.registered).toEqual(['recall'])
  expect(seen.runs.some(argv => argv.includes('sweep'))).toBe(true)
})

test('off: no tool, no rewrite', { options: { mode: 'off' } }, async ($, on) => {
  const seen = world(on)
  let instructions: string | undefined = 'unset'
  on('session.compact', ($, e) => {
    instructions = e.instructions
    return { messages: [{ role: 'user', text: 'STOCK', toolUses: [] }] }
  })
  await start($)
  await $.session.compact({ trigger: 'auto', messages: CONVERSATION } as never)

  expect(seen.registered).toEqual([])
  expect(instructions).toBeUndefined()
  expect(seen.writes).toEqual([])
})

test('over budget, the oldest words become an index and later compactions carry everything forward', async () => {
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(letter => letter.repeat(150))
  const first = personWords([said(a ?? ''), said(b ?? ''), said(c ?? '')], 350)
  expect(first).toContain(`- ${'A'.repeat(100)}...`)
  expect(first).not.toContain(a ?? '')
  expect(first).toContain(b ?? '')
  expect(first).toContain(c ?? '')

  const second = personWords([said(first), said(d ?? '')], 10_000)
  expect(second).toContain(`- ${'A'.repeat(100)}...`)
  expect(second).toContain(b ?? '')
  expect(second).toContain(d ?? '')
  expect(second.indexOf(b ?? '')).toBeLessThan(second.indexOf(d ?? ''))
})

test('a bracket tag the person types is their words; only the mods\' tags are dropped', async () => {
  const words = personWords([said('[x] done with the parser'), said('[wip] split the loader\n[tasks] Open: #3'), said('[tasks] Open: #4')], 10_000)
  expect(words).toContain('[x] done with the parser')
  expect(words).toContain('[wip] split the loader')
  expect(words).not.toContain('[tasks]')
})

test('a message the last compaction kept beside its summary is carried once', async () => {
  const first = personWords([said('lock the rings'), said('bake the shadows')], 10_000)
  // The engine kept "bake the shadows" as the tail, so it is in the next list as well as in the block.
  const second = personWords([said(first), said('bake the shadows'), said('ship it')], 10_000)
  expect(second.split('bake the shadows').length - 1).toBe(1)
  expect(second.indexOf('bake the shadows')).toBeLessThan(second.indexOf('ship it'))
})
