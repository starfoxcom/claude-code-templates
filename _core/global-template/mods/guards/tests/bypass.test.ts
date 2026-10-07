import { expect, test } from 'claude-code/testing'

import { inspect } from '../hooks/inspect'

// Each route around the check, refused: `[command, part of the reason, PowerShell]`.
const REFUSED: [string, string, boolean?][] = [
  ['git filter-repo --version', 'history rewriting'],
  ['git filter-branch --tree-filter x HEAD', 'history rewriting'],
  ['git -C repo filter-repo --path a', 'history rewriting'],
  ["git commit --no-verify -m 'fix: x'", 'skipping git hooks'],
  ["git commit -n -m 'fix: x'", 'skipping git hooks'],
  ["git commit -anm 'fix: x'", 'skipping git hooks'],
  ['git push --no-verify origin main', 'skipping git hooks'],
  ['git merge --no-verify feature', 'skipping git hooks'],
  ["git -c core.hooksPath=/dev/null commit -m 'fix: x'", 'skipping git hooks'],
  ['git config core.hooksPath /dev/null', 'skipping git hooks'],
  ['git config --unset core.hooksPath', 'skipping git hooks'],
  ["LEFTHOOK=0 git commit -m 'fix: x'", 'disabling lefthook'],
  ['export LEFTHOOK=0', 'disabling lefthook'],
  ['lefthook uninstall', 'disabling lefthook'],
  ['$env:LEFTHOOK = 0', 'disabling lefthook', true],
  ["git commit -m 'fix: x' --trailer 'Reviewed-by: a'", '--trailer'],
  ['git commit --trailer=Reviewed-by:a -m x', '--trailer'],
  ['git commit -C HEAD~1', "reusing another commit's message"],
  ['git commit --reuse-message=HEAD', "reusing another commit's message"],
  ['git commit -ac HEAD', "reusing another commit's message"],
  ['eval git commit -m "$MSG"', 'eval'],
  ['eval "git commit --no-verify -m x"', 'skipping git hooks'],
  // Shapes a text mask got wrong: an escaped quote, an emoji, a CRLF here-doc, a here-doc named in a message.
  [String.raw`git commit -m Don\'t -m 'x' --no-verify`, 'skipping git hooks'],
  ["git commit -m '\u{1F41B}\u{1F527} fix' -n", 'skipping git hooks'],
  ["git commit -F - <<'EOF'\r\nfix: x\r\nEOF\r\ngit commit --amend --no-verify", 'skipping git hooks'],
  ["git commit -m 'docs: explain cat <<EOF usage'\ngit commit --amend --no-verify", 'skipping git hooks'],
  ["git commit -m 'it''s' --no-verify", 'skipping git hooks', true],
]

for (const [command, reason, ps] of REFUSED) {
  test(`refused: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, ps ?? false).block).toContain(reason)
  })
}

// One step either side: the same words as message text, on another git command, or read-only.
const PASSED: [string, boolean?][] = [
  ["git commit -m 'docs: explain --no-verify and --trailer'"],
  ["git commit -F - <<'EOF'\ndocs: never run git filter-repo here\nEOF"],
  ["git commit -F - <<'END.MSG'\ndocs: explain --no-verify\nEND.MSG"],
  ["gh pr create --title 'docs: eval is refused' --body 'x'"],
  ["git commit -m '-n is the dry-run flag of push'"],
  // `-n` skips hooks only on a commit: on a push it is a dry run, on a merge it drops the diffstat.
  ['git push -n origin main'],
  ['git merge --no-ff -n origin/develop'],
  ['git revert --no-commit abc -n'],
  ['git cherry-pick -n abc123'],
  ['git tag -n'],
  // The word `commit` as an argument, never as the subcommand.
  ['git log --grep=commit -n 3'],
  ['git log -S commit -n 5'],
  ['git log -- docs/commit-format.md -n 5'],
  ['git config --get core.hooksPath'],
  ['git -c core.hooksPath=/x log -1'],
  ["git commit -m 'set LEFTHOOK=0 to skip it'"],
  ['eval "$(ssh-agent)"'],
  ["git commit -m 'fix: x'"],
  ["git commit -m 'it''s fine'", true],
]

for (const [command, ps] of PASSED) {
  test(`passed: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, ps ?? false).block).toBeUndefined()
  })
}

test('a variable set inside a subshell is unknown after it', () => {
  const plan = inspect('(S=/safe); gh pr create -t t --body-file "$S/b.md"', false)
  expect(plan.files).toEqual([])
  expect(plan.unread).toEqual(['the PR text'])
  // Set in the command itself, it is known.
  expect(inspect('S=/safe; gh pr create -t t --body-file "$S/b.md"', false).files.map(f => f.path)).toEqual([
    '/safe/b.md',
  ])
})

