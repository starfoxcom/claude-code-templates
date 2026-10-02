import { expect, test } from 'claude-code/testing'

import { inspect } from '../hooks/inspect'
import { checkAddedLines, checkBranch, checkText } from '../hooks/policy'
import { parse } from '../hooks/shell'

// Split so this file never carries a credit line itself.
const AI_TRAILER = 'Co-' + 'Authored-By: Cla' + 'ude <noreply@anthro' + 'pic.com>'
const HUMAN_TRAILER = 'Co-' + 'Authored-By: Jane Doe <12345+jane@users.noreply.github.com>'
const GENERATED = 'Gener' + 'ated with [Cla' + 'ude Code](https://cla' + 'ude.com/claude-code)'
const SESSION = 'https://cla' + 'ude.ai/code/session_' + '01V8SAUxUZBbVPekZUHDL9FZ'
const NAME = 'Cla' + 'ude'

// The first problem in a command's message texts and new branch names, as the mod reads them.
function verdict(command: string, mayName: boolean, powershell = false): string | undefined {
  const plan = inspect(command, powershell)
  if (plan.block) return 'run-watch'
  for (const t of plan.texts) {
    const v = checkText(t.text, mayName)
    if (v) return v.rule
  }
  for (const b of plan.branches) if (checkBranch(b, mayName)) return 'branch'
  return undefined
}

test('AI credit is blocked in every repo, through every message route', () => {
  for (const command of [
    `git commit -m 'docs: x' -m '${AI_TRAILER}'`,
    `git commit -am 'docs: x ${GENERATED}'`,
    `gh pr comment 5 --body '${SESSION}'`,
    `gh pr comment 5 --body 'Done \u{1F916}'`,
    `gh pr create --title t --body-file - <<'EOF'\n## What\n${AI_TRAILER}\nEOF`,
    `git commit -m "$(cat <<'EOF'\nfix(x): y\n\n${AI_TRAILER}\nEOF\n)"`,
    `gh api repos/o/r/issues/1/comments -f body='${GENERATED}'`,
    `gh release create v1 --notes '${GENERATED}'`,
    `git commit -m 'feat: x' -m 'Written with Cursor AI'`,
    `git commit -m "docs: x via ${NAME} Code"`,
  ]) {
    expect(verdict(command, true)).toBe('credit')
  }
  expect(verdict(`$m = @'\n${AI_TRAILER}\n'@; gh pr create --title t --body @'\n${AI_TRAILER}\n'@`, true, true)).toBe('credit')
})

test('a human co-author and plain words pass', () => {
  for (const command of [
    `git commit -m 'docs: x' -m '${HUMAN_TRAILER}'`,
    "git commit -m 'fix(ui): show pointer with cursor on toggle rows'",
    "git commit -m 'feat: add integration with LLM providers'",
    "git commit -m 'docs(rules): clarify what counts as a commit with AI trailers'",
  ]) {
    expect(verdict(command, false)).toBeUndefined()
  }
})

test('the product name: allowed where it is the subject, blocked elsewhere, never in identifiers', () => {
  const mention = `git commit -m 'docs: add guide for using ${NAME} Code'`
  expect(verdict(mention, true)).toBeUndefined()
  expect(verdict(mention, false)).toBe('name')
  for (const command of [
    "git commit -m 'docs: update CLAUDE.md and .claude/rules/git.md'",
    "git commit -m 'fix(ci): pin the claude.yml checkout'",
    "gh pr comment 5 --body '@claude review this PR - re-check on the parser'",
    "gh pr create --title t --body 'See https://github.com/acme/claude-helpers/issues/3'",
    'git add .github/workflows/claude.yml; git commit -q -m "fix(ci): drop admin hints"; git push -q -u origin hotfix/drop-admin-text-claude-yml',
    'cd "C:/Users/a/Repos/claude-helpers" && git commit -q -F "C:/Users/a/AppData/Local/Temp/claude/x/msg.txt"',
  ]) {
    expect(verdict(command, false)).toBeUndefined()
  }
})

test('a new branch name is checked once, when it is created', () => {
  expect(verdict('git switch -c chore/plan-claude-mods', false)).toBe('branch')
  expect(verdict('git checkout -b chore/plan-claude-mods origin/develop', true)).toBeUndefined()
  expect(verdict('git push -u origin chore/plan-claude-mods', false)).toBeUndefined()
  expect(verdict('git branch -D chore/plan-claude-mods', false)).toBeUndefined()
})

