import type { EngineInterface as Engine, Register } from 'claude-code'

import { attributionReason, pyFold } from './attribution'
import { HELPER_BLOCK, helpersCommand, helpersLine, isHelperChecked } from './helpers'
import { prReason } from './prcontract'
import type { PrRules } from './prcontract'
import { runWatchReason } from './runwatch'
import { applyFile, register as settings, SETTINGS_PANE } from './settings'

// guards: one in-process check on every Bash and PowerShell call, replacing the global attribution,
// `gh run watch` and PR-body scripts. Each check is a rule-for-rule copy of its script (attribution.ts,
// runwatch.ts, prcontract.ts), so it refuses exactly what the scripts refuse and passes what they pass.
// Opt-in per repo: the PR-body contract (mods-data/guards/pr-body.json). Opt-in by setting: helper agents
// (`helpers` = block refuses Agent and Workflow calls; see helpers.ts). Opt-out by setting: `attribution` =
// off drops the AI-credit scan; the routes around the commit gates stay refused.
//
// mode `shadow` (the default while it is new): never blocks; it logs what it would block, and what the
// scripts beside it blocked, to mods-data/guards/decisions.jsonl. mode `enforce`: blocks.

const LOG_CAP = 256 * 1024
const live = {
  mode: 'shadow',
  isAttribution: true,
  home: '',
  dir: '',
  isWindows: false,
}
// The helper setting, and the sessions that typed `/guards helpers allow` (module state: a replaced
// hooks worker forgets them, which errs toward the block).
const helpers = { setting: 'allow' as 'allow' | 'block', allowedIn: new Set<string>() }

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

// The repos whose PRs follow the PR-body contract, from mods-data/guards/pr-body.json; none without it.
async function prRules($: Engine): Promise<PrRules | undefined> {
  try {
    const rules = JSON.parse(String(await $.fs.read(`${live.dir}/pr-body.json`))) as PrRules
    return rules && typeof rules.repos === 'object' && rules.repos !== null ? rules : undefined
  } catch {
    return undefined
  }
}

// A command the scripts look at: a git or gh call, or a GitHub API call through curl or PowerShell. Only
// these are counted, so stats.json keeps the shadow comparison's denominator.
const NAMES_WRITE = /\b(git|gh|curl|lefthook)\b|Invoke-(RestMethod|WebRequest)|LEFTHOOK/i

// The first reason to block, in the order the scripts run (settings.json): attribution, `gh run watch`,
// then the PR-body contract. Each runs as its script does, from the session folder.
async function verdict($: Engine, tool: string, command: string): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  const host = { isWindows: live.isWindows, home: live.home }
  const read = async (path: string) => String(await $.fs.read(path))
  const at = { cwd, powershell: tool === 'PowerShell', host, read, isCredit: live.isAttribution }
  const credit = await attributionReason(command, at)
  if (credit) return `no AI attribution: ${credit}`
  const watch = runWatchReason(command)
  if (watch) return watch
  const pr = await prReason(command, { cwd, host, read, rules: await prRules($) })
  return pr ? `PR-body contract: ${pr}` : undefined
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

// A check that failed before the command ran, from the guard's own catch or the engine's (a throw
// anywhere in the hook, or its time budget overrun). Shadow lets the command run, as the scripts still
// check it; enforce refuses it, so a crash never lets an unchecked write through.
async function failed($: Engine, tool: string, command: string, error: string, run: () => Promise<any>) {
  const isEnforced = live.mode === 'enforce'
  const why = error.slice(0, 200)
  const entry = { at: Date.now(), tool, error: why, command: command.slice(0, 2000) }
  await log($, isEnforced ? { ...entry, enforced: true } : entry).catch(() => undefined)
  if (!isEnforced) return run()
  return {
    deny:
      `BLOCKED (guards): the check failed before it could read this call (${why}). Retry once; ` +
      'if it fails again, the maintainer can switch guards to shadow: /guards set mode shadow.',
  }
}

async function guard($: Engine, tool: string, command: string, run: () => Promise<any>) {
  if (!NAMES_WRITE.test(pyFold(command))) return run()
  // A hot reload starts the module over without a new session.start: set up on first use.
  if (!live.dir) await setUp($)
  let reason: string | undefined
  try {
    reason = await verdict($, tool, command)
  } catch (err) {
    return failed($, tool, command, String(err), run)
  }
  // An enforced block is counted and logged like any other decision: it is the one a false block is
  // debugged from. The command never ran, so the scripts' answer is unknown.
  const isBlocked = live.mode === 'enforce' && reason !== undefined
  const result = isBlocked ? { deny: `BLOCKED (guards): ${reason}` } : await run()
  const scripts = isBlocked
    ? undefined
    : (result?.deny ?? (result?.isError && /BLOCKED/.test(String(result?.text)) ? String(result.text) : undefined))
  await count($, Boolean(reason), Boolean(scripts))
  if (reason || scripts) {
    await log($, {
      at: Date.now(),
      session: await $.session.id(),
      tool,
      mod: reason ?? null,
      scripts: scripts ? String(scripts).slice(0, 300) : null,
      ...(isBlocked ? { enforced: true } : {}),
      command: command.slice(0, 2000),
    })
  }
  return result
}

async function helperState($: Engine) {
  const { setting, allowedIn } = helpers
  if (setting === 'allow' || allowedIn.size === 0) return { setting, isAllowedHere: false }
  return { setting, isAllowedHere: allowedIn.has(await $.session.id()) }
}

