import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Watch } from '../types'
import { isPush, isPushOrPr, mergedNumber, pushesBranch, targetFolder } from './command'
import { actionsIncident, incidentText, STATUS_EVERY_MS, STATUS_SCRIPT, STUCK_MS } from './incident'
import { redRounds, refusalText, ROUND_LIMIT, roundNodes, ROUNDS_FILE, ROUNDS_QUERY, TOUCHES_ROUNDS } from './rounds'
import { applyFile, register as settings, SETTINGS_PANE } from './settings'
import { keyOf, phoneText, registerView, STOP_PREFIX, summary } from './view'


const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/
const PENDING = new Set(['pending'])
const FAILED = new Set(['fail', 'cancel'])
const SETTLE_POLLS = 2
const KEEP_SETTLED_MS = 60 * 60_000
const HINT = '[help | settings | set | stop | phone | rounds]'
export const HELP = [
  "/ci-watch: watches a PR's checks and wakes the session once when they settle.",
  '  /ci-watch           the watched PRs and their checks',
  '  /ci-watch stop      stop watching every PR in this session',
  '  /ci-watch settings  open the settings pane',
  '  /ci-watch set       change a setting: set <name> <value>; alone, list them',
  '  /ci-watch phone     the same as text, for phone chats',
  `  /ci-watch rounds    the fix rounds in a row without green checks on this branch's PR (or rounds <pr>);`,
  `                      pushes are refused at ${ROUND_LIMIT}, until you type: rounds reset <pr>`,
  '  /ci-watch help      this list',
].join('\n')

const live = {
  pollMs: 30_000,
  timeoutMs: 60 * 60_000,
  watches: [] as Watch[],
  /** The load's one start: claim, sweep, load, poll. Every hook awaits it, so none acts mid-claim. */
  started: undefined as Promise<void> | undefined,
  /** The last save failed: memory holds watches the file may lack. */
  isUnsaved: false,
  /** Counts the changes made outside a poll (a new watch, a stop, a merge), so a poll can tell. */
  generation: 0,
  /** Saved with the watches: a reload mid-turn loads it, since that turn started in the old module. */
  isTurnRunning: false,
}

// The poll's results laid over the watches as they are now: a watch started meanwhile is kept, one
// stopped or dropped meanwhile stays gone. A pending wake is memory's: one sent meanwhile stays sent. So is
// an incident's note, while the watch is still unsettled on the same head (the poll drops it otherwise).
// The polled copy itself is kept whenever nothing differs: the poll finds its settled watches by identity.
function reconcile(current: Watch[], polled: Watch[]): Watch[] {
  const same = (a: Watch, b: Watch) =>
    a.id !== undefined ? a.id === b.id : b.id === undefined && a.repo === b.repo && a.number === b.number
  return current.map(w => {
    const p = polled.find(p => same(p, w))
    if (!p) return w
    const isNoteMemorys = !p.outcome && p.headSha === w.headSha
    const incidentPending = isNoteMemorys ? w.incidentPending : p.incidentPending
    // A note made meanwhile (another poll of this load noted and sent it) is kept, or it would be made again.
    const incident = isNoteMemorys ? (w.incident ?? p.incident) : p.incident
    const isKept =
      Boolean(p.wakePending) === Boolean(w.wakePending) &&
      Boolean(p.incidentPending) === Boolean(incidentPending) &&
      p.incident === incident
    return isKept ? p : { ...p, wakePending: w.wakePending, incidentPending, incident }
  })
}

export function settle(
  watch: Watch,
  checks: Record<string, string>,
  now: number,
  timeoutMs: number,
  quietMs: number,
): Watch {
  const names = Object.keys(checks)
  const isQuiet = names.length > 0 && names.every(name => !PENDING.has(checks[name] ?? ''))
  const stablePolls = isQuiet ? watch.stablePolls + 1 : 0
  const quietSince = isQuiet ? (watch.quietSince ?? now) : undefined
  const next: Watch = { ...watch, checks, stablePolls, quietSince }
  // Nothing wakes the session while any check or workflow still runs: a fix pushed mid-run restarts the
  // rest. The checks must stay quiet for two polls a full poll interval apart: right after a push GitHub
  // can still answer with the old commit's results, and a check can go back to pending seconds after it
  // finished (a review that escalates to a deeper one). Instances left by a hot reload poll seconds apart.
  const hasFailed = names.some(name => FAILED.has(checks[name] ?? ''))
  const isConfirmed = stablePolls >= SETTLE_POLLS && now - (quietSince ?? now) >= quietMs
  if (isQuiet && isConfirmed)
    return { ...next, outcome: hasFailed ? 'failed' : 'passed', settledAt: now }
  if (now - watch.startedAt > timeoutMs) return { ...next, outcome: 'timeout', settledAt: now }
  return next
}

