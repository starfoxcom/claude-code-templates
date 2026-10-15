import type { EngineInterface as Engine, Register } from 'claude-code'

import { HELPER_BLOCK, helpersCommand, helpersLine, isHelperChecked } from './helpers'
import { applyFile, register as settings, SETTINGS_PANE } from './settings'

// guards: runs the global attribution, `gh run watch` and PR-body hook scripts (scripts/) on every Bash and
// PowerShell call, the way Claude Code runs a command hook: the same Python, the same input, the same deny.
// The scripts themselves decide, so guards refuses exactly what they refuse. A machine's own copy of a
// script in mods-data/guards/scripts/ runs in place of the shipped one (the PR-body script holds the
// machine's repo table). Opt-in by setting: helper agents (`helpers` = block refuses Agent and Workflow
// calls; see helpers.ts). Opt-out by setting: `attribution` = off skips the attribution script.
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
  // The Python 3.8+ the scripts run on, found at set-up; empty when none runs.
  python: '',
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
  live.python = await findPython($)
  live.home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.').replace(/\\/g, '/')
  live.dir = `${(configured ?? `${live.home}/.claude`).replace(/\\/g, '/')}/mods-data/guards`
  // The engine's fs writes no missing folders; node makes it once per session.
  await $.process.run(['node', '-e', MARK_LOADED, live.dir, live.mode], { timeoutMs: 10_000 }).catch(() => undefined)
}

// The interpreters SETUP.md § 7c tries, in its order, and the check each must pass.
const PYTHONS = [['python'], ['python3'], ['py', '-3']]
const PYTHON_CHECK = 'import sys; assert sys.version_info >= (3, 8); print(sys.executable)'
// SETUP.md § 7c's launcher: a missing or unreadable script raises and exits 1, a non-blocking error, where
// `python <file>` exits 2, which blocks. `-I` keeps the session folder, PYTHONPATH and the user site out.
const LAUNCH = ['-I', '-c', "import runpy, sys; runpy.run_path(sys.argv[1], run_name='__main__')"]

// The full path of the first Python 3.8+ that runs, or '' when none does.
async function findPython($: Engine): Promise<string> {
  for (const candidate of PYTHONS) {
    const found = await $.process
      .run([...candidate, '-I', '-c', PYTHON_CHECK], { timeoutMs: 10_000 })
      .then(r => (r.exitCode === 0 ? r.stdout.trim() : ''))
      .catch(() => '')
    if (found) return found.replace(/\\/g, '/')
  }
  return ''
}

// The hook scripts, in their settings.json order: the first deny in this order is the reason given.
const SCRIPTS = ['no-ai-attribution.py', 'block-gh-run-watch.py', 'pr-body-contract.py']
const ATTRIBUTION_SCRIPT = 'no-ai-attribution.py'
// A command hook's default time limit in the global settings.
const SCRIPT_TIMEOUT_MS = 10_000

// The machine's own copy of a script when it has one, else the shipped one.
async function scriptFile($: Engine, name: string): Promise<string> {
  const own = `${live.dir}/scripts/${name}`
  const isOwn = await $.fs.stat(own).then(
    () => true,
    () => false,
  )
  return isOwn ? own : `${$.plugin.root.replace(/\\/g, '/')}/scripts/${name}`
}

type Answer = { reason?: string; error?: string }

// What a PreToolUse hook's JSON says about the call: the reason it stops it, or undefined. Claude Code
// stops the call on a `permissionDecision` of deny, on the older `decision: "block"` and on
// `continue: false`. An `ask` cannot be put to the person from here, so it stops the call too.
function stopReason(name: string, out: Record<string, unknown>): string | undefined {
  const specific = (out.hookSpecificOutput ?? {}) as Record<string, unknown>
  const text = (value: unknown) => String(value ?? '').trim() || `${name} refused the call`
  if (specific.permissionDecision === 'deny') return text(specific.permissionDecisionReason)
  if (specific.permissionDecision === 'ask') return `${text(specific.permissionDecisionReason)} (asks for approval)`
  if (out.decision === 'block') return text(out.reason)
  if (out.continue === false) return text(out.stopReason)
  return undefined
}

// One script's answer as Claude Code reads a command hook's: exit 2 stops the call with stderr, exit 0 with
// JSON as `stopReason` reads it. Anything else is a non-blocking hook error, as there: a script that cannot
// start, runs past the limit, exits with another code or prints something other than JSON lets the call run.
async function scriptAnswer($: Engine, name: string, input: string): Promise<Answer> {
  if (!live.python) return { error: 'no Python 3.8+ found (tried python, python3, py -3)' }
  try {
    const file = await scriptFile($, name)
    const { exitCode, stdout, stderr } = await $.process.run([live.python, ...LAUNCH, file], {
      stdin: input,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    })
    if (exitCode === 2) return { reason: stderr.trim() || `${name} refused the call` }
    if (exitCode !== 0) return { error: `${name} exited ${exitCode}: ${stderr.trim().slice(0, 200)}` }
    if (!stdout.trim()) return {}
    const out = JSON.parse(stdout) as unknown
    if (typeof out !== 'object' || out === null) return { error: `${name} printed something other than a JSON object` }
    const reason = stopReason(name, out as Record<string, unknown>)
    return reason === undefined ? {} : { reason }
  } catch (err) {
    return { error: `${name}: ${String(err).slice(0, 200)}` }
  }
}

