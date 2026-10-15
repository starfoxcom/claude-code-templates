import type { EngineInterface as Engine } from 'claude-code'

// Running the hook scripts as Claude Code runs a PreToolUse command hook: on the first Python 3.8+ found,
// through SETUP.md § 7c's launcher, the hook input on stdin, the answer read as Claude Code reads it.

/** Where the scripts run: the Python, the mod's data folder (own copies), the session's start folder and
 * whether the attribution script runs. */
export type Setup = { python: string; dataDir: string; projectDir: string; isAttribution: boolean }
/** The first reason to stop the call, and the scripts that failed. */
export type Verdict = { reason?: string; errors: string[] }

// The interpreters SETUP.md § 7c tries, in its order, and its check: Python 3.8+ outside any virtual or
// conda environment, since the guard serves every project and a project's environment can vanish.
const PYTHONS = [
  ['python'],
  ['python3'],
  ['py', '-3'],
  ...[13, 12, 11, 10, 9, 8].map(minor => [`python3.${minor}`]),
  ['/usr/bin/python3'],
  ['/usr/local/bin/python3'],
  ['/opt/homebrew/bin/python3'],
]
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

// The full path of the first Python 3.8+ that runs, or '' when none does.
export async function findPython($: Engine): Promise<string> {
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
  return OWN_ONLY.has(name) ? undefined : `${$.plugin.root.replace(/\\/g, '/')}/scripts/${name}`
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
// The engine's own hook budget stops while a process runs, so only SCRIPT_TIMEOUT_MS bounds a script.
async function scriptAnswer($: Engine, name: string, input: string, at: Setup): Promise<Answer> {
  if (!at.python) return { error: NO_PYTHON }
  try {
    const file = await scriptFile($, name, at.dataDir)
    if (file === undefined) return {}
    const { exitCode, stdout, stderr } = await $.process.run([at.python, ...LAUNCH, file], {
      stdin: input,
      env: { CLAUDE_PROJECT_DIR: at.projectDir },
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
// runs the hooks of one event. Their input carries the fields a PreToolUse command hook gets that the
// mod knows: hook_event_name, session_id, cwd, tool_name and tool_input.command.
export async function verdict($: Engine, tool: string, command: string, setup: Setup): Promise<Verdict> {
  const cwd = await $.session.cwd()
  const session = await $.session.id()
  const input = JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: session,
    cwd,
    tool_name: tool,
    tool_input: { command },
  })
  const names = SCRIPTS.filter(name => setup.isAttribution || name !== ATTRIBUTION_SCRIPT)
  // A hot reload keeps no start folder: the session's folder stands in.
  const at = { ...setup, projectDir: setup.projectDir || cwd }
  const answers = await Promise.all(names.map(name => scriptAnswer($, name, input, at)))
  return {
    reason: answers.find(a => a.reason !== undefined)?.reason,
    errors: answers.flatMap(a => (a.error ? [a.error] : [])),
  }
}
