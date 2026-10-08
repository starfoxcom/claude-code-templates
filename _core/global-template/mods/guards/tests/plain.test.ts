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
    // The commit-message form inside a single-quoted string opens no here-doc: the lines after it are code.
    "echo 'x \"$(cat <<'EOF'\n'; HUSKY=0 npm x; echo '\nEOF\n)\"'; git commit -m 'fix: y'",
    // A quoted or split program word may be git, and the hook files around it are then judged too.
    "echo 'exit 0' > '.git/hooks/commit-msg'; 'git' commit -m 'fix: x'",
    "rm '.git/hooks/commit-msg'; 'git' commit -m 'fix: x'",
    "rm .git/hooks/commit-msg; g''it commit -m 'fix: x'",
    // A cd into a hooks or git folder, then a plain redirect there.
    "cd .git/hooks && echo 'exit 0' > commit-msg; cd ../..; git commit -m 'fix: x'",
    "pushd .husky && echo 'exit 0' > commit-msg; popd; git commit -m 'fix: x'",
    "cd .git; echo '[core]' >> config; cd ..; git commit -m 'fix: x'",
    // git's own config files and the hook managers' configs.
    "echo '[core]' >> ~/.gitconfig && git commit -m 'fix: x'",
    "echo '[core]' > ~/.config/git/config; git commit -m 'fix: x'",
    "echo 'commit-msg:' > lefthook-local.yml; git commit -m 'fix: x'",
    "echo 'repos: []' > .pre-commit-config.yaml; git commit -m 'fix: x'",
    "echo 'hooksPath = /dev/null' >> ~/.gitconfig",
    // A program name Bash builds from a brace expansion or a glob.
    "{gi,commi}t -n -m 'x'",
    "/usr/bin/g[i]t commit -n -m 'x'",
    "/mingw64/bin/g?t commit -n -m 'x'",
    // Launchers that run their quoted argument as shell text.
    "flock /tmp/l -c 'git commit --no-verify -m x'",
    "watch 'git commit --no-verify -m x'",
    "parallel 'git commit --no-verify -m x' ::: 1",
    "script -c 'git commit --no-verify -m x' /dev/null",
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
    // Windows PowerShell reads curly quotes as quote marks: the text after one is code.
    "git commit -m 'fix: x’ --no-verify ‘'",
    "echo 'x’; git commit --no-verify -m y; ‘'",
    "Remove-Item '.git\\hooks\\commit-msg'; & 'git' commit -m 'fix: x'",
    "cd .git/hooks; 'exit 0' > commit-msg; cd ..\\..; git commit -m 'fix: x'",
    'git push origin x && gh pr create --title t --body-file b.md',
    "& (gcm g?t) commit -n -m 'x'",
    ". (Get-Command g*t) commit -n -m 'x'",
  ]) {
    expect([command, refused(command, true)]).toEqual([command, expect.stringContaining('not plain')])
  }
})

test('the refusal names what is not plain', () => {
  expect(refused('M=x; git commit -m "$M"')).toContain('Not plain here: `$` inside double quotes.')
  expect(refused('npm test && git push')).toContain('`npm`, which is not one of the programs a plain command runs')
  expect(refused("git push origin x | sed 's/a/b/'")).toContain('`sed`')
  // The advice works in Windows PowerShell, which has no &&.
  const chained = refused('git push origin x && gh pr create --title t --body-file b.md', true)
  expect(chained).toContain('Windows PowerShell has no && or ||')
  expect(chained).toContain('In PowerShell, run each git or gh call as its own tool call')
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
    // Bash reads curly quotes as plain letters; a .github folder or .gitignore holds no commit gate.
    ['git commit -m "fix: keep the \u201cplain\u201d rule"', false],
    ["cat .github/workflows/tests.yml; echo x >> .gitignore; git commit -m 'fix: x'", false],
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
  for (const command of ['g=gi; ${g}t commit -m x', '$G push', 'V=1 `echo git` push', 'x; "$g" push']) {
    expect([command, refused(command)]).toEqual([command, expect.stringContaining('not plain')])
  }
})