// How long ago the checks finished, so a late wake shows its delay.
function finishedAgo(watch: Watch, now?: number): string {
  if (now === undefined || watch.settledAt === undefined) return ''
  const minutes = Math.max(0, Math.round((now - watch.settledAt) / 60_000))
  return minutes === 0 ? ' Checks finished just now.' : ` Checks finished ${minutes} min ago.`
}

export function wakeText(watch: Watch, now?: number): string {
  return `${outcomeText(watch, now)}${finishedAgo(watch, now)}`
}

function outcomeText(watch: Watch, now?: number): string {
  const entries = Object.entries(watch.checks)
  const pr = `PR ${watch.repo}#${watch.number}`
  // Not settled: the wake names GitHub's incident while the checks wait.
  if (!watch.outcome && watch.incident) {
    const minutes = Math.round(((now ?? watch.startedAt) - watch.startedAt) / 60_000)
    return incidentText(pr, minutes, watch.incident)
  }
  const failed = entries.filter(([, bucket]) => FAILED.has(bucket)).map(([name]) => name)
  if (watch.outcome === 'failed') {
    return (
      `[ci-watch] ${pr}: all checks settled; failed: ${failed.join(', ')}. Fetch the failing logs (gh run ` +
      `view --log-failed) or the review comment, fix and push; the watch restarts on the new commit.`
    )
  }
  if (watch.outcome === 'timeout') {
    const pending = entries.filter(([, bucket]) => PENDING.has(bucket)).map(([name]) => name)
    return (
      `[ci-watch] ${pr}: still pending after the time limit: ${pending.join(', ') || 'no checks reported'}. ` +
      `Look at why before waiting longer.`
    )
  }
  return (
    `[ci-watch] ${pr}: all ${entries.length} checks settled with no failure. Verify it is mergeable and ` +
    `finish it per the project rules.`
  )
}

// The engine's fs makes no missing folders, so the data folder is made through node, once per load.
export const MKDIR_SCRIPT = 'require("fs").mkdirSync(process.argv[1],{recursive:true})'
const madeDirs = new Set<string>()
async function ensureDir($: EngineInterface, dir: string): Promise<void> {
  if (madeDirs.has(dir)) return
  const { exitCode } = await $.process.run(['node', '-e', MKDIR_SCRIPT, dir], { timeoutMs: 10_000 })
  if (exitCode === 0) madeDirs.add(dir)
}

// Every session leaves a state file and an owner file behind. Once per load, those of other sessions
// not written for SWEEP_DAYS are removed, never the settings
// (`node <plugin root>/scripts/sweep.cjs <folder> <this session's id> <days>`; test-helper/sweep.spec.cjs runs it).
const SWEEP_DAYS = 2
export const SWEEP_SCRIPT = 'scripts/sweep.cjs'

async function sweep($: EngineInterface): Promise<void> {
  const path = await statePath($)
  const args = [path.slice(0, path.lastIndexOf('/')), await $.session.id(), String(SWEEP_DAYS)]
  const script = `${$.plugin.root}/${SWEEP_SCRIPT}`
  await $.process.run(['node', script, ...args], { timeoutMs: 20_000 }).catch(() => undefined)
}

async function statePath($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const dir = `${configured ?? `${home}/.claude`}/mods-data/ci-watch`
  return `${dir}/${await $.session.id()}.json`.replaceAll('\\', '/')
}

