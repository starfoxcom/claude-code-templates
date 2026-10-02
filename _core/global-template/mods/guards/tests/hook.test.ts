import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const AI_TRAILER = 'Co-' + 'Authored-By: Cla' + 'ude <noreply@anthro' + 'pic.com>'
const LOG = 'C:/Users/me/.claude/mods-data/guards/decisions.jsonl'

function world(on: On, files: Record<string, string> = {}, diff = '') {
  const seen = { files: new Map(Object.entries(files)), ran: [] as string[], runs: [] as string[][] }
  mock.clock(on)
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
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
    const out = e.argv.includes('--show-toplevel') ? 'C:/Repos/my-game\n' : e.argv.includes('diff') ? diff : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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

test('a commit looks at the lines it adds', async ($, on) => {
  const seen = world(on, {}, `+++ b/src/a.ts\n@@ -0,0 +1 @@\n+// ${AI_TRAILER}\n`)
  await bash($, "git commit -m 'feat: x'")
  expect(seen.runs.some(argv => argv.includes('--cached'))).toBe(true)
  expect(seen.files.get(LOG)).toContain('added to src/a.ts')
})

test('read-only and clean commands run untouched and log nothing', async ($, on) => {
  const seen = world(on)
  await bash($, 'git log -1 && git status')
  await bash($, "git commit -m 'docs: x'")
  expect(seen.ran).toHaveLength(2)
  expect(seen.files.has(LOG)).toBe(false)
})