// Every ordinary spelling that moves the hooks or switches lefthook off.
const MORE_REFUSED: [string, string, boolean?][] = [
  ['git config set core.hooksPath /x', 'skipping git hooks'],
  ['git config unset core.hooksPath', 'skipping git hooks'],
  ['git config --file .git/config core.hooksPath /x', 'skipping git hooks'],
  ['git config -f .git/config core.hooksPath /x', 'skipping git hooks'],
  ['git config --global core.hooksPath /x', 'skipping git hooks'],
  ['git --config-env=core.hooksPath=HP commit -m x', 'skipping git hooks'],
  ['git --config-env core.hooksPath=HP commit -m x', 'skipping git hooks'],
  ['git config -t path core.hooksPath /x', 'skipping git hooks'],
  ["GIT_CONFIG_PARAMETERS='core.hooksPath=/x' git commit -m x", 'skipping git hooks'],
  ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git commit -m x', 'skipping git hooks'],
  ['LEFTHOOK=false git commit -m x', 'disabling lefthook'],
  ['export LEFTHOOK=false', 'disabling lefthook'],
  ['LEFTHOOK_EXCLUDE=commit-msg git commit -m x', 'disabling lefthook'],
  ["$env:LEFTHOOK = 'false'", 'disabling lefthook', true],
  ['$env:LEFTHOOK_EXCLUDE="commit-msg"', 'disabling lefthook', true],
]

for (const [command, reason, ps] of MORE_REFUSED) {
  test(`refused: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, ps ?? false).block).toContain(reason)
  })
}

test('reading a hooks setting, a file named like one, or a message naming a flag passes', () => {
  for (const command of [
    'git config get core.hooksPath',
    'git config --file core.hooksPath --list',
    'git config --get core.hooksPath /x',
    'git config --get-all core.hooksPath pattern',
    "git commit -m '--no-verify'",
    "git commit --author '--no-verify' -m x",
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})

test('a PowerShell splat built at run time is unread; a typed one is checked as typed', () => {
  expect(inspect('$p = @{ Title = "$env:T" }; gh pr create @p', true).unread).toEqual(['the PR text'])
  const fromFile = "$p = @{ Title = 't'; Body = (Get-Content b.md -Raw) }; gh pr create @p"
  expect(inspect(fromFile, true).unread).toEqual(['the PR text'])
  expect(inspect("$p = @{ Title = 'feat: x' }; gh pr create @p", true).unread).toEqual([])
})

test('an escaped dollar in an unquoted here-doc is literal; a bare one is unread', () => {
  const body = (line: string) => `git commit -F - <<EOF\n${line}\nEOF`
  expect(inspect(body(String.raw`fix: escape \$HOME in the script`), false).unread).toEqual([])
  expect(inspect(body('fix: use $HOME'), false).unread).toEqual(['the commit message'])
})

test('a spaced --config-env still leaves the commit as a write', () => {
  expect(inspect('git --config-env core.editor=ED commit -m msg', false).isWrite).toBe(true)
})

// Lefthook switched off behind a wrapper's flags or a keyword, a hooks section dropped, and
// `Invoke-Expression`, PowerShell's `eval`.
const WRAPPED_REFUSED: [string, string, boolean?][] = [
  ['env -i LEFTHOOK=0 git commit -m x', 'disabling lefthook'],
  ['sudo -E LEFTHOOK=0 git commit -m x', 'disabling lefthook'],
  ['declare -x LEFTHOOK=0', 'disabling lefthook'],
  ['if LEFTHOOK=0 git commit -m x; then :; fi', 'disabling lefthook'],
  ['for b in a; do LEFTHOOK=0 git commit -m x; done', 'disabling lefthook'],
  ['git config --remove-section core', 'skipping git hooks'],
  ['git config --rename-section core old', 'skipping git hooks'],
  ['git config --rename-section staged hooks', 'skipping git hooks'],
  ['git config remove-section core', 'skipping git hooks'],
  ['Invoke-Expression "git commit --no-verify -m x"', 'skipping git hooks', true],
  ["iex 'git commit -m x'", 'eval', true],
  // A script held in a variable the command sets is read with its value.
  ['CMD="git commit --no-verify -m x"; bash -c "$CMD"', 'skipping git hooks'],
]

for (const [command, reason, ps] of WRAPPED_REFUSED) {
  test(`refused: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, ps ?? false).block).toContain(reason)
  })
}

