import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, RenderChildren } from 'claude-code'

import type { CardTone, SharedPcBand } from '../types'
import { classify, compile, labelFor } from './classify'
import { rulesFor } from './rules'

// shared-pc: one session at a time holds "the seat" for heavy work on this PC; the rest wait in line.
// All shared state changes go through bin/pcctl.cjs (a Node helper with a mutex); this module reads
// state.json directly for the band. The mods README describes the behaviour.

const band = atom({ plugin: 'shared-pc', key: 'band' } as const, null)

const BEAT_MS = 10_000
const REFRESH_MS = 2_000
const LONG_SEAT_MS = 30 * 60_000
const NOTICE_CARD_MS = 10_000
const HOUR_MS = 60 * 60_000
// The hooks run in a sandbox with no time zone of its own (its clock reads UTC), so the host's UTC
// offset and zone name are read through node at set-up and again every hour, as session-facts and
// usage-guard do.
const READ_ZONE = [
  'node',
  '-e',
  'console.log(new Date().getTimezoneOffset() + " " + Intl.DateTimeFormat().resolvedOptions().timeZone)',
]

type Seat = {
  session: string
  kind: 'work' | 'hold'
  since: number
  label: string
  running?: number
  tasks?: string[]
  lastHeavyEnd?: number
  until?: number
  reason?: string
}
type LineEntry = { session: string; kind: 'work' | 'hold'; label: string; since: number }
type Ask = { session: string; name: string; reason: string; at: number; answer: 'approved' | 'declined' | null }
type State = {
  seat: Seat | null
  line: LineEntry[]
  nextUp: { session: string; until: number } | null
  requests: Ask[]
  updatedAt: number
}
type Reply = {
  error?: string
  granted?: boolean
  mine?: 'seat' | 'line' | 'none'
  position?: number
  note?: string
} & Partial<State>

const EMPTY: State = { seat: null, line: [], nextUp: null, requests: [], updatedAt: 0 }

// This load's view of itself; session.start fills it, a reload starts it over.
const ctx = {
  me: '',
  name: '',
  root: '',
  dir: '',
  pcctl: '',
  aliveMs: 45_000,
  lingerMs: 60_000,
  light: [] as RegExp[],
  heavy: [] as RegExp[],
  last: EMPTY,
  isWorking: false,
  isSetUp: false,
  // Why the mod could not start in this session; shown as a card until dismissed.
  offReason: '',
  isOffDismissed: false,
  // Answers this load already delivered, keyed by session and time asked.
  delivered: new Set<string>(),
  // Short notices for this session's own card ("Your turn on the PC"), each with an end time.
  notices: [] as { key: string; body: string; tone: CardTone; until: number }[],
  // The host's time zone; UTC until it is read.
  zone: { offsetMinutes: 0, name: 'UTC' },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setUp($).catch(() => undefined)
    return next(e)
  })

  // A hot reload starts the module over without a session.start: the next turn sets up again, so the
  // heartbeat, the band and turn-taking come back without a restart.
  on('turn.start', async ($, e, next) => {
    if (!ctx.isSetUp) await setUp($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (ctx.dir) await pcctl($, ['end', ctx.me])
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => gate($, e.command, () => next(e), next.signal))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) =>
    gate($, String((e as { command?: unknown }).command ?? ''), () => next(e), next.signal),
  )

  // A stopped background task no longer holds the seat.
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as { task_id?: string; shell_id?: string }
    const id = input.task_id ?? input.shell_id
    if (id) await settleTasks($, id)
    return ran
  })

  // A finished background task's notice frees its hold on the seat.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') await settleTasks($, e.text)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    if (ownTasks().length > 0 && e.door !== 'response') {
      const content = e.message.content
      const text =
        typeof content === 'string' ? content : content.map(b => ('text' in b ? String(b.text) : '')).join('\n')
      if (text.includes('task-notification') || text.includes('<status>')) await settleTasks($, text)
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__shared-pc__pc' }, async ($, e) => ({ result: await toolAction($, e as ToolInput) }))

  on('command.run', { command: 'pc' }, async ($, e) => ({ text: await commandAction($, e.args) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Remembered for the answer delivery: a running turn gets a note, an idle session a wake-up prompt.
    ctx.isWorking = e.props.isWorking
    // What core and the other mods draw here (usage-guard's card among them) stays, above the band.
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    const ui = $.ui.resolve(e)
    const cardWidth = Math.max(30, Math.min(64, e.props.bodyColumns - 2))
    if (ctx.offReason) return ctx.isOffDismissed ? inner : offCard(ui, cardWidth, inner)
    const shown = await read($, band)
    if (!shown) return inner
    return (
      <ui.Box flexDirection="column">
        {inner}
        {cardBox(ui, $, shown, cardWidth)}
        {seatLine(ui, $, shown)}
      </ui.Box>
    )
  })
}

