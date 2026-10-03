import type { EngineInterface, Register } from 'claude-code'

// One watched PR. The status line reads these from the session's state file.
export type Watch = {
  repo: string
  number: number
  headSha: string
  startedAt: number
  checks: Record<string, string>
  stablePolls: number
  // When the checks last went quiet; unset while any runs.
  quietSince?: number
  outcome?: 'passed' | 'failed' | 'timeout'
  settledAt?: number
  /** Set when the watch starts; names its wake claim (see `claimWake`). */
  id?: string
}

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/
// Matched on the command with its quoted text and here-doc bodies blanked (see `commandWords`), and on
// the subcommand word: `git commit -m "explain the push"` is not a push. Global options may come first.
const GIT_OPTS = String.raw`(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*`
const GH_OPTS = String.raw`(?:\s+(?:-R\s+\S+|--repo[=\s]\S+))*`
const AT_START = String.raw`(?:^|[\s;&|({])`
const PUSH_OR_PR = new RegExp(
  `${AT_START}git${GIT_OPTS}\\s+push\\b|${AT_START}gh${GH_OPTS}\\s+pr${GH_OPTS}\\s+create\\b`,
)
const PR_MERGE = new RegExp(`${AT_START}gh${GH_OPTS}\\s+pr${GH_OPTS}\\s+merge\\b([^|;&\\n]*)`)
const PENDING = new Set(['pending'])
const FAILED = new Set(['fail', 'cancel'])
const SETTLE_POLLS = 2
const KEEP_SETTLED_MS = 60 * 60_000

const live = {
  pollMs: 60_000,
  timeoutMs: 60 * 60_000,
  watches: [] as Watch[],
  isPolling: false,
  /** The last save failed: memory holds watches the file may lack. */
  isUnsaved: false,
  /** Counts the changes made outside a poll (a new watch, a stop, a merge), so a poll can tell. */
  generation: 0,
}

// The poll's results laid over the watches as they are now: a watch started meanwhile is kept, one
// stopped or dropped meanwhile stays gone.
function reconcile(current: Watch[], polled: Watch[]): Watch[] {
  const same = (a: Watch, b: Watch) =>
    a.id !== undefined ? a.id === b.id : b.id === undefined && a.repo === b.repo && a.number === b.number
  return current.map(w => polled.find(p => same(p, w)) ?? w)
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
  // Nothing wakes the session while any check or workflow still runs: a fix pushed mid-run
  // restarts the rest. Two quiet polls also let a workflow that starts late show up, and the
  // checks must stay quiet a full poll interval: instances left by a hot reload poll seconds
  // apart, and right after a push GitHub can still answer with the old commit's results.
  const hasFailed = names.some(name => FAILED.has(checks[name] ?? ''))
  if (stablePolls >= SETTLE_POLLS && now - (quietSince ?? now) >= quietMs)
    return { ...next, outcome: hasFailed ? 'failed' : 'passed', settledAt: now }
  if (now - watch.startedAt > timeoutMs) return { ...next, outcome: 'timeout', settledAt: now }
  return next
}

// The command with quoted strings emptied and here-doc bodies dropped, so message text never reads as
// a command. Folders come from the raw command (`targetFolder`).
// Each shell's own escape inside double quotes: a backslash in Bash (where a backtick runs a command and
// escapes nothing), a backtick in PowerShell (where a backslash is a plain character).
const DOUBLE_QUOTED = {
  bash: String.raw`"(?:[^"\\]|\\[\s\S])*"`,
  powershell: '"(?:[^"`]|`[\\s\\S])*"',
}

