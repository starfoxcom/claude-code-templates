import { expect, test } from 'claude-code/testing'

import { inspect } from '../hooks/inspect'
import { wayOut } from '../hooks/register'

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

// The round's last spellings: a FileInfo.Replace, gh's action past -R and its short flags, variables that
// make git run a program, a script file's own -c, a split cmd line, and a script built at run time.
test('the remaining spellings make the body file rewritable, and searches do not', () => {
  const named = (before: string, ps: boolean) =>
    inspect(`${before}\ngh pr create -t t --body-file b.md`, ps).files.map(f => f.named).at(-1)
  for (const [before, ps] of [
    ["$f = Get-Item other.md; $null = $f.Replace('b.md', $null)", true],
    ["$f = Get-Item other.md; $f.Replace('b.md', $null)", true],
    ['gh pr -R o/r checkout 12', false],
    ['gh pr --repo o/r merge 5 -d', false],
    ['gh issue develop 7 -c', false],
    ['gh pr merge 5 --delete-branch=true', false],
    ['gh pr merge 5 -md', false],
    ["GIT_EXTERNAL_DIFF='sh x.sh' git diff", false],
    ['GIT_SSH_COMMAND=./x git fetch', false],
    ['export GIT_SSH=./x; git fetch', false],
    ["$env:GIT_EXTERNAL_DIFF = 'sh x.sh'; git diff", true],
    ['bash gen.sh -c x', false],
    ['pwsh -File gen.ps1 -Command x', true],
    ["cmd //c type x '&' copy other.md b.md", false],
    ['cmd //c type $F', false],
    ['bash -c "cat $F"', false],
    ["env -vS 'cp other.md b.md'", false],
  ] as const) {
    expect([before, named(before, ps)]).toEqual([before, true])
  }
  for (const [before, ps] of [
    ['git log -S env', false],
    ['rg -S env', false],
    ["git commit -m 'GIT_SSH=x'", false],
    ['gh pr merge 5 --merge', false],
  ] as const) {
    expect([before, named(before, ps)]).toEqual([before, undefined])
  }
})

// A wrapper shell's options that take a value never hide its script; a script file's own -Command is its.
test('a wrapper shell with value options is still read, a PowerShell script file is not', () => {
  for (const command of [
    "bash -o pipefail -c 'git commit --no-verify -m x'",
    "bash -O extglob -c 'git commit --no-verify -m x'",
    "bash +o history -c 'git commit --no-verify -m x'",
    "bash --rcfile f -c 'git commit --no-verify -m x'",
    "bash -o pipefail <<'EOF'\ngit commit --no-verify -m x\nEOF",
    'pwsh -ExecutionPolicy Bypass -Command "git commit --no-verify -m x"',
    'powershell git commit --no-verify -m x',
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, expect.stringContaining('skipping git hooks')])
  }
  const named = (before: string) =>
    inspect(`${before}\ngh pr create -t t --body-file b.md`, false).files.map(f => f.named).at(-1)
  for (const before of [
    'pwsh gen.ps1 -Command x',
    'powershell gen.ps1 -c x',
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.external GIT_CONFIG_VALUE_0='sh x.sh' git diff",
    "GIT_CONFIG_PARAMETERS=\"'diff.external'='sh x.sh'\" git diff",
    'GIT_CONFIG_GLOBAL=cfg git diff',
    "EXT='sh x.sh' git --config-env=diff.external=EXT diff",
    "git -c diff.external='sh x.sh' diff",
    "GH_BROWSER='sh x.sh' gh browse",
    'export "GIT_SSH_COMMAND=sh x.sh"; git fetch',
    'export PATH="$PWD/bin:$PATH"; git status',
  ]) {
    expect([before, named(before)]).toEqual([before, true])
  }
  expect(named("export S=$(mktemp -d)")).toBeUndefined()
})

