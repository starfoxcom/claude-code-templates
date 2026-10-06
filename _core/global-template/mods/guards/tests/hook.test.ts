import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const AI_TRAILER = 'Co-' + 'Authored-By: Cla' + 'ude <noreply@anthro' + 'pic.com>'
const LOG = 'C:/Users/me/.claude/mods-data/guards/decisions.jsonl'

// `isDiffCut`: the diff went past the engine's output cap. A call named in `seen.broken` throws.
function world(on: On, files: Record<string, string> = {}, diff = '', os = 'Windows_NT', isDiffCut = false) {
  const seen = {
    files: new Map(Object.entries(files)),
    ran: [] as string[],
    runs: [] as string[][],
    broken: new Set<string>(),
  }
  const temp = 'C:\\Users\\me\\AppData\\Local\\Temp'
  const env: Record<string, string> = { USERPROFILE: 'C:/Users/me', TEMP: temp, OS: os }
  const unless = (call: string) => {
    if (seen.broken.has(call)) throw new Error(`${call} is down`)
  }
  mock.clock(on)
  on('env.get', ($, e) => (unless('env.get'), { value: env[e.name] }))
  on('session.id', () => (unless('session.id'), { value: 'sess-a' }))
  on('session.cwd', () => (unless('session.cwd'), { value: 'C:/Repos/my-game' }) as never)
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
  on('process.run', ($, e) => {
    seen.runs.push([...e.argv])
    const isDiff = e.argv.includes('diff')
    const out = e.argv.includes('--show-toplevel') ? 'C:/Repos/my-game\n' : isDiff ? diff : ''
    const isStdoutTruncated = isDiff && isDiffCut
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated, isStderrTruncated: false } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
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

test("the mode saved in the mod's settings file applies from the session's start", async ($, on) => {
  const manifest = JSON.stringify({ userConfig: { mode: { type: 'string', options: ['shadow', 'enforce'] } } })
  const saved = { 'plugin.json': manifest, 'C:/Users/me/.claude/mods-data/guards/settings.json': '{"mode":"enforce"}' }
  const seen = world(on, saved)
  const result = await bash($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)
  expect(String((result as { deny?: string }).deny)).toContain('BLOCKED (guards)')
  expect(seen.ran).toEqual([])
})

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
    // Not there either: the mapping was a guess, so the file is named unread, never refused.
    const missed = await bash($, 'gh pr create --title t --body-file /tmp/gone.md')
    expect((missed as { deny?: string }).deny).toBeUndefined()
    const entry = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
    expect(entry.unread?.length).toBe(1)
  },
)

test(
  'a relative body file is read from the folder in effect where it is named',
  { options: { mode: 'enforce' } },
  async ($, on) => {
    const clean = '## What\n- clean\n'
    const seen = world(on, {
      'C:/Repos/my-game/repo/sub/m.txt': clean,
      'C:/Repos/my-game/b.md': clean,
    })
    for (const command of [
      'cd repo && cd sub && git commit -F m.txt',
      'gh pr create --title t --body-file b.md && cd ../other && git pull',
    ]) {
      const result = await bash($, command)
      expect((result as { deny?: string }).deny).toBeUndefined()
    }
    expect(seen.ran).toHaveLength(2)
    // After `popd` the folder is not known: the file is named unread, never refused.
    const popped = await bash($, 'pushd x; popd; git commit -F m.txt')
    expect((popped as { deny?: string }).deny).toBeUndefined()
    const entry = JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
    expect(entry.unread?.length).toBe(1)
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

const RULES = 'C:/Users/me/.claude/mods-data/guards/pr-body.json'
const ROW_RULE = JSON.stringify({ repos: { 'my-game': { row: '^Resolves #\\d+$', noRow: '^(docs|chore)\\(' } } })
const FULL = '## What\n- add it\n\n## Why\nmissing\n\nResolves #4\n'

test('the PR-body contract blocks a body without its sections', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, { [RULES]: ROW_RULE, 'C:/Repos/my-game/b.md': '## What\n- add it\n' })
  const result = await bash($, 'gh pr create --title "feat: x" --body-file b.md')
  expect(String((result as { deny?: string }).deny)).toContain('PR-body contract: `## Why` is missing')
  expect(seen.ran).toEqual([])
})

