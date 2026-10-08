import { expect, test } from 'claude-code/testing'

import { inspect } from '../hooks/inspect'

// How the reading follows a PowerShell assignment in every spelling, and the environment a command sets.

// A PowerShell variable set from a command: the command runs, and is read like any other.
test('a PowerShell assignment of a command reads the command', () => {
  for (const command of [
    '$r = git commit --no-verify -m x',
    '$r += git commit --no-verify -m x',
    '[string]$r = git commit --no-verify -m x',
    '$r = . git commit --no-verify -m x',
  ]) {
    expect([command, inspect(command, true).block]).toEqual([command, expect.stringContaining('skipping git hooks')])
  }
  expect(inspect('$out = git commit -m $outside', true).unread).toContain('the commit message')
  expect(inspect('$r = gh pr create -t t --body-file b.md', true).files.map(f => f.path)).toEqual(['b.md'])
})

// The variable: drive, a typed assignment and -OutVariable all change a variable: its value is unknown after.
test('every PowerShell spelling that sets a variable leaves it unknown', () => {
  for (const command of [
    "$m = 'ok'; Set-Item variable:m $outside; git commit -m $m",
    "$m = 'ok'; New-Item variable:m -Value $outside -Force; git commit -m $m",
    "$m = 'ok'; Set-Content variable:m $outside; git commit -m $m",
    "$m = 'ok'; $variable:m = $outside; git commit -m $m",
    "$m = 'ok'; ${variable:m} = $outside; git commit -m $m",
    "$m = 'ok'; Write-Output $outside -ov m; git commit -m $m",
    "$m = 'ok'; [string]$m = $outside; git commit -m $m",
  ]) {
    expect([command, inspect(command, true).unread]).toEqual([command, expect.arrayContaining(['the commit message'])])
  }
  expect(inspect('Set-Content env:LEFTHOOK 0; git commit -m x', true).block).toContain('lefthook')
})

// .NET takes the value as typed: a quoted literal or a number is known, so lefthook on passes and off is refused.
test('a literal .NET environment value is read as typed', () => {
  expect(inspect("[Environment]::SetEnvironmentVariable('LEFTHOOK', '1'); git commit -m x", true).block).toBeUndefined()
  expect(inspect("[Environment]::SetEnvironmentVariable('LEFTHOOK', '0'); git commit -m x", true).block).toContain(
    'lefthook',
  )
})

// An env name built at run time may be any, so it unreads the git and gh calls after it, and nothing else.
test('an environment variable named at run time unreads only later git and gh calls', () => {
  for (const [command, ps] of [
    ['foreach ($k in $cfg.Keys) { Set-Item "env:$k" $cfg[$k] }; npm test', true],
    ['[Environment]::SetEnvironmentVariable($n, $v); npm test', true],
    ['export "$k=$v"; npm test', false],
  ] as const) {
    expect([command, inspect(command, ps).unread]).toEqual([command, []])
  }
  const named = 'an environment variable named at run time'
  expect(inspect('Set-Item "env:$k" 0; git commit -m x', true).unread).toContain(named)
  expect(inspect('export "$k=0"; git commit -m x', false).unread).toContain(named)
  // `declare -p`, `-f` and `-F` only print.
  for (const command of ['declare -p "$x"; git status', 'typeset -p "$x"; git status', 'declare -F "$f"; git status']) {
    expect([command, inspect(command, false).unread]).toEqual([command, []])
  }
})

// Every spelling of a PowerShell assignment target: joined or spaced operator, member, index, list, cast.
test('a PowerShell command assigned to any target is read', () => {
  for (const command of [
    '$r=git commit --no-verify -m x',
    '$r= git commit --no-verify -m x',
    '$r =git commit --no-verify -m x',
    '$r+=git commit --no-verify -m x',
    '$p.Body = git commit --no-verify -m x',
    '$a[0] = git commit --no-verify -m x',
    '$a, $b = git commit --no-verify -m x',
    '[string] $r = git commit --no-verify -m x',
    '[System.Collections.Generic.List[string]]$r = git commit --no-verify -m x',
    '[ValidateNotNull()][string]$r = git commit --no-verify -m x',
    '[System.Collections.Generic.Dictionary[string,int]]$d = git commit --no-verify -m x',
    '${r} = git commit --no-verify -m x',
    '$script:r = git commit --no-verify -m x',
    '$env:R = git commit --no-verify -m x',
    '$a = $r = git commit --no-verify -m x',
  ]) {
    expect([command, inspect(command, true).block]).toEqual([command, expect.stringContaining('skipping git hooks')])
  }
  expect(inspect('$r=git commit -F msg.md', true).files.map(f => f.path)).toEqual(['msg.md'])
  expect(inspect('$env:R = gh pr create -t t --body-file b.md', true).files.map(f => f.path)).toEqual(['b.md'])
  expect(inspect('$r=git commit -m $outside', true).unread).toContain('the commit message')
})