type Ui = ReturnType<Engine['ui']['resolve']>

// Shown instead of the band when the mod could not start in this session.
function offCard(ui: Ui, width: number, inner: RenderChildren) {
  const { Box, Button, Text } = ui
  return (
    <Box flexDirection="column">
      {inner}
      <Box
        alignSelf="flex-end"
        width={width}
        flexDirection="column"
        borderStyle="double"
        borderColor="red"
        backgroundColor="black"
        paddingX={1}
      >
        <Text bold color="black" backgroundColor="red">
          {' SHARED PC OFF '}
        </Text>
        <Text bold color="red" wrap="wrap">
          Turn-taking is off in this session: {ctx.offReason}
        </Text>
        <Button key="off-dismiss" label="Dismiss" variant="primary" onPress={() => void (ctx.isOffDismissed = true)} />
      </Box>
    </Box>
  )
}

// The mod's own toast: a bordered card at the band's right edge, drawn in every session; a request's
// card stays until someone answers it, from any session. Claude Code's toast takes no color or
// border, OS notifications may be off, and a card drawn outside the band (position absolute) is
// clipped by the band's slot, so it stays inside the band's own rows.
function cardBox(ui: Ui, $: Engine, shown: SharedPcBand, width: number) {
  const { Box, Button, Text } = ui
  // A band saved by an older version of the mod lacks newer fields (cards, a card's tone) until the next refresh.
  const cards = shown.cards ?? []
  const card = cards[0]
  if (!card) return null
  const tone = card.tone ?? 'yellow'
  const asker = card.requestSession
  return (
    <Box
      alignSelf="flex-end"
      width={width}
      flexDirection="column"
      borderStyle="double"
      borderColor={tone}
      backgroundColor="black"
      paddingX={1}
    >
      <Text bold color="black" backgroundColor={tone}>
        {' SHARED PC '}
        {cards.length > 1 ? `(+${cards.length - 1}) ` : ''}
      </Text>
      <Text bold color={tone} wrap="wrap">
        {card.body}
      </Text>
      {asker && (
        <Box>
          <Button
            key="card-approve"
            label="Approve"
            variant="primary"
            onPress={() => answerAsk($, asker, 'approve')}
          />
          <Button key="card-decline" label="Decline" onPress={() => answerAsk($, asker, 'decline')} />
        </Box>
      )}
      {!asker && card.tone === 'red' && (
        <Button key="card-dismiss" label="Dismiss" variant="primary" onPress={() => dismissNotice($, card.key)} />
      )}
    </Box>
  )
}

// The band's line: who has the PC, this session's place in line, or free.
function seatLine(ui: Ui, $: Engine, shown: SharedPcBand) {
  const { Box, Button, Text } = ui
  const seat = shown.holder
  if (!seat) return <Text color="green">PC · free</Text>
  const waiting = shown.waiting > 0 ? ` · ${shown.waiting} waiting` : ''
  if (shown.mine === 'seat') {
    return (
      <Box>
        <Text color={seat.isLong ? 'yellow' : 'green'}>
          PC · yours · {seat.label} · {seat.kind === 'hold' ? `${seat.left} left` : seat.heldFor}
          {waiting}{' '}
        </Text>
        <Button key="release" label="Release" onPress={() => change($, ['release', ctx.me])} />
      </Box>
    )
  }
  if (shown.mine === 'line') {
    return (
      <Box>
        <Text color="cyan">
          PC · #{shown.position} in line · {seat.name} has it ({seat.label}, {seat.heldFor}){' '}
        </Text>
        {shown.position > 1 && <Button key="next" label="Go next" onPress={() => change($, ['next', ctx.me])} />}
      </Box>
    )
  }
  const what =
    seat.kind === 'hold'
      ? `held by ${seat.name} · ${seat.label} · ${seat.left} left`
      : `${seat.name} has it · ${seat.label} · ${seat.heldFor}`
  return (
    <Text color="yellow">
      PC · {what}
      {waiting}
    </Text>
  )
}