// The first reason to block, and the scripts that failed. The scripts run side by side, as Claude Code
// runs the hooks of one event.
async function verdict($: Engine, tool: string, command: string): Promise<{ reason?: string; errors: string[] }> {
  const cwd = await $.session.cwd()
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd })
  const names = SCRIPTS.filter(name => live.isAttribution || name !== ATTRIBUTION_SCRIPT)
  const answers = await Promise.all(names.map(name => scriptAnswer($, name, input)))
  return {
    reason: answers.find(a => a.reason !== undefined)?.reason,
    errors: answers.flatMap(a => (a.error ? [a.error] : [])),
  }
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

type Tally = { isModBlock: boolean; isScriptBlock: boolean; error?: string }

// Per-day totals in mods-data/guards/stats.json: proof the mod runs, and the denominator for the
// shadow comparison (decisions.jsonl only holds the calls where the mod or the scripts would block). A call
// where a script failed counts as `failed`, not `checked`, with the last error kept for `/guards`; the
// log stays for blocks, so a broken Python never floods it.
async function count($: Engine, tally: Tally) {
  if (!live.dir) return
  const file = `${live.dir}/stats.json`
  let stats: Record<string, DayCount & { lastAt: number; lastError?: string }> = {}
  try {
    stats = JSON.parse(String(await $.fs.read(file)))
  } catch {
    // First count.
  }
  const now = Date.now()
  const day = new Date(now).toISOString().slice(0, 10)
  const row = (stats[day] ??= { checked: 0, mod: 0, scripts: 0, failed: 0, lastAt: 0 })
  if (tally.error) {
    row.failed = (row.failed ?? 0) + 1
    row.lastError = tally.error.slice(0, 300)
  } else row.checked++
  if (tally.isModBlock) row.mod++
  if (tally.isScriptBlock) row.scripts++
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
  // An empty command gets the scripts' own answer without starting them: they pass it.
  if (!command) return run()
  // A hot reload starts the module over without a new session.start: set up on first use.
  if (!live.dir) await setUp($)
  let reason: string | undefined
  let errors: string[]
  try {
    ;({ reason, errors } = await verdict($, tool, command))
  } catch (err) {
    return failed($, tool, command, String(err), run)
  }
  // An enforced block is counted and logged like any other decision: it is the one a false block is
  // debugged from. The command never ran, so the scripts' answer is unknown.
  const isBlocked = live.mode === 'enforce' && reason !== undefined
  const result = isBlocked ? { deny: reason } : await run()
  const scripts = isBlocked
    ? undefined
    : (result?.deny ?? (result?.isError && /BLOCKED/.test(String(result?.text)) ? String(result.text) : undefined))
  const error = errors.length > 0 ? errors.join('; ') : undefined
  await count($, { isModBlock: Boolean(reason), isScriptBlock: Boolean(scripts), error })
  if (reason || scripts) {
    await log($, {
      at: Date.now(),
      session: await $.session.id(),
      tool,
      mod: reason ?? null,
      scripts: scripts ? String(scripts).slice(0, 300) : null,
      ...(error ? { error } : {}),
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
  '/guards: runs the attribution, `gh run watch` and PR-body hook scripts on every shell call.',
  '  /guards           the mode and what it caught',
  '  /guards settings  open the settings pane',
  '  /guards set       change a setting: set <name> <value>; alone, list them',
  '  /guards helpers   helper agents: allow or block them for this session',
  '  /guards help      this list',
].join('\n')

type DayCount = { checked: number; mod: number; scripts: number; failed?: number; lastError?: string }

// The counts of the last `days` days in stats.json, today included, with the newest day's last error.
export function sumDays(stats: Record<string, DayCount>, now: number, days: number): DayCount {
  const total: DayCount = { checked: 0, mod: 0, scripts: 0, failed: 0 }
  for (let back = days - 1; back >= 0; back--) {
    const row = stats[new Date(now - back * 86_400_000).toISOString().slice(0, 10)]
    if (!row) continue
    total.checked += row.checked
    total.mod += row.mod
    total.scripts += row.scripts
    total.failed = (total.failed ?? 0) + (row.failed ?? 0)
    if (row.lastError) total.lastError = row.lastError
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
    `${label}: ${c.checked} shell calls checked, ${c.mod} ${isEnforced ? 'blocked' : 'it would block'}, ` +
    `${c.scripts} the guard scripts blocked` +
    (c.failed ? `, ${c.failed} not checked (a script failed; last: ${c.lastError}).` : '.')
  const now = await $.clock.now()
  return [
    isEnforced ? 'Guards: enforce (blocks).' : 'Guards: shadow (never blocks; logs what it would block).',
    live.python
      ? `Scripts run on ${live.python}.`
      : 'No Python 3.8+ found (tried python, python3, py -3): nothing is checked.',
    live.isAttribution
      ? 'Attribution check: on.'
      : 'Attribution check: off (setting attribution = off); the attribution script does not run.',
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