// Bundled shell options, PowerShell parameter prefixes, an encoded command, and the prefixes that run nothing.
test('bundles and prefixes keep the wrapped script read, and harmless settings refuse nothing', () => {
  for (const [command, ps] of [
    ["bash -euo pipefail -c 'git commit --no-verify -m x'", false],
    ["bash -eo pipefail -c 'git commit --no-verify -m x'", false],
    ["bash -euxo pipefail -c 'git commit --no-verify -m x'", false],
    ["bash -co pipefail 'git commit --no-verify -m x'", false],
    ["bash -euo pipefail <<'EOF'\ngit commit --no-verify -m x\nEOF", false],
    ['powershell -exec bypass -c "git commit --no-verify -m x"', false],
    ['pwsh -exec bypass -c "git commit --no-verify -m x"', false],
    ['pwsh -win hidden -c "git commit --no-verify -m x"', false],
    ['pwsh -comm "git commit --no-verify -m x"', false],
  ] as const) {
    expect([command, inspect(command, ps).block]).toEqual([command, expect.stringContaining('skipping git hooks')])
  }
  const last = (command: string) => inspect(command, false).files.map(f => f.named).at(-1)
  const before = (b: string) => last(`${b}\ngh pr create -t t --body-file b.md`)
  expect(before('powershell -EncodedCommand ZwBpAHQAIABzAHQAYQB0AHUAcwA=')).toBe(true)
  expect(before('pwsh -File gen.ps1')).toBe(true)
  for (const command of [
    'GH_REPO=o/r gh pr create -t t --body-file b.md',
    'GH_TOKEN=$T gh pr create -t t -F b.md',
    'GIT_AUTHOR_DATE=x git commit -F msg.txt',
    'git -C ../repo commit -F msg.txt',
  ]) {
    expect([command, last(command)]).toEqual([command, undefined])
  }
  for (const b of ['git log -c -3', 'git show -c HEAD', 'git branch -c a b', 'rg -n GH_TOKEN= .', 'echo PATH=$PATH']) {
    expect([b, before(b)]).toEqual([b, undefined])
  }
  for (const b of ["git -c diff.external='sh x.sh' diff", 'GIT_DIR=x git status', 'export PATH="$PWD/bin:$PATH"']) {
    expect([b, before(b)]).toEqual([b, true])
  }
})

// A statement of assignments only, a bare export, git's exec path, more pwsh spellings and `bash -s` arguments.
test('assignments alone, exec paths, pwsh spellings and bash -s arguments are read', () => {
  const before = (b: string) =>
    inspect(`${b}\ngh pr create -t t --body-file b.md`, false).files.map(f => f.named).at(-1)
  for (const b of [
    'PATH="$PWD/bin:$PATH"',
    'HOME=/tmp/h',
    "GIT_SSH_COMMAND='sh x.sh'",
    'X=1 PATH=./bin:$PATH',
    "GIT_SSH_COMMAND='sh x.sh'; export GIT_SSH_COMMAND; git fetch",
    'git --exec-path=./bin fetch',
  ]) {
    expect([b, before(b)]).toEqual([b, true])
  }
  for (const command of [
    'pwsh -EncodedArguments X -c "git commit --no-verify -m x"',
    'pwsh -encodeda X -c "git commit --no-verify -m x"',
    'pwsh -cwa "git commit --no-verify -m x"',
    'pwsh --command "git commit --no-verify -m x"',
    "bash -s -- \"$x\" <<'EOF'\ngit commit --no-verify -m x\nEOF",
    "bash -s arg <<'EOF'\ngit commit --no-verify -m x\nEOF",
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, expect.stringContaining('skipping git hooks')])
  }
  for (const command of ['HOME=/tmp/h git commit -m x', 'export XDG_CONFIG_HOME=/tmp/x; git commit -m x']) {
    expect([command, inspect(command, false).unread]).toEqual([command, expect.arrayContaining([expect.anything()])])
  }
})

