import type { EngineInterface as Engine } from 'claude-code'

// Running the hook scripts as Claude Code runs a PreToolUse command hook: on the first Python 3.8+ found,
// through SETUP.md § 7c's launcher, the hook input on stdin, the answer read as Claude Code reads it.

/** Where the scripts run: the Python, the mod's data folder (own copies) and whether the attribution script
 * runs. */
export type Setup = { python: string; dataDir: string; isAttribution: boolean }
/** The first reason to stop the call, and the scripts that failed. */
export type Verdict = { reason?: string; errors: string[] }

// The interpreters SETUP.md § 7c tries, in its order, and its check: Python 3.8+ outside any virtual or
// conda environment, since the guard serves every project and a project's environment can vanish.
const PYTHONS = [['python'], ['python3'], ['py', '-3'], ...[13, 12, 11, 10, 9, 8].map(minor => [`python3.${minor}`])]
// Tried last, after conda's own interpreter.
const LAST_PYTHONS = [['/usr/bin/python3'], ['/usr/local/bin/python3'], ['/opt/homebrew/bin/python3']]
const PYTHON_CHECK = [
  'import os, sys',
  'assert sys.version_info >= (3, 8) and sys.prefix == sys.base_prefix',
  'up = os.path.dirname(sys.prefix)',
  "assert not (os.path.basename(up) == 'envs' and os.path.isdir(os.path.join(os.path.dirname(up), 'conda-meta')))",
  'print(sys.executable)',
].join('; ')
// SETUP.md § 7c's launcher: a missing or unreadable script raises and exits 1, a non-blocking error, where
// `python <file>` exits 2, which blocks. `-I` keeps the session folder, PYTHONPATH and the user site out.
const LAUNCH = ['-I', '-c', "import runpy, sys; runpy.run_path(sys.argv[1], run_name='__main__')"]

// What `code` prints on an interpreter: its output when it exits 0, '' when it fails, undefined when the
// interpreter does not start.
function ask($: Engine, argv: string[], code: string): Promise<string | undefined> {
  return $.process
    .run([...argv, '-I', '-c', code], { timeoutMs: 10_000 })
    .then(r => (r.exitCode === 0 ? r.stdout.trim().replace(/\\/g, '/') : ''))
    .catch(() => undefined)
}
const BASE_CHECK = 'import sys; assert sys.version_info >= (3, 8); print(sys.base_prefix)'

// The full path of the first Python 3.8+ that passes the check, or '' when none does. As in § 7c, a
// candidate that runs inside an environment is followed by the interpreter that environment came from, and
// conda's own interpreter ($CONDA_PYTHON_EXE) comes before the last fixed paths.
export async function findPython($: Engine): Promise<string> {
  const conda = await $.env.get('CONDA_PYTHON_EXE').catch(() => undefined)
  for (const candidate of [...PYTHONS, ...(conda ? [[conda]] : []), ...LAST_PYTHONS]) {
    const found = await ask($, candidate, PYTHON_CHECK)
    if (found) return found
    if (found === undefined) continue
    const base = await ask($, candidate, BASE_CHECK)
    for (const from of base ? [`${base}/bin/python3`, `${base}/python.exe`] : []) {
      const fromBase = await ask($, [from], PYTHON_CHECK)
      if (fromBase) return fromBase
    }
  }
  return ''
}

// The hook scripts, in their settings.json order: the first deny in this order is the reason given.
const SCRIPTS = ['no-ai-attribution.py', 'block-gh-run-watch.py', 'pr-body-contract.py']
const ATTRIBUTION_SCRIPT = 'no-ai-attribution.py'
// Scripts that ship no copy: they run only from a machine's own copy (a PR-body contract names its repos).
const OWN_ONLY = new Set(['pr-body-contract.py'])
// A command hook's default time limit in the global settings.
const SCRIPT_TIMEOUT_MS = 10_000
export const NO_PYTHON = 'no Python 3.8+ found outside a virtual or conda environment'

// The machine's own copy of a script when it has one, else the shipped one; none for an own-only script
// the machine has no copy of.
async function scriptFile($: Engine, name: string, dataDir: string): Promise<string | undefined> {
  const own = `${dataDir}/scripts/${name}`
  const isOwn = await $.fs.stat(own).then(
    () => true,
    () => false,
  )
  if (isOwn) return own
  return OWN_ONLY.has(name) ? undefined : shippedFile($, name)
}