// `$env:X = <command>` is set at run time: lefthook and git's hook settings cannot be read from it.
test('a PowerShell environment variable set from a command is set at run time', () => {
  for (const command of [
    '$env:LEFTHOOK = Write-Output 0; git commit -m x',
    '$env:LEFTHOOK=echo false; git commit -m x',
    "$env:LEFTHOOK = 'a' + 'b'; git commit -m x",
    '$env:LEFTHOOK += 0; git commit -m x',
  ]) {
    expect([command, inspect(command, true).block]).toEqual([command, expect.stringContaining('lefthook')])
  }
  const config = `$env:GIT_CONFIG_PARAMETERS = echo "'core.hooksPath=/dev/null'"; git commit -m x`
  expect(inspect(config, true).block).toContain('skipping git hooks')
  // A literal value is read as typed; $null removes it, which leaves lefthook on.
  for (const command of ["$env:LEFTHOOK='1'; git commit -m x", '$env:LEFTHOOK = $null; git commit -m x']) {
    expect([command, inspect(command, true).block]).toEqual([command, undefined])
  }
  expect(inspect("$env:LEFTHOOK='0'; git commit -m x", true).block).toContain('lefthook')
})

// A reassignment in any spelling leaves the variable unknown: git gets the new value, not the old text.
test('a PowerShell reassignment the reading cannot know leaves the variable unknown', () => {
  for (const change of [
    '$m =$outside',
    '$m= $outside',
    '$m=$outside',
    '[string] $m = $outside',
    '$a, $m = $outside',
    '[System.Collections.Generic.List[string]]$m = $outside',
    '$m=Get-Clipboard',
    '$m=hostname',
    'Set-Location sub -PassThru -OutVariable m',
    'Invoke-Expression $c -OutVariable m',
    '$a = $m = $outside',
    '$a=$m=$outside',
  ]) {
    const command = `$m = 'fix: x'; ${change}; git commit -m $m`
    expect([command, inspect(command, true).unread]).toEqual([command, expect.arrayContaining(['the commit message'])])
  }
  expect(inspect('$a=Get-Clipboard; git push origin main $a', true).unread).toContain('a word built at run time')
})

// Plain values keep their reading: a joined string, a list beside it, a splat, a here-string.
test('PowerShell plain values keep their reading in every spelling', () => {
  expect(inspect("$m='fix: x'; git commit -m $m", true).texts.map(t => t.text)).toContain('fix: x')
  expect(inspect("$m='x'; git commit -m $m", true).unread).toEqual([])
  const list = "$docs = 'fix: x'; $labels = 'bug', 'docs'; git commit -m $docs"
  expect(inspect(list, true).unread).toEqual([])
  expect(inspect(list, true).texts.map(t => t.text)).toContain('fix: x')
  // gh gets a splat as `-key:value` words: it stays unread, entry by entry as before.
  expect(inspect("$p = @{ Title = 't'; Body = 'b' }; gh pr create @p", true).unread).toEqual(['the PR text'])
  expect(inspect("$m = 'a' + 'b'; git commit -m $m", true).unread).toContain('the commit message')
  // A member, an index or a .NET property set is no message and no refusal.
  for (const command of [
    "$PSDefaultParameterValues['*:Encoding'] = 'utf8'; git commit -m 'fix: x'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; git commit -m 'fix: x'",
    "$p = [ordered]@{ a = 1 }; git commit -m 'fix: x'",
  ]) {
    expect([command, inspect(command, true).unread, inspect(command, true).block]).toEqual([command, [], undefined])
  }
  // A comparison or a bracketed `=` is no assignment.
  expect(inspect('[Parameter(Mandatory=$true)]$x = 1; git status', true).unread).toEqual([])
})

// A cast in front of parens or a hashtable (`[void](...)`, `[ordered]@{...}`) still opens it: what runs
// inside is read, and the hashtable's `}` closes no block around it.
test('a PowerShell cast in front of parens or a hashtable still opens it', () => {
  for (const command of [
    '[void](git commit --no-verify -m x)',
    '[string](git commit --no-verify -m x)',
    '[System.Collections.Generic.List[string]](git commit --no-verify -m x)',
  ]) {
    expect([command, inspect(command, true).block]).toEqual([command, expect.stringContaining('skipping git hooks')])
  }
  expect(inspect('[void](Set-Item env:LEFTHOOK 0); git commit -m x', true).block).toContain('lefthook')
  expect(inspect('[void](git commit -m $outside)', true).unread).toContain('the commit message')
  expect(inspect('[void](git commit -F msg.md)', true).files.map(f => f.path)).toEqual(['msg.md'])
  const scoped = "if ($ok) { $p = [ordered]@{ a = 1 }; $m = 'fix: x' }; git commit -m $m"
  expect(inspect(scoped, true).unread).toContain('the commit message')
})

