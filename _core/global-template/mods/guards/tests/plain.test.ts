import { expect, test } from 'claude-code/testing'

import { inspect } from '../hooks/judge'
import { namesWrite, notPlain } from '../hooks/plain'

const isNoted = (command: string, ps = false) => inspect(command, ps).notes.some(n => n.startsWith('not plain: '))

// Spellings past rounds of review found a way around a reading with. A command that is not plain is read as
// far as the reading goes and noted; a bypass route the reading finds in it is still refused.
test('a bypass route in a command that is not plain is still refused', () => {
  for (const [command, ps] of [
    ['HUSKY=0 git commit -m x', false],
    ['export HUSKY=0; git commit -m x', false],
    ['a.b() { git commit -m x; }; HUSKY=0 a.b', false],
    ['coproc C { git commit --no-verify -m x; }', false],
    ["eval 'git commit -m x'", false],
    ["bash -c 'git commit --no-verify -m x'", false],
    ['git -c core.hooksPath=$X commit -m x', false],
    ["iex 'git commit -m x'", true],
    ['git commit -m x --% --no-verify', true],
    // Windows PowerShell splits an unquoted dash word at its first dot: git gets `--no-verify .`.
    ["git commit -m 'fix: x' --no-verify.", true],
    // Windows PowerShell reads curly quotes as quote marks: the text after one is code.
    ["git commit -m 'fix: x’ --no-verify ‘'", true],
    ["echo 'x’; git commit --no-verify -m y; ‘'", true],
  ] as const) {
    const plan = inspect(command, ps)
    expect([command, plan.block]).toEqual([command, expect.any(String)])
    expect([command, isNoted(command, ps)]).toEqual([command, true])
  }
})

test('a message built at run time in a command that is not plain is named unread', () => {
  for (const [command, ps] of [
    ['git commit -m "$(echo x)"', false],
    ['git commit -m `echo x`', false],
    ['xargs git commit -m < m.txt', false],
    ["M='fix: x'; declare -n R=M; R=$OUT; git commit -m \"$M\"", false],
    ['git commit -F - <<EOF\n$BODY\nEOF', false],
    ['git commit -m "$m"', true],
    ["@('a') | % { git commit -m $_ }", true],
  ] as const) {
    expect([command, inspect(command, ps).unread]).toEqual([command, ['the commit message']])
  }
})

// The shipped attribution hook passes these, and the whole command text is still checked for credit.
test('any other command that is not plain is noted and left to the reading', () => {
  for (const [command, ps] of [
    ["M='fix: x'; git commit -m \"$M\"", false],
    ['f() { git commit -m x; }; f', false],
    ['for i in 1 2; do git commit -m x; done', false],
    ['(git commit -m x)', false],
    ['{ git commit -m x; }', false],
    ["trap 'git commit -m x' EXIT", false],
    ["sh -c 'git push --force'", false],
    ['git commit -m x &', false],
    ['env git commit -m x', false],
    ['command git commit -m x', false],
    ['git commit -m x # trailing', false],
    ['. ./hooks.sh; git push', false],
    ['npm run build && git commit -m x', false],
    ["echo '[core]' >> ~/.gitconfig && git commit -m 'fix: x'", false],
    ["echo 'commit-msg:' > lefthook-local.yml; git commit -m 'fix: x'", false],
    ["{gi,commi}t -n -m 'x'", false],
    ["flock /tmp/l -c 'git commit --no-verify -m x'", false],
    ["$m = 'fix: x'; git commit -m $m", true],
    ["& git commit -m 'x'", true],
    ["if ($?) { git commit -m 'x' }", true],
    ["Set-Variable -Name $n -Value $out; git commit -m 'x'", true],
    ['git commit -m "don’t stop"', true],
  ] as const) {
    const plan = inspect(command, ps)
    expect([command, plan.block, plan.unread]).toEqual([command, undefined, []])
    expect([command, isNoted(command, ps)]).toEqual([command, true])
  }
})

test('the note names what is not plain', () => {
  expect(inspect('M=x; git commit -m "$M"', false).notes).toContain('not plain: `$` inside double quotes')
  const npm = inspect('npm test && git push', false).notes.join('\n')
  expect(npm).toContain('`npm`, which is not one of the programs a plain command runs')
  expect(inspect("git push origin x | sed 's/a/b/'", false).notes.join('\n')).toContain('`sed`')
  const chained = inspect('git push origin x && gh pr create --title t --body-file b.md', true).notes
  const noAnd = 'not plain: Windows PowerShell has no && or ||: run each git or gh call as its own tool call'
  expect(chained).toContain(noAnd)
})