async function setUp($: Engine) {
  if (ctx.isSetUp) return
  ctx.isSetUp = true
  ctx.me = await $.session.id()
  ctx.root = await $.session.root()
  ctx.name = `${folderOf(ctx.root)}·${ctx.me.slice(0, 4)}`
  ctx.pcctl = `${$.plugin.root}/bin/pcctl.cjs`
  try {
    const where = JSON.parse((await $.process.run(['node', ctx.pcctl, 'where'])).stdout) as {
      dir: string
      aliveMs: number
      lingerMs: number
    }
    ctx.dir = where.dir.replace(/\\/g, '/')
    ctx.aliveMs = where.aliveMs
    ctx.lingerMs = where.lingerMs
  } catch (err) {
    ctx.dir = ''
    ctx.offReason = String(err).slice(0, 120)
    return
  }
  loadRules()
  await readZone($)
  $.clock.every(HOUR_MS, () => void readZone($))
  await beat($)
  $.clock.every(BEAT_MS, () => void beat($))
  $.clock.every(REFRESH_MS, () => void refresh($))
  await $.command.register({
    name: 'pc',
    description: 'Shared PC: show the line, or next [name] | leave | release | hold <min> [reason] | done | phone',
    argumentHint: '[help | next [name] | leave | release | hold <min> [reason] | done | phone]',
    immediate: true,
  })
  await $.tool.register({
    name: 'pc',
    description:
      'Shared PC seat (one session at a time runs heavy work; heavy commands queue automatically). ' +
      'hold: claim the PC for a measurement window (minutes 1-60). release: free it early. status: the line. ' +
      'request_next: ask the person to let this session go next; give a concrete reason (a window closing, ' +
      'the person waiting on this result, a short job stuck behind a long one).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['hold', 'release', 'status', 'request_next'] },
        minutes: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['action'],
    },
  })
  await refresh($)
}

async function pcctl($: Engine, args: string[]): Promise<Reply> {
  try {
    const r = await $.process.run(['node', ctx.pcctl, ...args], { timeoutMs: 20_000 })
    return JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as Reply
  } catch (err) {
    return { error: String(err) }
  }
}

async function change($: Engine, args: string[]): Promise<Reply> {
  const reply = await pcctl($, args)
  await refresh($)
  return reply
}

async function readState($: Engine): Promise<State> {
  try {
    return JSON.parse(await $.fs.read(`${ctx.dir}/state.json`)) as State
  } catch {
    return EMPTY
  }
}

async function sessionInfo($: Engine, id: string): Promise<{ name: string; lastBeat: number } | null> {
  try {
    return JSON.parse(await $.fs.read(`${ctx.dir}/sessions/${id}.json`))
  } catch {
    return null
  }
}

// A failed write is retried by the next beat; it never stops the set-up that runs the first one.
async function beat($: Engine) {
  if (!ctx.dir) return
  const lastBeat = await $.clock.now()
  await $.fs
    .write(
      `${ctx.dir}/sessions/${ctx.me}.json`,
      JSON.stringify({ id: ctx.me, name: ctx.name, root: ctx.root, lastBeat }),
    )
    .catch(() => undefined)
}

// Reads the shared state, asks the helper to tidy it when something has visibly expired, and updates the
// band only when what it shows changed.
async function refresh($: Engine) {
  if (!ctx.dir) return
  let s = await readState($)
  const now = await $.clock.now()
  if (s.seat) {
    const holder = await sessionInfo($, s.seat.session)
    const isGone = !holder || now - holder.lastBeat > ctx.aliveMs
    const isHoldOver = s.seat.kind === 'hold' && now > (s.seat.until ?? 0)
    const isLingerOver =
      s.seat.kind === 'work' &&
      s.seat.running === 0 &&
      (s.seat.tasks ?? []).length === 0 &&
      now - (s.seat.lastHeavyEnd ?? 0) > ctx.lingerMs
    if (isGone || isHoldOver || isLingerOver) {
      await pcctl($, ['status', ctx.me])
      s = await readState($)
    }
  }
  ctx.last = s
  const fresh = await toBand($, s, now)
  const shown = await read($, band)
  if (JSON.stringify(shown) !== JSON.stringify(fresh)) await update($, band, () => fresh)
  await handleRequests($, s)
}

