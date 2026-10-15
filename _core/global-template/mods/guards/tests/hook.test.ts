import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const AI_TRAILER = 'Co-' + 'Authored-By: Cla' + 'ude <noreply@anthro' + 'pic.com>'
const DATA = 'C:/Users/me/.claude/mods-data/guards'
const LOG = `${DATA}/decisions.jsonl`
const PR_RULES = JSON.stringify({
  repos: {
    'my-game': { row: String.raw`^(Resolves|Part of) #\d+\s*$`, noRow: String.raw`^(docs|chore)(\(|:)` },
    tiny: { row: String.raw`^Resolves #\d+$`, noRow: '^docs', segment: true },
  },
  skip: ['board'],
})
const FULL_BODY = '## What\n- add the sky\n\n## Why\nIt was missing.\n\nResolves #12\n'

// `seen.broken`: calls that throw. Files are keyed by the path the engine is asked for, with forward slashes.
function world(on: On, files: Record<string, string> = {}, os = 'Windows_NT', cwd = 'C:/Repos/my-game') {
  const seen = { files: new Map(Object.entries(files)), ran: [] as string[], broken: new Set<string>() }
  const env: Record<string, string> = { USERPROFILE: 'C:/Users/me', OS: os }
  const unless = (call: string) => {
    if (seen.broken.has(call)) throw new Error(`${call} is down`)
  }
  mock.clock(on)
  on('env.get', ($, e) => (unless('env.get'), { value: env[e.name] }))
  on('session.id', () => (unless('session.id'), { value: 'sess-a' }))
  on('session.cwd', () => (unless('session.cwd'), { value: cwd }) as never)
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    // The manifest, wherever the plugin root is: a test that needs it lists it as `plugin.json`.
    const text = seen.files.get(path.endsWith('/plugin.json') ? 'plugin.json' : path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    seen.files.set(e.path.replaceAll('\\', '/'), e.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }) as never)
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
const lastEntry = (seen: { files: Map<string, string> }) =>
  JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')

test("the mode saved in the mod's settings file applies from the session's start", async ($, on) => {
  const manifest = JSON.stringify({ userConfig: { mode: { type: 'string', options: ['shadow', 'enforce'] } } })
  const seen = world(on, { 'plugin.json': manifest, [`${DATA}/settings.json`]: '{"mode":"enforce"}' })
  const result = await call($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)
  expect(String(result.deny)).toContain('BLOCKED (guards)')
  expect(seen.ran).toEqual([])
})

test('in shadow mode a credit is logged, never blocked', async ($, on) => {
  const seen = world(on)
  await call($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)
  expect(seen.ran).toHaveLength(1)
  expect(lastEntry(seen).mod).toContain('attribution marker')
  expect(lastEntry(seen).scripts).toBeNull()
})

test('in enforce mode a block is refused, counted and logged', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  const result = await call($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)
  expect(seen.ran).toEqual([])
  expect(String(result.deny)).toContain('BLOCKED (guards): no AI attribution')
  expect(lastEntry(seen)).toMatchObject({ enforced: true })
  const stats = JSON.parse(seen.files.get(`${DATA}/stats.json`) ?? '{}')
  expect(Object.values(stats)).toMatchObject([{ checked: 1, mod: 1, scripts: 0 }])
})