test('dropping another config section, or a lefthook setting named as an argument, passes', () => {
  for (const command of [
    'git config --remove-section alias',
    'git config --rename-section alias.a alias.b',
    'echo LEFTHOOK=0',
    "git commit -m 'LEFTHOOK=0 is refused'",
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})

test('a hashtable with a value that runs, or changed after it was typed, is unread', () => {
  const unread = (c: string) => inspect(c, true).unread
  expect(unread("$p = @{ Title = 't'; Body = Get-Content b.md -Raw }; gh pr create @p")).toEqual(['the PR text'])
  expect(unread("$p = @{ Title = 't' }; $p.Body = (Get-Content b.md); gh pr create @p")).toEqual(['the PR text'])
  expect(unread("$p = @{ Title = 't' }; $p['Body'] = 'x'; gh pr create @p")).toEqual(['the PR text'])
  const typed = "$p = @{\n  Title = 'feat: x'; Draft = $true\n  Base = \"develop\"\n}; gh pr create @p"
  expect(unread(typed)).toEqual([])
})

test('a body names a variable the command set: read with its value', () => {
  const plan = (c: string, ps = false) => inspect(c, ps)
  const hereString = plan(`MSG='fix: x'; git commit -F - <<< "$MSG"`)
  expect(hereString.unread).toEqual([])
  expect(hereString.texts.map(t => t.text)).toContain('fix: x')
  const heredoc = plan("MSG='fix: x'\ngit commit -F - <<EOF\n$MSG\n\nBody.\nEOF")
  expect(heredoc.unread).toEqual([])
  expect(heredoc.texts.map(t => t.text)).toContain('fix: x\n\nBody.')
  // From outside the command, or another program's output, it stays unread.
  expect(plan('git commit -F - <<< "$MSG"').unread).toEqual(['the commit message'])
  expect(plan('git commit -F - <<EOF\n$(git log -1 --format=%B)\nEOF').unread).toEqual(['the commit message'])
  const fromRead = "read -r -d '' BODY <<EOF\n$OUT\nEOF\ngit commit -m \"$BODY\""
  expect(plan(fromRead).unread).toEqual(['the commit message'])
})

test('a variable is known inside the block that set it', () => {
  const plan = (c: string, ps = false) => inspect(c, ps)
  expect(plan("if ($ok) { $m = 'fix: x'; git commit -m $m }", true).unread).toEqual([])
  const sub = plan('(cd sub && F=b.md && gh pr create -t t -F "$F")')
  expect(sub.unread).toEqual([])
  expect(sub.files.map(f => f.path)).toEqual(['b.md'])
  expect(plan('(F=/x/b.md; (gh pr create -t t -F "$F"))').files.map(f => f.path)).toEqual(['/x/b.md'])
  // Another subshell, or after it closed: gone.
  expect(plan('(F=b.md); (gh pr create -t t -F "$F")').unread).toEqual(['the PR text'])
})

test('a command held in a variable from outside is out of reach', () => {
  // Listed in the README: nothing in the command says what it runs.
  expect(inspect('eval "$CMD"', false).block).toBeUndefined()
  expect(inspect('bash -c "$CMD"', false).isWrite).toBe(false)
})

// Lefthook through a package runner, commands in backticks, and a script a shell reads from a here-doc.
const HIDDEN_REFUSED: [string, string][] = [
  ['npx lefthook uninstall', 'disabling lefthook'],
  ['npx --yes lefthook uninstall', 'disabling lefthook'],
  ['pnpm exec lefthook uninstall', 'disabling lefthook'],
  ['yarn lefthook uninstall', 'disabling lefthook'],
  ['bunx @evilmartians/lefthook uninstall', 'disabling lefthook'],
  ['OUT=`git commit --no-verify -m x`', 'skipping git hooks'],
  ['echo "`git commit -n -m x`"', 'skipping git hooks'],
  ["bash <<'EOF'\ngit commit -n -m x\nEOF", 'skipping git hooks'],
  ["sh -s <<< 'git push --no-verify'", 'skipping git hooks'],
]

for (const [command, reason] of HIDDEN_REFUSED) {
  test(`refused: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, false).block).toContain(reason)
  })
}

test('lefthook run or installed through a runner, and a backtick read, pass', () => {
  for (const command of ['npx lefthook install', 'npx lefthook run pre-commit', 'echo `date`']) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})

test('each value is read where it was set: a subshell, a substitution or a child shell', () => {
  const read = (c: string) => inspect(c, false)
  const messages = (c: string) => read(c).texts.filter(t => !t.creditOnly && t.where === 'the commit message')
  // A subshell or a `$(...)` that sets the same name leaves the outer value alone.
  for (const command of [
    'M=a; (M=b); git commit -m "$M"',
    'M=a; X=$(M=b; echo); git commit -m "$M"',
    'M=a; X=`M=b`; git commit -m "$M"',
  ]) {
    expect([command, read(command).unread, messages(command).map(t => t.text)]).toEqual([command, [], ['a']])
  }
  // Set only inside one, it is gone outside.
  expect(read('X=$(M=b; echo); git commit -m "$M"').unread).toEqual(['the commit message'])
  // A child shell sees only an exported value.
  expect(read(`M=a; bash -c 'git commit -m "$M"'`).unread).toEqual(['the commit message'])
  expect(read(`export M=a; bash -c 'git commit -m "$M"'`).unread).toEqual([])
  expect(read(`M=a; export M; bash -c 'git commit -m "$M"'`).unread).toEqual([])
  // A here-doc script the shell reads fills in the outer shell's variables first.
  expect(read('M=a; bash <<EOF\ngit commit -m "$M"\nEOF').unread).toEqual([])
})

test('a hashtable added to after it was typed is unread', () => {
  const unread = (c: string) => inspect(c, true).unread
  expect(unread("$p = @{ Title = 't' }; $p += @{ Body = $env:B }; gh pr create @p")).toEqual(['the PR text'])
  expect(unread("$p = @{ Title = 't' }; $p.Add('Body', $b); gh pr create @p")).toEqual(['the PR text'])
  expect(unread("$m = 'fix: x'; $m += $env:T; git commit -m $m")).toEqual(['the commit message'])
})

// `eval` runs its words in this shell: read there, so a route inside it is refused by its own rule, and an
// `eval` beside a read-only git command passes.
const EVAL_REFUSED: [string, string][] = [
  ['eval "git config core.hooksPath /x"', 'skipping git hooks'],
  ["eval 'export LEFTHOOK=0'", 'disabling lefthook'],
  ['eval "lefthook uninstall"', 'disabling lefthook'],
  ["eval 'git commit -m x'", 'eval'],
  ['C="git commit -m x"; eval "$C"', 'eval'],
  ['eval "$(ssh-agent -s)"; git commit -m x', 'eval'],
]

for (const [command, reason] of EVAL_REFUSED) {
  test(`refused: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, false).block).toContain(reason)
  })
}