// A hot reload loads this module again but leaves the earlier instance's timer (and old code)
// running beside the new one. The instance that starts polling last names itself in the session's
// owner file; one that finds another name there is retired: it stops polling and its hooks pass
// through. A file, not a global, because instances do not share one. An unreadable file retires none.
const INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`

async function ownerPath($: EngineInterface): Promise<string> {
  return (await statePath($)).replace(/\.json$/, '.owner')
}

async function claimOwner($: EngineInterface): Promise<void> {
  try {
    const path = await ownerPath($)
    await ensureDir($, path.slice(0, path.lastIndexOf('/')))
    await $.fs.write(path, INSTANCE)
  } catch {
    // No owner file: every instance stays active, as before.
  }
}

export async function isRetired($: EngineInterface): Promise<boolean> {
  try {
    const owner = String(await $.fs.read(await ownerPath($))).trim()
    return owner !== '' && owner !== INSTANCE
  } catch {
    return false
  }
}

// A failed write never rejects a hook: the push it follows has already run.
// The band (view.tsx) reads the watches from session state; every save and load hands it a copy.
const shown = atom({ plugin: 'ci-watch', key: 'watches' } as const, [])

async function publish($: EngineInterface): Promise<void> {
  await update($, shown, () => live.watches.map(w => ({ ...w })))
}

async function save($: EngineInterface): Promise<void> {
  try {
    const path = await statePath($)
    await ensureDir($, path.slice(0, path.lastIndexOf('/')))
    await $.fs.write(path, JSON.stringify({ watches: live.watches, isTurnRunning: live.isTurnRunning }))
    live.isUnsaved = false
  } catch {
    // Memory stays the truth (the file may lack a new watch or still hold stopped ones), and the next
    // poll saves again.
    live.isUnsaved = true
  }
  // The band shows memory, so it stays current while the file cannot be written.
  await publish($)
}

type Saved = { watches?: Watch[]; isTurnRunning?: boolean }

async function readState($: EngineInterface): Promise<Saved | undefined> {
  try {
    return JSON.parse(String(await $.fs.read(await statePath($)))) as Saved
  } catch {
    return undefined
  }
}

async function readSaved($: EngineInterface): Promise<Watch[] | undefined> {
  return (await readState($))?.watches
}

async function load($: EngineInterface): Promise<void> {
  const saved = await readState($)
  live.watches = saved?.watches ?? []
  live.isTurnRunning = Boolean(saved?.isTurnRunning)
  await publish($)
}

// Saved at once: an instance loaded by a reload mid-turn reads it from the file.
async function setTurnRunning($: EngineInterface, isRunning: boolean): Promise<void> {
  if (live.isTurnRunning === isRunning) return
  live.isTurnRunning = isRunning
  await save($)
}

// The band's stop button: forget one watch, as `/ci-watch stop` forgets them all.
async function stopOne($: EngineInterface, key: string): Promise<void> {
  live.watches = live.watches.filter(w => keyOf(w) !== key)
  live.generation++
  await save($)
}

// True when the saved file already records this watch as settled: another instance woke the session, or
// holds the wake pending, which the live instance sends.
function isRecorded(saved: readonly Watch[] | undefined, watch: Watch): boolean {
  const there = saved?.find(w => w.repo === watch.repo && w.number === watch.number && w.headSha === watch.headSha)
  return there?.outcome !== undefined
}

// A last guard against a second wake from the same instance (two of its polls settling one watch). A
// hot reload's instances may not share this global (see the owner file above), so across instances the
// owner file and `isRecorded` are what keep a wake to one.
const wakeKey = (watch: Watch) => `${watch.id ?? ''}|${watch.repo}#${watch.number}@${watch.headSha}`

export function claimWake(watch: Watch): boolean {
  const shared = globalThis as { __ciWatchWoken?: Set<string> }
  const woken = (shared.__ciWatchWoken ??= new Set())
  const key = wakeKey(watch)
  if (woken.has(key)) return false
  woken.add(key)
  return true
}

async function gh($: EngineInterface, args: readonly string[], cwd?: string): Promise<string> {
  // `gh pr checks` exits non-zero while checks are pending; its JSON is still on stdout.
  const { stdout } = await $.process.run(['gh', ...args], { timeoutMs: 30_000, ...(cwd ? { cwd } : {}) })
  return stdout.trim()
}

// The branch's PR, or the PR `number` names, in the repo of the folder.
async function prOfBranch(
  $: EngineInterface,
  cwd?: string,
  number?: string,
): Promise<{ repo: string; number: number; headSha: string; state?: string; branch?: string } | undefined> {
  try {
    const args = ['pr', 'view', ...(number ? [number] : []), '--json', 'number,url,headRefOid,state,headRefName']
    const view = JSON.parse(await gh($, args, cwd)) as {
      number: number
      url: string
      headRefOid: string
      state?: string
      headRefName?: string
    }
    const repo = PR_URL.exec(view.url)?.[1]
    const found = { repo, number: view.number, headSha: view.headRefOid, state: view.state, branch: view.headRefName }
    return repo ? { ...found, repo } : undefined
  } catch {
    return undefined
  }
}

async function isClosed($: EngineInterface, repo: string, number: number): Promise<boolean> {
  try {
    const view = JSON.parse(await gh($, ['pr', 'view', String(number), '--repo', repo, '--json', 'state']))
    return view.state === 'MERGED' || view.state === 'CLOSED'
  } catch {
    return false
  }
}

async function headOf($: EngineInterface, repo: string, number: number): Promise<string> {
  try {
    const view = JSON.parse(await gh($, ['pr', 'view', String(number), '--repo', repo, '--json', 'headRefOid']))
    return String(view.headRefOid ?? '')
  } catch {
    return ''
  }
}

