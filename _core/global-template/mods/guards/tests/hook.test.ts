import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

// Tests run with no processes, so each script's answer is faked here in the hook protocol the real scripts
// speak (a deny on stdout, or exit 2 with stderr). What the scripts decide is theirs: these tests hold the
// mod to starting them as Claude Code starts a command hook and to reading their answer as it does.
const DATA = 'C:/Users/me/.claude/mods-data/guards'
const LOG = `${DATA}/decisions.jsonl`
const SHIPPED = ['no-ai-attribution.py', 'block-gh-run-watch.py', 'pr-body-contract.py']

type Answer = { exitCode: number; stdout?: string; stderr?: string }
type Script = (input: { tool_name: string; tool_input: { command: string }; cwd: string }) => Answer | undefined
const deny = (reason: string): Answer => ({
  exitCode: 0,
  stdout: JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }),
})
// Stand-ins for the shipped scripts: each refuses one marker word, and the shipped ones also the call the
// set-up tests them with (scripts.ts TEST_CALLS).
const refuses =
  (words: string[], reason: string): Script =>
  i =>
    words.some(word => i.tool_input.command.includes(word)) ? deny(reason) : undefined
const TEST_CALL = /Authored-By|gh run watch 1$/
const STAND_INS: Record<string, Script> = {
  'no-ai-attribution.py': refuses(['CREDIT', 'Authored-By'], 'BLOCKED (no AI attribution): x'),
  'block-gh-run-watch.py': refuses(['WATCH', 'gh run watch 1'], 'BLOCKED: `gh run watch`'),
  'pr-body-contract.py': refuses(['BODY'], 'BLOCKED (PR-body contract): y'),
}

type World = {
  files: Map<string, string>
  own: Set<string>
  ran: string[]
  started: Array<{ argv: string[]; input: Record<string, unknown>; cwd?: string; timeoutMs?: number; env?: unknown }>
  // The set-up's test calls, by script name, kept apart from the calls' own runs.
  tested: string[]
  // Every script gets an empty input, as if the engine dropped stdin.
  isInputLost: boolean
  broken: Set<string>
  scripts: Record<string, Script>
  // What each interpreter's version check prints; one missing from the map does not run.
  pythons: Record<string, string>
  // Interpreters that run inside an environment, with the base they came from (sys.base_prefix).
  inEnv: Record<string, string>
  // The interpreters the set-up checked, in order.
  probed: string[]
  env: Record<string, string>
}

const PYTHON = 'C:/Python/python.exe'
const LAUNCH = ['-I', '-c', "import runpy, sys; runpy.run_path(sys.argv[1], run_name='__main__')"]