test('an eval beside a read-only git command passes', () => {
  for (const command of [
    'eval "$(ssh-agent -s)"; git log --grep=commit -n 3',
    'eval "$(ssh-agent -s)"; git show HEAD:docs/commit-format.md',
    'eval "$(ssh-agent -s)"; git tag -l',
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})

test('a variable holding a here-doc or a file is read through it', () => {
  const plan = (c: string) => inspect(c, false)
  const doc = plan("MSG=$(cat <<'EOF'\nfix: x\n\nBody.\nEOF\n); git commit -m \"$MSG\"")
  expect(doc.unread).toEqual([])
  expect(doc.texts.map(t => t.text)).toContain('fix: x\n\nBody.')
  const filled = plan('T=x; MSG=$(cat <<EOF\nfix: $T\nEOF\n); git commit -m "$MSG"')
  expect(filled.texts.map(t => t.text)).toContain('fix: x')
  const file = plan('BODY=$(cat b.md); gh pr create -t t -b "$BODY"')
  expect(file.unread).toEqual([])
  expect(file.files.map(f => f.path)).toEqual(['b.md'])
  // Another program's output, or a here-doc that names an outside variable, stays unread.
  expect(plan('BODY=$(gh pr view 5 --json body); gh pr create -t t -b "$BODY"').unread).toEqual(['the PR text'])
  expect(plan('MSG=$(cat <<EOF\n$OUT\nEOF\n); git commit -m "$MSG"').unread).toEqual(['the commit message'])
})

test('a hashtable with escaped text or a here-string is typed', () => {
  const unread = (c: string) => inspect(c, true).unread
  expect(unread('$p = @{ Title = "t"; Body = "## What`n- add it" }; gh pr create @p')).toEqual([])
  expect(unread("$p = @{ Title = 't'; Body = @'\n## What\n- add it\n'@ }; gh pr create @p")).toEqual([])
  expect(unread('$p = @{ Title = "t"; Body = "cost: `$5" }; gh pr create @p')).toEqual([])
  expect(unread('$p = @{ Title = "t"; Body = "cost: $five" }; gh pr create @p')).toEqual(['the PR text'])
})

test('two substitutions in one word are two subshells', () => {
  const plan = inspect('M=a; X=$(M=b; echo)$(git commit -m "$M")', false)
  expect(plan.unread).toEqual([])
  expect(plan.texts.filter(t => !t.creditOnly && t.where === 'the commit message').map(t => t.text)).toEqual(['a'])
})

test('listing tags or notes writes nothing; making one does', () => {
  const reads = ['git tag', 'git tag -l', 'git tag --list v1*', 'git tag -n5', 'git tag -d v1', 'git notes list']
  for (const command of reads) {
    expect([command, inspect(command, false).isWrite]).toEqual([command, false])
  }
  for (const command of ["git tag -a v1 -m 'v1'", 'git tag v1', "git notes add -m 'x'"]) {
    expect([command, inspect(command, false).isWrite]).toEqual([command, true])
  }
})