// Bash names keep their case, a `$` typed in single quotes or escaped is text, the joined `--config-env=` is
// judged, and a new branch at HEAD changes no file.
test('names keep their case in Bash, plain dollars stay text, and a new branch at HEAD writes nothing', () => {
  const read = (command: string, ps = false) => inspect(command, ps)
  const texts = (command: string, ps = false) => read(command, ps).texts.filter(t => !t.creditOnly).map(t => t.text)
  for (const command of ['N="$OUT"; n=\'fix: x\'; git commit -m "$N"', 'git --config-env="$E" commit -m x']) {
    expect([command, read(command).unread]).toEqual([command, expect.arrayContaining([expect.anything()])])
  }
  for (const [command, ps, text] of [
    ["M='fix: x'; m=$(date); git commit -m \"$M\"", false, 'fix: x'],
    ['F=notes.md; git commit -m "docs: document \\$PATH in $F"', false, 'docs: document $PATH in notes.md'],
    ["A='fix: x'; B=y; git commit -m '$A '\"$B\"", false, '$A y'],
    ["A=x; B=y; git commit -m 'a`b '\"$B\"", false, 'a`b y'],
    ["$item='a'; git commit -m \"cost `$5 for $item\"", true, 'cost $5 for a'],
    ["$item='a'; git commit -m \"cost `$item for $item\"", true, 'cost $item for a'],
    ["$M = 'x'; git commit -m $m", true, 'x'],
  ] as const) {
    const seen = [command, read(command, ps).unread, texts(command, ps)]
    expect(seen).toEqual([command, [], expect.arrayContaining([text])])
  }
  const named = (b: string) => read(`${b} && git commit -F msg.md`).files.map(f => f.named).at(-1)
  for (const b of ['git checkout -b feat', 'git checkout -B feat', 'git switch -c feat', 'git switch --create feat']) {
    expect([b, named(b)]).toEqual([b, undefined])
  }
  for (const b of ['git checkout -b f main', 'git checkout f', 'git switch -c f -- x', 'git checkout -b "$B"']) {
    expect([b, named(b)]).toEqual([b, true])
  }
})

// Every kind of unread entry other than a message names a way out of its own.
test('each unread kind has its own way out', () => {
  for (const where of [
    'a word built at run time',
    'a git setting built at run time',
    'an environment variable named at run time',
    'a program named at run time',
    'a bash script built at run time',
    'a pwsh script built at run time',
    'a cmd script built at run time',
    'a git option built at run time',
    'a git subcommand built at run time',
    'a gh subcommand built at run time',
    'a flag value built at run time',
    'the new branch name',
    'the PR text (in a folder unknown before it runs)',
    'the PR text (in a folder unknown before it runs, and another program in this command may write b.md)',
    'the PR text (another program in this command may write b.md)',
    "the PR text (Git Bash's /tmp did not map to a folder the guard reads)",
    'the lines the commit adds (in a folder or repo built at run time)',
  ]) {
    expect([where, wayOut(where)]).toEqual([where, expect.any(String)])
  }
  expect(wayOut('a cmd script built at run time')).toContain('%NAME%')
  expect(wayOut('a bash script built at run time')).toContain('Write the script out')
  expect(wayOut('the commit message')).toBeUndefined()
})