test('flags and expansions outside message text never trip it', () => {
  for (const command of [
    'git log -1', 'git merge -q origin/develop', 'git switch -q develop', 'git cherry-pick -n abc123',
    'git tag -n', 'git tag -f v1.0.0', 'gh pr create -f --base develop', 'cd "$TMP" && git status',
    'for n in 1 2; do c=$(gh api search/issues -q .total_count); echo $c; done',
    "gh api graphql -f query='query($owner: String!) { repository(owner: $owner) { id } }' -F owner=o",
    'gh run list --branch x --json status --jq ".[0].status"',
    'grep -rn "gh run watch" .claude/rules',
    "node -e \"console.log('gh run watch is banned')\"",
  ]) {
    expect(verdict(command, false)).toBeUndefined()
  }
  expect(verdict('gh run watch 123 --exit-status', false)).toBe('run-watch')
  expect(verdict('cd repo && gh run watch', false)).toBe('run-watch')
})

test('body files are found in every spelling, and text built at run time is named as unread', () => {
  const files = (c: string) => inspect(c, false).files.map(f => f.path)
  expect(files('gh pr create --title t --body-file "C:/tmp/b.md"')).toEqual(['C:/tmp/b.md'])
  expect(files('gh pr create --title t --body-file=/tmp/b.md')).toEqual(['/tmp/b.md'])
  expect(files('git commit -F"/tmp/m.txt"')).toEqual(['/tmp/m.txt'])
  expect(files("git commit --template='/tmp/t.txt'")).toEqual(['/tmp/t.txt'])
  expect(files('gh api repos/o/r/issues/5/comments -F body=@/tmp/c.md')).toEqual(['/tmp/c.md'])
  expect(files('git commit -m "$(cat /tmp/m.txt)"')).toEqual(['/tmp/m.txt'])
  expect(files('gh api repos/o/r/issues/5/comments -F body=@-')).toEqual([])
  expect(files("gh issue create --template 'Bug report'")).toEqual([])
  expect(inspect('git commit -m "$MSG"', false).unread).toEqual(['the commit message'])
  expect(inspect(`git commit -m "$(cat <<'EOF'\nfix: x\nEOF\n)"`, false).unread).toEqual([])
  const written = inspect("cat > /tmp/b.md <<'EOF'\nbody\nEOF\ngh pr create --title t --body-file /tmp/b.md", false)
  expect(written.written).toEqual(['/tmp/b.md'])
})

test('a commit checks the lines it adds for credit lines, not quoted rules', () => {
  const diff = (line: string) => `+++ b/src/a.ts\n@@ -0,0 +1 @@\n+${line}\n`
  expect(checkAddedLines(diff(`// ${GENERATED}`))?.file).toBe('src/a.ts')
  expect(checkAddedLines(diff(AI_TRAILER))).toBeDefined()
  expect(checkAddedLines(diff(`- \`${AI_TRAILER}\` (or any AI email)`))).toBeUndefined()
  expect(checkAddedLines(diff(`const AI_TRAILER = 'Co-' + 'Authored-By: x'`))).toBeUndefined()
  expect(inspect("git commit -am 'x'", false).diff).toBe('all')
  expect(inspect("git commit -m 'x'", false).diff).toBe('cached')
})

test('the shell reading keeps quoted separators and here-docs in their statement', () => {
  const sts = parse(`git commit -m "a; b && c" && gh pr create --body-file - <<'EOF'\nx | y\nEOF`, false)
  expect(sts.map(s => s.words[0]?.text)).toEqual(['git', 'gh'])
  expect(sts[0]?.words[3]?.text).toBe('a; b && c')
  expect(sts[1]?.heredocs).toEqual(['x | y'])
  expect(parse('& "C:\\Program Files\\Git\\bin\\git.exe" status', true)[0]?.words[0]?.text).toBe('C:\\Program Files\\Git\\bin\\git.exe')
})

test('Bash keeps backslashes inside double quotes unless they escape $ ` " \\ or a newline', () => {
  // Found in the shadow logs: Windows body-file paths in double quotes lost every backslash.
  const files = (c: string) => inspect(c, false).files.map(f => f.path)
  expect(files('gh pr create --title t --body-file "C:\\a\\b.md"')).toEqual(['C:\\a\\b.md'])
  expect(files('gh api graphql -F body=@"C:\\Temp\\s.md"')).toEqual(['C:\\Temp\\s.md'])
  const word = (c: string) => parse(c, false)[0]?.words[1]?.text
  expect(word('echo "a\\$b \\"q\\" c\\\\d e\\`f"')).toBe('a$b "q" c\\d e`f')
  expect(word('echo "one\\\ntwo"')).toBe('onetwo')
  expect(word('echo "a\\nb"')).toBe('a\\nb')
})