test('the PR-body contract passes a full body and checks only listed repos', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on, { [RULES]: ROW_RULE, 'C:/Repos/my-game/b.md': FULL })
  expect((await bash($, 'gh pr create --title "feat: x" --body-file b.md') as { deny?: string }).deny).toBeUndefined()
  // Another repo, named with --repo, has no rule: an inline body passes there.
  expect((await bash($, 'gh pr create -R o/other --title t --body "x"') as { deny?: string }).deny).toBeUndefined()
  expect(seen.ran).toHaveLength(2)
})

test('without the rules file no PR body is checked', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  expect((await bash($, 'gh pr create --title t --body "x"') as { deny?: string }).deny).toBeUndefined()
  expect(seen.ran).toHaveLength(1)
})

const lastEntry = (seen: { files: Map<string, string> }) =>
  JSON.parse((seen.files.get(LOG) ?? '').trim().split('\n').pop() ?? '{}')
// The last logged command named its PR body unread (for whichever reason).
const isPrUnread = (seen: { files: Map<string, string> }) =>
  (lastEntry(seen).unread ?? []).some((u: string) => u.startsWith('the PR body'))

test('a body file the same command writes is named unread; a here-doc on stdin is checked', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on, { [RULES]: ROW_RULE })
  const write = (body: string) =>
    `cat > /tmp/b.md <<'EOF'\n${body}EOF\ngh pr create --title "feat: x" --body-file /tmp/b.md`
  const short = await bash($, write('## What\n- add it\n\n## Why\nmissing\n'))
  expect((short as { deny?: string }).deny).toBeUndefined()
  expect(isPrUnread(seen)).toBe(true)
  const piped = await bash($, `gh pr create --title "feat: x" --body-file - <<'EOF'\n## Why\nb\nEOF`)
  expect(String((piped as { deny?: string }).deny)).toContain('`## What` is missing')
  expect(seen.ran).toHaveLength(1)
})

test('a relative body file under a folder built at run time is never judged from the session folder', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on, { [RULES]: ROW_RULE, 'C:/Repos/my-game/b.md': '## What\n- add it\n' })
  const result = await bash($, 'cd "$REPO" && gh pr create --title "feat: x" --body-file b.md')
  expect((result as { deny?: string }).deny).toBeUndefined()
  expect(isPrUnread(seen)).toBe(true)
})

test('an invalid pattern in the rules file leaves the PR unjudged and the credit checks running', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const bad = JSON.stringify({ repos: { 'my-game': { row: '^(Resolves' } } })
  const seen = world(on, { [RULES]: bad, 'C:/Repos/my-game/b.md': FULL })
  const pr = await bash($, 'gh pr create --title "feat: x" --body-file b.md')
  expect((pr as { deny?: string }).deny).toBeUndefined()
  expect(lastEntry(seen).unread).toContain('the PR body (pr-body.json has an invalid pattern for my-game)')
  const credit = await bash($, `gh pr create --title "feat: x" --body-file b.md --body '${AI_TRAILER}'`)
  expect(String((credit as { deny?: string }).deny)).toContain('AI credit')
})

test('a PR body that cannot be read exactly is named unread, never blocked', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on, { [RULES]: ROW_RULE, 'C:/Repos/my-game/b.md': FULL })
  const routes = [
    // printf expands escapes the reading leaves as typed.
    `printf '## What\\n- add it\\n\\n## Why\\nmissing\\n\\nResolves #4\\n' > /tmp/b.md && ` +
      'gh pr create --title t --body-file /tmp/b.md',
    'cat b.md | gh pr create --title "feat: x" --body-file -',
    'gh pr create --title "feat: x" --body-file - < b.md',
    'cat b.md > c.md && gh pr create --title "feat: x" --body-file c.md',
  ]
  for (const command of routes) {
    expect([command, (await bash($, command) as { deny?: string }).deny]).toEqual([command, undefined])
    expect(isPrUnread(seen)).toBe(true)
  }
  expect(seen.ran).toHaveLength(routes.length)
})