// The shipped attribution hook's own rules, from its docstring and the live replays: what it refuses.
test('every route the attribution hook refuses is refused', { options: { mode: 'enforce' } }, async ($, on) => {
  world(on, { 'C:/Repos/my-game/body.md': `## What\n- x\n\n${AI_TRAILER}\n` })
  for (const [command, reason, tool] of [
    ['git commit -m x --no-verify', 'git hook bypass'],
    ['git commit -n -m x', 'git hook bypass'],
    ['git merge -n feature', 'git hook bypass'],
    ['git -c core.hooksPath=/dev/null commit -m x', 'git hook bypass'],
    ['LEFTHOOK=0 git commit -m x', 'git hook bypass'],
    ['npx lefthook uninstall', 'disabling lefthook'],
    ['git commit --trailer "a: b" -m x', '--trailer is not allowed'],
    ['git commit -C HEAD~1', 'reusing another commit'],
    ['git commit --reuse-message=HEAD', 'reusing another commit'],
    ['eval git commit -m x', 'eval builds the command'],
    ['git filter-repo --force', 'history rewriting'],
    ['git commit -m "$MSG"', 'shell expansion'],
    ['git commit -m "$(cat msg.txt)"', 'shell expansion'],
    ['git commit -m "`cat msg.txt`"', 'shell expansion'],
    ['git commit -F - < msg.txt', '`-F -` reads the message from a pipe'],
    ['echo git commit --no-verify -m x; git commit -m y', 'git hook bypass'],
    ['gh pr create -t t --body-file body.md', 'attribution marker'],
    ['gh pr create -t t --body-file missing.md', 'could not read message/body file'],
    ['gh pr comment 1 --body-file /c/Repos/my-game/body.md', 'could not read message/body file'],
    ['gh api repos/o/r/issues/1/comments -f body="$B"', 'shell expansion'],
    ["git commit -m 'x' -m $m", 'shell expansion', 'PowerShell'],
    ['gh run watch 123', '`gh run watch` streams logs'],
    ['gh -R o/r run watch', '`gh run watch` streams logs'],
  ] as const) {
    const result = await call($, command, (tool ?? 'Bash') as 'Bash')
    expect([command, String(result.deny)]).toEqual([command, expect.stringContaining(reason)])
  }
})

// And what it passes: text inside a message, a here-doc or a here-string is described, never run.
test('every command the attribution hook passes runs', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, { 'C:/Repos/my-game/body.md': '## What\n- x\n', 'C:/Repos/my-game/sub/m.txt': 'fix: y' })
  const commands = [
    "git commit -m 'docs: explain --no-verify and eval'",
    "git commit -F - <<'EOF'\nfix: say why $HOME stays literal\nEOF",
    'git tag -n',
    'git cherry-pick -n abc123',
    'git merge $SHA',
    'gh pr create -f',
    'gh issue create --template "Bug report"',
    'gh api repos/o/r/issues -F key=@-',
    'git commit -m "fix: the CLAUDE.md wording"',
    'cd sub && git commit -F m.txt',
    'gh pr create -t t --body-file body.md',
    'git push origin feature/ci-watch-incident',
    'ls ~/.claude/hooks && cat /c/Users/me/.claude/x',
    'npm test 2>$null',
  ]
  for (const command of commands) expect([command, (await call($, command)).deny]).toEqual([command, undefined])
  expect(seen.ran).toHaveLength(commands.length)
})

test('with attribution off, AI credit passes; every route around the gates stays refused', {
  options: { mode: 'enforce', attribution: 'off' },
}, async ($, on) => {
  const seen = world(on)
  expect((await call($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)).deny).toBeUndefined()
  expect((await call($, 'gh pr create -t t --body-file missing.md')).deny).toBeUndefined()
  for (const [command, reason] of [
    ['git commit --no-verify -m "fix: x"', 'git hook bypass'],
    ['git commit -C HEAD', 'reusing another commit'],
    [['gh', 'run', 'watch', '123'].join(' '), 'streams logs'],
  ]) {
    expect(String((await call($, command as string)).deny)).toContain(reason as string)
  }
  expect(seen.ran).toHaveLength(2)
})

test('read-only and clean commands run untouched and log nothing', async ($, on) => {
  const seen = world(on)
  const commands = ['git status', 'ls -la', 'git commit -m "fix: plain words"', 'gh pr view 3']
  for (const command of commands) await call($, command)
  expect(seen.ran).toHaveLength(4)
  expect(seen.files.has(LOG)).toBe(false)
})

