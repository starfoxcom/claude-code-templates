import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { LOOKS, summary } from '../hooks/view'
import type { Watch } from '../types'
import { world } from './world'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
const SURFACES = ['terminal', 'desktop'] as const
const BASE: Watch = { repo: 'o/r', number: 7, headSha: 'a1', startedAt: 0, checks: {}, stablePolls: 0 }

const SUMMARY_CASES: { name: string; watch: Partial<Watch>; text: string; color: string }[] = [
  {
    name: 'running',
    watch: { checks: { a: 'pass', b: 'pending' } },
    text: '⏳ PR 7 · 1/2 done',
    color: 'yellow',
  },
  {
    name: 'passed',
    watch: { checks: { a: 'pass', b: 'skipping' }, outcome: 'passed' },
    text: '✅ PR 7 · all 2 passed',
    color: 'green',
  },
  {
    name: 'failed',
    watch: { checks: { a: 'fail', b: 'cancel', c: 'pass' } },
    text: '❌ PR 7 · failed: a, b',
    color: 'red',
  },
  {
    name: 'failed while others still run',
    watch: { checks: { a: 'fail', b: 'pending', c: 'pass' } },
    text: '⏳ PR 7 · 2/3 done · failed so far: a',
    color: 'red',
  },
  {
    name: 'timed out',
    watch: { checks: { a: 'pending' }, outcome: 'timeout' },
    text: '⏰ PR 7 · stuck pending',
    color: 'yellow',
  },
  {
    name: 'all passed, not yet settled',
    watch: { checks: { a: 'pass', b: 'skipping' } },
    text: '⏳ PR 7 · all 2 passed, confirming',
    color: 'green',
  },
  {
    name: 'some still running',
    watch: { checks: { a: 'pass', b: 'pending' } },
    text: '⏳ PR 7 · 1/2 done',
    color: 'yellow',
  },
  { name: 'no checks yet', watch: {}, text: '⏳ PR 7 · 0/0 done', color: 'yellow' },
]

for (const { name, watch, text, color } of SUMMARY_CASES) {
  test(`summary: ${name}`, () => {
    expect(summary({ ...BASE, ...watch })).toEqual({ text, color })
  })
}

test('every check state has its own icon, colored by what it asks of you', () => {
  expect(LOOKS).toEqual({
    pass: { icon: '✅', color: 'green' },
    fail: { icon: '❌', color: 'red' },
    cancel: { icon: '🚫', color: 'red' },
    pending: { icon: '⏳', color: 'yellow' },
    skipping: { icon: '➖', color: 'gray' },
  })
})

async function pushed($: Engine, surface: 'terminal' | 'desktop'): Promise<void> {
  if (surface === 'terminal') await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  else await $.session.start({ cwd: 'C:/repo', surface: null, isInteractive: false } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature/x' } as never)
}

for (const surface of SURFACES) {
  test(`${surface}: a watched PR shows its row, its checks and a link to it`, async ($, on) => {
    const { seen, clock } = world(on)
    seen.rows = [{ name: 'review', bucket: 'fail' }]
    await pushed($, surface)
    await clock.advance(60_000)
    const ui = await $.ui.mount({ plugin: 'ci-watch', surface, component: 'AbovePrompt', props: PROPS })
    // The build still runs, so the row says so beside the failure.
    expect(await ui.find({ type: 'Text', text: /PR 7 · 1\/2 done · failed so far: review/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', href: 'https://github.com/o/r/pull/7' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /❌ review/ })).toBeUndefined()
    await ui.press({ key: 'ci-watch-checks-o/r#7' })
    // Each check in its state's icon and color, as the tasks list draws its states.
    expect(await ui.find({ type: 'Text', text: /❌ review/, color: 'red' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⏳ build/, color: 'yellow' } as never)).toBeDefined()
  })

  test(`${surface}: stop forgets the watch, so the session is never woken for it`, async ($, on) => {
    const { seen, clock } = world(on)
    await pushed($, surface)
    const ui = await $.ui.mount({ plugin: 'ci-watch', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /PR 7/ })).toBeDefined()
    await ui.press({ key: 'ci-watch-stop-o/r#7' })
    expect(await ui.find({ type: 'Text', text: /PR 7/ })).toBeUndefined()
    const saved = JSON.parse(seen.files.get('C:/Users/me/.claude/mods-data/ci-watch/s1.json') ?? '{}')
    expect(saved.watches).toEqual([])
    seen.bucket = 'pass'
    for (let poll = 0; poll < 3; poll++) await clock.advance(60_000)
    expect(seen.prompts).toEqual([])
  })

  test(`${surface}: the row follows the watches while the state file cannot be written`, async ($, on) => {
    const { seen } = world(on)
    seen.isWriteDown = true
    await pushed($, surface)
    const ui = await $.ui.mount({ plugin: 'ci-watch', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /PR 7/ })).toBeDefined()
    await $.command.run({ command: 'ci-watch', args: 'stop' } as never)
    expect(await ui.find({ type: 'Text', text: /PR 7/ })).toBeUndefined()
  })
}

const STATE = 'C:/Users/me/.claude/mods-data/ci-watch/s1.json'
const OWNER = 'C:/Users/me/.claude/mods-data/ci-watch/s1.owner'

test('a stop pressed in an instance a newer load replaced is left to the newer one', async ($, on) => {
  const { seen } = world(on)
  seen.isReadable = true
  await pushed($, 'terminal')
  const ui = await $.ui.mount({ plugin: 'ci-watch', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  // A hot reload: the newer instance names itself in the owner file and keeps the saved watches.
  seen.files.set(OWNER, 'a-newer-instance')
  const before = seen.files.get(STATE)
  await ui.press({ key: 'ci-watch-stop-o/r#7' })
  expect(seen.files.get(STATE)).toBe(before)
})

test('with nothing watched the band draws nothing of its own', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'ci-watch', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /PR / })).toBeUndefined()
})
