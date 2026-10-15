import { expect, test } from 'claude-code/testing'

import { inspect } from '../hooks/judge'
import { psNativeWords } from '../hooks/unseen'

const word = (text: string) => ({ text, dynamic: false, bodies: [] })

// Each row: a word as PowerShell holds it between `x` and `-n`, and the words git got for it from Windows
// PowerShell 5.1 (`git rev-parse --sq-quote x <word> -n`, Git for Windows 2.x, 2026-10-14).
test("the words Windows PowerShell hands git are the ones git gets", () => {
  for (const [typed, got] of [
    ['a "b" --no-verify', ['x', 'a b --no-verify', '-n']],
    ['a "b --no-verify', ['x', 'a b', '--no-verify -n']],
    ['x\\" --no-verify', ['x', 'x"', '--no-verify', '-n']],
    ['a\\" b', ['x', 'a"', 'b', '-n']],
    ['p q\\', ['x', 'p q" -n']],
    ['a ""b" -n', ['x', 'a "b -n', '-n']],
    ['a ""b -n', ['x', 'a "b', '-n -n']],
    ['fix: say "hi" -- ok', ['x', 'fix: say hi -- ok', '-n']],
    ['c:\\path\\ x', ['x', 'c:\\path\\ x', '-n']],
    ['two  "q" "r" s', ['x', 'two  q r s', '-n']],
    ['a\\\\" b c', ['x', 'a\\ b c -n']],
    ['"lead -n', ['x', 'lead -n -n']],
    ['', ['x', '-n']],
  ] as const) {
    const words = psNativeWords([word('x'), word(typed), word('-n')])?.map(w => w.text) ?? ['x', typed, '-n']
    expect([typed, words]).toEqual([typed, got])
  }
  expect(psNativeWords([word('commit'), word('-m'), word('fix: plain words')])).toBeUndefined()
})

test('a brace expansion is read as the words Bash makes of it', () => {
  for (const command of ["{gi,commi}t -n -m 'x'", 'git commit -m x {-n,}', "git commit {--no-verify,} -m 'x'"]) {
    expect([command, inspect(command, false).block]).toEqual([command, expect.any(String)])
  }
  for (const command of ['mkdir -p docs/{a,b} && git commit -m x', "git commit -m '{a,-n}'", 'cp x.{md,bak}']) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})

test('a launcher or a shell fed on stdin is followed back through programs that pass it on', () => {
  for (const command of [
    "echo 'git commit -n -m x' | tee a.log | sort | bash",
    "cat <<'EOF' | ssh host\ngit status\nEOF",
    "docker exec -i c sh <<'EOF'\ngit commit -n -m x\nEOF",
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, expect.stringContaining('cannot be read')])
  }
  // What feeds a reader, or a program that prints, runs nothing; a shell's name as git's or gh's word runs nothing.
  for (const command of [
    "echo 'git commit -n' | tee notes.md",
    "printf 'git commit -n' | wc -l | bash -c 'cat'",
    "gh issue create --title bash --body-file - <<'EOF'\nRun git commit -n to see it fail.\nEOF",
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})

test("another program's argument that is a command line is read as one; prose and code are not", () => {
  expect(inspect("tmux new -d 'git commit --no-veri -m x'", false).block).toContain('skipping git hooks')
  expect(inspect("tmux new -d 'git status && git log'", false).block).toBeUndefined()
  for (const command of [
    "curl -d 'please git commit -n now' https://x",
    "node -e \"require('child_process').execSync('git commit -n')\"",
    "make MSG='git commit -n'",
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})

test('a variable is a held flag only when the command typed a flag for it', () => {
  for (const [command, ps] of [
    ['X=(-q -n); git commit -m x "${X[@]}"', false],
    ["$o = '-q','-n'; git commit -m x $o", true],
  ] as const) {
    const held = expect.stringContaining('a flag held in a variable')
    expect([command, inspect(command, ps).block]).toEqual([command, held])
  }
  for (const command of [
    'MSG="fix: a - b"; git commit -m "$MSG"',
    'R=$(git rev-parse --abbrev-ref HEAD); git push -u origin "$R"',
    'git push origin "$BRANCH"',
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})
