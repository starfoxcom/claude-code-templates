import type { EngineInterface, Register, SessionCompactInput, SessionCompactResult, SessionMessage } from 'claude-code'

import { register as settings, SETTINGS_PANE } from './settings'

export const PERSON_MARK = "[compact-handoff] The person's messages, word for word"
const MESSAGE_SPLIT = '\n--- message ---\n'
const INDEX_HEAD = 'Older messages, kept only as an index (full text via the recall tool):'
const RECALL_TOOL = 'mcp__compact-handoff__recall'

// The hand-off gets a slice of the compaction window, so small windows pay a
// small hand-off. The person's words get part of that slice; the rest is the
// written hand-off.
const BUDGET_SHARE = 0.025
const BUDGET_MIN_TOKENS = 2_000
const BUDGET_MAX_TOKENS = 15_000
const PERSON_SHARE = 0.4
const CHARS_PER_TOKEN = 4
const INDEX_LINE_CHARS = 100
const INDEX_MAX_LINES = 30
const RECALL_MAX_CHARS = 6_000

// Disk: shadow mode keeps one file per compaction, on mode one per session;
// both sweep down to the newest few at session start.
const KEEP_FILES = 20
const MAX_AGE_DAYS = 14

// Lines the mods attach to a prompt, and whole prompts they submit, start with
// the mod's tag ("[session-facts] ...", "[tasks] ...", "[ci-watch] ..."); they
// are not the person's words. The tags are listed by name so a line the person
// types, such as "[x] done" or "[wip] ...", is kept. A new mod that writes into
// prompts adds its tag here. scripts/helper.cjs carries the same pattern
// (test-helper/helper.spec.cjs keeps the two equal).
export const MOD_TAGS = [
  'session-facts',
  'time',
  'task-tracking',
  'tasks',
  'ci-watch',
  'shared-pc',
  'skill-check',
  'usage-guard',
  'compact-handoff',
  'guards',
]
export const INJECTED_LINE = new RegExp(`^\\[(?:${MOD_TAGS.join('|')})\\](?: |$)`)
// The tags the engine wraps its own user-role text in. A message the person types may start with any
// other `<` (an HTML snippet, a generic, a log line); scripts/helper.cjs keeps the same list.
export const ENGINE_TAGS = [
  'system-reminder',
  'command-name',
  'command-message',
  'command-args',
  'local-command',
  'ide_',
  'user-prompt-submit-hook',
  'task-notification',
  'cross-session-message',
  'bash-input',
  'bash-stdout',
  'bash-stderr',
]
export const ENGINE_TAG = new RegExp(`^<(?:${ENGINE_TAGS.join('|')})`)
// A prompt a plugin submitted in the person's place, and the engine's note that the person pressed Esc.
// scripts/helper.cjs carries the same pattern.
export const NOT_PERSON = /^(?:The [\w.-]+ plugin sent a message:|\[Request interrupted by user)/

type Mode = 'off' | 'shadow' | 'on'

const HINT = '[help | settings]'
export const HELP = [
  "/compact-handoff: at each compaction, keeps the person's messages word for word and writes a hand-off.",
  '  /compact-handoff           the current mode',
  '  /compact-handoff settings  open the settings pane',
  '  /compact-handoff help      this list',
].join('\n')
export const MODE_TEXT: Record<Mode, string> = {
  on: 'Mode on: the hand-off replaces the stock compaction summary.',
  shadow: 'Mode shadow: stock compaction, with the hand-off written beside it for comparison.',
  off: 'Mode off: stock compaction.',
}

export function handoffPrompt(limitTokens: number): string {
  return [
    'Write the hand-off a fresh context of yourself needs to continue this work with nothing lost.',
    'That context remembers NOTHING except this hand-off and the messages carried with it.',
    `Hard limit: about ${limitTokens} tokens. Plain, direct sentences.`,
    'Before writing, silently list every decision, number or measurement, name, path, setting,',
    'promise to the person, open question, dead end and file touched in this conversation.',
    'Then check that each one is in the hand-off, or is dropped only because continuing the work',
    'does not need it. Output exactly these sections:',
    '## Doing: the goal, the work item, why it matters.',
    '## Where we are: the last finished step and the exact next step.',
    '## Decided: each decision with its reason; exact numbers, names, paths, settings.',
    '## Dead ends: what was tried and rejected, and why, so it is not retried.',
    '## Read next: exact file paths (and line ranges) to open first, each with its reason. Nothing else.',
    '## Reference: the facts the next steps lean on that would otherwise mean reopening a file:',
    'API calls and their shapes, signatures, formats, commands. Compact, exact.',
    '## Don\'t re-read: files whose needed content is fully covered above. Never "already absorbed".',
    '## Live state: branch, uncommitted work, running jobs and monitors, other sessions and what they own or hold.',
    '## Owed to the person: open questions, promises, anything waiting on their answer.',
    'State only what the conversation shows; mark anything not confirmed as unconfirmed.',
    "The person's own messages are carried separately, word for word: refer to them, never paraphrase their decisions.",
    `Anything not kept here stays searchable with the ${RECALL_TOOL} tool.`,
  ].join('\n')
}

function stripInjected(text: string): string {
  return text
    .split('\n')
    .filter(line => !INJECTED_LINE.test(line.trim()))
    .join('\n')
    .trim()
}

// A prompt a mod submitted is only mod lines (its own, plus the context other
// mods attached), so nothing is left once they are stripped.
function isPersonMessage(message: SessionMessage): boolean {
  if (message.role !== 'user' || (message.toolResults?.length ?? 0) > 0) return false
  const text = message.text.trim()
  return (
    !ENGINE_TAG.test(text) &&
    !NOT_PERSON.test(text) &&
    !text.startsWith('[SYSTEM') &&
    !text.startsWith('This session is being continued') &&
    !text.startsWith(PERSON_MARK) &&
    stripInjected(text).length > 0
  )
}

// Earlier compactions carried the person's words forward in a block of ours;
// read them back so every compaction keeps the whole history, oldest first.
function carriedForward(messages: readonly SessionMessage[]): { kept: string[]; index: string[] } {
  const block = messages.find(message => message.text.startsWith(PERSON_MARK))
  if (!block) return { kept: [], index: [] }
  const [head = '', ...kept] = block.text.split(MESSAGE_SPLIT)
  const index = head.split('\n').filter(line => line.startsWith('- '))
  return { kept, index }
}

const indexLine = (text: string) => `- ${text.replace(/\s+/g, ' ').slice(0, INDEX_LINE_CHARS)}...`

// How many of `texts`' first messages repeat the end of `carried`, in order: the tail the engine kept.
// Only a run at the very start counts. A message cannot be told from a new one by its text, so when the
// budget moved older tail members to the index, they are carried again rather than guessed at: a
// message may then show twice, never go missing.
function keptTail(carried: readonly string[], texts: readonly string[]): number {
  for (let k = Math.min(carried.length, texts.length); k > 0; k--) {
    if (carried.slice(-k).every((text, i) => text === texts[i])) return k
  }
  return 0
}

// `typed` is the transcript's own list (see transcriptWords); without it the
// compaction's message list is used, which misses prompts typed mid-turn.
export function personWords(
  messages: readonly SessionMessage[],
  budgetChars: number,
  typed?: readonly string[],
): string {
  const previous = carriedForward(messages)
  const source = typed ?? messages.filter(isPersonMessage).map(message => message.text)
  // The messages the last compaction kept beside its summary open the list again: they are carried once,
  // from the block. Only that leading run is folded, so a "yes" typed again later is kept. The
  // transcript's list starts after the compaction and has no such run.
  const texts = source.map(stripInjected).filter(Boolean)
  const fresh = typed ? texts : texts.slice(keptTail(previous.kept, texts))
  const all = [...previous.kept, ...fresh]

  const kept: string[] = []
  let used = 0
  let cut = all.length
  for (let i = all.length - 1; i >= 0; i--) {
    const text = all[i] ?? ''
    if (used + text.length > budgetChars && kept.length > 0) break
    kept.unshift(text)
    used += text.length
    cut = i
  }
  const overflow = all.slice(0, cut).map(indexLine)
  const index = [...previous.index, ...overflow].slice(-INDEX_MAX_LINES)

  const head = index.length > 0 ? `${PERSON_MARK}\n${INDEX_HEAD}\n${index.join('\n')}` : PERSON_MARK
  return [head, ...kept].join(MESSAGE_SPLIT)
}

async function budgetTokens($: EngineInterface): Promise<number> {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const window = context.breakdown?.autoCompactThreshold ?? context.window
    return Math.min(BUDGET_MAX_TOKENS, Math.max(BUDGET_MIN_TOKENS, Math.round(window * BUDGET_SHARE)))
  } catch {
    return 8_000
  }
}