// Plain `$` stay where they were typed through every cut of a word, into scripts, `eval`, paths and written
// files; `$'...'` and `@"..."@` read as their shells read them; a splat is no branch name; and each shell
// keeps its own variables.
test('plain dollars follow every cut, quoting style and shell', () => {
  const read = (command: string, ps = false) => inspect(command, ps)
  const texts = (command: string, ps = false) => read(command, ps).texts.filter(t => !t.creditOnly).map(t => t.text)
  for (const [command, ps] of [
    ['git commit -m\'$ \'"$OUT"', false],
    ['git commit -am\'$ \'"$OUT"', false],
    ['gh api repos/o/r/issues -f body=\'$ 5.0\'"$OUT"', false],
    ["export m='fix: x'; pwsh -Command 'git commit -m \"note $m\"'", false],
    ['git switch -c @a', true],
  ] as const) {
    expect([command, read(command, ps).unread]).toEqual([command, expect.arrayContaining([expect.anything()])])
  }
  for (const [command, ps, text] of [
    ['F=x; git commit -m\'$ \'"$F"', false, '$ x'],
    ['F=notes.md; git commit -m"docs: document \\$PATH in $F"', false, 'docs: document $PATH in notes.md'],
    ['F=notes.md; gh api repos/o/r/issues -f body="document \\$PATH in $F"', false, 'document $PATH in notes.md'],
    ["export M='fix: x'; X=-q; bash -c \"M='other'; git commit -m \\\"\\$M\\\" $X\"", false, 'other'],
    ["export M='fix: x'; X=-q; eval \"M='other'; git commit -m \\\"\\$M\\\" $X\"", false, 'other'],
    ["acme=x; F=y; git commit -m $'acme rocks\\n'\"$F\"", false, 'acme rocks\ny'],
    ["git commit -m $'a\\x41\\101\\u0042\\'\\\\'", false, "aAAB'\\"],
    ['$m = @"\n`$PATH and `$x\n"@; git commit -m $m', true, '$PATH and $x'],
  ] as const) {
    expect([command, read(command, ps).unread, texts(command, ps)]).toEqual([
      command,
      [],
      expect.arrayContaining([text]),
    ])
  }
  expect(texts("export M='fix: x'; X=-q; bash -c \"M='other'; git commit -m \\\"\\$M\\\" $X\"")).not.toContain('fix: x')
  // Left whole for the glob rule, the word keeps its plain `$` where they were typed.
  expect(texts("A='fix: x'; F=y; git commit -m'$A [wip] '$F")).toContain('$A [wip] y')
  // A path typed with a plain `$` names that very file.
  expect(read("x=b; gh api graphql -F query=@'$x.md'").files.map(f => f.path)).toEqual(['$x.md'])
  const written = read("x=b; cat > '$x.md' <<'EOF'\nclean\nEOF\ngh pr create -t t -F b.md").files
  expect(written.map(f => [f.path, f.written])).toEqual([['b.md', undefined]])
  // A PowerShell splat may hand git a start point after the branch name.
  const splat = read("$a = @('feat','HEAD~1'); git checkout -b @a; gh pr create -t t --body-file b.md", true)
  expect([splat.unread, splat.files.map(f => f.named)]).toEqual([['the new branch name'], [true]])
})

// A redirect joined to a target that holds a variable (`>"$F"`, `<$IN`) is read as one, filled in.
test('a redirect joined to a variable target writes or feeds that file', () => {
  const files = (command: string) => inspect(command, false).files.map(f => [f.path, f.written ?? false])
  for (const w of ['cat >"$F" <<\'EOF\'\nx\nEOF', 'echo hi >$F', 'printf x 1>"$F"']) {
    const command = `F=b.md; ${w}\ngh pr create -t t -F b.md`
    expect([command, files(command)]).toEqual([command, [['b.md', true]]])
  }
  expect(files('F=m.txt; git commit -F - <"$F"')).toEqual([['m.txt', false]])
  expect(inspect('git commit -F - <"$IN"', false).unread).toEqual(['the commit message'])
})

