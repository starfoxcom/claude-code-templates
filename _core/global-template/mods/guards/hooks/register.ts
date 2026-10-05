import type { EngineInterface as Engine, Register } from 'claude-code'

import { inspect } from './inspect'
import type { Folder, Plan } from './inspect'
import { describeName, findName, readNameRules } from './names'
import type { NameRule } from './names'
import { checkAddedLines, checkBranch, checkText, describe } from './policy'
import { checkBody, checkCall, hasRow, ruleFor } from './prbody'
import type { PrCall, PrRules } from './prbody'
import { register as settings, SETTINGS_PANE } from './settings'

// guards: one in-process check on every Bash and PowerShell call, replacing the attribution,
// `gh run watch` and PR-body scripts. It reads the command (which program, which flags, which message) instead of
// scanning raw text, so paths, branch names and flags never trip it. Hot reload watches this file only:
// change it after editing shell.ts, inspect.ts or policy.ts. Opt-in per repo, from files in
// mods-data/guards: the PR-body contract (pr-body.json) and banned names (names.json).
//
// mode `shadow` (the default while it is new): never blocks; it logs what it would block, and what the
// scripts beside it blocked, to mods-data/guards/decisions.jsonl. mode `enforce`: blocks.

const LOG_CAP = 256 * 1024
const live = { mode: 'shadow', mentionRepos: ['*'] as string[], home: '', dir: '', isWindows: false, temp: '' }

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
  live.temp = ((await $.env.get('TEMP')) ?? (await $.env.get('TMP')) ?? '').replace(/\\/g, '/').replace(/\/$/, '')
  live.dir = `${(configured ?? `${live.home}/.claude`).replace(/\\/g, '/')}/mods-data/guards`
  // The engine's fs writes no missing folders; node makes it once per session.
  await $.process.run(['node', '-e', MARK_LOADED, live.dir, live.mode], { timeoutMs: 10_000 }).catch(() => undefined)
}

