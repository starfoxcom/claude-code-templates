import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { checkCache, nextLifetime, parseMemory, SHORT_LIFETIME_MS, writtenLifetime } from '../hooks/cache'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const NOW = Date.UTC(2026, 9, 2, 16, 0, 0)
const WARM = {
  input_tokens: 10,
  output_tokens: 500,
  cache_read_input_tokens: 200_000,
  cache_creation_input_tokens: 1_000,
}
const COLD = {
  input_tokens: 10,
  output_tokens: 500,
  cache_read_input_tokens: 20_000,
  cache_creation_input_tokens: 230_000,
}
const AT = { at: NOW, lifetimeMs: HOUR, isFreshWindow: false }

const CHECK_CASES: {
  name: string
  usage: typeof WARM
  c: Partial<typeof AT> & { sinceLastMs?: number }
  miss?: string
}[] = [
  { name: 'warm', usage: WARM, c: { sinceLastMs: 50 * MINUTE } },
  { name: 'reads as much as it writes is still warm', usage: { ...WARM, cache_creation_input_tokens: 200_000 }, c: {} },
  { name: 'cold at session start or after a reload', usage: COLD, c: {}, miss: 'expected' },
  {
    name: 'cold after a compaction or a model change',
    usage: COLD,
    c: { sinceLastMs: MINUTE, isFreshWindow: true },
    miss: 'expected',
  },
  { name: 'cold one step under 5 minutes', usage: COLD, c: { sinceLastMs: SHORT_LIFETIME_MS - 1 }, miss: 'early' },
  { name: 'cold at 5 minutes', usage: COLD, c: { sinceLastMs: SHORT_LIFETIME_MS }, miss: 'short' },
  { name: 'cold one step under the lifetime', usage: COLD, c: { sinceLastMs: HOUR - 1 }, miss: 'short' },
  { name: 'cold at the lifetime', usage: COLD, c: { sinceLastMs: HOUR }, miss: 'expired' },
  {
    name: 'cold past a 5-minute lifetime',
    usage: COLD,
    c: { sinceLastMs: 6 * MINUTE, lifetimeMs: SHORT_LIFETIME_MS },
    miss: 'expired',
  },
]

for (const { name, usage, c, miss } of CHECK_CASES) {
  test(`checkCache: ${name}`, () => {
    const resent = usage.cache_creation_input_tokens
    expect(checkCache(usage, { ...AT, ...c })).toEqual(miss ? { at: NOW, resent, miss } : { at: NOW, resent })
  })
}

test('nextLifetime: 5 minutes once a miss proves it, the setting again once a warm request outlives it', () => {
  const check = (miss?: 'short' | 'early' | 'expired') => ({ at: NOW, resent: 1, ...(miss ? { miss } : {}) })
  expect(nextLifetime(check('short'), 20 * MINUTE, HOUR, HOUR)).toBe(SHORT_LIFETIME_MS)
  expect(nextLifetime(check('early'), MINUTE, HOUR, HOUR)).toBe(HOUR)
  expect(nextLifetime(check(), SHORT_LIFETIME_MS, SHORT_LIFETIME_MS, HOUR)).toBe(SHORT_LIFETIME_MS)
  expect(nextLifetime(check(), SHORT_LIFETIME_MS + 1, SHORT_LIFETIME_MS, HOUR)).toBe(HOUR)
  expect(nextLifetime(check(), undefined, SHORT_LIFETIME_MS, HOUR)).toBe(SHORT_LIFETIME_MS)
})

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never

function world(on: On) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  // The zone probe, or the transcript's cache lines when the command names the transcript.
  const transcript = { lines: '', reads: [] as string[] }
  on('process.run', ($, e) => {
    const path = e.argv.length === 4 ? e.argv[3] : undefined
    if (path) transcript.reads.push(path)
    const stdout = path ? transcript.lines : '420 America/Phoenix\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 250_000, window: 500_000 }, rateLimits: [] },
  }))
  on('settings.read', () => ({ value: { pluginConfigs: {} } }) as never)
  // The data folder, keyed with forward slashes; the pause file is never there.
  const files = new Map<string, string>()
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path.replaceAll('\\', '/'))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path.replaceAll('\\', '/'), e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on(
    'session.compact',
    () => ({ messages: [{ role: 'user', text: 'SUMMARY', toolUses: [] }], tokensAfter: 40_000 }) as never,
  )
  // turn.step streams: the stand-in for the model answers with no chunks, at the usage the test set.
  const reply = { usage: WARM as object | null, model: 'claude-opus-5-5' }
  on('turn.step', async function* ($, e) {
    const usage = reply.usage && { ...reply.usage, model: reply.model }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}) as never)
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return { clock, reply, transcript, files }
}

// A streaming event runs only as it is read.
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of stream) void chunk
}

async function turn($: Engine, step: { index?: number; agentId?: string } = {}): Promise<void> {
  await drain($.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...step } as never))
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, reason: 'answer' } as never)
}

async function row($: Engine) {
  return $.ui.mount({ plugin: 'session-facts', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true })
}

test('a miss two minutes after a reply says the cache broke early and what it resent', async ($, on) => {
  const { clock, reply } = world(on)
  await start($)
  await turn($)
  await clock.advance(2 * MINUTE)
  reply.usage = COLD
  await turn($)
  const ui = await row($)
  expect(
    await ui.find({ type: 'Text', text: /^cache broke early · resent 230k$/, color: 'yellow' } as never),
  ).toBeDefined()
  await clock.advance(15 * MINUTE)
  expect(await ui.find({ type: 'Text', text: /cache broke/ })).toBeUndefined()
})