// A `{ }` group in a pipeline runs in a subshell; a command naming `IFS` leaves unquoted splits unknown; a
// trap action built at run time is read as an `eval`; a hook manager's off switch with any other value passes.
test('piped groups, IFS, trap actions and hook-manager values are read as the shell runs them', () => {
  const read = (command: string, ps = false) => inspect(command, ps)
  const plain = read('git commit -am x').targets[0]?.folder
  expect(read('{ cd sub; } | cat; git commit -am x').targets[0]?.folder).toEqual(plain)
  expect(read('{ cd sub; } 2>&1 | tail -5; git commit -am x').targets[0]?.folder).toEqual(plain)
  for (const command of [
    '{ M=x; } | cat; git commit -m "$M"',
    'echo | { true; M=x; }; git commit -m "$M"',
    'echo | { read L; M=x; } | cat; git commit -m "$M"',
  ]) {
    expect([command, read(command).unread]).toEqual([command, ['the commit message']])
  }
  // Not piped, the group runs in this shell.
  expect(read("{ M='fix: x'; }; git commit -m \"$M\"").unread).toEqual([])
  const ifs = read("IFS=,; X='--no-verify,'; git commit -m 'fix: x' $X")
  expect([ifs.block, ifs.unread]).not.toEqual([undefined, []])
  // An `EXIT` trap built at run time runs after everything; any other may change what follows.
  const temp = "T=$(mktemp); trap \"rm -f $T\" EXIT; cat > \"$T\" <<'EOF'\nfix: x\nEOF\ngit commit -F \"$T\""
  expect(read(temp).unread).toEqual([])
  expect(read('trap "$X" DEBUG; M=\'fix: x\'; git commit -m "$M"').unread).toEqual(['the commit message'])
  expect(read('trap "git commit --no-verify -m $X" EXIT').block).toContain('a trap action built at run time')
  for (const command of ['HUSKY=1 git commit -m x', 'SKIP= git commit -m x', 'LEFTHOOK=1 git commit -m x']) {
    expect([command, read(command).block]).toEqual([command, undefined])
  }
  // PowerShell: a value written with `>` is no program that may rewrite the body file.
  for (const command of [
    "'## What' > b.md; gh pr create -t t -F b.md",
    "@'\n## What\n- x\n'@ > b.md; gh pr create -t t -F b.md",
    "$body = 'x'; $body > b.md; gh pr create -t t -F b.md",
  ]) {
    expect([command, read(command, true).files.map(f => f.named)]).toEqual([command, [undefined]])
  }
})

// A hook manager's switch counts only where it reaches a git call that runs hooks; `Invoke-Expression` reads
// its `-Command` and its pipe; an `EXIT` trap in a subshell runs before what follows; a deferred statement
// reads a variable set again later as unknown; a name set at run time may be any; `` `make `` is a command.
test('switches reach git calls, iex reads its input, and deferred or run-time names stay unknown', () => {
  const read = (command: string, ps = false) => inspect(command, ps)
  for (const command of [
    'HUSKY=0 npm ci',
    'export HUSKY=0; npm install',
    'SKIP=eslint pre-commit run --all-files',
    'SKIP=1 make test',
    'skip=0; ls',
  ]) {
    expect([command, read(command).block]).toEqual([command, undefined])
  }
  for (const command of [
    'SKIP=x git commit -m y',
    'export HUSKY=0; git commit -m y',
    'LEFTHOOK=0 git push',
    "HUSKY=0 bash -c 'git commit -m y'",
  ]) {
    expect([command, read(command).block]).toEqual([command, expect.stringContaining('git hooks off')])
  }
  for (const command of [
    "Invoke-Expression -Command 'git commit --no-verify -m x'",
    "iex -C 'git commit --no-verify -m x'",
    "iex -Command:'git commit --no-verify -m x'",
    "'git commit --no-verify -m x' | iex",
    "$c = 'git commit --no-verify -m x'; $c | Invoke-Expression",
  ]) {
    expect([command, read(command, true).block]).toEqual([command, expect.stringContaining('skipping git hooks')])
  }
  const named = (before: string, ps = false) =>
    read(`${before}; gh pr create -t t --body-file b.md`, ps).files.map(f => f.named).at(-1)
  expect(named("'cp other.md b.md' | Invoke-Expression", true)).toBe(true)
  expect(named('`make', true)).toBe(true)
  expect(named('(trap "$X" EXIT)')).toBe(true)
  expect(named('X=$(trap "$Y" EXIT; echo)')).toBe(true)
  expect(named('trap "$X" EXIT')).toBeUndefined()
  for (const command of [
    "M='fix: x'; trap 'git commit -m \"$M\"' EXIT; M=$OUT",
    "M='fix: x'; f() { git commit -m \"$M\"; }; M=$OUT; f",
    "M=a; for v in M; do printf -v \"$v\" '%s' \"$OUT\"; done; git commit -m \"$M\"",
    'M=a; read -r "$V" <<< "$OUT"; git commit -m "$M"',
  ]) {
    expect([command, read(command).unread]).toEqual([command, expect.arrayContaining(['the commit message'])])
  }
  expect(read("M='fix: x'; trap 'git commit -m \"$M\"' EXIT").unread).toEqual([])
})