// Only a command that is the PR call alone is judged: anything before it (a `cd`, a variable, a
// subshell) or around it (`bash -c`) could change which repo, folder or text gh really uses.
const NOT_ALONE = [
  'F=short.md; gh pr create --title "feat: x" --body-file "$F"',
  '(cd sub && make) && gh pr create --title "feat: x" --body-file short.md',
  // The cd runs in a subshell: gh stays in the session folder.
  '(cd sub) && gh pr create --title "feat: x" --body-file short.md',
  'bash -c "gh pr create -t t -F - <<\'EOF\'\n$BODY\nEOF"',
  'gh pr create -R "$OWNER/$REPO" -t t --body x',
  'gh pr create -t t -F a.md -F short.md',
  "gh pr create -t $'docs(x): y' -F short.md",
  'gh pr edit https://github.com/o/other/pull/5 --body-file short.md',
  // Unquoted here-doc: the shell joins `- add it\` with the next line, so gh gets no `## Why` heading.
  'gh pr create -t "feat: x" -F - <<EOF\n## What\n- add it\\\n## Why\nb\n\nResolves #1\nEOF',
]
for (const command of NOT_ALONE) {
  test(`a PR call that is not plain and alone is named unread, never blocked: ${command}`, {
    options: { mode: 'enforce' },
  }, async ($, on) => {
    // Every file any of them may name exists, so only the PR check could block.
    const short = '## What\n- add it\n'
    const files = { 'C:/Repos/my-game/a.md': short, 'C:/Repos/my-game/sub/short.md': short }
    const seen = world(on, { [RULES]: ROW_RULE, 'C:/Repos/my-game/short.md': short, ...files })
    expect((await bash($, command) as { deny?: string }).deny).toBeUndefined()
    expect(isPrUnread(seen)).toBe(true)
  })
}

const NOT_PLAIN = 'the PR body (format check, create: not a single plain PR call)'

test('a PowerShell splat is never blocked for flags it may carry', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, { [RULES]: ROW_RULE })
  on('tool.call', { tool: 'PowerShell' }, () => ({ result: {} as never }))
  await $.session.start({ cwd: 'C:/Repos/my-game', surface: 'terminal', isInteractive: true })
  const result = await $.tool.call({ tool: 'PowerShell', command: 'gh pr create @params' } as never)
  expect((result as { deny?: string }).deny).toBeUndefined()
  expect(lastEntry(seen).unread).toContain(NOT_PLAIN)
})

// Only a command whose one gh statement is the PR call is judged: with more, the repo, the body file or
// the title could belong to another statement. Each of these is named unread, never blocked.
const SHORT = { [RULES]: ROW_RULE, 'C:/Repos/my-game/short.md': '## What\n- add it\n' }

test('two PR calls in one command are named unread', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, SHORT)
  const both = await bash($, 'gh pr create --title "feat: x" --body-file short.md && gh pr edit 5 --add-label bug')
  expect((both as { deny?: string }).deny).toBeUndefined()
  expect(lastEntry(seen).unread).toContain(NOT_PLAIN)
})

test('another gh call naming a repo leaves the PR unread', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, SHORT)
  const command = 'gh pr view 12 -R o/other --json body && gh pr create --title "feat: x" --body-file short.md'
  expect((await bash($, command) as { deny?: string }).deny).toBeUndefined()
  expect(lastEntry(seen).unread).toContain(NOT_PLAIN)
})

test('a title built at run time is named unread', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, SHORT)
  const result = await bash($, 'gh pr create --title "$T" --body-file short.md')
  expect((result as { deny?: string }).deny).toBeUndefined()
  expect(lastEntry(seen).unread).toContain(NOT_PLAIN)
})

test('two here-docs on one PR call are named unread', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, { [RULES]: ROW_RULE })
  const command = `gh pr create --title "feat: x" --body-file - <<'A' <<'B'\n${FULL}A\n## Why\nb\nB`
  expect((await bash($, command) as { deny?: string }).deny).toBeUndefined()
  expect(isPrUnread(seen)).toBe(true)
})

const NAMES = 'C:/Users/me/.claude/mods-data/guards/names.json'
const NAME_RULE = JSON.stringify({ repos: { 'my-game': { names: ['oldkeep'], words: ['OK'] } } })

test('a banned name is blocked in a commit message, a body file and a new branch', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on, { [NAMES]: NAME_RULE, 'C:/Repos/my-game/msg.txt': 'fix: match the OK width\n' })
  const message = await bash($, `git commit -m 'feat: port the Oldkeep sky'`)
  expect(String((message as { deny?: string }).deny)).toContain('"Oldkeep" named in the commit message')
  const file = await bash($, 'git commit -F msg.txt')
  expect(String((file as { deny?: string }).deny)).toContain('"OK" named in')
  const branch = await bash($, 'git checkout -b feature/ok-like-oldkeep')
  expect(String((branch as { deny?: string }).deny)).toContain('"oldkeep" named in the new branch name')
  expect(seen.ran).toEqual([])
})

