import type { EngineInterface, Register, SessionCompactInput, SessionCompactResult, SessionMessage } from 'claude-code'

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
// are not the person's words. scripts/helper.cjs carries the same pattern
// (test-helper/helper.spec.cjs keeps the two equal).
export const INJECTED_LINE = /^\[[a-z][a-z0-9-]*\](?: |$)/

type Mode = 'off' | 'shadow' | 'on'

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
    "## Don't re-read: files whose needed content is fully covered above. Never \"already absorbed\".",
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
    !text.startsWith('<') &&
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
  const index = head
    .split('\n')
    .filter(line => line.startsWith('- '))
  return { kept, index }
}

// `typed` is the transcript's own list (see transcriptWords); without it the
// compaction's message list is used, which misses prompts typed mid-turn.
export function personWords(messages: readonly SessionMessage[], budgetChars: number, typed?: readonly string[]): string {
  const previous = carriedForward(messages)
  const source = typed ?? messages.filter(isPersonMessage).map(message => message.text)
  const fresh = source.map(stripInjected).filter(Boolean)
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
  const overflow = all.slice(0, cut).map(text => `- ${text.replace(/\s+/g, ' ').slice(0, INDEX_LINE_CHARS)}...`)
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
    const body = Object.entries(sections).map(([title, text]) => `## ${title}\n\n${text}`).join('\n\n')
    await $.fs.write(`${await dataDir($)}/${name}.md`, `${body}\n`)
  } catch {
    // A record that cannot be written never blocks a compaction.
  }
}

async function shadow($: EngineInterface, e: SessionCompactInput, next: (e: SessionCompactInput) => Promise<SessionCompactResult>) {
  const budget = await budgetTokens($)
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
  await record($, `${sessionId}-${stamp}-shadow`, {
    Trigger: `${e.trigger}, budget ${budget} tokens, ${result.messages ? 'stock compaction stood' : `skipped: ${result.skip}`}`,
    'Stock summary (what the session kept)': result.messages ? summaryText(result) : '(none)',
    'Hand-off (shadow, not used)': fork.isAnswered ? fork.text : `(no hand-off: ${fork.reason})`,
    "The person's messages": personWords(e.messages, budget * PERSON_SHARE * CHARS_PER_TOKEN, await transcriptWords($)),
  })
  return result
}

async function handoffInstructions($: EngineInterface, e: SessionCompactInput, budget: number): Promise<string> {
  const asked = e.instructions ? `\nThe person also asked the summary to keep: ${e.instructions}` : ''
  return handoffPrompt(budget) + asked
}

// An ahead-of-time summary written to the stock brief would be thrown away
// when the real compaction asks for the hand-off: write it to the same brief.
async function precompute($: EngineInterface, e: SessionCompactInput, next: (e: SessionCompactInput) => Promise<SessionCompactResult>) {
  const stamp = new Date(await $.clock.now()).toISOString()
  await record($, `${await $.session.id()}-precompute`, { 'Ran at': stamp })
  return next({ ...e, instructions: await handoffInstructions($, e, await budgetTokens($)) })
}

async function replace($: EngineInterface, e: SessionCompactInput, next: (e: SessionCompactInput) => Promise<SessionCompactResult>) {
  const budget = await budgetTokens($)
  const result = await next({ ...e, instructions: await handoffInstructions($, e, budget) })
  if (!result.messages) return result

  const words = personWords(e.messages, budget * PERSON_SHARE * CHARS_PER_TOKEN, await transcriptWords($))
  const [summary, ...rest] = result.messages
  const carried: SessionMessage = { role: 'user', text: words, toolUses: [] }
  await record($, await $.session.id(), { 'Hand-off': summaryText(result), "The person's messages": words })
  return { ...result, messages: summary ? [summary, carried, ...rest] : [carried, ...rest] }
}

export const register: Register = (on, options) => {
  const mode = (options.mode ?? 'on') as Mode
  if (mode === 'off') return

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'recall',
      description:
        'Search the full transcript of this session, including everything before compaction, for exact earlier ' +
        'details (decisions, numbers, paths, wording). All words in the query must appear. Returns capped snippets, newest first.',
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