// The engine's fs makes no missing folders, so the data folder is made through node, once per load.
export const MKDIR_SCRIPT = 'require("fs").mkdirSync(process.argv[1],{recursive:true})'
const madeDirs = new Set<string>()
async function ensureDir($: EngineInterface, dir: string): Promise<void> {
  if (madeDirs.has(dir)) return
  const { exitCode } = await $.process.run(['node', '-e', MKDIR_SCRIPT, dir], { timeoutMs: 10_000 })
  if (exitCode === 0) madeDirs.add(dir)
}

async function dataDir($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/compact-handoff`.replace(/\\/g, '/')
}

async function runHelper($: EngineInterface, args: readonly string[]) {
  const script = `${$.plugin.root}/scripts/helper.cjs`
  return $.process.run(['node', script, ...args], { timeoutMs: 60_000 })
}

async function helper($: EngineInterface, args: readonly string[]): Promise<string> {
  const { exitCode, stdout, stderr } = await runHelper($, args)
  return exitCode === 0 ? stdout.trim() : `helper failed: ${stderr.trim() || `exit ${exitCode}`}`
}

// The transcript's own list, or undefined when the helper fails (no transcript
// under this session id, no node): the caller then uses the compaction's list.
async function transcriptWords($: EngineInterface): Promise<string[] | undefined> {
  try {
    const { exitCode, stdout } = await runHelper($, ['persons', await $.session.id()])
    if (exitCode !== 0) return undefined
    const parsed: unknown = JSON.parse(stdout)
    return Array.isArray(parsed) ? parsed.map(String) : undefined
  } catch {
    return undefined
  }
}

function summaryText(result: SessionCompactResult): string {
  return result.messages?.[0]?.text ?? '(no summary message)'
}

async function record($: EngineInterface, name: string, sections: Record<string, string>): Promise<void> {
  try {
    const body = Object.entries(sections)
      .map(([title, text]) => `## ${title}\n\n${text}`)
      .join('\n\n')
    const dir = await dataDir($)
    await ensureDir($, dir)
    await $.fs.write(`${dir}/${name}.md`, `${body}\n`)
  } catch {
    // A record that cannot be written never blocks a compaction.
  }
}