// `seen.own`: scripts the machine has its own copy of. `seen.broken`: calls that throw.
function world(on: On, os = 'Windows_NT'): World {
  const seen: World = {
    files: new Map(),
    // The PR-body script ships no copy: the machine holds its own, as one that uses it does.
    own: new Set(['pr-body-contract.py']),
    ran: [],
    started: [],
    tested: [],
    isInputLost: false,
    broken: new Set(),
    scripts: { ...STAND_INS },
    pythons: { python: 'C:\\Python\\python.exe\n' },
    inEnv: {},
    probed: [],
    env: { USERPROFILE: 'C:/Users/me', OS: os },
  }
  const env = seen.env
  const unless = (call: string) => {
    if (seen.broken.has(call)) throw new Error(`${call} is down`)
  }
  mock.clock(on)
  on('env.get', ($, e) => (unless('env.get'), { value: env[e.name] }))
  on('session.id', () => (unless('session.id'), { value: 'sess-a' }))
  on('session.cwd', () => (unless('session.cwd'), { value: 'C:/Repos/my-game' }) as never)
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    const text = seen.files.get(path.endsWith('/plugin.json') ? 'plugin.json' : path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => (seen.files.set(e.path.replaceAll('\\', '/'), e.text), { value: undefined }))
  on('fs.stat', ($, e) => {
    const name = e.path.replaceAll('\\', '/').replace(`${DATA}/scripts/`, '')
    if (!seen.own.has(name)) throw new Error('ENOENT')
    return { value: { kind: 'file' } as never }
  })
  on('process.run', ($, e) => {
    const file = String(e.argv.at(-1))
    let answer: Answer = { exitCode: 0 }
    if (file.includes('sys.executable')) {
      // The interpreter check: the words before `-I` name the candidate.
      const candidate = e.argv.slice(0, e.argv.indexOf('-I')).join(' ')
      seen.probed.push(candidate)
      const printed = seen.pythons[candidate]
      if (candidate in seen.inEnv) answer = { exitCode: 1 }
      else if (printed === undefined) throw new Error('not found')
      else answer = { exitCode: 0, stdout: printed }
    } else if (file.includes('print(sys.base_prefix)')) {
      const base = seen.inEnv[e.argv.slice(0, e.argv.indexOf('-I')).join(' ')]
      if (base === undefined) throw new Error('not found')
      answer = { exitCode: 0, stdout: `${base}\n` }
    } else if (file.endsWith('.py')) {
      unless('python')
      const sent = JSON.parse(String(e.init?.stdin))
      const input = seen.isInputLost ? { tool_name: '', tool_input: { command: '' }, cwd: '' } : sent
      const name = file.slice(file.lastIndexOf('/') + 1)
      if (TEST_CALL.test(sent.tool_input.command)) seen.tested.push(name)
      else {
        const { cwd, timeoutMs, env } = e.init ?? {}
        seen.started.push({ argv: [...e.argv], input: sent, cwd, timeoutMs, env })
      }
      const script = (file.startsWith(DATA) && seen.scripts[`own ${name}`]) || seen.scripts[name]
      answer = script?.(input) ?? answer
    }
    const { exitCode, stdout = '', stderr = '' } = answer
    return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  const ran = (command: unknown) => (seen.ran.push(String(command)), { result: {} as never })
  on('tool.call', { tool: 'Bash' }, ($, e) => ran(e.command))
  on('tool.call', { tool: 'PowerShell' }, ($, e) => ran(e.command))
  return seen
}

async function call($: Engine, command: string, tool: 'Bash' | 'PowerShell' = 'Bash') {
  await $.session.start({ cwd: 'C:/Repos/my-game', surface: 'terminal', isInteractive: true })
  return (await $.tool.call({ tool, command } as never)) as { deny?: string }
}
const lastEntry = (seen: World) => JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
const names = (seen: World) => seen.started.map(s => String(s.argv.at(-1)).replace(/^.*\//, ''))
const stats = (seen: World) => Object.values(JSON.parse(seen.files.get(`${DATA}/stats.json`) ?? '{}'))

test('each shell call starts the three scripts as Claude Code starts a command hook', async ($, on) => {
  const seen = world(on)
  await call($, 'git status', 'PowerShell')
  expect([...names(seen)].sort()).toEqual([...SHIPPED].sort())
  for (const { argv, input, cwd, timeoutMs, env } of seen.started) {
    expect(argv).toEqual([PYTHON, ...LAUNCH, expect.stringMatching(/\/scripts\/[a-z-]+\.py$/)])
    expect(input).toEqual({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-a',
      cwd: 'C:/Repos/my-game',
      tool_name: 'PowerShell',
      tool_input: { command: 'git status' },
    })
    expect(cwd).toBe('C:/Repos/my-game')
    expect(env).toBeUndefined()
    expect(timeoutMs).toBe(10_000)
  }
  expect(seen.ran).toEqual(['git status'])
})

// A candidate inside a virtual or conda environment fails the check (exits nonzero), as one not on PATH does.
test('the scripts run on the first Python 3.8+ found, in the setup guide order', async ($, on) => {
  const seen = world(on, 'Linux')
  seen.pythons = { 'python3.11': '/usr/bin/python3.11\n', '/usr/bin/python3': '/usr/bin/python3\n' }
  await call($, 'ls')
  expect(new Set(seen.started.map(s => s.argv[0]))).toEqual(new Set(['/usr/bin/python3.11']))
  expect(seen.started).toHaveLength(3)
  expect(seen.probed).toEqual(['python', 'python3', 'py -3', 'python3.13', 'python3.12', 'python3.11'])
})

// SETUP.md § 7c: a candidate inside an environment is followed by the interpreter the environment came from.
test("a Python inside a virtual environment hands over to the one it was built from", async ($, on) => {
  const seen = world(on)
  seen.inEnv = { python: 'C:\\Python312' }
  seen.pythons = { 'C:/Python312/python.exe': 'C:\\Python312\\python.exe\n' }
  await call($, 'ls')
  expect(seen.probed).toEqual(['python', 'C:/Python312/bin/python3', 'C:/Python312/python.exe'])
  expect(new Set(seen.started.map(s => s.argv[0]))).toEqual(new Set(['C:/Python312/python.exe']))
})

// A conda environment's base is the environment itself; conda's own interpreter comes before the fixed paths.
test("inside a conda environment the scripts run on conda's own Python", async ($, on) => {
  const seen = world(on)
  seen.inEnv = { python: 'C:/Miniconda3/envs/game' }
  seen.env.CONDA_PYTHON_EXE = 'C:\\Miniconda3\\python.exe'
  seen.pythons = {
    'C:\\Miniconda3\\python.exe': 'C:\\Miniconda3\\python.exe\n',
    '/usr/bin/python3': '/usr/bin/python3\n',
  }
  await call($, 'ls')
  expect(seen.probed.at(-1)).toBe('C:\\Miniconda3\\python.exe')
  expect(new Set(seen.started.map(s => s.argv[0]))).toEqual(new Set(['C:/Miniconda3/python.exe']))
})

// After a hot reload no session.start runs: the first call sets up, and one sent beside it waits for that.
test('shell calls sent together after a hot reload all wait for the set-up', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  const results = await Promise.all(
    ['git commit -m CREDIT', 'ls', 'gh run WATCH'].map(command => $.tool.call({ tool: 'Bash', command } as never)),
  )
  expect((results as Array<{ deny?: string }>).map(r => r.deny)).toEqual([
    'BLOCKED (no AI attribution): x',
    undefined,
    'BLOCKED: `gh run watch`',
  ])
  expect(seen.started).toHaveLength(9)
  expect(seen.probed).toEqual(['python'])
  expect(stats(seen)).toMatchObject([{ checked: 3, failed: 0 }])
})

test('with no Python found nothing starts, the call runs and the status says so', async ($, on) => {
  const seen = world(on)
  seen.pythons = {}
  expect((await call($, 'git commit -m CREDIT')).deny).toBeUndefined()
  expect(seen.started).toEqual([])
  expect(stats(seen)).toMatchObject([{ checked: 0, failed: 1, lastError: expect.stringContaining('no Python') }])
  const { text } = (await $.command.run({ command: 'guards', args: '' } as never)) as { text: string }
  expect(text).toContain('No Python 3.8+ found')
})

test('the set-up tests each shipped script with a call it must refuse', async ($, on) => {
  const seen = world(on)
  await call($, 'ls')
  expect([...seen.tested].sort()).toEqual(['block-gh-run-watch.py', 'no-ai-attribution.py'])
  expect(stats(seen)).toMatchObject([{ checked: 1, failed: 0 }])
  const { text } = (await $.command.run({ command: 'guards', args: '' } as never)) as { text: string }
  expect(text).toContain(`Scripts run on ${PYTHON}.`)
})

test("the set-up tests the shipped scripts even where the machine's own copy is looser", async ($, on) => {
  const seen = world(on)
  seen.own.add('block-gh-run-watch.py')
  seen.scripts['own block-gh-run-watch.py'] = refuses(['WATCH'], 'BLOCKED (own): `gh run watch`')
  expect((await call($, 'gh run WATCH')).deny).toBeUndefined()
  expect(lastEntry(seen)).toMatchObject({ mod: 'BLOCKED (own): `gh run watch`' })
  expect(stats(seen)).toMatchObject([{ checked: 1, failed: 0 }])
  const { text } = (await $.command.run({ command: 'guards', args: '' } as never)) as { text: string }
  expect(text).toContain(`Scripts run on ${PYTHON}.`)
})

// Both shipped scripts exit 0 silently on an input they cannot read, so a lost stdin would pass every call.
test('a hook input lost on the way is caught at set-up: no call counts as checked', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on)
  seen.isInputLost = true
  expect((await call($, 'git commit -m CREDIT')).deny).toBeUndefined()
  expect(stats(seen)).toMatchObject([{ checked: 0, failed: 1, lastError: expect.stringContaining('let through') }])
  const { text } = (await $.command.run({ command: 'guards', args: '' } as never)) as { text: string }
  expect(text).toContain('no call counts as checked')
})

test('a script that fails its set-up test still refuses what it refuses', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  seen.scripts['no-ai-attribution.py'] = refuses(['CREDIT'], 'BLOCKED (no AI attribution): x')
  expect((await call($, 'git commit -m CREDIT')).deny).toBe('BLOCKED (no AI attribution): x')
  expect(stats(seen)).toMatchObject([{ failed: 1, lastError: expect.stringMatching(/^no-ai-attribution\.py let/) }])
})