// A file a writer copies holds what was written before that writer ran, never what a later one writes.
test('a copied file is read as it stood when it was copied', () => {
  const body = "cat > a.md <<'EOF'\n## What\n- add banned-x\nEOF\n"
  const command = `${body}cat a.md > b.md\necho clean > a.md\ngh pr create -t t -F b.md`
  expect(notPlain(command, false)).toBeUndefined()
  const read = inspect(command, false).texts.filter(t => !t.creditOnly)
  expect(read.map(t => t.text).join('\n')).toContain('banned-x')
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
    // A quoted dash word reaches git as typed.
    ["gh pr create --title t '--body-file=b.md'", true],
    // Bash reads curly quotes as plain letters; a .github folder or .gitignore holds no commit gate.
    ['git commit -m "fix: keep the \u201cplain\u201d rule"', false],
    ["cat .github/workflows/tests.yml; echo x >> .gitignore; git commit -m 'fix: x'", false],
    // A folder that only holds the word is ordinary: `hook` in a name, a `git` folder of repos.
    ['cd ~/src/webhook-relay && git push', false],
    ["cd src/hooks && git commit -m 'fix: x'", false],
    ['cd ~/git/app && git push', false],
    ['cd C:\\git\\app; git push', true],
    ["git commit -m 'fix: x' 2>> logs/hook-debug.log", false],
    ["echo x > .github/notes.md; git commit -m 'fix: x'", false],
  ] as const) {
    expect([command, notPlain(command, ps)]).toEqual([command, undefined])
    expect([command, inspect(command, ps).block]).toEqual([command, undefined])
  }
})

test('a write named only in data, or a command that names none, is left to the reading', () => {
  expect(namesWrite("python - <<'EOF'\nprint('git commit')\nEOF")).toBe(false)
  expect(namesWrite("grep -n 'git push' notes.md")).toBe(false)
  expect(namesWrite('ls $HOME')).toBe(false)
  // A `.git` only read past, and a hook manager run by name, name no write.
  for (const command of [
    "rg --glob '!.git' foo",
    "find . -name '*.ts' -not -path './.git/*'",
    'tar --exclude=.git -czf x.tgz .',
    'pip install git+https://github.com/a/b.git',
    'npx lefthook run pre-commit',
    'HUSKY=0 npm ci',
  ])
    expect([command, namesWrite(command)]).toEqual([command, false])
  expect(namesWrite("bash -c 'git commit -m x'")).toBe(true)
  expect(namesWrite("git -c alias.ci='commit --no-verify' ci -m x")).toBe(true)
  expect(namesWrite("echo \"<<'X'\"\ngit push --no-verify\nX")).toBe(true)
  // A quoted or split program word may be git; quoted data that only starts like a statement is not one.
  for (const command of ["'git' commit -m x", "g''it push", 'g\\it push', "echo x; 'gh' pr merge 5"])
    expect([command, namesWrite(command)]).toEqual([command, true])
  expect(namesWrite("echo 'a; b' | grep a")).toBe(false)
  // In PowerShell a quoted program path is git only when it names git; a backslash is a path's own.
  expect(namesWrite("& 'C:/Program Files/Git/cmd/git.exe' commit -m x", true)).toBe(true)
  expect(namesWrite('& "C:/Program Files/Godot/godot.exe" --headless --path game', true)).toBe(false)
  expect(namesWrite('C:\\tmp\\lv\\run_mem.ps1 -Tag a -GpuIndex 1', true)).toBe(false)
  expect(namesWrite("$env:X = ''; & C:\\tmp\\lv\\run_mem.ps1 -Tag a", true)).toBe(false)
  expect(namesWrite('g`it commit -m x', true)).toBe(true)
  // A program word built at run time is read where the command sets it, and noted where it cannot be.
  expect(inspect('g=gi; ${g}t commit -m x', false).isWrite).toBe(true)
  for (const command of ['$G push', 'V=1 `echo git` push', 'x; "$g" push']) {
    const plan = inspect(command, false)
    const named = expect.arrayContaining(['a program named at run time'])
    expect([command, plan.block, plan.notes]).toEqual([command, undefined, named])
  }
})