function shippedFile($: Engine, name: string): string {
  return `${$.plugin.root.replace(/\\/g, '/')}/scripts/${name}`
}

type Answer = { reason?: string; error?: string }
// The folder a call runs in and the hook input for it.
type HookCall = { cwd: string; input: string }

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
// a JSON object as `stopReason` reads it, exit 0 with anything else (none, plain text) lets it run. Any
// other end is a non-blocking hook error, as there: a script that cannot start, runs past the limit or
// exits with another code lets the call run. The engine's own hook budget stops while a process runs, so
// only SCRIPT_TIMEOUT_MS bounds a script. `isShipped` runs the shipped copy even where the machine has its own.
async function scriptAnswer($: Engine, name: string, call: HookCall, at: Setup, isShipped = false): Promise<Answer> {
  if (!at.python) return { error: NO_PYTHON }
  try {
    const file = isShipped ? shippedFile($, name) : await scriptFile($, name, at.dataDir)
    if (file === undefined) return {}
    // Started in the session's folder, as Claude Code starts a command hook.
    const { exitCode, stdout, stderr } = await $.process.run([at.python, ...LAUNCH, file], {
      cwd: call.cwd,
      stdin: call.input,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    })
    if (exitCode === 2) return { reason: stderr.trim() || `${name} refused the call` }
    if (exitCode !== 0) return { error: `${name} exited ${exitCode}: ${stderr.trim().slice(0, 200)}` }
    let out: unknown
    try {
      out = JSON.parse(stdout)
    } catch {
      return {}
    }
    if (typeof out !== 'object' || out === null) return {}
    const reason = stopReason(name, out as Record<string, unknown>)
    return reason === undefined ? {} : { reason }
  } catch (err) {
    return { error: `${name}: ${String(err).slice(0, 200)}` }
  }
}

// The fields a PreToolUse command hook gets that the mod knows: hook_event_name, session_id, cwd (the
// session's current folder, as Claude Code gives it), tool_name and tool_input.command.
async function hookInput($: Engine, tool: string, command: string): Promise<HookCall> {
  const cwd = await $.session.cwd()
  const session = await $.session.id()
  const input = JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: session,
    cwd,
    tool_name: tool,
    tool_input: { command },
  })
  return { cwd, input }
}

// The first reason to block, and the scripts that failed. The scripts run side by side, as Claude Code
// runs the hooks of one event.
export async function verdict($: Engine, tool: string, command: string, setup: Setup): Promise<Verdict> {
  const call = await hookInput($, tool, command)
  const names = SCRIPTS.filter(name => setup.isAttribution || name !== ATTRIBUTION_SCRIPT)
  const answers = await Promise.all(names.map(name => scriptAnswer($, name, call, setup)))
  return {
    reason: answers.find(a => a.reason !== undefined)?.reason,
    errors: answers.flatMap(a => (a.error ? [a.error] : [])),
  }
}

// SETUP.md § 7c's verify step, run at set-up: each shipped script gets a call it must refuse. A clean pass
// means the hook input never reached the scripts or their answer was lost, so a pass on a real call proves
// nothing. The shipped copies run even where the machine has its own: the check is of the path to the
// scripts, which every copy shares, not of a copy's rules. A script that fails to run is left to the calls,
// which count each failure.
const AI_TRAILER = `Co-${'Authored-By'}: Cla${'ude'} <noreply@anthro${'pic'}.com>`
const TEST_CALLS = [
  ['no-ai-attribution.py', `git commit -m "docs: x" -m "${AI_TRAILER}"`],
  ['block-gh-run-watch.py', 'gh run watch 1'],
]

// Why the scripts' answers cannot be trusted, or '' when every test call was refused. No Python, or a set-up
// that cannot build the input, is left to the calls too: each one reports it.
export async function selfCheck($: Engine, setup: Setup): Promise<string> {
  if (!setup.python) return ''
  try {
    const passed = await Promise.all(
      TEST_CALLS.map(async ([name = '', command = '']) => {
        const answer = await scriptAnswer($, name, await hookInput($, 'Bash', command), setup, true)
        return answer.reason === undefined && answer.error === undefined ? [name] : []
      }),
    )
    const names = passed.flat()
    if (names.length === 0) return ''
    return `${names.join(' and ')} let through the call it must refuse at set-up (the hook input may not reach it)`
  } catch {
    return ''
  }
}