// The fix-round limit (rounds.ts). The resets live beside the session files, shared by every session.
async function roundsPath($: EngineInterface): Promise<string> {
  const path = await statePath($)
  return `${path.slice(0, path.lastIndexOf('/'))}/${ROUNDS_FILE}`
}

async function readResets($: EngineInterface): Promise<Record<string, string>> {
  try {
    const resets = JSON.parse(String(await $.fs.read(await roundsPath($))))
    return resets && typeof resets === 'object' ? (resets as Record<string, string>) : {}
  } catch {
    return {}
  }
}

async function redRoundsOf($: EngineInterface, pr: { repo: string; number: number }): Promise<number> {
  const [owner, name] = pr.repo.split('/')
  // `-f` sends a string as is; `-F` would turn an all-digit owner or name into a number GraphQL refuses.
  const query = ['api', 'graphql', '-f', `query=${ROUNDS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`]
  const answer = await gh($, [...query, '-F', `number=${pr.number}`]).catch(() => '')
  return redRounds(roundNodes(answer), (await readResets($))[`${pr.repo}#${pr.number}`])
}

// A push to a PR past the limit: why it is refused. Only the open PR of the folder the push runs in, and
// only a push that updates that PR's branch; a PR GitHub cannot be asked about is not refused.
async function roundRefusal($: EngineInterface, command: string, isPowerShell: boolean) {
  const folder = targetFolder(command, (await $.env.get('OS')) === 'Windows_NT', isPowerShell)
  const pr = await prOfBranch($, folder)
  if (!pr || pr.state !== 'OPEN' || !pr.branch || !pushesBranch(command, pr.branch, isPowerShell)) return undefined
  const red = await redRoundsOf($, pr)
  return red >= ROUND_LIMIT ? `BLOCKED (ci-watch): ${refusalText(`${pr.repo}#${pr.number}`, red)}` : undefined
}

const ROUNDS_OWN =
  "BLOCKED (ci-watch): the fix-round count's file is the user's: only `/ci-watch rounds reset` writes it."

