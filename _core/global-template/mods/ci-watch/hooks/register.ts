import type { EngineInterface, Register } from 'claude-code'

// One watched PR. The status line reads these from the session's state file.
export type Watch = {
  repo: string
  number: number
  headSha: string
  startedAt: number
  checks: Record<string, string>
  stablePolls: number
  outcome?: 'passed' | 'failed' | 'timeout'
  settledAt?: number
}

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/
const PUSH_OR_PR = /\bgit\b[^|;&\n]*\bpush\b|\bgh\b[^|;&\n]*\bpr\b[^|;&\n]*\bcreate\b/
const PR_MERGE = /\bgh\b[^|;&\n]*\bpr\s+merge\b([^|;&\n]*)/
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

export function settle(watch: Watch, checks: Record<string, string>, now: number, timeoutMs: number): Watch {
  const names = Object.keys(checks)
  const isQuiet = names.length > 0 && names.every(name => !PENDING.has(checks[name] ?? ''))
  const stablePolls = isQuiet ? watch.stablePolls + 1 : 0
  const next: Watch = { ...watch, checks, stablePolls }
  if (names.some(name => FAILED.has(checks[name] ?? ''))) return { ...next, outcome: 'failed', settledAt: now }
  if (stablePolls >= SETTLE_POLLS) return { ...next, outcome: 'passed', settledAt: now }
  if (now - watch.startedAt > timeoutMs) return { ...next, outcome: 'timeout', settledAt: now }
  return next
}

// A merged PR's watch is noise: the chat already says it merged. Returns the
// PR number a `gh pr merge` names, 0 when it names none (the branch's PR).
export function mergedNumber(command: string): number | undefined {
  const merge = PR_MERGE.exec(command)
  if (!merge) return undefined
  const named = /(?:^|\s)#?(\d+)(?=\s|$)/.exec(merge[1] ?? '')
  return named ? Number(named[1]) : 0
}

export function wakeText(watch: Watch): string {
  const entries = Object.entries(watch.checks)
  const pr = `PR ${watch.repo}#${watch.number}`
  if (watch.outcome === 'failed') {
    const failed = entries.filter(([, bucket]) => FAILED.has(bucket)).map(([name]) => name)
    return `[ci-watch] ${pr}: ${failed.join(', ')} failed. Fetch the failing logs (gh run view --log-failed), fix and push; the watch restarts on the new commit.`
  }
  if (watch.outcome === 'timeout') {
    const pending = entries.filter(([, bucket]) => PENDING.has(bucket)).map(([name]) => name)
    return `[ci-watch] ${pr}: still pending after the time limit: ${pending.join(', ') || 'no checks reported'}. Look at why before waiting longer.`
  }
  return `[ci-watch] ${pr}: all ${entries.length} checks settled with no failure. Verify it is mergeable and finish it per the project rules.`
}

async function statePath($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const dir = `${configured ?? `${home}/.claude`}/mods-data/ci-watch`
  return `${dir}/${await $.session.id()}.json`.replaceAll('\\', '/')
}

async function save($: EngineInterface): Promise<void> {
  await $.fs.write(await statePath($), JSON.stringify({ watches: live.watches }))
}

async function load($: EngineInterface): Promise<void> {
  try {
    const saved = JSON.parse(String(await $.fs.read(await statePath($)))) as { watches?: Watch[] }
    live.watches = saved.watches ?? []
  } catch {
    live.watches = []
  }
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
  const fresh: Watch = { repo, number, headSha, startedAt: await $.clock.now(), checks: {}, stablePolls: 0 }
  live.watches = [...live.watches.filter(w => !(w.repo === repo && w.number === number)), fresh]
  await save($)
  return fresh
}

async function poll($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  let changed = false
  const kept: Watch[] = []
  for (const current of live.watches) {
    if (current.outcome) {
      // A merge made outside this session (the web page) clears it here.
      if (now - (current.settledAt ?? now) < KEEP_SETTLED_MS && !(await isClosed($, current.repo, current.number))) kept.push(current)
      else changed = true
      continue
    }
    const head = await headOf($, current.repo, current.number)
    const base = head && head !== current.headSha ? { ...current, headSha: head, startedAt: now, stablePolls: 0, checks: {} } : current
    let checks: Record<string, string> = base.checks
    try {
      const rows = JSON.parse(await gh($, ['pr', 'checks', String(base.number), '--repo', base.repo, '--json', 'name,bucket'])) as {
        name: string
        bucket: string
      }[]
      checks = Object.fromEntries(rows.map(row => [row.name, row.bucket]))
    } catch {
      // No checks reported yet; the next poll tries again.
    }
    const next = settle(base, checks, now, live.timeoutMs)
    kept.push(next)
    changed = true
    if (next.outcome) void $.prompt.submit({ text: wakeText(next) }).catch(() => undefined)
  }
  live.watches = kept
  if (changed) await save($)
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
    if (!PUSH_OR_PR.test(command)) return result
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
