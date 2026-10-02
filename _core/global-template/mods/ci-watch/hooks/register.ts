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
const PUSH_OR_PR = new RegExp(`${AT_START}git${GIT_OPTS}\\s+push\\b|${AT_START}gh${GH_OPTS}\\s+pr${GH_OPTS}\\s+create\\b`)
const PR_MERGE = new RegExp(`${AT_START}gh${GH_OPTS}\\s+pr${GH_OPTS}\\s+merge\\b([^|;&\\n]*)`)
const PENDING = new Set(['pending'])
const FAILED = new Set(['fail', 'cancel'])
const SETTLE_POLLS = 2
const KEEP_SETTLED_MS = 60 * 60_000

const live: { pollMs: number; timeoutMs: number; watches: Watch[]; isPolling: boolean } = {
  pollMs: 60_000,
  timeoutMs: 60 * 60_000,
  watches: [],
  isPolling: false,
}

export function settle(watch: Watch, checks: Record<string, string>, now: number, timeoutMs: number, quietMs: number): Watch {
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
  if (stablePolls >= SETTLE_POLLS && now - (quietSince ?? now) >= quietMs) return { ...next, outcome: hasFailed ? 'failed' : 'passed', settledAt: now }
  if (now - watch.startedAt > timeoutMs) return { ...next, outcome: 'timeout', settledAt: now }
  return next
}

// The command with quoted strings emptied and here-doc bodies dropped, so message text never reads as
// a command. Folders come from the raw command (`targetFolder`).
export function commandWords(command: string): string {
  const lines = command.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    kept.push(line)
    const doc = /<<-?\s*(["']?)([A-Za-z_][\w.-]*)\1/.exec(line)
    if (!doc) continue
    while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== doc[2]) i++
    i++
  }
  return kept.join('\n').replace(/@'[\s\S]*?'@|@"[\s\S]*?"@|'[^']*'|"(?:[^"\\`]|[\\`][\s\S])*"/g, '""')
}

export function isPushOrPr(command: string): boolean {
  return PUSH_OR_PR.test(commandWords(command))
}

// A merged PR's watch is noise: the chat already says it merged. Returns the
// PR number a `gh pr merge` names, 0 when it names none (the branch's PR).
export function mergedNumber(command: string): number | undefined {
  const merge = PR_MERGE.exec(commandWords(command))
  if (!merge) return undefined
  const named = /(?:^|\s)#?(\d+)(?=\s|$)/.exec(merge[1] ?? '')
  return named ? Number(named[1]) : 0
}

export function wakeText(watch: Watch): string {
  const entries = Object.entries(watch.checks)
  const pr = `PR ${watch.repo}#${watch.number}`
  const failed = entries.filter(([, bucket]) => FAILED.has(bucket)).map(([name]) => name)
  if (watch.outcome === 'failed') {
    return `[ci-watch] ${pr}: all checks settled; failed: ${failed.join(', ')}. Fetch the failing logs (gh run view --log-failed) or the review comment, fix and push; the watch restarts on the new commit.`
  }
  if (watch.outcome === 'timeout') {
    const pending = entries.filter(([, bucket]) => PENDING.has(bucket)).map(([name]) => name)
    return `[ci-watch] ${pr}: still pending after the time limit: ${pending.join(', ') || 'no checks reported'}. Look at why before waiting longer.`
  }
  return `[ci-watch] ${pr}: all ${entries.length} checks settled with no failure. Verify it is mergeable and finish it per the project rules.`
}

// The engine's fs makes no missing folders, so the data folder is made through node, once per load.
export const MKDIR_SCRIPT = 'require("fs").mkdirSync(process.argv[1],{recursive:true})'
const madeDirs = new Set<string>()
async function ensureDir($: EngineInterface, dir: string): Promise<void> {
  if (madeDirs.has(dir)) return
  const { exitCode } = await $.process.run(['node', '-e', MKDIR_SCRIPT, dir], { timeoutMs: 10_000 })
  if (exitCode === 0) madeDirs.add(dir)
}

async function statePath($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const dir = `${configured ?? `${home}/.claude`}/mods-data/ci-watch`
  return `${dir}/${await $.session.id()}.json`.replaceAll('\\', '/')
}