// Which lines are here-doc bodies (and their end lines): they hold text, never commands.
function hereDocLines(lines: readonly string[]): Set<number> {
  const body = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    // `<<` alone: `<<<` feeds one word, not the lines after it. Found on the line with its quoted text
    // blanked (a delimiter's own quotes kept), so a `<<EOF` inside a message opens nothing.
    const unquoted = (lines[i] ?? '').replace(/(?<!<<-?\s*)(?:'[^']*'|"(?:[^"\\`]|[\\`].)*")/g, '""')
    const doc = /(?<!<)<<(?!<)-?\s*(["']?)([A-Za-z_][\w.-]*)\1/.exec(unquoted)
    if (!doc) continue
    while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== doc[2]) body.add(++i)
    if (i + 1 < lines.length) body.add(++i)
  }
  return body
}

const quotedSpans = (isPowerShell: boolean) =>
  new RegExp(
    String.raw`@'[\s\S]*?'@|@"[\s\S]*?"@|'[^']*'|${isPowerShell ? DOUBLE_QUOTED.powershell : DOUBLE_QUOTED.bash}`,
    'g',
  )

export function commandWords(command: string, isPowerShell = false): string {
  const lines = command.split('\n')
  const body = hereDocLines(lines)
  return lines
    .filter((_, i) => !body.has(i))
    .join('\n')
    .replace(quotedSpans(isPowerShell), '""')
}

// The command at full length, with here-doc bodies blanked and the inside of each quoted string filled
// with `_`: a match on it sits at the same place in the command, and message text matches nothing.
function maskedCommand(command: string, isPowerShell: boolean): string {
  const lines = command.split('\n')
  const body = hereDocLines(lines)
  return lines
    .map((line, i) => (body.has(i) ? ' '.repeat(line.length) : line))
    .join('\n')
    .replace(quotedSpans(isPowerShell), span => span[0] + '_'.repeat(span.length - 2) + span[span.length - 1])
}

export function isPushOrPr(command: string, isPowerShell = false): boolean {
  return PUSH_OR_PR.test(commandWords(command, isPowerShell))
}

// A merged PR's watch is noise: the chat already says it merged. Returns the
// PR number a `gh pr merge` names, 0 when it names none (the branch's PR).
export function mergedNumber(command: string, isPowerShell = false): number | undefined {
  const merge = PR_MERGE.exec(commandWords(command, isPowerShell))
  if (!merge) return undefined
  const named = /(?:^|\s)#?(\d+)(?=\s|$)/.exec(merge[1] ?? '')
  return named ? Number(named[1]) : 0
}

export function wakeText(watch: Watch): string {
  const entries = Object.entries(watch.checks)
  const pr = `PR ${watch.repo}#${watch.number}`
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
// not written for SWEEP_DAYS are removed (`<folder> <days> <this session's id>`).
const SWEEP_DAYS = 2
export const SWEEP_SCRIPT =
  'const fs=require("fs"),p=require("path");const [d,days,keep]=process.argv.slice(1);' +
  'if(fs.existsSync(d)){const cut=Date.now()-days*864e5;for(const n of fs.readdirSync(d)){' +
  'if(!/\\.(json|owner)$/.test(n)||n.startsWith(keep+"."))continue;' +
  'try{const f=p.join(d,n);if(fs.statSync(f).mtimeMs<cut)fs.unlinkSync(f)}catch{}}}'

async function sweep($: EngineInterface): Promise<void> {
  const path = await statePath($)
  const args = [path.slice(0, path.lastIndexOf('/')), String(SWEEP_DAYS), await $.session.id()]
  await $.process.run(['node', '-e', SWEEP_SCRIPT, ...args], { timeoutMs: 20_000 }).catch(() => undefined)
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
async function save($: EngineInterface): Promise<void> {
  try {
    const path = await statePath($)
    await ensureDir($, path.slice(0, path.lastIndexOf('/')))
    await $.fs.write(path, JSON.stringify({ watches: live.watches }))
    live.isUnsaved = false
  } catch {
    // Memory stays the truth (the file may lack a new watch or still hold stopped ones), and the next
    // poll saves again.
    live.isUnsaved = true
  }
}

async function readSaved($: EngineInterface): Promise<Watch[] | undefined> {
  try {
    const saved = JSON.parse(String(await $.fs.read(await statePath($)))) as { watches?: Watch[] }
    return saved.watches
  } catch {
    return undefined
  }
}

async function load($: EngineInterface): Promise<void> {
  live.watches = (await readSaved($)) ?? []
}

// True when the saved file already records this watch as settled: another instance woke the session.
function isRecorded(saved: readonly Watch[] | undefined, watch: Watch): boolean {
  const there = saved?.find(w => w.repo === watch.repo && w.number === watch.number && w.headSha === watch.headSha)
  return there?.outcome !== undefined
}

// A last guard against a second wake from the same instance (two of its polls settling one watch). A
// hot reload's instances may not share this global (see the owner file above), so across instances the
// owner file and `isRecorded` are what keep a wake to one.
export function claimWake(watch: Watch): boolean {
  const shared = globalThis as { __ciWatchWoken?: Set<string> }
  const woken = (shared.__ciWatchWoken ??= new Set())
  const key = `${watch.id ?? ''}|${watch.repo}#${watch.number}@${watch.headSha}`
  if (woken.has(key)) return false
  woken.add(key)
  return true
}

// The folder a push or `gh pr create` ran in: `git -C <dir>` or the `cd <dir>` / `Set-Location <dir>`
// steps before it, on the same line or the lines above. Undefined means the session's folder.
const GIT_C = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/
const CD = /(?:^|[;&|\n]\s*)(?:cd|Set-Location|Push-Location|pushd)\s+(?:-Path\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/g
const PUSH_AT = /\bgit\b[^;&|\n]*\bpush\b|\bgh\s+pr\s+create\b/
const ABSOLUTE = /^(?:[a-zA-Z]:|[/\\~])/

// The patterns run on the masked command, so text inside quotes or here-docs steers nothing; each path
// is then read from the command at the same place.
export function targetFolder(command: string, isWindows: boolean, isPowerShell = false): string | undefined {
  // Git Bash paths (/c/Users/...) mean nothing to a Windows process: turn them into C:/Users/...
  // Only on Windows: elsewhere `/u/me` is a real one-letter folder.
  const masked = maskedCommand(command, isPowerShell)
  const pathAt = (match: RegExpExecArray | RegExpMatchArray, offset = 0) => {
    const at = offset + (match.index ?? 0) + match[0].length - match[1]!.length
    const bare = command.slice(at, at + match[1]!.length).replace(/^["']|["']$/g, '')
    return isWindows ? bare.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : bare
  }
  const push = PUSH_AT.exec(masked)
  // `git -C <dir>` on the push itself wins.
  const gitC = push ? GIT_C.exec(push[0]) : null
  if (push && gitC) return pathAt(gitC, push.index)
  // Each `cd` before the push moves on from the one before it, unless it names a whole path.
  let folder: string | undefined
  for (const step of masked.slice(0, push?.index ?? masked.length).matchAll(CD)) {
    const next = pathAt(step)
    folder = folder === undefined || ABSOLUTE.test(next) ? next : `${folder}/${next}`
  }
  return folder
}

async function gh($: EngineInterface, args: readonly string[], cwd?: string): Promise<string> {
  // `gh pr checks` exits non-zero while checks are pending; its JSON is still on stdout.
  const { stdout } = await $.process.run(['gh', ...args], { timeoutMs: 30_000, ...(cwd ? { cwd } : {}) })
  return stdout.trim()
}

async function prOfBranch(
  $: EngineInterface,
  cwd?: string,
): Promise<{ repo: string; number: number; headSha: string } | undefined> {
  try {
    const view = JSON.parse(await gh($, ['pr', 'view', '--json', 'number,url,headRefOid'], cwd)) as {
      number: number
      url: string
      headRefOid: string
    }
    const repo = PR_URL.exec(view.url)?.[1]
    return repo ? { repo, number: view.number, headSha: view.headRefOid } : undefined
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
        ? { ...current, headSha: head, startedAt: now, stablePolls: 0, quietSince: undefined, checks: {} }
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
    const next = checks
      ? settle(base, checks, now, live.timeoutMs, live.pollMs)
      : now - base.startedAt > live.timeoutMs
        ? { ...base, outcome: 'timeout' as const, settledAt: now }
        : base
    kept.push(next)
    changed = true
    if (next.outcome) settled.push(next)
  }
  // A push, a stop or a merge while this poll waited on gh changed the list: lay the results over it.
  live.watches = live.generation === generation ? kept : reconcile(live.watches, kept)
  const toWake = settled.filter(w => live.watches.includes(w))
  // A newer load took over while this poll waited on gh: it settles the watches on its own next poll,
  // so this instance neither saves nor wakes.
  if (await isRetired($)) return
  // The two instances poll on their own phases and spend seconds in gh, so the file is read again
  // right before waking: a settlement it already records was sent by the other instance. This
  // instance's record is written before its prompt goes out.
  const recorded = toWake.length > 0 ? await readSaved($) : undefined
  if (changed || live.isUnsaved) await save($)
  for (const watch of toWake) {
    if (!isRecorded(recorded, watch) && claimWake(watch))
      void $.prompt.submit({ text: wakeText(watch) }).catch(() => undefined)
  }
}

// A hot reload starts the module over without a new session.start: the next
// turn or tool call reloads the saved watches and restarts polling.
async function startPolling($: EngineInterface): Promise<void> {
  if (live.isPolling) return
  live.isPolling = true
  await claimOwner($)
  await sweep($)
  await load($)
  const tick = $.clock.every(live.pollMs, async () => {
    if (await isRetired($)) return void tick.cancel()
    await poll($).catch(() => undefined)
  })
}

export const register: Register = (on, options) => {
  live.pollMs = Number(options.pollSeconds ?? 60) * 1000
  live.timeoutMs = Number(options.timeoutMinutes ?? 60) * 60_000

  on('session.start', async ($, e, next) => {
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
    await $.command.register({ name: 'ci-watch', description: 'Show watched PRs, or stop: /ci-watch stop' })
    return result
  })

  // startPolling first: a freshly loaded instance claims the owner file before any check.
  on('turn.start', async ($, e, next) => {
    await startPolling($)
    return next(e)
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    await startPolling($)
    if (await isRetired($)) return next(e)
    const result = await next(e)
    const command = String((e as { command?: unknown }).command ?? '')
    const isPowerShell = (e as { tool?: unknown }).tool === 'PowerShell'
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

  on('command.run', { command: 'ci-watch' }, async ($, e, next) => {
    await startPolling($)
    if (await isRetired($)) return next(e)
    if (e.args.trim() === 'stop') {
      live.watches = []
      live.generation++
      await save($)
      return { text: 'Stopped watching every PR in this session.' }
    }
    if (live.watches.length === 0) return { text: 'No PR is being watched.' }
    const lines = live.watches.map(w => {
      const states = Object.values(w.checks)
      const passed = states.filter(bucket => !PENDING.has(bucket) && !FAILED.has(bucket)).length
      return `${w.repo}#${w.number}: ${w.outcome ?? 'running'}, ${passed}/${states.length} done`
    })
    return { text: lines.join('\n') }
  })
}