// Bash on Windows writes /c/Users/...; the engine's fs takes C:/Users/... Only on Windows: elsewhere
// `/u/me` is a real one-letter folder. Git Bash also mounts the Windows temp folder at /tmp, so a body
// file a Bash command names there is read from TEMP (PowerShell has no such mount).
function osPath(path: string, cwd: string, isBash = false): string {
  let p = path.replace(/\\/g, '/')
  if (p.startsWith('~/')) p = live.home + p.slice(1)
  if (isBash && live.isWindows && live.temp && /^\/tmp(?:\/|$)/.test(p)) p = live.temp + p.slice(4)
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

// A body file's full path: from the folder in effect where it is named; a file read through a pipe
// keeps the command's.
function fileAt(path: string, folder: Folder | undefined, cwd: string, session: string, isBash: boolean) {
  const base = !folder ? cwd : folder.path === undefined ? session : osPath(folder.path, session, isBash)
  return osPath(path, base, isBash)
}

// A relative path under a folder built at run time (`cd "$REPO"`) cannot be found from here, and a file
// of the same name in the session folder is a different file: it is never read.
function isUnplaced(plan: Plan, path: string, folder: Folder | undefined): boolean {
  const isFolderUnknown = folder ? folder.isUnknown : plan.isCwdUnknown
  return Boolean(isFolderUnknown) && !/^([a-zA-Z]:)?[\\/]|^~/.test(path)
}

// What message text is checked for besides AI credit: the product name unless the repo may name it,
// and the repo's banned names.
type TextRules = { mayName: boolean; banned?: NameRule }

// One message text: AI credit first, then the product name, then the repo's banned names.
function textReason(text: string, where: string, rules: TextRules, creditOnly = false): string | undefined {
  const v = checkText(text, rules.mayName || creditOnly)
  if (v) return describe(v, where)
  const name = rules.banned && !creditOnly ? findName(text, rules.banned) : undefined
  return name ? describeName(name, where) : undefined
}

// The body files the command reads: the first reason to block, or undefined. Files that cannot be read
// for a known cause are named unread instead.
async function checkFiles($: Engine, plan: Plan, cwd: string, rules: TextRules, isBash: boolean) {
  const written = new Set(plan.written.map(p => osPath(p, cwd, isBash).toLowerCase()))
  const session = await $.session.cwd()
  for (const { where, path, written: fromCommand, folder } of plan.files) {
    const full = fileAt(path, folder, cwd, session, isBash)
    if (isUnplaced(plan, path, folder)) {
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
      // A Bash /tmp path on Windows is mapped by a guess (Git Bash's mount of TEMP): when the guess
      // misses, the file is named unread rather than refused.
      const isTmpGuess = isBash && live.isWindows && /^\/tmp(?:\/|$)/.test(path.replace(/\\/g, '/'))
      if (written.has(full.toLowerCase()) || isTmpGuess) {
        plan.unread.push(where)
        continue
      }
      return `could not read the body file ${full} for ${where}. Write the file first, or check the path.`
    }
    const reason = textReason(text, `${where} (file ${path})`, rules)
    if (reason) return reason
  }
  return undefined
}

// The repos whose PRs follow the PR-body contract, from mods-data/guards/pr-body.json; none without it.
async function prRules($: Engine): Promise<PrRules | undefined> {
  try {
    const rules = JSON.parse(String(await $.fs.read(`${live.dir}/pr-body.json`))) as PrRules
    return rules && typeof rules.repos === 'object' ? rules : undefined
  } catch {
    return undefined
  }
}

// The repos' banned names, from mods-data/guards/names.json; none without it, or when it is malformed.
async function nameRules($: Engine) {
  try {
    return readNameRules(String(await $.fs.read(`${live.dir}/names.json`)))
  } catch {
    return undefined
  }
}

// The PR body exactly as it will be sent: a literal here-doc on stdin, or a file already on disk where
// the command's folder is known. Undefined for any other route, among them a body file this same command
// writes (its text as the command reading holds it may differ from what lands in the file).
async function prBody($: Engine, plan: Plan, call: PrCall, cwd: string, isBash: boolean) {
  if (call.bodyFile === '-') return call.stdinBody
  // Another statement naming the same path may sit in another folder: which entry is the PR's is a guess.
  const files = plan.files.filter(f => f.path === call.filePath)
  const file = files.length === 1 ? files[0] : undefined
  if (!file || file.written || isUnplaced(plan, file.path, file.folder)) return undefined
  try {
    return String(await $.fs.read(fileAt(file.path, file.folder, cwd, await $.session.cwd(), isBash)))
  } catch {
    return undefined
  }
}

// The PR call, judged only in its plain form: the command's one gh statement, with a title written out.
// With other gh statements the repo, the body file or the title may belong to one of them, so the
// body is named unread instead, which the shadow log shows; it never blocks and never passes in silence.
async function checkPr($: Engine, plan: Plan, cwd: string, repo: string, isBash: boolean) {
  const [call] = plan.prs
  if (!call) return undefined
  const isPlain =
    plan.prs.length === 1 && plan.ghCalls === 1 && call.isAlone && !call.isTitleDynamic && !call.isUnknown
  const rules = await prRules($)
  if (!rules) return undefined
  // Before the repo's rule: another statement's `--repo` may have named the wrong repo.
  if (!isPlain) return void plan.unread.push(`the PR body (format check, ${call.action}: not a single plain PR call)`)
  const rule = ruleFor(rules, repo)
  if (!rule) return undefined
  const early = checkCall(call)
  if (early) return early
  if (call.bodyFile === undefined) return undefined
  const text = await prBody($, plan, call, cwd, isBash)
  if (text === undefined) return void plan.unread.push(`the PR body (format check, ${call.action})`)
  try {
    const reason = checkBody(text, call.hasTitle ? call.title : undefined, rule)
    // No title: whether this PR may skip the board row is unknown, so a missing row is named unread.
    if (!reason && !call.hasTitle && rule.row && !hasRow(text, rule))
      plan.unread.push(`the PR body's board row (format check, ${call.action}: no --title to judge it)`)
    return reason
  } catch {
    // A pattern in pr-body.json that does not compile: the body goes unjudged, the other checks still run.
    return void plan.unread.push(`the PR body (pr-body.json has an invalid pattern for ${repo})`)
  }
}

// The first reason to block, or undefined.
async function verdict($: Engine, plan: Plan, isBash = false): Promise<string | undefined> {
  if (plan.block) return plan.block
  const cwd = osPath(plan.cwd ?? (await $.session.cwd()), await $.session.cwd(), isBash)
  const top = (await git($, cwd, ['rev-parse', '--show-toplevel'])).trim()
  const repo = (plan.repo ?? top.split(/[\\/]/).pop() ?? '').toLowerCase()
  const mayName = live.mentionRepos.includes('*') || live.mentionRepos.includes(repo)
  const rules: TextRules = { mayName, banned: ruleFor(await nameRules($), repo) }
  for (const { where, text, creditOnly } of plan.texts) {
    const reason = textReason(text, where, rules, creditOnly)
    if (reason) return reason
  }
  const fileReason = await checkFiles($, plan, cwd, rules, isBash)
  if (fileReason) return fileReason
  for (const branch of plan.branches) {
    const where = `the new branch name "${branch}" (it lands in merge commit titles)`
    const v = checkBranch(branch, mayName)
    if (v) return describe(v, where)
    const name = rules.banned ? findName(branch, rules.banned) : undefined
    if (name) return describeName(name, where)
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
  // Last: a credit anywhere outranks the PR format.
  const prReason = await checkPr($, plan, cwd, repo, isBash)
  return prReason ? `PR-body contract: ${prReason}` : undefined
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
  // A write the reading missed still carries the command-text backstop, so text alone is reason to check.
  if (!plan.isWrite && plan.texts.length === 0 && plan.branches.length === 0 && !plan.block) return run()
  // A hot reload starts the module over without a new session.start: set up on first use.
  if (!live.dir) await setUp($)
  let reason: string | undefined
  try {
    reason = await verdict($, plan, tool === 'Bash')
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
  settings(on, options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await setUp($)
    await $.command.register({
      name: 'guards',
      description: 'The guard mode and what it caught. Also: settings, help',
      argumentHint: ARGUMENT_HINT,
    })
    return result
  })
  on('command.run', { command: 'guards' }, async ($, e) => ({ text: await runCommand($, e.args) }))
  on('tool.call', { tool: 'Bash' }, ($, e, next) => guard($, 'Bash', String(e.command ?? ''), () => next(e)))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) =>
    guard($, 'PowerShell', String((e as { command?: unknown }).command ?? ''), () => next(e)),
  )
}