// `/ci-watch rounds [reset] [<pr>]`. A reset counts only when the user typed it (at the prompt or from the
// phone): a command a plugin or the session runs never clears the limit.
async function roundsCommand($: EngineInterface, args: string, origin: { kind: string }): Promise<string> {
  const match = /^rounds(\s+reset)?(?:\s+#?(\d+))?\s*$/.exec(args)
  if (!match) return HELP
  const pr = await prOfBranch($, undefined, match[2])
  if (!pr) return match[2] ? `No PR #${match[2]} in this folder's repo.` : "This folder's branch has no PR."
  const key = `${pr.repo}#${pr.number}`
  if (!match[1]) {
    const red = await redRoundsOf($, pr)
    return `${key}: ${red} fix round(s) in a row without every check green; pushes are refused at ${ROUND_LIMIT}.`
  }
  if (origin.kind !== 'composer' && origin.kind !== 'bridge') return 'Only the user resets the fix-round count.'
  const path = await roundsPath($)
  await ensureDir($, path.slice(0, path.lastIndexOf('/')))
  await $.fs.write(path, JSON.stringify({ ...(await readResets($)), [key]: pr.headSha }))
  return `Reset the fix-round count of ${key}: rounds after ${pr.headSha.slice(0, 7)} count from zero.`
}

// A push that moves no commit (tags, "Everything up-to-date") keeps the watch on that head, settled or
// not, so it wakes the session once. `isAsked`: the watch tool, which starts over on request.
async function startWatch(
  $: EngineInterface,
  repo: string,
  number: number,
  headSha: string,
  isAsked = false,
): Promise<Watch> {
  const same = live.watches.find(w => w.repo === repo && w.number === number && w.headSha === headSha)
  if (same && !isAsked) return same
  const startedAt = await $.clock.now()
  const id = `${startedAt}-${Math.random().toString(36).slice(2)}`
  const fresh: Watch = { repo, number, headSha, startedAt, checks: {}, stablePolls: 0, id }
  live.watches = [...live.watches.filter(w => !(w.repo === repo && w.number === number)), fresh]
  live.generation++
  await save($)
  return fresh
}

// A settled watch is kept an hour so a second instance does not wake for it again. A merge made outside
// this session (the web page) drops it. A head that moved restarts it: right after a push GitHub can
// still name the old commit, so the push found the settled watch, and its new commit is caught here.
async function recheckSettled($: EngineInterface, watch: Watch, now: number): Promise<Watch | undefined> {
  if (now - (watch.settledAt ?? now) >= KEEP_SETTLED_MS) return undefined
  let view: { state?: string; headRefOid?: string } = {}
  try {
    view = JSON.parse(
      await gh($, ['pr', 'view', String(watch.number), '--repo', watch.repo, '--json', 'state,headRefOid']),
    )
  } catch {
    // Unknown: kept as it is until the next poll.
  }
  if (view.state === 'MERGED' || view.state === 'CLOSED') return undefined
  const head = String(view.headRefOid ?? '')
  if (!head || head === watch.headSha) return watch
  const id = `${now}-${Math.random().toString(36).slice(2)}`
  return { repo: watch.repo, number: watch.number, headSha: head, startedAt: now, checks: {}, stablePolls: 0, id }
}

// GitHub's status, read at most every few minutes and only while some watch waits long past a normal run.
const status: { readAt?: number; incident?: string } = {}
async function readIncident($: EngineInterface, now: number): Promise<string | undefined> {
  if (status.readAt !== undefined && now - status.readAt < STATUS_EVERY_MS) return status.incident
  status.readAt = now
  const r = await $.process.run(['node', '-e', STATUS_SCRIPT], { timeoutMs: 20_000 }).catch(() => null)
  status.incident = r && r.exitCode === 0 ? actionsIncident(r.stdout) : undefined
  return status.incident
}

// A watch whose checks sit pending past STUCK_MS while GitHub reports an Actions incident wakes the session
// once with the incident's name (the row shows it too), instead of waiting out the time limit in silence.
// Returns whether a watch changed.
async function noteIncidents($: EngineInterface, now: number): Promise<boolean> {
  // Some check still pending (or none reported yet): a watch only confirming finished checks is not stuck.
  const isPending = (w: Watch) => {
    const buckets = Object.values(w.checks)
    return buckets.length === 0 || buckets.some(bucket => PENDING.has(bucket))
  }
  const isWaiting = (w: Watch) => !w.outcome && !w.incident && now - w.startedAt > STUCK_MS && isPending(w)
  if (!live.watches.some(isWaiting)) return false
  const incident = await readIncident($, now)
  if (!incident) return false
  // Another load may have noted it while this one read GitHub (two stay active when the owner file cannot
  // be written): its saved note stands as saved, still held or already sent, and no second one is made.
  const saved = await readSaved($)
  const notedBy = (w: Watch) => saved?.find(s => s.id === w.id && s.headSha === w.headSha && s.incident)
  live.watches = live.watches.map(w => {
    if (!isWaiting(w)) return w
    const noted = notedBy(w)
    if (noted) return { ...w, incident: noted.incident, incidentPending: noted.incidentPending }
    return { ...w, incident, incidentPending: true }
  })
  return true
}

async function poll($: EngineInterface): Promise<void> {
  // Start from the saved state: a hot reload can leave an earlier instance's timer running beside
  // this one, and reading the file keeps a watch the other already settled from waking twice. With
  // no saved file yet, or after a failed save, the watches in memory stand. So do they when a push or a
  // stop landed during the read: the file it read is older than memory.
  const generation = live.generation
  const start = live.isUnsaved ? undefined : await readSaved($)
  if (start && live.generation === generation) live.watches = start
  const now = await $.clock.now()
  let changed = false
  const kept: Watch[] = []
  const settled: Watch[] = []
  for (const watched of live.watches) {
    let current = watched
    if (current.outcome) {
      const rechecked = await recheckSettled($, current, now)
      if (rechecked !== current) changed = true
      if (rechecked?.outcome) kept.push(rechecked)
      if (!rechecked || rechecked.outcome) continue
      current = rechecked
    }
    const head = await headOf($, current.repo, current.number)
    const base =
      head && head !== current.headSha
        ? {
            ...current,
            headSha: head,
            startedAt: now,
            stablePolls: 0,
            checks: {},
            quietSince: undefined,
            incident: undefined,
            incidentPending: undefined,
          }
        : current
    let checks: Record<string, string> | undefined
    try {
      const rows = JSON.parse(
        await gh($, ['pr', 'checks', String(base.number), '--repo', base.repo, '--json', 'name,bucket']),
      ) as {
        name: string
        bucket: string
      }[]
      checks = Object.fromEntries(rows.map(row => [row.name, row.bucket]))
    } catch {
      // A failed read (network, auth, no checks yet) is not a quiet poll: the count stands and the
      // next poll tries again. Only the time limit can settle the watch meanwhile.
    }
    const polled = checks
      ? settle(base, checks, now, live.timeoutMs, live.pollMs)
      : now - base.startedAt > live.timeoutMs
        ? { ...base, outcome: 'timeout' as const, settledAt: now }
        : base
    // Settled: its own wake says it all, so an incident note not sent yet is dropped.
    const next = polled.outcome && polled.incidentPending ? { ...polled, incidentPending: undefined } : polled
    kept.push(next)
    changed = true
    if (next.outcome) settled.push(next)
  }
  // A push, a stop or a merge while this poll waited on gh changed the list: lay the results over it.
  live.watches = live.generation === generation ? kept : reconcile(live.watches, kept)
  const toWake = settled.filter(w => live.watches.includes(w))
  // GitHub's status is read before the retirement check: the read can take seconds, and a load retired
  // meanwhile must not save over the newer one's file afterwards.
  const isIncidentNoted = await noteIncidents($, now)
  // A newer load took over while this poll waited on gh: it settles the watches on its own next poll,
  // so this instance neither saves nor wakes.
  if (await isRetired($)) return
  // The two instances poll on their own phases and spend seconds in gh, so the file is read again
  // right before waking: a settlement it already records was sent by the other instance. This
  // instance's record is written before its prompt goes out.
  const recorded = toWake.length > 0 ? await readSaved($) : undefined
  // Each wake is marked pending in the same save that records its outcome; sendHeld sends it.
  const due = new Set(toWake.filter(w => !isRecorded(recorded, w) && claimWake(w)))
  if (due.size > 0) live.watches = live.watches.map(w => (due.has(w) ? { ...w, wakePending: true } : w))
  if (changed || isIncidentNoted || live.isUnsaved) await save($)
  if (!live.isTurnRunning) await sendHeld($)
}

// Pending wakes go out from a poll while no turn runs; one that settles mid-turn rides the turn's next
// tool result instead (takeNotes), and what no tool result carried goes out from the first poll after it.
// The mark lives in the saved file, so a reload mid-turn sends it from the new module. Each is checked
// again first: a watch stopped or replaced meanwhile is no longer listed, and a PR merged or closed, or
// one whose head moved on (its new commit has a watch of its own), wakes nothing. Taken from memory in
// one step and saved as sent before any prompt goes out, so no wake goes twice.
const isHeld = (w: Watch) => Boolean(w.wakePending || w.incidentPending)
const asSent = (w: Watch): Watch => (isHeld(w) ? { ...w, wakePending: undefined, incidentPending: undefined } : w)

async function sendHeld($: EngineInterface): Promise<void> {
  if (await isRetired($)) return
  const held = live.watches.filter(isHeld)
  if (held.length === 0) return
  live.watches = live.watches.map(asSent)
  live.generation++
  await save($)
  for (const watch of held) {
    if (await isClosed($, watch.repo, watch.number)) continue
    const head = await headOf($, watch.repo, watch.number)
    if (head && head !== watch.headSha) continue
    const text = wakeText(watch, await $.clock.now())
    // A refused wake (a hook drops the prompt, or the call fails) is marked pending again for the next poll.
    void $.prompt
      .submit({ text })
      .then(
        sent => sent.drop !== undefined,
        () => true,
      )
      .then(isRefused => (isRefused ? markPending($, watch) : undefined))
      .catch(() => undefined)
  }
}

// Tries per wake: a hook that drops every prompt is not asked again each minute. An incident's early wake
// counts apart from the settlement's, so refusals of the first never cost the second its tries.
const MAX_TRIES = 3
const refusals = new Map<string, number>()
const triesKey = (watch: Watch) => `${watch.outcome ? 'settled' : 'incident'}:${wakeKey(watch)}`

// Saved, not only set in memory: every poll starts from the file. A newer load owns the file once this
// one is retired, so then only the flag is laid on its copy, and that load sends the wake.
async function markPending($: EngineInterface, watch: Watch): Promise<void> {
  const count = (refusals.get(triesKey(watch)) ?? 0) + 1
  refusals.set(triesKey(watch), count)
  if (count >= MAX_TRIES) return
  const isSame = (w: Watch) => w.id === watch.id && w.headSha === watch.headSha
  // An incident's note is marked again only while the watch is still unsettled: once it settled, its own
  // wake goes out instead.
  const marked = (w: Watch): Watch =>
    watch.outcome ? { ...w, wakePending: true } : w.outcome ? w : { ...w, incidentPending: true }
  const mark = (list: Watch[]) => list.map(w => (isSame(w) ? marked(w) : w))
  if (await isRetired($)) {
    const saved = await readState($)
    if (saved?.watches) await $.fs.write(await statePath($), JSON.stringify({ ...saved, watches: mark(saved.watches) }))
    return
  }
  live.watches = mark(live.watches)
  live.generation++
  await save($)
}

// As the old Monitor did: checks that finish while a turn runs reach it at once, on the next tool result,
// instead of waiting for the turn's end. Each is taken from the pending list in one step and saved.
async function takeNotes($: EngineInterface): Promise<string[]> {
  // A newer load may have taken over while the tool ran: the notes and the file are its own.
  if (!live.isTurnRunning || (await isRetired($))) return []
  const due = live.watches.filter(isHeld)
  if (due.length === 0) return []
  live.watches = live.watches.map(asSent)
  live.generation++
  await save($)
  const now = await $.clock.now()
  return due.map(w => wakeText(w, now))
}

// A hot reload starts the module over without a new session.start: the next
// turn or tool call reloads the saved watches and restarts polling. Each hook waits for the same start:
// a reload runs its start beside the model's next call, and a call that only saw the start under way
// read the older load's name in the owner file, passed itself on as retired, and went unanswered.
function startPolling($: EngineInterface): Promise<void> {
  live.started ??= (async () => {
    await claimOwner($)
    await sweep($)
    await load($)
    armPolling($)
  })().catch(() => undefined)
  return live.started
}

// A new interval from the settings file takes over at the next tick of the old one.
function armPolling($: EngineInterface): void {
  const period = live.pollMs
  const tick = $.clock.every(period, async () => {
    if (await isRetired($)) return void tick.cancel()
    if (live.pollMs !== period) {
      tick.cancel()
      armPolling($)
    }
    await poll($).catch(() => undefined)
  })
}

// The settings file at the session's start, before any tool call: the settings module follows it from
// there. Read here, since an engine handle is never passed into another file.
async function readSettings($: EngineInterface): Promise<void> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const file = await $.fs.read(`${config}/mods-data/ci-watch/settings.json`.replace(/\\/g, '/')).catch(() => '')
  const manifest = (dir: string) => $.fs.read(`${$.plugin.root}${dir}/plugin.json`)
  applyFile(String(file), String(await manifest('/.claude-plugin').catch(() => manifest('').catch(() => ''))))
}

