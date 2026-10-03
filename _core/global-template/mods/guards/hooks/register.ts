import type { EngineInterface as Engine, Register } from 'claude-code'

import { inspect } from './inspect'
import type { Plan } from './inspect'
import { checkAddedLines, checkBranch, checkText, describe } from './policy'

// guards: one in-process check on every Bash and PowerShell call, replacing the attribution and
// `gh run watch` scripts. It reads the command (which program, which flags, which message) instead of
// scanning raw text, so paths, branch names and flags never trip it. Hot reload watches this file only:
// change it after editing shell.ts, inspect.ts or policy.ts.
//
// mode `shadow` (the default while it is new): never blocks; it logs what it would block, and what the
// scripts beside it blocked, to mods-data/guards/decisions.jsonl. mode `enforce`: blocks.

const LOG_CAP = 256 * 1024
const live = { mode: 'shadow', mentionRepos: ['*'] as string[], home: '', dir: '', isWindows: false }

// Makes the data folder and records when, and in which mode, the mod loaded.
const MARK_LOADED = [
  'const fs=require("fs")',
  'fs.mkdirSync(process.argv[1],{recursive:true})',
  'const at=new Date().toISOString()',
  'fs.writeFileSync(process.argv[1]+"/loaded.json",JSON.stringify({at,mode:process.argv[2]}))',
].join(';')

async function setUp($: Engine) {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  live.isWindows = (await $.env.get('OS')) === 'Windows_NT'
  live.home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.').replace(/\\/g, '/')
  live.dir = `${(configured ?? `${live.home}/.claude`).replace(/\\/g, '/')}/mods-data/guards`
  // The engine's fs writes no missing folders; node makes it once per session.
  await $.process.run(['node', '-e', MARK_LOADED, live.dir, live.mode], { timeoutMs: 10_000 }).catch(() => undefined)
}

// Bash on Windows writes /c/Users/...; the engine's fs takes C:/Users/... Only on Windows: elsewhere
// `/u/me` is a real one-letter folder.
function osPath(path: string, cwd: string): string {
  let p = path.replace(/\\/g, '/')
  if (p.startsWith('~/')) p = live.home + p.slice(1)
  const drive = live.isWindows ? /^\/([a-zA-Z])\//.exec(p) : null
  if (drive) p = `${drive[1]?.toUpperCase()}:/${p.slice(3)}`
  if (!/^[a-zA-Z]:\//.test(p) && !p.startsWith('/')) p = `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/${p}`
  return p
}

// `isCut`: the output went past the engine's cap, so what came back is only its start.
async function gitRun($: Engine, cwd: string, args: string[]): Promise<{ out: string; isCut: boolean }> {
  try {
    const run = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 8_000 })
    return run.exitCode === 0 ? { out: run.stdout, isCut: Boolean(run.isStdoutTruncated) } : { out: '', isCut: false }
  } catch {
    return { out: '', isCut: false }
  }
}

async function git($: Engine, cwd: string, args: string[]): Promise<string> {
  return (await gitRun($, cwd, args)).out
}

// The first reason to block, or undefined.
async function verdict($: Engine, plan: Plan): Promise<string | undefined> {
  if (plan.block) return plan.block
  const cwd = osPath(plan.cwd ?? (await $.session.cwd()), await $.session.cwd())
  const top = (await git($, cwd, ['rev-parse', '--show-toplevel'])).trim()
  const repo = (plan.repo ?? top.split(/[\\/]/).pop() ?? '').toLowerCase()
  const mayName = live.mentionRepos.includes('*') || live.mentionRepos.includes(repo)
  for (const { where, text, creditOnly } of plan.texts) {
    const v = checkText(text, mayName || Boolean(creditOnly))
    if (v) return describe(v, where)
  }
  const written = new Set(plan.written.map(p => osPath(p, cwd).toLowerCase()))
  for (const { where, path, written: fromCommand } of plan.files) {
    const full = osPath(path, cwd)
    // A relative path under a folder built at run time (`cd "$REPO"`) cannot be found from here, and a
    // file of the same name in the session folder is a different file: it is never read.
    if (plan.isCwdUnknown && !/^([a-zA-Z]:)?[\\/]|^~/.test(path)) {
      if (!fromCommand) plan.unread.push(where)
      continue
    }
    let text: string
    try {
      text = String(await $.fs.read(full))
    } catch {
      // A body file this same command writes does not exist yet: what it writes was read from the
      // command text above. One written under another spelling of its path is named unread.
      if (fromCommand) continue
      if (written.has(full.toLowerCase())) {
        plan.unread.push(where)
        continue
      }
      return `could not read the body file ${full} for ${where}. Write the file first, or check the path.`
    }
    const v = checkText(text, mayName)
    if (v) return describe(v, `${where} (file ${path})`)
  }
  for (const branch of plan.branches) {
    const v = checkBranch(branch, mayName)
    if (v) return describe(v, `the new branch name "${branch}" (it lands in merge commit titles)`)
  }
  if (plan.diff) {
    const diff = await gitRun(
      $,
      cwd,
      plan.diff === 'all' ? ['diff', 'HEAD', '-U0', '--no-color'] : ['diff', '--cached', '-U0', '--no-color'],
    )
    const hit = checkAddedLines(diff.out)
    if (hit) return `AI credit line added to ${hit.file}: "${hit.line}". Remove it before committing.`
    // A diff past the output cap was read only in part: the rest is named unread, never passed as clean.
    if (diff.isCut) plan.unread.push('the lines the commit adds past the first part of its diff')
  }
  return undefined
}