// A body file is found where the hook's Python `open()` finds it: from the first `cd`, else the session
// folder; a Git Bash `/c/...` path is a rooted path to Python on Windows, so it is not found.
test('a body file is read where the hook reads it', { options: { mode: 'enforce' } }, async ($, on) => {
  world(on, { 'C:/Repos/other/b.md': AI_TRAILER, 'C:/c/Repos/my-game/b.md': AI_TRAILER, 'C:/Users/me/b.md': 'x' })
  expect(String((await call($, 'cd ../other && gh pr comment 1 -F b.md')).deny)).toContain('attribution')
  expect(String((await call($, 'cd C:/Repos/other && gh pr comment 1 -F b.md')).deny)).toContain('attribution')
  expect(String((await call($, 'gh pr comment 1 -F /c/Repos/my-game/b.md')).deny)).toContain('attribution')
  expect((await call($, 'gh pr comment 1 -F ~/b.md')).deny).toBeUndefined()
})

test('off Windows a path is read as posix paths are', { options: { mode: 'enforce' } }, async ($, on) => {
  world(on, { '/c/Repos/my-game/b.md': AI_TRAILER }, 'Linux', '/home/me')
  expect(String((await call($, 'gh pr comment 1 -F /c/Repos/my-game/b.md')).deny)).toContain('attribution')
})

test('the PR-body contract holds a listed repo to the PR format', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, {
    [`${DATA}/pr-body.json`]: PR_RULES,
    'C:/Repos/my-game/full.md': FULL_BODY,
    'C:/Repos/my-game/short.md': '## What\n',
    'C:/Repos/my-game/norow.md': FULL_BODY.replace('Resolves #12\n', ''),
    'C:/Repos/my-game/emptynotes.md': `${FULL_BODY}## Notes\n\n`,
  })
  for (const [command, reason] of [
    ['gh pr create -t "feat: x" --body-file short.md', '`## What` is missing'],
    ['gh pr create -t "feat: x" --body-file norow.md', 'no board-row line'],
    ['gh pr create -t "feat: x" --body-file emptynotes.md', '`## Notes` is present but empty'],
    ['gh pr create -t "feat: x" --body "## What"', 'inline `--body`'],
    ['gh pr create --fill', '`--fill*`'],
    ['gh pr create -t "feat: x"', 'needs `--body-file'],
  ]) {
    expect(String((await call($, command as string)).deny)).toContain(reason as string)
  }
  for (const command of [
    'gh pr create -t "feat: x" --body-file full.md',
    'gh pr create -t "docs: x" --body-file norow.md',
    'gh pr edit 3 --add-label bug',
    'gh pr create -R o/elsewhere -t t --body x',
    'gh pr create -R o/board -t t --body x',
  ]) {
    expect([command, (await call($, command)).deny]).toEqual([command, undefined])
  }
  expect(seen.ran).toHaveLength(5)
})

test('a segment key matches a whole folder name only', { options: { mode: 'enforce' } }, async ($, on) => {
  world(on, { [`${DATA}/pr-body.json`]: PR_RULES }, 'Windows_NT', 'C:/Repos/tiny')
  expect(String((await call($, 'gh pr create -t t --body x')).deny)).toContain('inline `--body`')
  expect((await call($, 'gh pr create -R o/tinyproject -t t --body x')).deny).toBeUndefined()
})

test('without the rules file, or with a pattern that does not compile, no PR body is judged', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on, { 'C:/Repos/my-game/short.md': '## What\n' })
  await call($, 'gh pr create -t t --body x')
  seen.files.set(`${DATA}/pr-body.json`, JSON.stringify({ repos: { 'my-game': { row: '(', noRow: '^docs' } } }))
  await call($, 'gh pr create -t t --body-file short.md')
  expect(seen.ran).toHaveLength(2)
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
  const result = await call($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)
  expect(seen.ran).toHaveLength(1)
  expect(result).toEqual({ result: {} })
})