export const register: Register = (on, options) => {
  registerView(on)
  // The settings come from the mod's own file over the loaded options, read again as it changes.
  settings(on, options, values => {
    live.pollMs = Number(values.pollSeconds ?? 30) * 1000
    live.timeoutMs = Number(values.timeoutMinutes ?? 60) * 60_000
  })

  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'ci-watch' || !e.element.startsWith(STOP_PREFIX)) return next(e)
    // As in tool.call: load the watches first, and leave the press to the live instance after a reload.
    await startPolling($)
    if (await isRetired($)) return next(e)
    await stopOne($, e.element.slice(STOP_PREFIX.length))
    return { element: e.element }
  })

  on('session.start', async ($, e, next) => {
    // A settings file that cannot be read never costs the start: the loaded options stand.
    await readSettings($).catch(() => undefined)
    const result = await next(e)
    await startPolling($)
    await $.tool.register({
      name: 'watch',
      description:
        "Watch a pull request's CI checks locally (no usage while waiting); the session is woken once when they " +
        'settle. ' +
        'Pushes and `gh pr create` are watched automatically; use this for any other PR.',
      inputSchema: {
        type: 'object',
        properties: {
          pr: { type: 'number', description: 'PR number.' },
          repo: { type: 'string', description: "owner/name; defaults to the current branch's PR repo." },
        },
        required: ['pr'],
      },
    })
    await $.command.register({ name: 'ci-watch', description: 'The PRs this session watches', argumentHint: HINT })
    // A new start runs no turn yet, whatever a session that ended mid-turn saved.
    await setTurnRunning($, false)
    return result
  })

  // startPolling first: a freshly loaded instance claims the owner file before any check.
  on('turn.start', async ($, e, next) => {
    await startPolling($)
    if (!(await isRetired($))) await setTurnRunning($, true)
    return next(e)
  })

  // A reload mid-turn ends the turn in the new module: it loads the watches, pending wakes included.
  on('turn.complete', async ($, e, next) => {
    await startPolling($)
    if (await isRetired($)) return next(e)
    await setTurnRunning($, false)
    // What is still pending (no tool result carried it) goes out from the next poll, between turns: a
    // prompt submitted from the turn's own end was seen to vanish.
    return next(e)
  })

  // The other common tools carry a finished watch into the running turn too.
  on('tool.call', { tool: ['Read', 'Edit', 'Write', 'Grep', 'Glob'] }, async ($, e, next) => {
    const input = e as { tool?: unknown; file_path?: unknown }
    const isWrite = input.tool === 'Edit' || input.tool === 'Write'
    if (isWrite && TOUCHES_ROUNDS.test(String(input.file_path ?? ''))) return { deny: ROUNDS_OWN }
    await startPolling($)
    if (await isRetired($)) return next(e)
    const result = await next(e)
    if (e.agentId !== undefined || 'deny' in result) return result
    const notes = await takeNotes($)
    return notes.length > 0 ? { ...result, context: [...(result.context ?? []), ...notes] } : result
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const command = String((e as { command?: unknown }).command ?? '')
    const isPowerShell = (e as { tool?: unknown }).tool === 'PowerShell'
    // Held by every instance, retired or not: the limit never waits on which one polls.
    if (TOUCHES_ROUNDS.test(command)) return { deny: ROUNDS_OWN }
    const refusal = isPush(command, isPowerShell) ? await roundRefusal($, command, isPowerShell) : undefined
    if (refusal) return { deny: refusal }
    await startPolling($)
    if (await isRetired($)) return next(e)
    const answered = await next(e)
    // A finished watch rides on this result; a subagent's call or a refused one carries none.
    const notes = e.agentId !== undefined || 'deny' in answered ? [] : await takeNotes($)
    const isPlain = 'deny' in answered || notes.length === 0
    const result = isPlain ? answered : { ...answered, context: [...(answered.context ?? []), ...notes] }
    if (result.deny !== undefined || result.isError) return result
    const merged = mergedNumber(command, isPowerShell)
    if (merged !== undefined) {
      // No number: the branch's PR, so every finished watch is a candidate. A watch is dropped only once
      // GitHub says its PR is merged or closed: `--auto` only queues the merge, and a refused merge
      // leaves the PR open, and either way the watch still has to wake the session.
      const candidates = live.watches.filter(w => (merged ? w.number === merged : w.outcome))
      const gone: Watch[] = []
      for (const w of candidates) if (await isClosed($, w.repo, w.number)) gone.push(w)
      if (gone.length > 0) {
        live.watches = live.watches.filter(w => !gone.includes(w))
        live.generation++
        await save($)
      }
      return result
    }
    if (!isPushOrPr(command, isPowerShell)) return result
    // `gh pr create` prints the new PR's URL; otherwise ask about the branch in the folder the command ran in.
    const created = PR_URL.exec(JSON.stringify(result.result ?? ''))
    if (created) {
      const [, repo, number] = created
      await startWatch($, repo!, Number(number), await headOf($, repo!, Number(number)))
      return result
    }
    const folder = targetFolder(command, (await $.env.get('OS')) === 'Windows_NT', isPowerShell)
    const pr = (await prOfBranch($, folder)) ?? (await prOfBranch($))
    if (pr) await startWatch($, pr.repo, pr.number, pr.headSha)
    return result
  })

  on('tool.call', { tool: 'mcp__ci-watch__watch' }, async ($, e, next) => {
    await startPolling($)
    if (await isRetired($)) return next(e)
    const input = e as { pr?: unknown; repo?: unknown }
    const number = Number(input.pr)
    const repo = typeof input.repo === 'string' && input.repo ? input.repo : (await prOfBranch($))?.repo
    if (!Number.isInteger(number) || !repo)
      return { deny: 'ci-watch needs a PR number, and a repo when the branch has no PR.' }
    await startWatch($, repo, number, await headOf($, repo, number), true)
    return { result: `Watching ${repo}#${number}; you will be woken once its checks settle.` }
  })

  // `/ci-watch [help | settings | stop | phone]`; with no argument, the watched PRs. An unknown verb gets the help.
  on('command.run', { command: 'ci-watch' }, async ($, e, next) => {
    // Typed with no word over Remote Control (the phone, the web, Desktop viewing a CLI session), where no
    // row draws: the bare command answers with the phone text.
    const verb = e.args.trim() || (e.origin?.kind === 'bridge' ? 'phone' : '')
    if (/^rounds\b/.test(verb)) return { text: await roundsCommand($, verb, e.origin ?? { kind: 'unclassified' }) }
    if (!['', 'settings', 'stop', 'phone'].includes(verb)) return { text: HELP }
    if (verb === 'settings') {
      await $.ui.open({ id: SETTINGS_PANE, title: 'CI watch settings', focus: true })
      return { text: 'Opened the ci-watch settings.' }
    }
    await startPolling($)
    if (await isRetired($)) return next(e)
    if (verb === 'stop') {
      live.watches = []
      live.generation++
      await save($)
      return { text: 'Stopped watching every PR in this session.' }
    }
    // The row's own words, so the command and the row never disagree; the phone also gets each check.
    const none = live.watches.length === 0 ? ['No PR is being watched.'] : []
    if (verb === 'phone')
      return { text: [...none, ...live.watches.map(phoneText), '/ci-watch help for more'].join('\n') }
    if (none.length > 0) return { text: none[0] }
    return { text: live.watches.map(w => `${summary(w).text} (${w.repo})`).join('\n') }
  })
}