// The .NET call that sets the environment, behind a cast or a discarded result, is still read.
test('a .NET environment call behind a cast or a discarded result is read', () => {
  for (const command of [
    "[void][Environment]::SetEnvironmentVariable('LEFTHOOK', '0'); git commit -m x",
    "$null = [Environment]::SetEnvironmentVariable('LEFTHOOK', '0'); git commit -m x",
    "$null = [void][System.Environment]::SetEnvironmentVariable('LEFTHOOK', '0', 'Process'); git commit -m x",
    "[Environment]::SetEnvironmentVariable('LEFTHOOK', '0') | Out-Null; git commit -m x",
  ]) {
    expect([command, inspect(command, true).block]).toEqual([command, expect.stringContaining('lefthook')])
  }
  const named = 'an environment variable named at run time'
  for (const command of [
    '[void][Environment]::SetEnvironmentVariable($n, $v); git commit -m x',
    '$null = [Environment]::SetEnvironmentVariable($n, $v); git commit -m x',
  ]) {
    expect([command, inspect(command, true).unread]).toEqual([command, expect.arrayContaining([named])])
  }
})

// PowerShell's file writers, .NET included, name the body file they may rewrite.
test('a PowerShell or .NET write names the body file it may rewrite', () => {
  for (const before of [
    "Set-Content b.md 'x'",
    "'x' | Out-File b.md",
    "[IO.File]::WriteAllText('b.md', 'x')",
    "Copy-Item other.md b.md",
  ]) {
    const files = inspect(`${before}; gh pr create -t t --body-file b.md`, true).files
    expect([before, files.map(f => f.named)]).toEqual([before, [true]])
  }
  expect(inspect('Get-Content b.md; gh pr create -t t --body-file b.md', true).files.map(f => f.named)).toEqual([
    undefined,
  ])
})

// Every spelling of a write the review found: gh's writing groups, git's output files, a colon-bound
// PowerShell parameter, a .NET call behind `$null =`, and a destination built at run time.
test('every write spelling names the body file it may rewrite', () => {
  const named = (before: string, ps: boolean) =>
    inspect(`${before}\ngh pr create -t t --body-file b.md`, ps).files.map(f => f.named)
  for (const [before, ps] of [
    ['gh release download v1 -p b.md --clobber', false],
    ['gh run download 5 -n art', false],
    ['gh codespace cp remote:/x/b.md b.md', false],
    ['git log -1 --format=%B --output=b.md', false],
    ['git --no-pager diff --output=b.md', false],
    ["Set-Content -Path:b.md 'x'", true],
    ['Copy-Item o.md -Destination:b.md', true],
    ["$null = [IO.File]::WriteAllText('b.md', 'x')", true],
    ['cp other.md "$F"', false],
    ["cat > b.md <<'EOF'\nclean\nEOF\ncp other.md b.md", false],
    // In any order, and in code that may run later: a function, a program fed its names by xargs.
    ["cp other.md b.md\ncat > b.md <<'EOF'\nclean\nEOF", false],
    ['npm run build', false],
    ['f() { cp x b.md; }', false],
    ['echo b.md | xargs cp other.md', false],
    ['git pull', false],
  ] as const) {
    expect([before, named(before, ps)]).toEqual([before, [true]])
  }
  for (const [before, ps] of [
    ['gh pr create -F b.md', false],
    ['cd sub; git add b.md', false],
    ['git log -1 --format=%B', false],
    ['for f in $files; do echo $f; done', false],
  ] as const) {
    expect([before, named(before, ps).at(-1)]).toEqual([before, undefined])
  }
})

// The last ways a program could run unseen: an eval of unknown text, a method call, a checkout, `env -S`,
// options that run a program. And `-o` that is no output file.
test('every hidden program run makes the body file rewritable', () => {
  const named = (before: string, ps: boolean) =>
    inspect(`${before}\ngh pr create -t t --body-file b.md`, ps).files.map(f => f.named).at(-1)
  for (const [before, ps] of [
    ["cat > b.md <<'EOF'\nclean\nEOF\neval \"$CMD\"", false],
    ['Invoke-Expression $cmd', true],
    ["$null = $xml.Save('b.md')", true],
    ['gh pr checkout 12', false],
    ['gh issue develop 7 --checkout', false],
    ['gh pr merge 5 --merge --delete-branch', false],
    ["env -S 'cp other.md b.md'", false],
    ['rg --pre ./x foo', false],
    ['git fetch --upload-pack=./x origin', false],
    ['git push --receive-pack=./x origin main', false],
  ] as const) {
    expect([before, named(before, ps)]).toEqual([before, true])
  }
  for (const [before, ps] of [
    ['git push -o ci.skip origin main', false],
    ['git commit -o f.ts -m x', false],
    ['git merge-base HEAD origin/develop', false],
    ['gh pr merge 5 --merge', false],
    ['gh pr create -t checkout -F x.md', false],
    ['$t = $s.Trim()', true],
    ["$p = [IO.Path]::Combine($d, 'b.md')", true],
    ['$n = [math]::Max(1, 2)', true],
  ] as const) {
    expect([before, named(before, ps)]).toEqual([before, undefined])
  }
  expect(inspect("$t = $s.Trim(); git commit -m 'fix: x'", true).unread).toEqual([])
})
