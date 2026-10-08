import { expect, test } from 'claude-code/testing'

import { inspect } from '../hooks/inspect'
import { namesWrite, notPlain } from '../hooks/plain'

const refused = (command: string, ps = false) => inspect(command, ps).block ?? ''

// Every spelling past rounds of review found a way around a reading with: each is refused before any reading.
test('a command naming a history write that is not plain is refused outright', () => {
  for (const command of [
    'HUSKY=0 git commit -m x',
    'export HUSKY=0; git commit -m x',
    "M='fix: x'; git commit -m \"$M\"",
    'git commit -m "$(echo x)"',
    'git commit -m `echo x`',
    'f() { git commit -m x; }; f',
    'a.b() { git commit -m x; }; HUSKY=0 a.b',
    'for i in 1 2; do git commit -m x; done',
    '(git commit -m x)',
    '{ git commit -m x; }',
    'coproc C { git commit --no-verify -m x; }',
    "trap 'git commit -m x' EXIT",
    "eval 'git commit -m x'",
    "bash -c 'git commit --no-verify -m x'",
    "sh -c 'git push --force'",
    "echo 'git commit --no-verify -m x' | bash",
    'git commit -m x &',
    'xargs git commit -m < m.txt',
    'env git commit -m x',
    'command git commit -m x',
    '\\git commit -m x',
    'git commit -m x # trailing',
    'git commit -m x *',
    '. ./hooks.sh; git push',
    'source ./x.sh && git push',
    "M='fix: x'; declare -n R=M; R=$OUT; git commit -m \"$M\"",
    'git commit -F - <<EOF\n$BODY\nEOF',
    'npm run build && git commit -m x',
    "echo x > .git/hooks/commit-msg; git commit -m 'fix: x'",
    'git -c core.hooksPath=$X commit -m x',
  ]) {
    expect([command, refused(command)]).toEqual([command, expect.stringContaining('not plain')])
  }
})

test('a PowerShell command naming a history write that is not plain is refused outright', () => {
  for (const command of [
    "$m = 'fix: x'; git commit -m $m",
    'git commit -m "$m"',
    "& git commit -m 'x'",
    "iex 'git commit -m x'",
    "git commit -m 'a \"b\" --no-verify'",
    "git commit -m ''",
    'git commit -m x --% --no-verify',
    "if ($?) { git commit -m 'x' }",
    "@('a') | % { git commit -m $_ }",
    "$r = [ref]$m; git commit -m 'x'",
    "Set-Variable -Name $n -Value $out; git commit -m 'x'",
  ]) {
    expect([command, refused(command, true)]).toEqual([command, expect.stringContaining('not plain')])
  }
})

test('the refusal names what is not plain', () => {
  expect(refused('M=x; git commit -m "$M"')).toContain('Not plain here: `$` inside double quotes.')
  expect(refused('npm test && git push')).toContain('`npm`, which is not one of the programs a plain command runs')
  expect(refused("git push origin x | sed 's/a/b/'")).toContain('`sed`')
})

// Plain commands go on to the reading, which judges what they write.
test('a plain command is read as before', () => {
  for (const [command, ps] of [
    ["git add -A && git commit -m 'fix: x' && git push -q origin feature/x 2>&1 | tail -1", false],
    ["cd repo && git -C ../lib fetch && git log --oneline -3 | grep fix", false],
    ["git commit -m \"$(cat <<'EOF'\nfix: x\n\nmore\nEOF\n)\"", false],
    ["cat > /tmp/b.md <<'EOF'\n## What\n- add x\nEOF\ngh pr create --title t --body-file /tmp/b.md", false],
    ['gh pr view 5 --json body --jq .body > c.md; gh pr edit 5 --body-file c.md', false],
    ['gh issue create --title t --body-file "C:\\Users\\me\\b.md"', false],
    ['git push 2>&1 | grep -v "^\\s*$" | tail -8', false],
    ["git commit -m 'fix: x'; git push", true],
    ["'## What' > b.md; gh pr create --title t --body-file b.md", true],
    ["Set-Location C:\\repo; git push -q origin x 2>&1 | Select-Object -Last 2", true],
  ] as const) {
    expect([command, notPlain(command, ps)]).toEqual([command, undefined])
    expect([command, inspect(command, ps).block]).toEqual([command, undefined])
  }
})

test('a write named only in data, or a command that names none, is left to the reading', () => {
  expect(namesWrite("python - <<'EOF'\nprint('git commit')\nEOF")).toBe(false)
  expect(namesWrite("grep -n 'git push' notes.md")).toBe(false)
  expect(namesWrite('ls $HOME')).toBe(false)
  expect(namesWrite("bash -c 'git commit -m x'")).toBe(true)
  expect(namesWrite("git -c alias.ci='commit --no-verify' ci -m x")).toBe(true)
  expect(namesWrite("echo \"<<'X'\"\ngit push --no-verify\nX")).toBe(true)
  for (const command of ['g=gi; ${g}t commit -m x', '$G push', 'V=1 `echo git` push', 'x; "$g" push']) {
    expect([command, refused(command)]).toEqual([command, expect.stringContaining('not plain')])
  }
})
