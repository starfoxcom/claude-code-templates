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
    const v = checkText(t.text, mayName || Boolean(t.creditOnly))
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
  // Still the name: between punctuation, with separators inside it, or in a snake_case word.
  for (const command of [
    `git commit -m 'docs: thanks, ${NAME}!'`,
    `git commit -m 'docs: ask ${NAME.slice(0, 3)}-${NAME.slice(3)} first'`,
    `git commit -m 'feat: add the ${NAME.toLowerCase()}_helper module'`,
  ]) {
    expect(verdict(command, false)).toBe('name')
  }
  for (const command of [
    "git commit -m 'docs: update CLAUDE.md and .claude/rules/git.md'",
    "git commit -m 'fix(ci): pin the claude.yml checkout'",
    "gh pr comment 5 --body '@claude review this PR - re-check on the parser'",
    "gh pr create --title t --body 'See https://github.com/acme/claude-helpers/issues/3'",
    'git add .github/workflows/claude.yml; git commit -q -m "fix(ci): drop admin hints"; git push -q -u origin hotfix/drop-admin-text-claude-yml',
    'cd "C:/Users/a/Repos/claude-helpers" && git commit -q -F "C:/Users/a/AppData/Local/Temp/claude/x/msg.txt"',
    // The name is a whole word only, never part of a longer word or spread across spaces or lines.
    "git commit -m 'docs: thank the philanthropic and misanthropic reviewers'",
    "git commit -m 'docs: the critic lauded the change'",
    "git commit -m 'docs: quote the spec' -m 'spec\nlauded by the team'",
    "git commit -m 'docs: credit Marc Laude for the parser'",
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

test('a quoted value that starts with < or > is text, not a redirect', () => {
  for (const command of [
    `gh pr comment 5 --body "<details><summary>Logs</summary>${GENERATED}</details>"`,
    `gh pr comment 5 --body "> quoted ${GENERATED}"`,
    `gh pr comment 5 --body '<!-- note --> ${GENERATED}'`,
    `git commit -m "<scope>: x ${GENERATED}"`,
    `gh pr create --title "<WIP> x" --body "${GENERATED}"`,
  ]) {
    expect(verdict(command, true)).toBe('credit')
  }
  // Unquoted redirects keep working, a quoted target included.
  const written = inspect(`cat >"/tmp/b.md" <<'EOF'\nbody\nEOF\ngh pr create --title t --body-file /tmp/b.md`, false)
  expect(written.written).toEqual(['/tmp/b.md'])
  expect(inspect('git commit -F - < "/tmp/m.txt"', false).files.map(f => f.path)).toEqual(['/tmp/m.txt'])
})

test('cmd with the command as one quoted word, and a message flag left without its value, are read or named', () => {
  for (const command of [`cmd /c "git commit -m \\"${AI_TRAILER}\\""`, `cmd //c "git commit -m '${AI_TRAILER}'"`]) {
    expect(verdict(command, true)).toBe('credit')
  }
  expect(verdict(`cmd /c "git commit -m '${AI_TRAILER}'"`, true, true)).toBe('credit')
  expect(inspect(`git commit -F <(printf 'fix: x')`, false).unread).toEqual(['the commit message'])
  expect(inspect(`gh pr create --title t --body-file >(cat)`, false).unread).toEqual(['the PR text'])
  expect(inspect('git commit -m', false).unread).toEqual(['the commit message'])
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

test('review, merge and close flags that are switches never swallow the body', () => {
  const body = `fix: x\n\n${AI_TRAILER}`
  const texts = (c: string) => inspect(c, false).texts.map(t => t.text)
  for (const command of [
    `gh pr review 5 -a -b '${body}'`,
    `gh pr review 5 -r -b '${body}'`,
    `gh pr review 5 -c -b '${body}'`,
    `gh pr review 5 --comment -b '${body}'`,
    `gh pr merge 5 -m -b '${body}'`,
    `gh pr merge 5 -r -d -b '${body}'`,
    `gh pr merge 5 --merge --match-head-commit abc123 -t '${body}'`,
  ]) {
    expect(texts(command)).toContain(body)
    expect(verdict(command, true)).toBeDefined()
  }
  expect(texts(`gh issue close 5 -r completed -c '${body}'`)).toContain(body)
  expect(texts(`gh pr close 5 -d -c '${body}'`)).toContain(body)
})

test('git and gh behind a shell keyword, a wrapper, a subshell or another shell are read', () => {
  for (const command of [
    `if true; then git commit -m 'fix: x' -m '${AI_TRAILER}'; fi`,
    `if git diff --quiet; then :; else git commit -am '${AI_TRAILER}'; fi`,
    `if gh pr comment 5 -b '${GENERATED}'; then echo ok; fi`,
    `for n in 1 2; do gh pr comment $n -b '${GENERATED}'; done`,
    `while read n; do gh pr comment "$n" --body '${GENERATED}'; done < prs.txt`,
    `{ git commit -m '${AI_TRAILER}'; }`,
    `(git commit -m '${AI_TRAILER}')`,
    `cd repo && (git add -A && git commit -m '${AI_TRAILER}')`,
    `! git commit -m '${AI_TRAILER}'`,
    `time git commit -m '${AI_TRAILER}'`,
    `sudo -u bob git commit -m '${AI_TRAILER}'`,
    `env GIT_AUTHOR_NAME=x git commit -m '${AI_TRAILER}'`,
    `GIT_EDITOR=true command git commit -m '${AI_TRAILER}'`,
    `nohup gh pr comment 5 -b '${GENERATED}'`,
    `timeout 60 gh pr comment 5 -b '${GENERATED}'`,
    `echo 5 | xargs -I{} gh pr comment {} -b '${GENERATED}'`,
    `PR=$(gh pr create --title t --body '${GENERATED}')`,
    `echo "opened $(gh pr create --title t --body '${GENERATED}')"`,
    `bash -c "git commit -m '${AI_TRAILER}'"`,
    `powershell -Command "git commit -m '${AI_TRAILER}'"`,
    `cmd /c git commit -m "${AI_TRAILER}"`,
  ]) {
    expect(verdict(command, true)).toBe('credit')
  }
  for (const command of [
    `foreach ($n in 1..2) { gh pr comment $n -b '${GENERATED}' }`,
    `if ($ok) { git commit -m '${AI_TRAILER}' }`,
    `1..2 | ForEach-Object { gh pr comment $_ --body '${GENERATED}' }`,
  ]) {
    expect(verdict(command, true, true)).toBe('credit')
  }
  expect(inspect('command -v git', false).isWrite).toBe(false)
  expect(inspect('if git diff --quiet; then echo clean; fi', false).isWrite).toBe(false)
})

test('a global repo flag before the gh subcommand is skipped with its value', () => {
  for (const command of [
    `gh -R o/r pr comment 5 -b '${GENERATED}'`,
    `gh --repo o/r pr comment 5 --body '${GENERATED}'`,
    `gh --repo=o/r issue create -t t -b '${GENERATED}'`,
    `gh pr -R o/r comment 5 -b '${GENERATED}'`,
  ]) {
    expect(verdict(command, true)).toBe('credit')
  }
  expect(inspect('gh -R o/r pr comment 5 -b x', false).repo).toBe('r')
  expect(inspect('gh -R o/r pr view 5', false).isWrite).toBe(false)
})

test('gh api reads its method in every spelling and a here-doc fed to --input', () => {
  const doc = `<<'EOF'\n{"body":"${GENERATED}"}\nEOF`
  for (const command of [
    `gh api -XPOST repos/o/r/issues/1/comments --input - ${doc}`,
    `gh api --method=POST repos/o/r/issues/1/comments --input - ${doc}`,
    `gh api -X PATCH repos/o/r/issues/comments/9 --input - ${doc}`,
    `gh api repos/o/r/issues/1/comments --input - ${doc}`,
  ]) {
    expect(verdict(command, true)).toBe('credit')
  }
  expect(inspect('gh api -X GET search/issues -f q=is:open', false).isWrite).toBe(false)
  expect(inspect('gh api repos/o/r/pulls/5', false).isWrite).toBe(false)
})

test('text piped in, set in a variable, or written to a file earlier in the command is read', () => {
  for (const command of [
    `echo '{"body":"${GENERATED}"}' | gh api repos/o/r/issues -X POST --input -`,
    `printf 'fix: x\\n\\n${AI_TRAILER}\\n' | git commit -F -`,
    `echo '${GENERATED}' | gh pr comment 5 -F -`,
    `cat <<'EOF' | gh pr comment 5 --body-file -\n${GENERATED}\nEOF`,
    `cat > /tmp/b.md <<'EOF'\n${AI_TRAILER}\nEOF\ngh pr create --title t --body-file /tmp/b.md`,
    `echo '${GENERATED}' > b.md && gh pr comment 5 --body-file ./b.md`,
    `MSG='${AI_TRAILER}'; git commit -m "fix: x" -m "$MSG"`,
    `export BODY='${GENERATED}'\ngh pr comment 5 --body "\${BODY}"`,
    `read -r -d '' BODY <<'EOF'\n${GENERATED}\nEOF\ngh pr create --title t --body "$BODY"`,
    `git commit -m "$(printf '%s\\n' 'fix: x' '${AI_TRAILER}')"`,
    `git commit -m "$(echo '${AI_TRAILER}')"`,
  ]) {
    expect(verdict(command, true)).toBe('credit')
  }
  for (const command of [
    `'${GENERATED}' | gh pr comment 5 -F -`,
    `$b = '${GENERATED}'; gh pr comment 5 --body $b`,
    `$p = @{ title = 't'; body = '${GENERATED}' }; gh pr create @p`,
  ]) {
    expect(verdict(command, true, true)).toBe('credit')
  }
  const plan = (c: string, ps = false) => inspect(c, ps)
  expect(plan('git commit -F - < /tmp/m.txt').files.map(f => f.path)).toEqual(['/tmp/m.txt'])
  expect(plan('cat /tmp/b.md | gh pr create --title t --body-file -').files.map(f => f.path)).toEqual(['/tmp/b.md'])
  expect(plan('F=/tmp/b.md; gh pr create --title t --body-file "$F"').files.map(f => f.path)).toEqual(['/tmp/b.md'])
  const fed = plan("cat > /tmp/b.md <<'EOF'\nbody\nEOF\ngh pr create --title t --body-file /tmp/b.md").files
  expect(fed).toEqual([{ where: 'the PR text', path: '/tmp/b.md', written: true }])
  // A message made by something the reading cannot follow is named, never dropped.
  expect(plan('git log -1 --format=%B | git commit -F -').unread).toEqual(['the commit message'])
  expect(plan('git commit -F -').unread).toEqual(['the commit message'])
  expect(plan('gh pr view 5 --json body --jq .body > b.md; gh pr edit 5 --body-file b.md').unread).toEqual([
    'the PR edit (file b.md)',
  ])
  expect(plan(`$p = @{ title = 't' }; gh pr create @p`, true).unread).toEqual(['the PR text'])
  expect(plan('bash -c "git commit -m \\"$MSG\\""').unread).toContain('a bash script built at run time')
  expect(plan('MSG=fixed; git commit -m "$MSG"').unread).toEqual([])
})