async function shadow(
  $: EngineInterface,
  e: SessionCompactInput,
  next: (e: SessionCompactInput) => Promise<SessionCompactResult>,
) {
  const budget = await budgetTokens($)
  const typed = await transcriptWords($)
  const [result, fork] = await Promise.all([
    next(e),
    // A refused fork must never fail the hook after the stock compaction ran.
    $.model.fork({ prompt: handoffPrompt(budget) }).catch((error: unknown) => ({
      isAnswered: false as const,
      reason: String(error),
    })),
  ])
  const sessionId = await $.session.id()
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
  const outcome = result.messages ? 'stock compaction stood' : `skipped: ${result.skip}`
  await record($, `${sessionId}-${stamp}-shadow`, {
    Trigger: `${e.trigger}, budget ${budget} tokens, ${outcome}`,
    'Stock summary (what the session kept)': result.messages ? summaryText(result) : '(none)',
    'Hand-off (shadow, not used)': fork.isAnswered ? fork.text : `(no hand-off: ${fork.reason})`,
    "The person's messages": personWords(e.messages, budget * PERSON_SHARE * CHARS_PER_TOKEN, typed),
  })
  return result
}

async function handoffInstructions($: EngineInterface, e: SessionCompactInput, budget: number): Promise<string> {
  const asked = e.instructions ? `\nThe person also asked the summary to keep: ${e.instructions}` : ''
  return handoffPrompt(budget) + asked
}

