import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const AI_TRAILER = 'Co-' + 'Authored-By: Cla' + 'ude <noreply@anthro' + 'pic.com>'
const LOG = 'C:/Users/me/.claude/mods-data/guards/decisions.jsonl'

// `isDiffCut`: the diff went past the engine's output cap.
function world(on: On, files: Record<string, string> = {}, diff = '', os = 'Windows_NT', isDiffCut = false) {
  const seen = { files: new Map(Object.entries(files)), ran: [] as string[], runs: [] as string[][] }
  mock.clock(on)
  mock.env(on, { USERPROFILE: 'C:/Users/me', TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp', OS: os })
  on('session.id', () => ({ value: 'sess-a' }))
  on('session.cwd', () => ({ value: 'C:/Repos/my-game' }) as never)
  on('fs.read', ($, e) => {
    const text = seen.files.get(e.path.replaceAll('\\', '/'))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    seen.files.set(e.path.replaceAll('\\', '/'), e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    seen.runs.push([...e.argv])
    const isDiff = e.argv.includes('diff')
    const out = e.argv.includes('--show-toplevel') ? 'C:/Repos/my-game\n' : isDiff ? diff : ''
    const isStdoutTruncated = isDiff && isDiffCut
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated, isStderrTruncated: false } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    seen.ran.push(String(e.command))
    return { result: {} as never }
  })
  return seen
}

async function bash($: Engine, command: string) {
  await $.session.start({ cwd: 'C:/Repos/my-game', surface: 'terminal', isInteractive: true })
  return $.tool.call({ tool: 'Bash', command } as never)
}

test('in shadow mode a credit is logged, never blocked', async ($, on) => {
  const seen = world(on)
  await bash($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)
  expect(seen.ran).toHaveLength(1)
  const entry = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
  expect(entry.mod).toContain('AI credit')
  expect(entry.scripts).toBeNull()
})

test('in enforce mode a block is refused, counted and logged', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  const result = await bash($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)
  expect(seen.ran).toEqual([])
  expect(String((result as { deny?: string }).deny)).toContain('BLOCKED (guards)')
  const entry = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
  expect(entry.mod).toContain('AI credit')
  expect(entry.enforced).toBe(true)
  const stats = JSON.parse(seen.files.get('C:/Users/me/.claude/mods-data/guards/stats.json') ?? '{}')
  expect(Object.values(stats)).toMatchObject([{ checked: 1, mod: 1, scripts: 0 }])
})

test('writes the reading misses are still refused in enforce mode', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  for (const command of [
    `OUT=\`git commit -m '${AI_TRAILER}'\``,
    `bash <<'EOF'\ngit commit -m '${AI_TRAILER}'\nEOF`,
    `echo "git commit -m '${AI_TRAILER}'" | bash`,
    `git push -o "merge_request.description=${AI_TRAILER}"`,
    `OUT=\`gh api repos/o/r/issues/1/comments -fbody='${AI_TRAILER}'\``,
  ]) {
    const result = await bash($, command)
    expect(String((result as { deny?: string }).deny)).toContain('BLOCKED (guards)')
  }
  expect(seen.ran).toEqual([])
  expect((seen.files.get(LOG) ?? '').trim().split('\n')).toHaveLength(5)
})

test(
  'a Bash body file under /tmp is read from the Windows temp folder',
  { options: { mode: 'enforce' } },
  async ($, on) => {
    const seen = world(on, { 'C:/Users/me/AppData/Local/Temp/body.md': '## What\n- clean\n' })
    const result = await bash($, 'gh pr create --title t --body-file /tmp/body.md')
    expect((result as { deny?: string }).deny).toBeUndefined()
    expect(seen.ran).toHaveLength(1)
  },
)

test('a body file is read, and a credit inside it is found', async ($, on) => {
  const seen = world(on, { 'C:/tmp/body.md': `## What\n- x\n\n${AI_TRAILER}\n` })
  await bash($, 'gh pr create --title t --body-file /c/tmp/body.md')
  expect(seen.files.get(LOG)).toContain('file /c/tmp/body.md')
})

test('a body file the same command writes is read from the command text', async ($, on) => {
  const seen = world(on)
  await bash($, `cat > /tmp/b.md <<'EOF'\n## What\n${AI_TRAILER}\nEOF\ngh pr create --title t --body-file /tmp/b.md`)
  const entry = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
  expect(entry.mod).toContain('file /tmp/b.md')
  // Written by another program: the guard cannot read it, and says so.
  await bash($, 'gh pr view 5 --json body --jq .body > /tmp/c.md; gh pr edit 5 --body-file /tmp/c.md')
  const next = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
  expect(next.unread).toEqual(['the PR edit (file /tmp/c.md)'])
})

test('a relative body file under a folder built at run time is named unread, never refused', async ($, on) => {
  const seen = world(on)
  for (const command of [
    'cd "$REPO" && gh pr create --title t --body-file body.md',
    'git -C "$ROOT" commit -F msg.txt',
  ]) {
    await bash($, command)
    const entry = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
    expect(entry.mod).toBeNull()
    expect(entry.unread?.length).toBe(1)
  }
  // A file of the same name in the session folder is a different file: still named unread, never read.
  seen.files.set('C:/Repos/my-game/body.md', '## What\n- clean\n')
  await bash($, 'cd "$REPO" && gh pr create --title t --body-file body.md')
  const sameName = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
  expect(sameName.unread?.length).toBe(1)
  // A literal folder still refuses a file that is not there.
  await bash($, 'cd C:/Repos/other && gh pr create --title t --body-file body.md')
  const literal = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
  expect(literal.mod).toContain('could not read the body file')
})

test('a commit looks at the lines it adds', async ($, on) => {
  const seen = world(on, {}, `+++ b/src/a.ts\n@@ -0,0 +1 @@\n+// ${AI_TRAILER}\n`)
  await bash($, "git commit -m 'feat: x'")
  expect(seen.runs.some(argv => argv.includes('--cached'))).toBe(true)
  expect(seen.files.get(LOG)).toContain('added to src/a.ts')
})

test('a diff past the output cap names the rest of the added lines unread', async ($, on) => {
  const seen = world(on, {}, `+++ b/src/a.ts\n@@ -0,0 +1 @@\n+const x = 1\n`, 'Windows_NT', true)
  await bash($, "git commit -m 'feat: x'")
  const entry = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
  expect(entry.mod).toBeNull()
  expect(entry.unread).toEqual(['the lines the commit adds past the first part of its diff'])
})

test('read-only and clean commands run untouched and log nothing', async ($, on) => {
  const seen = world(on)
  await bash($, 'git log -1 && git status')
  await bash($, "git commit -m 'docs: x'")
  expect(seen.ran).toHaveLength(2)
  expect(seen.files.has(LOG)).toBe(false)
})

test('off Windows a one-letter top folder is read where it is, not as a drive', async ($, on) => {
  const seen = world(on, { '/u/me/b.md': `## What\n- x\n\n${AI_TRAILER}\n` }, '', 'Linux')
  await bash($, 'gh pr create --title t --body-file /u/me/b.md')
  expect(seen.files.get(LOG)).toContain('file /u/me/b.md')
})
