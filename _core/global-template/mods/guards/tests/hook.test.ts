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
// Stand-ins for the shipped scripts: each refuses one marker word.
const refuses =
  (word: string, reason: string): Script =>
  i =>
    i.tool_input.command.includes(word) ? deny(reason) : undefined
const STAND_INS: Record<string, Script> = {
  'no-ai-attribution.py': refuses('CREDIT', 'BLOCKED (no AI attribution): x'),
  'block-gh-run-watch.py': refuses('WATCH', 'BLOCKED: `gh run watch`'),
  'pr-body-contract.py': refuses('BODY', 'BLOCKED (PR-body contract): y'),
}

type World = {
  files: Map<string, string>
  own: Set<string>
  ran: string[]
  started: Array<{ argv: string[]; input: Record<string, unknown>; timeoutMs?: number }>
  broken: Set<string>
  scripts: Record<string, Script>
}

// `seen.own`: scripts the machine has its own copy of. `seen.broken`: calls that throw.
function world(on: On, os = 'Windows_NT'): World {
  const seen: World = { files: new Map(), own: new Set(), ran: [], started: [], broken: new Set(), scripts: {} }
  seen.scripts = { ...STAND_INS }
  const env: Record<string, string> = { USERPROFILE: 'C:/Users/me', OS: os }
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
    const [, file = ''] = e.argv
    let answer: Answer = { exitCode: 0 }
    if (file.endsWith('.py')) {
      unless('python')
      const input = JSON.parse(String(e.init?.stdin))
      seen.started.push({ argv: [...e.argv], input, timeoutMs: e.init?.timeoutMs })
      const name = file.slice(file.lastIndexOf('/') + 1)
      answer = seen.scripts[file.startsWith(DATA) ? `own ${name}` : name]?.(input) ?? answer
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
const names = (seen: World) => seen.started.map(s => s.argv[1]?.replace(/^.*\//, ''))

test('each shell call starts the three scripts as Claude Code starts a command hook', async ($, on) => {
  const seen = world(on)
  await call($, 'git status', 'PowerShell')
  expect([...names(seen)].sort()).toEqual([...SHIPPED].sort())
  for (const { argv, input, timeoutMs } of seen.started) {
    expect(argv[0]).toBe('python')
    expect(argv[1]).toContain('/scripts/')
    expect(input).toEqual({
      hook_event_name: 'PreToolUse',
      tool_name: 'PowerShell',
      tool_input: { command: 'git status' },
      cwd: 'C:/Repos/my-game',
    })
    expect(timeoutMs).toBe(10_000)
  }
  expect(seen.ran).toEqual(['git status'])
})

test('off Windows the scripts start with python3', async ($, on) => {
  const seen = world(on, 'Linux')
  await call($, 'ls')
  expect(seen.started.map(s => s.argv[0])).toEqual(['python3', 'python3', 'python3'])
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
  const files = seen.started.map(s => String(s.argv[1])).sort()
  expect(files).toHaveLength(3)
  expect(files.filter(f => f.endsWith('/pr-body-contract.py'))).toEqual([`${DATA}/scripts/pr-body-contract.py`])
})

test('the empty command starts no script', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  await call($, '')
  expect(seen.started).toEqual([])
  expect(seen.ran).toEqual([''])
})

// A failing command hook is a non-blocking error to Claude Code: the call runs, and here the error is logged.
test('a script that fails lets the call run, even in enforce, and is logged', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  seen.scripts['block-gh-run-watch.py'] = () => ({ exitCode: 1, stderr: 'Traceback: boom' })
  expect((await call($, 'git status')).deny).toBeUndefined()
  expect(seen.ran).toEqual(['git status'])
  expect(lastEntry(seen).error).toContain('block-gh-run-watch.py exited 1: Traceback: boom')
})

test('a script that prints no JSON lets the call run and is logged', async ($, on) => {
  const seen = world(on)
  seen.scripts['no-ai-attribution.py'] = () => ({ exitCode: 0, stdout: 'not json' })
  expect((await call($, 'git status')).deny).toBeUndefined()
  expect(seen.ran).toHaveLength(1)
  expect(lastEntry(seen).error).toContain('no-ai-attribution.py')
})

test("a failing script never hides another script's deny", { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  seen.scripts['no-ai-attribution.py'] = () => ({ exitCode: 1, stderr: 'boom' })
  expect((await call($, 'gh run WATCH')).deny).toBe('BLOCKED: `gh run watch`')
  expect(lastEntry(seen)).toMatchObject({ mod: 'BLOCKED: `gh run watch`', enforced: true })
  expect(lastEntry(seen).error).toContain('no-ai-attribution.py exited 1')
})

test('a Python that cannot start lets the call run and is logged', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  seen.broken.add('python')
  expect((await call($, 'git status')).deny).toBeUndefined()
  expect(seen.ran).toEqual(['git status'])
  expect(lastEntry(seen).error).toContain('process.run')
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