test('every way a hook says stop stops the call', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  const out = (json: unknown): Answer => ({ exitCode: 0, stdout: JSON.stringify(json) })
  for (const [json, reason] of [
    [{ decision: 'block', reason: 'old shape' }, 'old shape'],
    [{ continue: false, stopReason: 'stopped' }, 'stopped'],
    [{ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'sure?' } }, 'sure? (asks'],
    [{ hookSpecificOutput: { permissionDecision: 'deny' } }, 'pr-body-contract.py refused the call'],
  ] as const) {
    seen.scripts['pr-body-contract.py'] = () => out(json)
    expect(String((await call($, 'gh pr create')).deny)).toContain(reason)
  }
  for (const json of [{ hookSpecificOutput: { permissionDecision: 'allow' } }, { decision: 'approve' }, {}]) {
    seen.scripts['pr-body-contract.py'] = () => out(json)
    expect((await call($, 'gh pr create')).deny).toBeUndefined()
  }
  // No output, plain text or a JSON value that is not an object: the call runs, counted as checked.
  for (const stdout of ['', 'all good', '"text"', 'null']) {
    seen.scripts['pr-body-contract.py'] = () => ({ exitCode: 0, stdout })
    expect((await call($, 'gh pr create')).deny).toBeUndefined()
  }
  expect(stats(seen)).toMatchObject([{ failed: 0 }])
})