test('a miss twenty minutes in switches the countdown to 5 minutes and names the cold start', async ($, on) => {
  const { clock, reply } = world(on)
  await start($)
  await turn($)
  await clock.advance(20 * MINUTE)
  reply.usage = COLD
  await turn($)
  const ui = await row($)
  const text = /^cache lasts 5m · 5m left · cold start 250k$/
  expect(await ui.find({ type: 'Text', text, color: 'yellow' } as never)).toBeDefined()
  await clock.advance(5 * MINUTE)
  expect(await ui.find({ type: 'Text', text: /^cache lasts 5m · likely expired · cold start 250k$/ })).toBeDefined()
})

test('an expected miss stays quiet: session start, a compaction, a model change', async ($, on) => {
  const { clock, reply } = world(on)
  reply.usage = COLD
  await start($)
  await turn($)
  await $.session.compact({ trigger: 'auto', messages: [] } as never)
  await clock.advance(MINUTE)
  await turn($)
  await clock.advance(MINUTE)
  reply.model = 'claude-sonnet-5-5'
  await turn($)
  const ui = await row($)
  expect(await ui.find({ type: 'Text', text: /^cache/ })).toBeUndefined()
})

test('only the first request of the main conversation counts', async ($, on) => {
  const { clock, reply } = world(on)
  await start($)
  await turn($)
  await clock.advance(2 * MINUTE)
  reply.usage = COLD
  await turn($, { index: 1 })
  await turn($, { agentId: 'a1' })
  reply.usage = null
  await turn($)
  const ui = await row($)
  expect(await ui.find({ type: 'Text', text: /^cache/ })).toBeUndefined()
})

const line = (written: Record<string, number>, extra: object = {}) =>
  JSON.stringify({ ...extra, message: { usage: { cache_creation: written } } })
const ONE_HOUR = line({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_455 })
const FIVE_MINUTES = line({ ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 })

test('writtenLifetime: the newest main-conversation write names the lifetime', () => {
  expect(writtenLifetime(ONE_HOUR)).toBe(HOUR)
  expect(writtenLifetime(FIVE_MINUTES)).toBe(SHORT_LIFETIME_MS)
  expect(writtenLifetime([ONE_HOUR, FIVE_MINUTES].join('\n'))).toBe(SHORT_LIFETIME_MS)
  expect(writtenLifetime([FIVE_MINUTES, ONE_HOUR].join('\n'))).toBe(HOUR)
  // A subagent's line, a write of nothing and a cut-off line are skipped.
  const subagent = line({ ephemeral_5m_input_tokens: 900 }, { isSidechain: true })
  const nothing = line({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 })
  expect(writtenLifetime([ONE_HOUR, subagent, nothing, '{"message":{"us'].join('\n'))).toBe(HOUR)
  expect(writtenLifetime('')).toBeUndefined()
})

const STOP = { transcript_path: 'C:/t/s1.jsonl', stop_hook_active: false } as never

test('the countdown runs on the lifetime the transcript shows, not the setting', async ($, on) => {
  const { transcript } = world(on)
  transcript.lines = FIVE_MINUTES
  await start($)
  await turn($)
  await $.classic.Stop(STOP)
  expect(transcript.reads).toEqual(['C:/t/s1.jsonl'])
  const ui = await row($)
  const text = /^cache 5m left · cold start 250k$/
  expect(await ui.find({ type: 'Text', text, color: 'yellow' } as never)).toBeDefined()
})

test('an unreadable transcript keeps the setting', async ($, on) => {
  const { transcript } = world(on)
  transcript.lines = 'not json'
  await start($)
  await turn($)
  await $.classic.Stop(STOP)
  const ui = await row($)
  expect(await ui.find({ type: 'Text', text: /^cache/ })).toBeUndefined()
})

const MEMORY = 'C:/Users/me/.claude/mods-data/session-facts/s1.json'

test('parseMemory: the saved facts, or nothing for a torn or foreign file', () => {
  const saved = { lastResponseAt: NOW, lifetimeMs: HOUR, lastModel: 'm', check: { at: NOW, resent: 9, miss: 'early' } }
  expect(parseMemory(JSON.stringify(saved))).toEqual(saved)
  expect(parseMemory(JSON.stringify({ ...saved, check: { at: NOW, resent: 9, miss: 'odd' } }))?.check).toBeUndefined()
  expect(parseMemory(JSON.stringify({ lifetimeMs: HOUR }))).toBeUndefined()
  expect(parseMemory('{"lastResponseAt": 1')).toBeUndefined()
  expect(parseMemory('')).toBeUndefined()
})

test('each reply is remembered in the data folder', async ($, on) => {
  const { files } = world(on)
  await start($)
  await turn($)
  expect(parseMemory(files.get(MEMORY) ?? '')).toEqual(
    expect.objectContaining({ lastResponseAt: NOW, lifetimeMs: HOUR, lastModel: 'claude-opus-5-5' }),
  )
})

test('after a reload the countdown carries on from the remembered reply', async ($, on) => {
  const { files } = world(on)
  files.set(MEMORY, JSON.stringify({ lastResponseAt: NOW - 55 * MINUTE, lifetimeMs: HOUR }))
  await start($)
  const ui = await row($)
  expect(await ui.find({ type: 'Text', text: /^cache 5m left · cold start 250k$/ })).toBeDefined()
})

test('a break right after a reload is flagged, not taken for a fresh start', async ($, on) => {
  const { files, reply } = world(on)
  const remembered = { lastResponseAt: NOW - 2 * MINUTE, lifetimeMs: HOUR, lastModel: 'claude-opus-5-5' }
  files.set(MEMORY, JSON.stringify(remembered))
  reply.usage = COLD
  await start($)
  await turn($)
  const ui = await row($)
  expect(await ui.find({ type: 'Text', text: /^cache broke early · resent 230k$/ })).toBeDefined()
})
