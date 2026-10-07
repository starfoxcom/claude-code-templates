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
  ['eval "git commit --no-verify -m x"', 'eval'],
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