// A failed write never rejects a hook: the push it follows has already run.
async function save($: EngineInterface): Promise<void> {
  try {
    const path = await statePath($)
    await ensureDir($, path.slice(0, path.lastIndexOf('/')))
    await $.fs.write(path, JSON.stringify({ watches: live.watches }))
  } catch {
    // The watches stay in memory; the next save tries again.
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

// Instances left beside each other by a hot reload share one process, so a claim on the global
// object, checked and set with no await in between, lets exactly one of them send each wake.
export function claimWake(watch: Watch): boolean {
  const shared = globalThis as { __ciWatchWoken?: Set<string> }
  const woken = (shared.__ciWatchWoken ??= new Set())
  const key = `${watch.id ?? ''}|${watch.repo}#${watch.number}@${watch.headSha}`
  if (woken.has(key)) return false
  woken.add(key)
  return true
}

// The folder a push or `gh pr create` ran in: `git -C <dir>` or a `cd <dir>` / `Set-Location <dir>`
// before it. Undefined means the session's folder.
export function targetFolder(command: string): string | undefined {
  // Git Bash paths (/c/Users/...) mean nothing to a Windows process: turn them into C:/Users/...
  const unquote = (raw: string) => raw.replace(/^["']|["']$/g, '').replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:')
  const gitC = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(command)
  if (gitC) return unquote(gitC[1]!)
  const cd = /(?:^|[;&|]\s*)(?:cd|Set-Location|Push-Location|pushd)\s+(?:-Path\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/.exec(command)
  return cd ? unquote(cd[1]!) : undefined
}

async function gh($: EngineInterface, args: readonly string[], cwd?: string): Promise<string> {
  // `gh pr checks` exits non-zero while checks are pending; its JSON is still on stdout.
  const { stdout } = await $.process.run(['gh', ...args], { timeoutMs: 30_000, ...(cwd ? { cwd } : {}) })
  return stdout.trim()
}

async function prOfBranch($: EngineInterface, cwd?: string): Promise<{ repo: string; number: number; headSha: string } | undefined> {
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

async function startWatch($: EngineInterface, repo: string, number: number, headSha: string): Promise<Watch> {
  const startedAt = await $.clock.now()
  const id = `${startedAt}-${Math.random().toString(36).slice(2)}`
  const fresh: Watch = { repo, number, headSha, startedAt, checks: {}, stablePolls: 0, id }
  live.watches = [...live.watches.filter(w => !(w.repo === repo && w.number === number)), fresh]
  await save($)
  return fresh
}

async function poll($: EngineInterface): Promise<void> {
  // Start from the saved state: a hot reload can leave an earlier instance's timer running beside
  // this one, and reading the file keeps a watch the other already settled from waking twice. With
  // no saved file yet, the watches in memory stand.
  const start = await readSaved($)
  if (start) live.watches = start
  const now = await $.clock.now()
  let changed = false
  const kept: Watch[] = []
  const settled: Watch[] = []
  for (const current of live.watches) {
    if (current.outcome) {
      // A merge made outside this session (the web page) clears it here.
      if (now - (current.settledAt ?? now) < KEEP_SETTLED_MS && !(await isClosed($, current.repo, current.number))) kept.push(current)
      else changed = true
      continue
    }
    const head = await headOf($, current.repo, current.number)
    const base = head && head !== current.headSha ? { ...current, headSha: head, startedAt: now, stablePolls: 0, quietSince: undefined, checks: {} } : current
    let checks: Record<string, string> | undefined
    try {
      const rows = JSON.parse(await gh($, ['pr', 'checks', String(base.number), '--repo', base.repo, '--json', 'name,bucket'])) as {
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
  live.watches = kept
  // The two instances poll on their own phases and spend seconds in gh, so the file is read again
  // right before waking: a settlement it already records was sent by the other instance. This
  // instance's record is written before its prompt goes out.
  const recorded = settled.length > 0 ? await readSaved($) : undefined
  if (changed) await save($)
  for (const watch of settled) {
    if (!isRecorded(recorded, watch) && claimWake(watch)) void $.prompt.submit({ text: wakeText(watch) }).catch(() => undefined)
  }
}

// A hot reload starts the module over without a new session.start: the next
// turn or tool call reloads the saved watches and restarts polling.
async function startPolling($: EngineInterface): Promise<void> {
  if (live.isPolling) return
  live.isPolling = true
  await load($)
  $.clock.every(live.pollMs, () => void poll($).catch(() => undefined))
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
        'Watch a pull request\'s CI checks locally (no usage while waiting); the session is woken once when they settle. ' +
        'Pushes and `gh pr create` are watched automatically; use this for any other PR.',
      inputSchema: {
        type: 'object',
        properties: {
          pr: { type: 'number', description: 'PR number.' },
          repo: { type: 'string', description: 'owner/name; defaults to the current branch\'s PR repo.' },
        },
        required: ['pr'],
      },
    })
    await $.command.register({ name: 'ci-watch', description: 'Show watched PRs, or stop: /ci-watch stop' })
    return result
  })

  on('turn.start', async ($, e, next) => {
    await startPolling($)
    return next(e)
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    await startPolling($)
    const result = await next(e)
    const command = String((e as { command?: unknown }).command ?? '')
    if (result.deny !== undefined || result.isError) return result
    const merged = mergedNumber(command)
    if (merged !== undefined) {
      // No number: the branch's PR, gone with the branch once merged, so clear every finished watch.
      live.watches = live.watches.filter(w => (merged ? w.number !== merged : !w.outcome))
      await save($)
      return result
    }
    if (!isPushOrPr(command)) return result
    // `gh pr create` prints the new PR's URL; otherwise ask about the branch in the folder the command ran in.
    const created = PR_URL.exec(JSON.stringify(result.result ?? ''))
    if (created) {
      const [, repo, number] = created
      await startWatch($, repo!, Number(number), await headOf($, repo!, Number(number)))
      return result
    }
    const pr = (await prOfBranch($, targetFolder(command))) ?? (await prOfBranch($))
    if (pr) await startWatch($, pr.repo, pr.number, pr.headSha)
    return result
  })

  on('tool.call', { tool: 'mcp__ci-watch__watch' }, async ($, e) => {
    const input = e as { pr?: unknown; repo?: unknown }
    const number = Number(input.pr)
    const repo = typeof input.repo === 'string' && input.repo ? input.repo : (await prOfBranch($))?.repo
    if (!Number.isInteger(number) || !repo) return { deny: 'ci-watch needs a PR number, and a repo when the branch has no PR.' }
    await startWatch($, repo, number, await headOf($, repo, number))
    return { result: `Watching ${repo}#${number}; you will be woken once its checks settle.` }
  })

  on('command.run', { command: 'ci-watch' }, async ($, e) => {
    if (e.args.trim() === 'stop') {
      live.watches = []
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