test('banned names apply only to the listed repos and never to the command text', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on, { [NAMES]: NAME_RULE })
  // Another repo, named with --repo: not on the list.
  expect((await bash($, 'gh issue create -R o/board --title "Oldkeep notes" --body "x"') as { deny?: string }).deny)
    .toBeUndefined()
  // A path in the command is not a message.
  expect((await bash($, 'git -C ../Oldkeep-Translator commit -m "fix: x"') as { deny?: string }).deny)
    .toBeUndefined()
  expect(seen.ran).toHaveLength(2)
})

test('a malformed names file checks no name', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, { [NAMES]: '{"repos":{"my-game":{"names":"oldkeep"}}}' })
  expect((await bash($, `git commit -m 'feat: port the Oldkeep sky'`) as { deny?: string }).deny).toBeUndefined()
  expect(seen.ran).toHaveLength(1)
})
test('a PR edit with no title is judged without the board row, which is named unread', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on, { [RULES]: ROW_RULE, 'C:/Repos/my-game/b.md': '## What\n- a\n\n## Why\nb\n' })
  const result = await bash($, 'gh pr edit 7 --body-file b.md')
  expect((result as { deny?: string }).deny).toBeUndefined()
  expect(lastEntry(seen).unread).toContain("the PR body's board row (format check, edit: no --title to judge it)")
  const short = await bash($, 'gh pr edit 7 --body-file short.md')
  expect(short).toBeDefined()
})

// Spellings gh reads one way and a plain reading another: each is named unread, never blocked.
const ODD_SPELLINGS = [
  'gh pr create -dF b.md -t "feat: x"',
  'gh pr create -tfeat -F b.md',
  'gh pr create --title "feat: x" --body-file "$(cat name.txt)"',
  "gh pr create --title \"feat: x\" -F - <<< $'## What\\n- a\\n\\n## Why\\nb\\n\\nResolves #1'",
]
// A body the check would refuse (no board row), so a misread spelling shows as a block.
const NO_ROW = '## What\n- a\n\n## Why\nb\n'
for (const command of ODD_SPELLINGS) {
  test(`an odd spelling is named unread, never blocked: ${command}`, { options: { mode: 'enforce' } }, async (
    $,
    on,
  ) => {
    const files = { [RULES]: ROW_RULE, 'C:/Repos/my-game/name.txt': 'b.md\n', 'C:/Repos/my-game/b.md': NO_ROW }
    const seen = world(on, files)
    expect((await bash($, command) as { deny?: string }).deny).toBeUndefined()
    expect(lastEntry(seen).unread?.some((u: string) => u.startsWith('the PR body'))).toBe(true)
  })
}

// A check that fails before the command runs: enforce refuses it, shadow lets it run. The engine's own
// catch takes a throw outside the guard's try, here the set-up on a call that comes before session.start.
test('in enforce mode a check that crashes refuses the command', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  seen.broken.add('env.get')
  const result = await $.tool.call({ tool: 'Bash', command: "git commit -m 'fix: x'" } as never)
  expect(seen.ran).toEqual([])
  expect(String((result as { deny?: string }).deny)).toContain('the check failed')
  expect(String((result as { deny?: string }).deny)).toContain('env.get')
})

test('in shadow mode a check that crashes lets the command run', async ($, on) => {
  const seen = world(on)
  seen.broken.add('env.get')
  const result = await $.tool.call({ tool: 'Bash', command: "git commit -m 'fix: x'" } as never)
  expect(seen.ran).toHaveLength(1)
  expect((result as { deny?: string }).deny).toBeUndefined()
})

test('in enforce mode a check error refuses the command and is logged', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  const seen = world(on)
  await $.session.start({ cwd: 'C:/Repos/my-game', surface: 'terminal', isInteractive: true })
  seen.broken.add('session.cwd')
  const result = await $.tool.call({ tool: 'PowerShell', command: "git commit -m 'fix: x'" } as never)
  expect(seen.ran).toEqual([])
  expect(String((result as { deny?: string }).deny)).toContain('the check failed')
  expect(lastEntry(seen)).toMatchObject({ tool: 'PowerShell', enforced: true })
  expect(lastEntry(seen).error).toContain('session.cwd')
})