// Every session shows a new skip-the-line request as its own card for 30 s (toBand), then as the box
// above the prompt. The asking session alone takes the answer: a note during a turn, a wake-up prompt
// while idle, then `ack` clears it.
async function handleRequests($: Engine, s: State) {
  for (const ask of s.requests) {
    const key = `${ask.session}:${ask.at}`
    if (ask.answer && ask.session === ctx.me && !ctx.delivered.has(key)) {
      ctx.delivered.add(key)
      const text =
        ask.answer === 'approved'
          ? '[shared-pc] The person approved your request: this session goes next on the PC. Go ahead with the ' +
            'heavy work you asked for.'
          : '[shared-pc] The person declined your request to go next. Carry on: heavy commands still run, waiting ' +
            'their normal turn in line.'
      await pcctl($, ['ack', ctx.me])
      // A session that asked may be waiting on the answer, so an idle one is woken.
      if (ctx.isWorking) await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
      else await $.prompt.submit({ text })
    }
  }
}

async function toBand($: Engine, s: State, now: number): Promise<SharedPcBand> {
  const position = s.line.findIndex(e => e.session === ctx.me) + 1
  let holder: SharedPcBand['holder'] = null
  if (s.seat) {
    const info = s.seat.session === ctx.me ? { name: ctx.name } : await sessionInfo($, s.seat.session)
    holder = {
      name: info?.name ?? s.seat.session.slice(0, 8),
      label: s.seat.kind === 'hold' ? (s.seat.reason ?? 'hold') : s.seat.label,
      kind: s.seat.kind,
      heldFor: duration(now - s.seat.since),
      left: s.seat.kind === 'hold' ? duration((s.seat.until ?? now) - now) : undefined,
      isLong: now - s.seat.since > LONG_SEAT_MS,
    }
  }
  return {
    mine: s.seat?.session === ctx.me ? 'seat' : position > 0 ? 'line' : 'none',
    position,
    holder,
    waiting: s.line.length,
    requests: s.requests
      .filter(r => !r.answer)
      .map(r => ({ session: r.session, name: r.name, reason: r.reason, isMine: r.session === ctx.me })),
    cards: cardsFor(s, now),
  }
}

function cardsFor(s: State, now: number): SharedPcBand['cards'] {
  const cards: SharedPcBand['cards'] = []
  // A request's card stays until someone answers it: the card is the default look.
  for (const ask of s.requests) {
    if (ask.answer) continue
    const who = ask.session === ctx.me ? 'This session' : ask.name
    cards.push({
      key: `${ask.session}:${ask.at}`,
      body: `${who} asks to go next on the PC: ${ask.reason}`,
      tone: 'yellow',
      requestSession: ask.session,
    })
  }
  ctx.notices = ctx.notices.filter(n => n.until > now)
  for (const n of ctx.notices) cards.push({ key: n.key, body: n.body, tone: n.tone })
  return cards
}

// Shows a notice on this session's own card: good news and information for a few seconds, an error
// until the person dismisses it.
async function notify($: Engine, body: string, tone: CardTone) {
  const now = await $.clock.now()
  const until = tone === 'red' ? Number.POSITIVE_INFINITY : now + NOTICE_CARD_MS
  ctx.notices.push({ key: `notice:${now}`, body, tone, until })
  await refresh($)
}

// A press always answers: the request card gives way to a short card saying what was decided, and the
// same line goes to the transcript for a surface that draws no card.
async function answerAsk($: Engine, asker: string, answer: 'approve' | 'decline') {
  const reply = await change($, ['answer', asker, answer])
  const name = asker.slice(0, 8)
  const decided =
    answer === 'approve' ? `Approved: ${name} goes next on the PC.` : `Declined: ${name} keeps its place in the line.`
  const text = reply.error ? `shared-pc error: ${reply.error}` : decided
  await notify($, text, reply.error ? 'red' : 'blue')
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } }).catch(() => undefined)
}

async function dismissNotice($: Engine, key: string) {
  ctx.notices = ctx.notices.filter(n => n.key !== key)
  await refresh($)
}

function loadRules() {
  const lists = rulesFor(ctx.root)
  ctx.light = compile(lists.light)
  ctx.heavy = compile(lists.heavy)
}