const ARGUMENT_HINT = '[help | settings]'
const HELP = [
  '/guards: reads every shell command that writes history (commits, PRs, issues, releases) for AI credit.',
  '  /guards           the mode, where the product may be named, and what it caught',
  '  /guards settings  open the settings pane',
  '  /guards help      this list',
].join('\n')

type DayCount = { checked: number; mod: number; scripts: number }

// The counts of the last `days` days in stats.json, today included.
export function sumDays(stats: Record<string, DayCount>, now: number, days: number): DayCount {
  const total = { checked: 0, mod: 0, scripts: 0 }
  for (let back = 0; back < days; back++) {
    const row = stats[new Date(now - back * 86_400_000).toISOString().slice(0, 10)]
    if (!row) continue
    total.checked += row.checked
    total.mod += row.mod
    total.scripts += row.scripts
  }
  return total
}

async function statusText($: Engine): Promise<string> {
  if (!live.dir) await setUp($)
  let stats: Record<string, DayCount> = {}
  try {
    stats = JSON.parse(String(await $.fs.read(`${live.dir}/stats.json`)))
  } catch {
    // Nothing checked yet.
  }
  const isEnforced = live.mode === 'enforce'
  const names = live.mentionRepos.includes('*') ? 'every repo' : live.mentionRepos.join(', ') || 'no repo'
  const line = (label: string, c: DayCount) =>
    `${label}: ${c.checked} writes checked, ${c.mod} ${isEnforced ? 'blocked' : 'it would block'}, ` +
    `${c.scripts} the guard scripts blocked.`
  const now = await $.clock.now()
  const banned = Object.keys((await nameRules($))?.repos ?? {})
  return [
    isEnforced ? 'Guards: enforce (blocks).' : 'Guards: shadow (never blocks; logs what it would block).',
    `The product name may appear in ${names}; AI credit is blocked everywhere.`,
    ...(banned.length > 0 ? [`Banned names (names.json) are checked in: ${banned.join(', ')}.`] : []),
    line('Today (UTC)', sumDays(stats, now, 1)),
    line('Last 7 days (UTC)', sumDays(stats, now, 7)),
  ].join('\n')
}

// `/guards [help | settings]`; with no argument, the status. Another word gets the list.
async function runCommand($: Engine, args: string): Promise<string> {
  const verb = args.trim().split(/\s+/)[0] ?? ''
  if (verb === 'settings') {
    await $.ui.open({ id: SETTINGS_PANE, title: 'Guards settings', focus: true })
    return 'Opened the guards settings.'
  }
  return verb ? HELP : statusText($)
}