test('a crash after the command ran keeps its result and never runs it twice', async ($, on) => {
  const seen = world(on)
  seen.broken.add('session.id')
  const result = await bash($, `git commit -m 'fix: x' -m '${AI_TRAILER}'`)
  expect(seen.ran).toHaveLength(1)
  expect(result).toEqual({ result: {} })
})

// From the shadow trial: Emberholm opens every PR as `cd "<repo>" && gh pr create ...`.
test('a PR call after a cd to a literal folder is judged there', { options: { mode: 'enforce' } }, async ($, on) => {
  world(on, { [RULES]: ROW_RULE, 'C:/Repos/other/b.md': NO_ROW })
  const result = await bash($, 'cd "C:/Repos/other" && gh pr create --title "feat: x" --body-file b.md')
  expect(String((result as { deny?: string }).deny)).toContain('PR-body contract')
  const full = await bash($, 'cd C:/Repos/other && cd sub && gh pr create --title "feat: x" --body-file ../b.md')
  expect(String((full as { deny?: string }).deny)).toContain('PR-body contract')
})

test('a PR call after a cd built at run time is named unread', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on, { [RULES]: ROW_RULE, 'C:/Repos/my-game/b.md': NO_ROW })
  const result = await bash($, 'cd "$REPO" && gh pr create --title "feat: x" --body-file b.md')
  expect((result as { deny?: string }).deny).toBeUndefined()
  expect(lastEntry(seen).unread?.some((u: string) => u.startsWith('the PR body'))).toBe(true)
})

// From the shadow trial: a python here-doc writes the API input, then gh sends it.
const SCRIPT_THEN_API = [
  "python - <<'EOF'",
  'import json',
  "open('su.json','w').write(json.dumps({'query': 'q'}))",
  'EOF',
  'gh api graphql --input su.json',
].join('\n')

test('a body file a script in the same command writes is named unread, never missing', {
  options: { mode: 'enforce' },
}, async ($, on) => {
  const seen = world(on)
  const result = await bash($, SCRIPT_THEN_API)
  expect((result as { deny?: string }).deny).toBeUndefined()
  expect(seen.ran).toHaveLength(1)
  expect(lastEntry(seen).unread).toEqual(['the GitHub API call'])
  // With no script before it, a missing file is still refused.
  const missing = await bash($, 'gh api graphql --input su.json')
  expect(String((missing as { deny?: string }).deny)).toContain('could not read the body file')
})

test('a credit line in the script that writes the body file is still refused', { options: { mode: 'enforce' } }, async (
  $,
  on,
) => {
  world(on)
  const result = await bash($, SCRIPT_THEN_API.replace('import json', `import json\n# ${AI_TRAILER}`))
  expect(String((result as { deny?: string }).deny)).toContain('BLOCKED (guards)')
})

// Only script code in the command marks a later body file: its text is under the credit check.
// A script file on disk, a flag that is not inline code for that interpreter, or one that belongs to the script.
const NOT_INLINE = [
  'python gen.py',
  'python --version',
  'node build.js',
  'python -E gen.py',
  'ruby -c gen.rb',
  'node -c gen.js',
  'python gen.py -c cfg.ini',
  // Code the shell builds at run time: from a file on disk, or from the environment.
  'python -c "$(cat gen.py)"',
  'python -c "$CODE"',
  'python -c',
]
// A here-doc fed to a script on disk is its data, not its code; an unquoted one may pull its code in.
const HEREDOCS: Record<string, string> = { "python gen.py <<'EOF'": 'data', 'python - <<EOF': '$(cat gen.py)' }
for (const before of [...NOT_INLINE, ...Object.keys(HEREDOCS)]) {
  test(`after "${before}" a missing body file is still refused`, { options: { mode: 'enforce' } }, async ($, on) => {
    world(on)
    const body = HEREDOCS[before]
    const tail = body === undefined ? '' : `\n${body}\nEOF`
    const result = await bash($, `${before} && gh api graphql --input su.json${tail}`)
    expect(String((result as { deny?: string }).deny)).toContain('could not read the body file')
  })
}

test('inline script code (-c, -e) marks a later body file too', { options: { mode: 'enforce' } }, async ($, on) => {
  const seen = world(on)
  const inline = [`python -c "open('su.json','w').write('x')"`, `node -e "require('fs').writeFileSync('su.json','x')"`]
  for (const before of inline) {
    const result = await bash($, `${before} && gh api graphql --input su.json`)
    expect((result as { deny?: string }).deny).toBeUndefined()
  }
  expect(seen.ran).toHaveLength(2)
})