async function log($: Engine, entry: Record<string, unknown>) {
  if (!live.dir) return
  const file = `${live.dir}/decisions.jsonl`
  let text = ''
  try {
    text = String(await $.fs.read(file))
  } catch {
    // First entry.
  }
  if (text.length > LOG_CAP) {
    await $.fs.write(`${live.dir}/decisions.1.jsonl`, text).catch(() => undefined)
    text = ''
  }
  await $.fs.write(file, `${text}${JSON.stringify(entry)}\n`).catch(() => undefined)
}

// Per-day totals in mods-data/guards/stats.json: proof the mod runs, and the denominator for the
// shadow comparison (decisions.jsonl only holds the writes where the mod or the scripts would block).
async function count($: Engine, isModBlock: boolean, isScriptBlock: boolean) {
  if (!live.dir) return
  const file = `${live.dir}/stats.json`
  let stats: Record<string, { checked: number; mod: number; scripts: number; lastAt: number }> = {}
  try {
    stats = JSON.parse(String(await $.fs.read(file)))
  } catch {
    // First count.
  }
  const now = Date.now()
  const day = new Date(now).toISOString().slice(0, 10)
  const row = (stats[day] ??= { checked: 0, mod: 0, scripts: 0, lastAt: 0 })
  row.checked++
  if (isModBlock) row.mod++
  if (isScriptBlock) row.scripts++
  row.lastAt = now
  // Keep the last 30 days.
  for (const key of Object.keys(stats).sort().slice(0, -30)) delete stats[key]
  await $.fs.write(file, JSON.stringify(stats, null, 1)).catch(() => undefined)
}

async function guard($: Engine, tool: string, command: string, run: () => Promise<any>) {
  const plan = inspect(command, tool === 'PowerShell')
  if (!plan.isWrite && plan.branches.length === 0 && !plan.block) return run()
  // A hot reload starts the module over without a new session.start: set up on first use.
  if (!live.dir) await setUp($)
  let reason: string | undefined
  try {
    reason = await verdict($, plan)
  } catch (err) {
    // A guard that fails must not stop the work; the scripts still run beside it in shadow.
    await log($, { at: Date.now(), tool, error: String(err).slice(0, 200), command: command.slice(0, 2000) })
    return run()
  }
  // An enforced block is counted and logged like any other decision: it is the one a false block is
  // debugged from. The command never ran, so the scripts' answer is unknown.
  const isBlocked = live.mode === 'enforce' && reason !== undefined
  const result = isBlocked ? { deny: `BLOCKED (guards): ${reason}` } : await run()
  const scripts = isBlocked
    ? undefined
    : (result?.deny ?? (result?.isError && /BLOCKED/.test(String(result?.text)) ? String(result.text) : undefined))
  await count($, Boolean(reason), Boolean(scripts))
  if (reason || scripts || plan.unread.length > 0) {
    await log($, {
      at: Date.now(),
      session: await $.session.id(),
      tool,
      mod: reason ?? null,
      scripts: scripts ? String(scripts).slice(0, 300) : null,
      ...(isBlocked ? { enforced: true } : {}),
      unread: plan.unread,
      command: command.slice(0, 2000),
    })
  }
  return result
}

export const register: Register = (on, options) => {
  live.mode = String(options.mode ?? 'shadow') === 'enforce' ? 'enforce' : 'shadow'
  live.mentionRepos = String(options.mentionRepos ?? '*')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await setUp($)
    return result
  })
  on('tool.call', { tool: 'Bash' }, ($, e, next) => guard($, 'Bash', String(e.command ?? ''), () => next(e)))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) =>
    guard($, 'PowerShell', String((e as { command?: unknown }).command ?? ''), () => next(e)),
  )
}