// The gate: a heavy command claims the seat, or waits in line inside the call until it gets it.
async function gate($: Engine, command: string, run: () => Promise<any>, signal: AbortSignal) {
  if (!ctx.isSetUp) await setUp($).catch(() => undefined)
  if (!ctx.dir || classify(command, ctx.light, ctx.heavy) === 'light') return run()
  const pausedUntil = await usagePauseEnd($)
  if (pausedUntil) {
    return {
      deny:
        `shared-pc: the plan-usage pause is on until ${clockTime(pausedUntil)}, so no new heavy work starts. ` +
        'Wrap up instead (commit locally, write the hand-off); heavy work resumes after the pause.',
    }
  }
  const label = labelFor(command, ctx.light, ctx.heavy)
  const claim = await pcctl($, ['claim', ctx.me, label])
  if (claim.error) {
    await notify($, 'Shared PC helper failed: this command runs without waiting its turn.', 'red')
    return run()
  }
  let waited = ''
  if (!claim.granted) {
    const startedAt = await $.clock.now()
    const behind = await holderName($, claim)
    await refresh($)
    const out = await waitInLine($, signal)
    let reply: Reply = {}
    try {
      reply = JSON.parse(out.trim().split('\n').pop() || '{}')
    } catch {}
    // An Esc can land after the waiter took the seat: giving up frees that seat too, not just the line.
    if (signal.aborted || !reply.granted) {
      await change($, ['abandon', ctx.me])
      return { deny: 'shared-pc: left the line for the PC before getting the seat. Nothing ran.' }
    }
    waited = `[shared-pc] waited ${duration((await $.clock.now()) - startedAt)} for the PC behind ${behind}.`
    await notify($, `Your turn on the PC: ${label} starts now.`, 'green')
  }
  let ran: any
  try {
    ran = await run()
  } finally {
    const taskId = ran?.result?.backgroundTaskId as string | undefined
    await change($, taskId ? ['done', ctx.me, taskId] : ['done', ctx.me])
  }
  return waited && ran && ran.deny === undefined ? { ...ran, context: [...(ran.context ?? []), waited] } : ran
}