test("the mode saved in the mod's settings file applies from the session's start", async ($, on) => {
  const seen = world(on)
  const mode = { type: 'string', options: ['shadow', 'enforce'] }
  seen.files.set('plugin.json', JSON.stringify({ userConfig: { mode } }))
  seen.files.set(`${DATA}/settings.json`, '{"mode":"enforce"}')
  const result = await call($, 'git commit -m CREDIT')
  expect(String(result.deny)).toContain('BLOCKED (no AI attribution)')
  expect(seen.ran).toEqual([])
})

test("in enforce mode a script's deny refuses the call with its own reason", { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  expect((await call($, 'git commit -m CREDIT')).deny).toBe('BLOCKED (no AI attribution): x')
  expect((await call($, 'gh run WATCH')).deny).toBe('BLOCKED: `gh run watch`')
  expect((await call($, 'gh pr create BODY')).deny).toBe('BLOCKED (PR-body contract): y')
  expect(seen.ran).toEqual([])
  expect(lastEntry(seen)).toMatchObject({ enforced: true, mod: 'BLOCKED (PR-body contract): y' })
  const stats = JSON.parse(seen.files.get(`${DATA}/stats.json`) ?? '{}')
  expect(Object.values(stats)).toMatchObject([{ checked: 3, mod: 3, scripts: 0 }])
})

test('when several scripts deny, the first in settings order gives the reason', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  world(on)
  expect((await call($, 'gh pr create BODY WATCH CREDIT')).deny).toBe('BLOCKED (no AI attribution): x')
  expect((await call($, 'gh pr create BODY WATCH')).deny).toBe('BLOCKED: `gh run watch`')
})

test('exit 2 refuses with what the script wrote to stderr', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  seen.scripts['pr-body-contract.py'] = () => ({ exitCode: 2, stderr: 'no body file\n' })
  expect((await call($, 'gh pr create')).deny).toBe('no body file')
})

test('in shadow mode a deny is logged and counted, never blocked', async ($, on) => {
  const seen = world(on)
  await call($, 'git commit -m CREDIT')
  expect(seen.ran).toHaveLength(1)
  expect(lastEntry(seen)).toMatchObject({ mod: 'BLOCKED (no AI attribution): x', scripts: null })
  expect(lastEntry(seen).enforced).toBeUndefined()
})

test('clean calls run untouched and log nothing', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  for (const command of ['git status', 'ls -la', 'gh pr view 3']) await call($, command)
  expect(seen.ran).toHaveLength(3)
  expect(seen.files.has(LOG)).toBe(false)
  const stats = JSON.parse(seen.files.get(`${DATA}/stats.json`) ?? '{}')
  expect(Object.values(stats)).toMatchObject([{ checked: 3, mod: 0, scripts: 0 }])
})

test('with attribution off, the attribution script never starts', {
  options: { mode: 'enforce', attribution: 'off' },
}, async ($, on) => {
  const seen = world(on)
  expect((await call($, 'git commit -m CREDIT')).deny).toBeUndefined()
  expect(String((await call($, 'gh run WATCH')).deny)).toContain('gh run watch')
  expect(names(seen)).not.toContain('no-ai-attribution.py')
  expect(seen.ran).toHaveLength(1)
})

test("a machine's own copy of a script runs in place of the shipped one", { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  seen.own.add('pr-body-contract.py')
  seen.scripts['own pr-body-contract.py'] = () => deny('own table')
  expect((await call($, 'gh pr create')).deny).toBe('own table')
  // The scripts start side by side, so in no fixed order.
  const files = seen.started.map(s => String(s.argv.at(-1))).sort()
  expect(files).toHaveLength(3)
  expect(files.filter(f => f.endsWith('/pr-body-contract.py'))).toEqual([`${DATA}/scripts/pr-body-contract.py`])
})