// An Agent or Workflow call: refused in enforce, logged in shadow, while the setting blocks helpers.
async function helperGuard($: Engine, tool: string, run: () => Promise<any>) {
  if (!isHelperChecked(await helperState($))) return run()
  if (!live.dir) await setUp($)
  const isBlocked = live.mode === 'enforce'
  // Logged, never counted: stats.json counts shell writes, the denominator of the shadow comparison.
  const entry ={ at: Date.now(), session: await $.session.id(), tool, mod: HELPER_BLOCK, scripts: null }
  await log($, { ...entry, ...(isBlocked ? { enforced: true } : {}), unread: [], command: '' })
  return isBlocked ? { deny: `BLOCKED (guards): ${HELPER_BLOCK}` } : run()
}

// The settings file at the session's start, before any tool call: the settings module follows it from
// there. Read here, since an engine handle is never passed into another file.
async function readSettings($: Engine): Promise<void> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const file = await $.fs.read(`${config}/mods-data/guards/settings.json`.replace(/\\/g, '/')).catch(() => '')
  const manifest = (dir: string) => $.fs.read(`${$.plugin.root}${dir}/plugin.json`)
  applyFile(String(file), String(await manifest('/.claude-plugin').catch(() => manifest('').catch(() => ''))))
}

export const register: Register = (on, options) => {
  // The settings come from the mod's own file over the loaded options, read again as it changes.
  settings(on, options, values => {
    live.mode = String(values.mode ?? 'shadow') === 'enforce' ? 'enforce' : 'shadow'
    live.isAttribution = String(values.attribution ?? 'on') !== 'off'
    helpers.setting = String(values.helpers ?? 'allow') === 'block' ? 'block' : 'allow'
  })

  on('session.start', async ($, e, next) => {
    // A settings file that cannot be read never costs the start: the loaded options stand.
    await readSettings($).catch(() => undefined)
    const result = await next(e)
    await setUp($)
    await $.command.register({
      name: 'guards',
      description: 'The guard mode and what it caught. Also: settings, set, help',
      argumentHint: ARGUMENT_HINT,
    })
    return result
  })
  on('command.run', { command: 'guards' }, async ($, e) => ({ text: await runCommand($, e.args) }))
  // Without a `.catch` the engine skips a hook that throws or overruns its budget, and the command
  // runs unchecked. A failure after the command ran replays its result.
  const bash = (e: { command?: unknown }) => String(e.command ?? '')
  const ps = (e: unknown) => String((e as { command?: unknown }).command ?? '')
  on('tool.call', { tool: 'Bash' }, ($, e, next) => guard($, 'Bash', bash(e), () => next(e))).catch(
    ($, e, next) =>
      next.called ? next(e) : failed($, 'Bash', bash(e), caughtError(next.error), () => next(e)),
  )
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => guard($, 'PowerShell', ps(e), () => next(e))).catch(
    ($, e, next) =>
      next.called ? next(e) : failed($, 'PowerShell', ps(e), caughtError(next.error), () => next(e)),
  )
  // A failed helper check refuses only where helpers are blocked: with the setting at allow it never stops one.
  on('tool.call', { tool: ['Agent', 'Workflow'] }, ($, e, next) => helperGuard($, e.tool, () => next(e))).catch(
    ($, e, next) =>
      next.called || helpers.setting === 'allow'
        ? next(e)
        : failed($, e.tool, '', caughtError(next.error), () => next(e)),
  )
}

// Why the engine caught the hook, in words for the log and the refusal.
function caughtError(error: { kind: string; message?: string }): string {
  if (error.kind !== 'timeout') return error.message ?? 'the check threw'
  return error.message ? `ran past its time budget: ${error.message}` : 'ran past its time budget'
}

const ARGUMENT_HINT = '[help | settings | set | helpers]'
const HELP = [
  '/guards: runs copies of the attribution, PR-body and `gh run watch` hooks on every shell call.',
  '  /guards           the mode and what it caught',
  '  /guards settings  open the settings pane',
  '  /guards set       change a setting: set <name> <value>; alone, list them',
  '  /guards helpers   helper agents: allow or block them for this session',
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
  const line = (label: string, c: DayCount) =>
    `${label}: ${c.checked} writes checked, ${c.mod} ${isEnforced ? 'blocked' : 'it would block'}, ` +
    `${c.scripts} the guard scripts blocked.`
  const now = await $.clock.now()
  return [
    isEnforced ? 'Guards: enforce (blocks).' : 'Guards: shadow (never blocks; logs what it would block).',
    live.isAttribution
      ? 'AI credit is blocked everywhere, as the global attribution hook blocks it.'
      : 'Attribution check: off (setting attribution = off); AI credit is not checked.',
    helpersLine(await helperState($), isEnforced),
    line('Today (UTC)', sumDays(stats, now, 1)),
    line('Last 7 days (UTC)', sumDays(stats, now, 7)),
  ].join('\n')
}

// `/guards [help | settings | helpers]`; with no argument, the status. Another word gets the list.
async function runCommand($: Engine, args: string): Promise<string> {
  const [verb = '', word = ''] = args.trim().split(/\s+/)
  if (verb === 'helpers') {
    const state = await helperState($)
    const answer = helpersCommand(word, state)
    // Each session adds or removes only its own allow; a status look changes nothing.
    if (answer.isAllowedHere !== state.isAllowedHere) {
      const session = await $.session.id()
      if (answer.isAllowedHere) helpers.allowedIn.add(session)
      else helpers.allowedIn.delete(session)
    }
    return answer.text
  }
  if (verb === 'settings') {
    await $.ui.open({ id: SETTINGS_PANE, title: 'Guards settings', focus: true })
    return 'Opened the guards settings.'
  }
  return verb ? HELP : statusText($)
}