// An ahead-of-time summary written to the stock brief would be thrown away
// when the real compaction asks for the hand-off: write it to the same brief.
async function precompute(
  $: EngineInterface,
  e: SessionCompactInput,
  next: (e: SessionCompactInput) => Promise<SessionCompactResult>,
) {
  const stamp = new Date(await $.clock.now()).toISOString()
  await record($, `${await $.session.id()}-precompute`, { 'Ran at': stamp })
  return next({ ...e, instructions: await handoffInstructions($, e, await budgetTokens($)) })
}

async function replace(
  $: EngineInterface,
  e: SessionCompactInput,
  next: (e: SessionCompactInput) => Promise<SessionCompactResult>,
) {
  const budget = await budgetTokens($)
  // Read before the compaction runs: the boundary it writes to the transcript
  // would otherwise hide this cycle's messages from the helper.
  const typed = await transcriptWords($)
  const result = await next({ ...e, instructions: await handoffInstructions($, e, budget) })
  // The engine rejects an empty list (a compaction keeps at least one message); a skip passes through.
  if (!result.messages?.length) return result

  const words = personWords(e.messages, budget * PERSON_SHARE * CHARS_PER_TOKEN, typed)
  const [summary, ...rest] = result.messages
  const carried: SessionMessage = { role: 'user', text: words, toolUses: [] }
  await record($, await $.session.id(), { 'Hand-off': summaryText(result), "The person's messages": words })
  return { ...result, messages: summary ? [summary, carried, ...rest] : [carried, ...rest] }
}

export const register: Register = (on, options) => {
  const mode = (options.mode ?? 'on') as Mode
  settings(on, options)

  // `/compact-handoff [help | settings]`; with no argument, the mode. Any other argument gets the help.
  on('command.run', { command: 'compact-handoff' }, async ($, e) => {
    const verb = e.args.trim()
    if (verb === '') return { text: MODE_TEXT[mode] }
    if (verb !== 'settings') return { text: HELP }
    await $.ui.open({ id: SETTINGS_PANE, title: 'Compact hand-off settings', focus: true })
    return { text: 'Opened the compact-handoff settings.' }
  })

  // The command registers in every mode, so mode off can still be turned back on from its pane.
  on('session.start', async ($, e, next) => {
    const description = 'The compaction hand-off: its mode'
    await $.command.register({ name: 'compact-handoff', description, argumentHint: HINT })
    if (mode === 'off') return next(e)
    await $.tool.register({
      name: 'recall',
      description:
        'Search the full transcript of this session, including everything before compaction, for exact earlier ' +
        'details (decisions, numbers, paths, wording). All words in the query must appear. Returns capped ' +
        'snippets, newest first.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Words that must all appear in the passage.' } },
        required: ['query'],
      },
    })
    void dataDir($)
      .then(dir => helper($, ['sweep', dir, String(KEEP_FILES), String(MAX_AGE_DAYS)]))
      .catch(() => undefined)
    return next(e)
  })

  if (mode === 'off') return

  on('tool.call', { tool: RECALL_TOOL }, async ($, e) => {
    const query = String((e as { query?: unknown }).query ?? '').trim()
    if (!query) return { deny: 'recall needs a query.' }
    const text = await helper($, ['recall', await $.session.id(), String(RECALL_MAX_CHARS), query])
    return { result: text }
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (e.trigger === 'precompute') return mode === 'on' ? precompute($, e, next) : next(e)
    return mode === 'on' ? replace($, e, next) : shadow($, e, next)
  })
}