test('without its own copy, the PR-body script never starts', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  seen.own.clear()
  expect((await call($, 'gh pr create BODY')).deny).toBeUndefined()
  expect([...names(seen)].sort()).toEqual(['block-gh-run-watch.py', 'no-ai-attribution.py'])
})

test('the empty command starts no script', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  await call($, '')
  expect(seen.started).toEqual([])
  expect(seen.ran).toEqual([''])
})

// A failing command hook is a non-blocking error to Claude Code: the call runs. Here it is counted as not
// checked, with the last error, in stats.json (the log keeps blocks only).
test('a script that fails lets the call run, even in enforce, and is counted', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  seen.scripts['block-gh-run-watch.py'] = () => ({ exitCode: 1, stderr: 'Traceback: boom' })
  expect((await call($, 'git status')).deny).toBeUndefined()
  expect(seen.ran).toEqual(['git status'])
  const lastError = 'block-gh-run-watch.py exited 1: Traceback: boom'
  expect(stats(seen)).toMatchObject([{ checked: 0, failed: 1, lastError }])
  expect(seen.files.has(LOG)).toBe(false)
})

// A script past its limit: the run rejects (a timeout) or ends killed with no exit code, its output cut.
// Neither is read as a pass or a block, even with a deny in the cut output.
test('a script that runs past its limit or is killed lets the call run and is counted', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on)
  const cut = deny('BLOCKED (PR-body contract): y')
  for (const [answer, error] of [
    [() => {
      throw new Error('timed out after 10000 ms')
    }, 'pr-body-contract.py:'],
    [() => ({ ...cut, exitCode: null as never, stderr: 'killed' }), 'pr-body-contract.py exited null'],
  ] as const) {
    seen.scripts['pr-body-contract.py'] = i => (TEST_CALL.test(i.tool_input.command) ? undefined : answer())
    expect((await call($, 'gh pr create')).deny).toBeUndefined()
    expect(stats(seen).at(-1)).toMatchObject({ lastError: expect.stringContaining(error) })
  }
  expect(seen.ran).toEqual(['gh pr create', 'gh pr create'])
  expect(stats(seen)).toMatchObject([{ checked: 0, failed: 2 }])
})

test("a failing script never hides another script's deny", { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  seen.scripts['no-ai-attribution.py'] = () => ({ exitCode: 1, stderr: 'boom' })
  expect((await call($, 'gh run WATCH')).deny).toBe('BLOCKED: `gh run watch`')
  expect(lastEntry(seen)).toMatchObject({ mod: 'BLOCKED: `gh run watch`', enforced: true })
  expect(lastEntry(seen).error).toContain('no-ai-attribution.py exited 1')
})

test('a script that cannot start lets the call run and is counted', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  seen.broken.add('python')
  expect((await call($, 'git status')).deny).toBeUndefined()
  expect(seen.ran).toEqual(['git status'])
  expect(stats(seen)).toMatchObject([{ failed: 1, lastError: expect.stringContaining('process.run') }])
})

test('in enforce mode a check that crashes refuses the command', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  seen.broken.add('env.get')
  const result = (await $.tool.call({ tool: 'Bash', command: "git commit -m 'fix: x'" } as never)) as { deny?: string }
  expect(seen.ran).toEqual([])
  expect(String(result.deny)).toContain('the check failed')
  expect(String(result.deny)).toContain('env.get')
})

test('in shadow mode a check that crashes lets the command run', async ($, on) => {
  const seen = world(on)
  seen.broken.add('env.get')
  const result = (await $.tool.call({ tool: 'Bash', command: "git commit -m 'fix: x'" } as never)) as { deny?: string }
  expect(seen.ran).toHaveLength(1)
  expect(result.deny).toBeUndefined()
})

test('in enforce mode a check error refuses the command and is logged', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  await $.session.start({ cwd: 'C:/Repos/my-game', surface: 'terminal', isInteractive: true })
  seen.broken.add('session.cwd')
  const result = (await $.tool.call({ tool: 'PowerShell', command: "git commit -m 'fix: x'" } as never)) as {
    deny?: string
  }
  expect(seen.ran).toEqual([])
  expect(String(result.deny)).toContain('the check failed')
  expect(lastEntry(seen)).toMatchObject({ tool: 'PowerShell', enforced: true })
  expect(lastEntry(seen).error).toContain('session.cwd')
})

test('a crash after the command ran keeps its result and never runs it twice', async ($, on) => {
  const seen = world(on)
  seen.broken.add('session.id')
  const result = await call($, 'git commit -m CREDIT')
  expect(seen.ran).toHaveLength(1)
  expect(result).toEqual({ result: {} })
})