// The helper's `wait` child prints nothing until this session gets the seat or is out of line, so
// an abort (Esc) cannot wait for its next piece: each pull races the signal, and an abort ends the
// wait at once and closes the child, whatever the engine does with the stream. The caller then
// gives up its place (`abandon`).
async function waitInLine($: Engine, signal: AbortSignal): Promise<string> {
  let onAbort = () => {}
  const aborted = new Promise<'aborted'>(resolve => {
    onAbort = () => resolve('aborted')
    if (signal.aborted) resolve('aborted')
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  const child = $.process.spawn({ argv: ['node', ctx.pcctl, 'wait', ctx.me] })
  let out = ''
  try {
    for (;;) {
      const pull = child.next()
      // A pull left behind by an abort settles when the child is closed; nothing waits on it.
      pull.catch(() => undefined)
      const step = await Promise.race([pull, aborted])
      if (step === 'aborted' || step.done) break
      if (step.value.stream === 'stdout') out += step.value.text
    }
  } catch {
    // A child that cannot start counts as not granted.
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (signal.aborted) void child.return({ code: null, signal: null }).catch(() => undefined)
  }
  return out
}

// The usage-guard mod's shared pause (mods-data/usage-guard/pause.json): while it is active, sessions
// wrap up, so no new heavy work should start. Returns when the pause ends, or 0 when there is none.
async function usagePauseEnd($: Engine): Promise<number> {
  try {
    const dataRoot = ctx.dir.replace(/\/[^/]+$/, '')
    const pause = JSON.parse(await $.fs.read(`${dataRoot}/usage-guard/pause.json`)) as {
      status?: string
      wakeAt?: number
    }
    const now = await $.clock.now()
    return pause.status === 'active' && (pause.wakeAt ?? 0) > now ? (pause.wakeAt ?? 0) : 0
  } catch {
    return 0
  }
}

async function readZone($: Engine): Promise<void> {
  try {
    const { exitCode, stdout } = await $.process.run(READ_ZONE, { timeoutMs: 10_000 })
    const [offset, name] = stdout.trim().split(' ')
    if (exitCode === 0 && Number.isFinite(Number(offset)) && name) ctx.zone = { offsetMinutes: Number(offset), name }
  } catch {
    // UTC stays; the times shown say so.
  }
}

// The host's local time of day, with its zone, the way usage-guard's card shows the same pause.
function clockTime(epochMs: number): string {
  const local = new Date(epochMs - ctx.zone.offsetMinutes * 60_000)
  return `${local.toISOString().slice(11, 16)} (${ctx.zone.name})`
}

async function holderName($: Engine, reply: Reply): Promise<string> {
  const seat = reply.seat
  if (!seat) return 'the line'
  const info = await sessionInfo($, seat.session)
  return `${info?.name ?? seat.session.slice(0, 8)} (${seat.kind === 'hold' ? seat.reason : seat.label})`
}

function ownTasks(): string[] {
  return ctx.last.seat?.session === ctx.me ? (ctx.last.seat.tasks ?? []) : []
}

async function settleTasks($: Engine, text: string) {
  for (const id of ownTasks()) if (text.includes(id)) await change($, ['taskdone', ctx.me, id])
}

type ToolInput = { action?: string; minutes?: number; reason?: string }

async function toolAction($: Engine, input: ToolInput): Promise<string> {
  switch (input.action) {
    case 'hold': {
      const pausedUntil = await usagePauseEnd($)
      if (pausedUntil) return `Refused: the plan-usage pause is on until ${clockTime(pausedUntil)}.`
      const reply = await change($, ['hold', ctx.me, String(input.minutes ?? 15), input.reason ?? 'measurement'])
      return reply.mine === 'seat' ? 'Hold active.' : `Hold queued: #${reply.position} in line.`
    }
    case 'release':
      await change($, ['release', ctx.me])
      return 'Released.'
    case 'request_next': {
      const reason = input.reason?.trim()
      if (!reason) return 'Refused: request_next needs a concrete reason.'
      // Shared, so every session toasts it and shows the box; a toast cannot stay until answered.
      const reply = await change($, ['ask', ctx.me, reason])
      if (reply.error) return `Request failed: ${reply.error}`
      return (
        'Request shown to the person in every session. Their answer arrives as a note; keep to light work ' +
        'meanwhile.'
      )
    }
    default:
      return describe(await pcctl($, ['status', ctx.me]))
  }
}

const HELP = [
  '/pc: the shared PC seat; heavy commands take turns on it, first come, first served.',
  '  /pc                       the seat, who holds it and the line',
  '  /pc next [name]           let this session (or the named one) go next; approves your own request',
  '  /pc leave                 leave the line',
  '  /pc release               give the seat back',
  '  /pc hold <min> [reason]   keep the seat for a measurement or a multi-command run (default 15 min)',
  '  /pc done                  same as release',
  '  /pc phone                 the same as text, for phone chats',
  '  /pc help                  this list',
].join('\n')

async function commandAction($: Engine, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (verb === 'help') return HELP
  let reply: Reply
  switch (verb) {
    case '':
      reply = await pcctl($, ['status', ctx.me])
      break
    case 'next': {
      // Typed in a session with its own open request, `/pc next` is the person approving it.
      const isOwnOpen = !rest[0] && ctx.last.requests.some(r => r.session === ctx.me && !r.answer)
      reply = isOwnOpen ? await change($, ['answer', ctx.me, 'approve']) : await change($, ['next', rest[0] ?? ctx.me])
      break
    }
    case 'leave':
    case 'release':
      reply = await change($, [verb, ctx.me])
      break
    case 'hold':
      reply = await change($, ['hold', ctx.me, rest[0] ?? '15', rest.slice(1).join(' ') || 'measurement'])
      break
    case 'done':
      reply = await change($, ['release', ctx.me])
      break
    case 'phone':
      return phoneText(await pcctl($, ['status', ctx.me]))
    default:
      return HELP
  }
  return describe(reply)
}

function folderOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'session'
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/**
 * The seat as plain text for a phone chat, which draws no card: the status with a square for who holds the
 * seat (green free, blue this session, yellow another), then every open request the cards would show.
 */
function phoneText(reply: Reply): string {
  if (reply.error) return describe(reply)
  const square = !reply.seat ? '🟩' : reply.seat.session === ctx.me ? '🟦' : '🟨'
  const who = (id: string) => (id === ctx.me ? 'this session' : id.slice(0, 8))
  const asks = (reply.requests ?? []).filter(ask => !ask.answer)
  const lines = asks.map(ask => `🟨 ${who(ask.session)} asks to go next: ${ask.reason}`)
  return [`${square} ${describe(reply)}`, ...lines, '/pc help for more'].join('\n')
}

function describe(reply: Reply): string {
  if (reply.error) return `shared-pc error: ${reply.error}`
  const who = (id: string) => (id === ctx.me ? 'this session' : id.slice(0, 8))
  const seat = reply.seat
  const lines = [
    seat ? `Seat: ${who(seat.session)} · ${seat.kind === 'hold' ? `hold: ${seat.reason}` : seat.label}` : 'Seat: free',
    ...(reply.line ?? []).map((entry, i) => `${i + 1}. ${who(entry.session)} · ${entry.label}`),
  ]
  if (reply.note) lines.push(reply.note)
  return lines.join('\n')
}
