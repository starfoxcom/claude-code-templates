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
  ["LEFTHOOK=0 git commit -m 'fix: x'", 'git hooks off'],
  ['export LEFTHOOK=0; git commit -m x', 'git hooks off'],
  ['lefthook uninstall', 'git hooks off'],
  ['$env:LEFTHOOK = 0; git commit -m x', 'git hooks off', true],
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
  ['LEFTHOOK=false git commit -m x', 'git hooks off'],
  ['export LEFTHOOK=false; git commit -m x', 'git hooks off'],
  ['LEFTHOOK_EXCLUDE=commit-msg git commit -m x', 'git hooks off'],
  ["$env:LEFTHOOK = 'false'; git commit -m x", 'git hooks off', true],
  ['$env:LEFTHOOK_EXCLUDE="commit-msg"; git push', 'git hooks off', true],
  // The other hook managers the bundles ship: husky, pre-commit and simple-git-hooks.
  ['HUSKY=0 git commit -m x', 'git hooks off'],
  ['export HUSKY=0; git commit -m x', 'git hooks off'],
  ['HUSKY_SKIP_HOOKS=1 git commit -m x', 'git hooks off'],
  ['SKIP=conventional-commit git commit -m x', 'git hooks off'],
  ['export SKIP=conventional-commit; git commit -m x', 'git hooks off'],
  ['SKIP_SIMPLE_GIT_HOOKS=1 git commit -m x', 'git hooks off'],
  ['HUSKY=$H git commit -m x', 'git hooks off'],
  ['$env:HUSKY = 0; git commit -m x', 'git hooks off', true],
  ["$env:SKIP = 'conventional-commit'; git commit -m x", 'git hooks off', true],
  ['pre-commit uninstall', 'git hooks off'],
  ['uvx pre-commit uninstall', 'git hooks off'],
  ['python -m pre_commit uninstall', 'git hooks off'],
  ['npx husky uninstall', 'git hooks off'],
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
  expect(inspect("$p = @{ Title = 'feat: x' }; gh pr create @p", true).unread).toEqual(['the PR text'])
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
  ['env -i LEFTHOOK=0 git commit -m x', 'git hooks off'],
  ['sudo -E LEFTHOOK=0 git commit -m x', 'git hooks off'],
  ['declare -x LEFTHOOK=0; git commit -m x', 'git hooks off'],
  ['if LEFTHOOK=0 git commit -m x; then :; fi', 'git hooks off'],
  ['for b in a; do LEFTHOOK=0 git commit -m x; done', 'git hooks off'],
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
  // Typed as it may be, gh gets it as `-key:value` words, never that text.
  expect(unread(typed)).toEqual(['the PR text'])
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
  ['npx lefthook uninstall', 'git hooks off'],
  ['npx --yes lefthook uninstall', 'git hooks off'],
  ['pnpm exec lefthook uninstall', 'git hooks off'],
  ['yarn lefthook uninstall', 'git hooks off'],
  ['bunx @evilmartians/lefthook uninstall', 'git hooks off'],
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
  // An unknown PowerShell variable may also hold a list: several words.
  expect(unread("$m = 'fix: x'; $m += $env:T; git commit -m $m")).toContain('the commit message')
})

// `eval` runs its words in this shell: read there, so a route inside it is refused by its own rule, and an
// `eval` beside a read-only git command passes.
const EVAL_REFUSED: [string, string][] = [
  ['eval "git config core.hooksPath /x"', 'skipping git hooks'],
  ["eval 'export LEFTHOOK=0'; git commit -m x", 'git hooks off'],
  ['eval "lefthook uninstall"', 'git hooks off'],
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

// A message that is wholly one `$(cat <<EOF ... EOF)` is read as the shell fills it in; anything else
// built at run time in the word, or after the here-doc, leaves it unread.
const CAT_UNREAD = [
  'git commit -m "$(cat <<EOF\n$OUT\nEOF\n)"',
  'git commit -m "$(cat <<EOF\n$(git log -1 --format=%B)\nEOF\n)"',
  'git commit -m "$(cat <<EOF\nfix: `date`\nEOF\n)"',
  "git commit -m \"$(cat <<'EOF'\nfix: x\nEOF\n) $OUT\"",
  'git commit -m "$(cat b.md) $OUT"',
  'git commit -m "$(cat b.md)$(git log -1 --format=%B)"',
  "MSG=\"$(cat <<'EOF'\nfix: x\nEOF\n)$(git log -1 --format=%B)\"; git commit -m \"$MSG\"",
  // A pipe on the `cat` line changes the text; a second here-doc line after the first ends it.
  "git commit -m \"$(cat <<'EOF' | rev\nfix: x\nEOF\n)\"",
  "git commit -m \"$(cat <<'EOF'\nfix: x\nEOF\necho more\nEOF\n)\"",
  // `-F "$(cat name.txt)"` names a file by another file's text.
  'git commit -F "$(cat name.txt)"',
]

for (const command of CAT_UNREAD) {
  test(`unread: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, false).unread).toEqual(['the commit message'])
  })
}

test('a quoted here-doc message is read as typed, a bare one filled in', () => {
  const plan = (c: string) => inspect(c, false)
  const messages = (c: string) => plan(c).texts.filter(t => !t.creditOnly).map(t => t.text)
  // The harness form, with a body that only mentions a file or a variable.
  const quoted = "git commit -m \"$(cat <<'EOF'\nfix: read $(cat b.md) and $OUT\nEOF\n)\""
  expect([plan(quoted).unread, plan(quoted).files]).toEqual([[], []])
  expect(messages(quoted)).toContain('fix: read $(cat b.md) and $OUT')
  const bare = 'T=x; git commit -m "$(cat <<EOF\nfix: $T\nEOF\n)"'
  expect(plan(bare).unread).toEqual([])
  expect(messages(bare)).toContain('fix: x')
  // Indented, ` EOF` is body text and the next exact line ends it.
  expect(messages("git commit -m \"$(cat <<'EOF'\nfix: x\n EOF\nEOF\n)\"")).toContain('fix: x\n EOF')
  expect(messages("git commit -m \"$(cat <<-'EOF'\n\tfix: x\n\tEOF\n)\"")).toContain('fix: x')
  // Handed over as a file: `<(cat <<'EOF' ... EOF)` is the text, `<(cat b.md)` the file.
  expect(messages("gh pr create -t t -F <(cat <<'EOF'\n## What\nEOF\n)")).toContain('## What')
  expect(plan('gh pr create -t t -F <(cat b.md)').files.map(f => f.path)).toEqual(['b.md'])
  expect(plan('gh pr create -t t -F "$(cat b.md)"').unread).toEqual(['the PR text'])
})

// A value set where the outer read cannot see it: inside a subshell holding a case block, or a subshell
// an eval opens. The commit reads the outer `$M`, from outside the command.
const SCOPED_UNREAD = [
  "(case $x in a) M='fix: x';; esac); git commit -m \"$M\"",
  '(case $x in (a|b) M=b;; *) M=c;; esac); git commit -m "$M"',
  '(case $x in @(a|b)) M=b ;& c) M=c ;;& esac); git commit -m "$M"',
  '(case $x in\n  a)\n    M=b\n    ;;\nesac\n); git commit -m "$M"',
  '(if true; then case $x in a) M=b; esac; fi); git commit -m "$M"',
  '(M=b); eval "(git commit -m \\"\\$M\\")"',
]

for (const command of SCOPED_UNREAD) {
  test(`unread: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, false).unread).toEqual(['the commit message'])
  })
}

test('a case block is read as the shell reads it', () => {
  const messages = (c: string) =>
    inspect(c, false).texts.filter(t => !t.creditOnly && t.where === 'the commit message').map(t => t.text)
  // The outer value stays where a subshell with a case block sets its own.
  expect(messages('M=a; (cd sub; case $x in a) M=b;; esac); git commit -m "$M"')).toEqual(['a'])
  // An arm may not run: its value is known inside it, unknown after the block. A commit inside an arm is
  // read as one.
  expect(messages('case $x in a) M=b; git commit -m "$M";; esac')).toEqual(['b'])
  expect(inspect('case $x in a) M=b;; esac; git commit -m "$M"', false).unread).toEqual(['the commit message'])
  expect(messages("case $x in a) git commit -m 'fix: y';; esac")).toEqual(['fix: y'])
  // A `$(...)` with a case block ends at its own `)`: the commit after it is read.
  const sub = inspect("X=$(case $y in a) echo a;; esac); git commit --no-verify -m 'fix: z'", false)
  expect(sub.block).toContain('skipping git hooks')
  // The word `case` as an argument opens nothing.
  expect(messages("git commit -m 'docs: the case in point'")).toEqual(['docs: the case in point'])
  expect(inspect('echo case a in b) ; (M=b); git commit -m "$M"', false).unread).toEqual(['the commit message'])
})

test('assignments in front of a child shell reach it, as bash passes them', () => {
  const read = (c: string) => inspect(c, false)
  for (const command of [
    `M='fix: x' bash -c 'git commit -m "$M"'`,
    `env M='fix: x' bash -c 'git commit -m "$M"'`,
    `T=x; M="fix: $T" bash -c 'git commit -m "$M"'`,
    `M='fix: x' bash <<'EOF'\ngit commit -m "$M"\nEOF`,
  ]) {
    expect([command, read(command).unread]).toEqual([command, []])
  }
  const messages = (c: string) => read(c).texts.filter(t => !t.creditOnly && t.where === 'the commit message')
  expect(messages(`M='fix: x' bash -c 'git commit -m "$M"'`).map(t => t.text)).toEqual(['fix: x'])
  // Only the child sees it, and `env -i` or `env -u` takes an exported value away.
  expect(read(`M=a bash -c 'true'; git commit -m "$M"`).unread).toEqual(['the commit message'])
  expect(messages(`export M=a; env -i bash -c 'git commit -m "$M"'`).map(t => t.text)).toEqual([''])
  expect(messages(`export M=a; env -u M bash -c 'git commit -m "$M"'`).map(t => t.text)).toEqual([''])
  expect(messages(`export M=a; env -uM bash -c 'git commit -m "$M"'`).map(t => t.text)).toEqual([''])
})

test('an assignment in front of eval is seen by its words, and unknown after it', () => {
  const read = (c: string) => inspect(c, false)
  const messages = (c: string) => read(c).texts.filter(t => !t.creditOnly && t.where === 'the commit message')
  expect(messages(`M=a; M=b eval 'git commit -m "$M"'`).map(t => t.text)).toEqual(['b'])
  expect(read(`M=a; M=b eval 'true'; git commit -m "$M"`).unread).toEqual(['the commit message'])
  // The eval's top level runs in place: what it sets is known after it.
  expect(messages(`eval 'M=b'; git commit -m "$M"`).map(t => t.text)).toEqual(['b'])
})

test('a hashtable with escaped text or a here-string is typed', () => {
  const unread = (c: string) => inspect(c, true).unread
  expect(unread('$p = @{ Title = "t"; Body = "## What`n- add it" }; gh pr create @p')).toEqual(['the PR text'])
  expect(unread("$p = @{ Title = 't'; Body = @'\n## What\n- add it\n'@ }; gh pr create @p")).toEqual(['the PR text'])
  expect(unread('$p = @{ Title = "t"; Body = "cost: `$5" }; gh pr create @p')).toEqual(['the PR text'])
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

// A git long option shortened to a start of its name that names no other option, as git reads it, and
// the other routes found with it: a note or a fixup that takes another object's message, a tag trailer.
const SHORTENED_REFUSED: [string, string, boolean?][] = [
  ["git commit --no-verif -m 'fix: x'", 'skipping git hooks'],
  ["git commit --no-veri -m 'fix: x'", 'skipping git hooks'],
  ['git push --no-verif origin main', 'skipping git hooks'],
  ['git rebase --no-verif main', 'skipping git hooks'],
  ["git commit --trail 'Reviewed-by: a' -m x", '--trailer'],
  ['git commit --reu HEAD', "reusing another commit's message"],
  ['git commit --reedit=HEAD', "reusing another commit's message"],
  ['git commit --fixup=amend:HEAD', "reusing another commit's message"],
  ['git commit --fixup reword:HEAD', "reusing another commit's message"],
  ['git notes add -C 1a2b3c HEAD', "reusing another commit's message"],
  ['git notes add -c 1a2b3c', "reusing another commit's message"],
  ['git notes append --reuse=1a2b3c', "reusing another commit's message"],
  ["git tag -a v1 -m 'v1' --trai 'Reviewed-by: a'", '--trailer'],
  ['git config --rem core', 'skipping git hooks'],
  ['git config --rena core old', 'skipping git hooks'],
  ['git config --unset-a core.hooksPath', 'skipping git hooks'],
  ['git config --ad core.hooksPath /x', 'skipping git hooks'],
  ['git config unset --a core.hooksPath', 'skipping git hooks'],
  // A program named by a variable the command set is read as that program.
  ["GIT=git; $GIT commit --no-verify -m 'fix: x'", 'skipping git hooks'],
  ["$g = 'git'; & $g commit --no-verify -m x", 'skipping git hooks', true],
]

for (const [command, reason, ps] of SHORTENED_REFUSED) {
  test(`refused: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, ps ?? false).block).toContain(reason)
  })
}

test('a shortened option is read as the option git reads', () => {
  const read = (c: string) => inspect(c, false)
  const messages = (c: string) => read(c).texts.filter(t => !t.creditOnly && t.where === 'the commit message')
  expect(messages("git commit --mess 'fix: x'").map(t => t.text)).toEqual(['fix: x'])
  expect(messages("git commit --messa='fix: x'").map(t => t.text)).toEqual(['fix: x'])
  expect(read('git commit --fi m.txt').files).toEqual([])
  expect(read('git commit --fil m.txt').files.map(f => f.path)).toEqual(['m.txt'])
  expect(read('git commit --al').targets[0]?.diff).toBe('cached')
  expect(read("git commit --all -m 'fix: x'").targets[0]?.diff).toBe('all')
  expect(read('git branch --mo old new').branches).toEqual(['new'])
  expect(read('git branch --del old').branches).toEqual([])
  expect(read('git checkout --orph fresh').branches).toEqual(['fresh'])
  expect(read('git switch --cr fresh').branches).toEqual(['fresh'])
  expect(read('git tag --del v1').isWrite).toBe(false)
})

test('a shortened name that is no such option, or names two, is left as written', () => {
  for (const command of [
    // `--no-ver` names both `--no-verify` and `--no-verbose`: git refuses it.
    "git commit --no-ver -m 'fix: x'",
    "git commit --verify -m 'fix: x'",
    'git commit --fixup HEAD',
    'git commit --squash=HEAD -m x',
    "git commit -m 'fix: x' --amend --no-edit",
    'git notes add -m x',
    'git config --get core.hooksPath',
    'git config --get-a core.hooksPath',
    'git push --verbose',
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
})

test('a program named at run time with a write for arguments is unread', () => {
  const read = (c: string, ps = false) => inspect(c, ps)
  const messages = (c: string) => read(c).texts.filter(t => !t.creditOnly && t.where === 'the commit message')
  expect(messages("GIT=git; $GIT commit -m 'fix: x'").map(t => t.text)).toEqual(['fix: x'])
  expect(messages("G='git -C repo'; $G commit -m 'fix: x'").map(t => t.text)).toEqual(['fix: x'])
  for (const command of ['$G commit -m x', '"$(which git)" commit -m x', '$GH pr create -t t -b x']) {
    expect([command, read(command).unread]).toEqual([command, ['a program named at run time']])
  }
  // Another program, or a read-only call, is no write.
  for (const command of ['"$HOME/bin/tool" --version', '$G log -1', 'X=$(date)']) {
    expect([command, read(command).unread]).toEqual([command, []])
  }
  expect(read("$p = @{ Title = 't' }; $p.Add('Body', 'x')", true).unread).toEqual([])
})

test('a tag or merge message that reads like a flag is a message', () => {
  for (const command of [
    "git tag -a v1 -m '--trailer is refused'",
    "git merge -m '--no-verify is refused' feature",
    "git tag -a v1 -u '--trailer' -m x",
  ]) {
    expect([command, inspect(command, false).block]).toEqual([command, undefined])
  }
  // `--no-verif` names `--no-verify-signatures` too on a merge: git refuses it, so it is left as written.
  expect(inspect("git merge --no-verif -m 'x' feature", false).block).toBeUndefined()
  expect(inspect("git merge -m 'x' --no-verify feature", false).block).toContain('skipping git hooks')
  expect(inspect("git tag -a v1 -m x --trailer 'R: a'", false).block).toContain('--trailer')
})

// A value the shell builds at run time, wherever it stands: an array, an append, an indirect or special
// expansion, a name set by a command the reading does not follow, a word that may turn into a flag.
const RUN_TIME_UNREAD: [string, string][] = [
  ['MSG=("$OUT"); git commit -m "$MSG"', 'the commit message'],
  ['ARGS=(--no-verify); git commit -m x "${ARGS[@]}"', 'the commit message'],
  ["M='fix: x'; M+=\" $OUT\"; git commit -m \"$M\"", 'the commit message'],
  ['X=OUT; git commit -m "${!X}"', 'the commit message'],
  ['git commit -m "${X:-$OUT}"', 'the commit message'],
  ['declare -n R=OUT; git commit -m "$R"', 'the commit message'],
  ["M=a; printf -v M '%s' \"$OUT\"; git commit -m \"$M\"", 'the commit message'],
  ['M=a; read -r M < f; git commit -m "$M"', 'the commit message'],
  ['for M in "$OUT"; do git commit -m "$M"; done', 'the commit message'],
  ['M=a; unset M; git commit -m "$M"', 'the commit message'],
  ['(case $x\nin a) M=b;; esac); git commit -m "$M"', 'the commit message'],
  ['git commit -m x $NV', 'the commit message'],
  ['git commit -m x "$@"', 'the commit message'],
  ['git $C -m x', 'a git subcommand built at run time'],
  ['gh pr $A -t t -b x', 'a gh subcommand built at run time'],
  ['git -c "$K" commit -m x', 'a git setting built at run time'],
  ['A=create; gh pr $A -t t -b "$OUT"', 'the PR text'],
  ['git checkout -b "$B"', 'the new branch name'],
]

for (const [command, what] of RUN_TIME_UNREAD) {
  test(`unread: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, false).unread).toContain(what)
  })
}

// Set in the command, the value fills in every word, so the route it spells is refused.
const FILLED_REFUSED: [string, string][] = [
  ["NV=--no-verify; git commit -m 'fix: x' $NV", 'skipping git hooks'],
  ["C=commit; git $C -m 'fix: x' --no-verify", 'skipping git hooks'],
  ['K=core.hooksPath=/x; git -c "$K" commit -m x', 'skipping git hooks'],
  ['V=0; LEFTHOOK=$V git commit -m x', 'git hooks off'],
  ['LEFTHOOK=$V git commit -m x', 'git hooks off'],
  ['LEFTHOOK+=0 git commit -m x', 'git hooks off'],
  ['case $x in $(git commit --no-verify -m x)) ;; esac', 'skipping git hooks'],
]

for (const [command, reason] of FILLED_REFUSED) {
  test(`refused: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, false).block).toContain(reason)
  })
}

test('ordinary words built at run time that cannot turn into a flag pass', () => {
  const read = (c: string, ps = false) => inspect(c, ps)
  const messages = (c: string) => read(c).texts.filter(t => !t.creditOnly && t.where === 'the commit message')
  expect(messages('M=a; M+=b; git commit -m "$M"').map(t => t.text)).toEqual(['ab'])
  expect(messages("M='fix: x'; echo \"$M\"; git commit -m \"$M\"").map(t => t.text)).toEqual(['fix: x'])
  for (const command of [
    'F=src/a.ts; git commit -m x "$F"',
    'git commit -m x -- "$F"',
    'git commit -m x "src/$F"',
    'gh api "repos/$R/pulls"',
    "B=feature/x; git checkout -b \"$B\"",
  ]) {
    expect([command, read(command).unread, read(command).block]).toEqual([command, [], undefined])
  }
  expect(read('$env:LEFTHOOK=1; git commit -m x', true).block).toBeUndefined()
  expect(read('$env:LEFTHOOK = $v; git commit -m x', true).block).toContain('git hooks off')
})

// A here-doc quoted with a backslash, the classic `git config` read past its key, git-filter-repo on its
// own, and an eval whose text ends in a subshell or whose prefix appends.
const ROUND_12_REFUSED: [string, string][] = [
  ["cat <<\\EOF > m.txt\nfix: don't skip it\nEOF\ngit commit --no-verify -F m.txt", 'skipping git hooks'],
  ['git config core.hooksPath -x', 'skipping git hooks'],
  ['git config core.hooksPath --get', 'skipping git hooks'],
  ['git-filter-repo --force', 'history rewriting'],
]

for (const [command, reason] of ROUND_12_REFUSED) {
  test(`refused: ${JSON.stringify(command)}`, () => {
    expect(inspect(command, false).block).toContain(reason)
  })
}

test('an eval leaves its prefix unknown where the command goes on', () => {
  for (const command of [`M=x eval '(true)'; git commit -m "$M"`, `M=a; M+=" $OUT" eval 'git commit -m "$M"'`]) {
    expect([command, inspect(command, false).unread]).toEqual([command, ['the commit message']])
  }
})

test('a backslash here-doc, a mktemp body file, a plain setting and pushd/popd pass', () => {
  const read = (c: string) => inspect(c, false)
  const doc = read("git commit -F - <<\\EOF\nfix: it's read\nEOF")
  expect([doc.unread, doc.files, doc.block]).toEqual([[], [], undefined])
  expect(doc.texts.map(t => t.text)).toContain("fix: it's read")
  const temp = read("F=$(mktemp); cat > \"$F\" <<'EOF'\nfix: x\nEOF\ngit commit -F \"$F\"")
  expect([temp.unread, temp.files.map(f => f.written)]).toEqual([[], [true]])
  // Set again in between, the name holds another file.
  expect(read("F=$(mktemp); cat > \"$F\" <<'EOF'\nx\nEOF\nF=$OUT; git commit -F \"$F\"").unread).toEqual([
    'the commit message',
  ])
  expect(read("git -c \"user.name=$N\" commit -m 'fix: x'").unread).toEqual([])
  expect(read('git -c "alias.ci=$A" ci').unread).toEqual(['a git setting built at run time'])
  const popped = read('pushd sub && popd && git commit -F m.txt')
  expect([popped.unread, popped.files[0]?.folder]).toEqual([[], { isUnknown: false }])
  expect(read('git config --get core.hooksPath').block).toBeUndefined()
})

// A value the shell splits at run time, a config word built at run time, a file matched to the wrong
// writer, and a folder moved by a stack option or inside a subshell.
test('a value that may split into more options is unread', () => {
  for (const [command, what] of [
    ["git -c user.name=$N commit -m 'fix: x'", 'a git option built at run time'],
    ['git -C $DIR commit -m x', 'a git option built at run time'],
    ["git commit --date $D -m 'fix: x'", 'the commit message'],
    ['gh pr create -t t --body-file b.md --base $B', 'the PR text'],
  ]) {
    expect(inspect(command as string, false).unread).toContain(what)
  }
  expect(inspect('gh pr create -t t --body-file b.md --base "$B"', false).unread).toEqual([])
})

test('a git config word built at run time where the key stands, or beside a hooks key, is refused', () => {
  for (const command of ['git config $SCOPE core.hooksPath /dev/null', 'git config --unset $K', 'git config $K /x']) {
    expect([command, inspect(command, false).block]).toEqual([command, expect.stringContaining('built at run time')])
  }
  expect(inspect('git config user.email "$E"', false).block).toBeUndefined()
})

test('each body file is read from the writer it was named after', () => {
  const plan = (c: string, ps = false) => inspect(c, ps)
  const two = plan(
    "F=$(mktemp); cat > \"$F\" <<'EOF'\nfix: first\nEOF\ngit commit -F \"$F\"\n" +
      "F=$(mktemp); cat > \"$F\" <<'EOF'\n## What\nEOF\ngh pr create -t t --body-file \"$F\"",
  )
  const texts = two.texts.filter(t => t.where.startsWith('the commit message')).map(t => t.text)
  expect(texts).toContain('fix: first')
  // No tracked variable in the spelling, or one changed in place: not the same file.
  expect(plan("set -- a.md b.md; cat > \"$1\" <<'EOF'\nx\nEOF\nshift; git commit -F \"$1\"").unread).toEqual([
    'the commit message',
  ])
  expect(plan("$f = 'b.md'; 'fix: x' > $f; $f += '.2'; gh pr create -t t --body-file $f", true).unread).toContain(
    'the PR text',
  )
})

test('a folder moved by a stack option, or inside a subshell, is read as the shell moves it', () => {
  const folder = (c: string) => inspect(c, false).files[0]?.folder
  expect(folder('pushd docs; popd +1; git commit -F msg.txt')).toEqual({ isUnknown: true })
  expect(folder('pushd -n docs; git commit -F msg.txt')).toEqual({ isUnknown: true })
  expect(folder('pushd docs; (popd; make); git commit -F msg.txt')).toEqual({ path: 'docs', isUnknown: false })
  expect(folder('(cd sub && make); git commit -F m.txt')).toEqual({ isUnknown: false })
})

// A word that splits anywhere in a git or gh write, a git 2.46 section verb with a run-time section, a
// PowerShell command in value position, and a body file rewritten after it was read.
test('a split word anywhere in a write is unread; after a literal -- it is a path', () => {
  const split = ['git --git-dir=$G commit -m x', 'git commit -S$K -m x', 'git push $X', 'git commit --verbos $V -m x']
  for (const command of split) {
    expect(inspect(command, false).unread).toContain('a word built at run time')
  }
  expect(inspect("git commit -m 'fix: x' -- $FILES", false).unread).toEqual([])
  expect(inspect('git log $RANGE', false).unread).toEqual([])
})

test('a run-time section after a git 2.46 verb is refused', () => {
  for (const command of ['git config remove-section $S', 'git config rename-section $A b']) {
    expect([command, inspect(command, false).block]).toEqual([command, expect.stringContaining('built at run time')])
  }
})

test('a PowerShell command in value position is unknown, a quoted string is text', () => {
  expect(inspect('$m = Get-Date; git commit -m $m', true).unread).toContain('the commit message')
  expect(inspect("$m = 'fix: x'; git commit -m $m", true).unread).toEqual([])
})

test('a body file read before the command writes it again is the file as it was', () => {
  const twice = "cat > m.txt <<'EOF'\nfix: first\nEOF\ngit commit -F m.txt\ncat > m.txt <<'EOF'\nsecond\nEOF"
  const plan = inspect(twice, false)
  expect(plan.texts.filter(t => t.where.startsWith('the commit message')).map(t => t.text)).toContain('fix: first')
})

// A git write whose flags are not walked (push, rebase, am) takes any run-time word as a possible flag,
// before or after a `--`; a PowerShell list is several words, never one.
test('a run-time word on push or rebase is unread, quoted or not, past a -- too', () => {
  const unread = [
    'git push origin main "$NV"',
    'set -- --no-verify; git push origin main "$@"',
    'git push origin "${A[@]}"',
    'git push -o -- origin $REF',
    'git rebase -X "$S" main',
    'git cherry-pick "$C"',
  ]
  const word = expect.arrayContaining(['a word built at run time'])
  for (const command of unread) expect([command, inspect(command, false).unread]).toEqual([command, word])
  for (const command of ['git push origin main', 'git push -u origin HEAD', 'git push origin "feature/$B"']) {
    expect([command, inspect(command, false).unread]).toEqual([command, []])
  }
})

test('a PowerShell list is several words: as a value, a variable or a word of a write', () => {
  expect(inspect("$a = '--no-verify','--quiet'; git commit -m 'fix: x' $a", true).unread).not.toEqual([])
  expect(inspect("$a = @('--no-verify'); git commit -m 'fix: x' $a", true).unread).not.toEqual([])
  expect(inspect('git push origin $a', true).unread).toContain('a word built at run time')
  expect(inspect("git commit -m 'x','--no-verify'", true).unread).toContain('a flag value built at run time')
  expect(inspect("git push origin 'main','--no-verify'", true).unread).toContain('a word built at run time')
  // A comma inside quotes is text.
  expect(inspect("git commit -m 'fix: a, b'", true).unread).toEqual([])
  expect(inspect("$m = 'fix: a, b'; git commit -m $m", true).unread).toEqual([])
})

test('the classic --rename-section with a run-time target is refused', () => {
  expect(inspect('git config --rename-section x $B', false).block).toContain('built at run time')
  expect(inspect('git config --rename-section alias.a alias.b', false).block).toBeUndefined()
})

test('a relative body file is the written one only when named in the same known folder', () => {
  const body = "cat > m.md <<'EOF'\nfix: x\nEOF\n"
  const message = (command: string) => inspect(command, false).files.find(f => f.where === 'the commit message')
  expect(message(`${body}git commit -F m.md`)?.written).toBe(true)
  expect(message(`${body}cd "$REPO" && git commit -F m.md`)?.written).toBeUndefined()
  expect(message(`${body}cd sub && git commit -F m.md`)?.written).toBeUndefined()
  expect(message(`${body}git -C sub commit -F m.md`)?.written).toBeUndefined()
  expect(message(`cd sub; ${body}git commit -F m.md`)?.written).toBe(true)
  // A writer after `&&` may not have run by the next line: the file on disk is read too.
  expect(message(`cd sub && ${body}git commit -F m.md`)?.written).toBeUndefined()
  expect(message("cd sub && cat > m.md <<'EOF' && git commit -F m.md\nfix: x\nEOF")?.written).toBe(true)
  expect(message("cat > /tmp/m.md <<'EOF'\nfix: x\nEOF\ncd sub && git commit -F /tmp/m.md")?.written).toBe(true)
})

// A PowerShell expression is computed, never text: as a stored value, a word of a write, or a splat.
test('a PowerShell expression or splat on a write is unread; a plain string is text', () => {
  const unread = [
    "$a = '--no-verify'.Trim(); git push origin main $a",
    "$a = [string]'--no-verify'; git commit -m 'fix: x' $a",
    "$a = '--no-'+'verify'; git commit -m 'fix: x' $a",
    "$o = ' --no-verify'; git push origin main $o.Trim()",
    "$a = @('--no-verify'); git push origin main @a",
    "$a = '--no-verify'; git push origin @a",
  ]
  for (const command of unread) expect([command, inspect(command, true).unread]).not.toEqual([command, []])
  expect(inspect("$o = ' x'; git push origin main $o.Trim()", true).unread).toContain('a word built at run time')
  expect(inspect("$m = 'fix: x'; git commit -m $m", true).unread).toEqual([])
  expect(inspect("$m = 'fix: x'; git commit -m \"$m (y)\"", true).unread).toEqual([])
  expect(inspect("$n = 3; git commit -m 'fix: x'", true).unread).toEqual([])
})

test('a separator inside a quoted value never hides the subcommand', () => {
  const command = "git -c credential.helper='!f() { echo x; }; f' push origin $REF"
  expect(inspect(command, false).unread).toContain('a word built at run time')
  expect(inspect("git -C 'D:/a&b' push origin \"$R\"", false).unread).toContain('a word built at run time')
})

test("a file a writer reads is where the writer ran", () => {
  const command = 'cd docs && cat CHANGES.md > /tmp/b.md && cd .. && gh pr create -t t --body-file /tmp/b.md'
  const plan = inspect(command, false)
  expect(plan.files.find(f => f.path === 'CHANGES.md')?.folder).toEqual({ path: 'docs', isUnknown: false })
})

test('a $(mktemp) file is a full path, so a folder change keeps it the written one', () => {
  const body = "cat > \"$F\" <<'EOF'\nfix: x\nEOF\n"
  const message = (command: string) => inspect(command, false).files.find(f => f.where === 'the commit message')
  expect(message(`F=$(mktemp)\n${body}git -C ../repo commit -F "$F"`)?.written).toBe(true)
  expect(message(`F=$(mktemp -t m.XXXX)\n${body}cd sub && git commit -F "$F"`)?.written).toBe(true)
  // With a template or a folder of its own, mktemp may print a relative path.
  expect(message(`F=$(mktemp -p .)\n${body}cd sub && git commit -F "$F"`)?.written).toBeUndefined()
  expect(message(`F=$(mktemp m.XXXX)\n${body}cd sub && git commit -F "$F"`)?.written).toBeUndefined()
})

// A PowerShell splat may hand over a subcommand or global options, and `--%` passes the rest raw.
test('a PowerShell splat up to the subcommand, or raw mode, makes a write unread', () => {
  const unread = [
    "$a = @('-c','core.hooksPath=/dev/null'); git @a commit -m 'fix: x'",
    'git @a push origin main',
    'gh @a pr create -t t --body-file b.md',
    'gh pr @a',
    'git -C @a commit -m x',
    'git -c @a commit -m x',
    'git --git-dir @a commit -m x',
    'git --% commit -m x %NV%',
    'git push origin main --% %NV%',
  ]
  for (const command of unread) expect([command, inspect(command, true).unread]).not.toEqual([command, []])
  // After the action word a splat is never the typed text: unread too.
  expect(inspect("$p = @{ title = 't' }; gh pr create @p", true).unread).toEqual(['the PR text'])
})

test('a braced variable with a member or an index is computed, never filled in', () => {
  for (const tail of ['.Trim()', '[0]', '.Substring(1)']) {
    const command = `$o = '--no-verify'; git push origin main \${o}${tail}`
    expect([command, inspect(command, true).unread]).toEqual([command, ['a word built at run time']])
  }
})

test('a file a fed writer reads is fed in turn, wherever the command runs', () => {
  const command = "cat > a.md <<'EOF'\nthe body\nEOF\ncat a.md > /tmp/b.md\ngh pr create -t t --body-file /tmp/b.md"
  const plan = inspect(command, false)
  expect(plan.texts.some(t => t.text.includes('the body') && !t.creditOnly)).toBe(true)
  expect(plan.files.find(f => f.path === 'a.md')?.written).toBe(true)
  expect(inspect(`cd sub; ${command}`, false).files.find(f => f.path === 'a.md')?.written).toBe(true)
  // A writer that reads its own file is fed once.
  expect(inspect('cat m.md >> m.md; git commit -F m.md', false).files.length).toBeLessThan(5)
})

// A bare PowerShell variable may hold a list, a splat any words, and `--%` passes the rest raw.
test('a list, splat or raw mode in a value or subcommand spot makes a write unread', () => {
  const unread = [
    'gh pr -R @a',
    'gh -R @a',
    "$d = '.','-c','core.hooksPath=/dev/null'; git -C $d push origin main",
    "$d = 'now','--no-verify'; git commit --date $d -m 'fix: x'",
    "$b = 'main','--body-file','o.md'; gh pr create -t t --body-file b.md --base $b",
    "$r = 'o/r','create','--body-file','b.md'; gh pr -R $r",
    'git --% %S% -m x %NV%',
    'gh --% %G% create --body-file b.md',
    'git --% --namespace ; commit --no-verify -m x',
  ]
  for (const command of unread) expect([command, inspect(command, true).unread]).not.toEqual([command, []])
  expect(inspect("$d = '.'; git -C $d push origin main", true).unread).toEqual([])
})

test('git options that take a separate value are skipped with it', () => {
  for (const command of ['git --attr-source HEAD commit --no-verify -m x', 'git --attr-source HEAD push --no-verify']) {
    expect([command, inspect(command, false).block]).toEqual([command, expect.stringContaining('hook')])
  }
})

// cmd fills in `%NAME%`, drops `^` and splits its line at `&` and `|`, unlike the shell.
test('a git or gh call in a cmd script with cmd syntax is unread', () => {
  const bash = [
    'NV=--no-verify cmd //c git commit -m x %NV%',
    'cmd //c git commit --no-veri^fy -m x',
    'cmd //c git %S% -m x',
  ]
  for (const command of bash) expect([command, inspect(command, false).unread]).not.toEqual([command, []])
  expect(inspect('cmd /c "git commit --no-veri^fy -m x"', false).unread).not.toEqual([])
  expect(inspect("cmd /c git status '&' git commit --no-verify -m x", true).unread).not.toEqual([])
  expect(inspect("$p = @{ nm = 'x' }; git commit @p", true).unread).not.toEqual([])
  expect(inspect('$n = 42; gh pr merge $n --merge', true).unread).toEqual([])
})

// A git alias, include or config file the command sets may turn a call into a write that skips the hooks.
test('a git alias, include or config file set in the command makes its git calls unread', () => {
  const unread = [
    'git -c alias.ci="commit --no-verify" ci -m x',
    "git -c alias.ci='!git commit --no-verify' ci -m x",
    'git -c alias.c=commit c -m x',
    'git config alias.ci "commit --no-verify"; git ci -m x',
    'A="commit --no-verify" git --config-env=alias.ci=A ci -m x',
    'git -c include.path=/tmp/h.cfg commit -m x',
    'git config --global include.path /tmp/h.cfg; git commit -m x',
    'GIT_CONFIG_GLOBAL=/tmp/h.cfg git commit -m x',
  ]
  const setting = expect.arrayContaining(['a git setting built at run time'])
  for (const command of unread) expect([command, inspect(command, false).unread]).toEqual([command, setting])
  expect(inspect("git -c user.name=me commit -m 'fix: x'", false).unread).toEqual([])
})

// Whether a call writes is told from its subcommand as parsed: a write word inside a `$(...)` or a path is no
// write, so a read-only call with a word built at run time is read as it is.
test('a read-only git or gh call with a word built at run time is never unread', () => {
  const reads = [
    'git diff $(git merge-base origin/develop HEAD)',
    'git log --oneline $(git merge-base HEAD origin/develop)..HEAD',
    'git rev-list --count $(git merge-base HEAD origin/develop)..HEAD',
    'git log $(git rev-parse HEAD~3)..HEAD -- docs/commit-format.md',
    'git add $(git diff --name-only | grep commit)',
    'git stash push -m "$(date)"',
    'cmd //c "git log --oneline | findstr fix"',
    'gh pr view $(gh pr list --json number --jq ".[0].number")',
    'G=git; $G diff $(git merge-base a b)',
    'eval "git diff $(git merge-base a b) $X"',
  ]
  for (const command of reads) {
    const plan = inspect(command, false)
    expect([command, plan.unread, plan.block]).toEqual([command, [], undefined])
  }
  // The same shapes on a write, or with the subcommand itself built at run time, stay unread or refused.
  const writes = [
    'git push $(git rev-parse --abbrev-ref HEAD) $OPTS',
    'git commit -m x $(echo --no-verify)',
    'git $(echo commit) -m x',
    'git -C $D commit -m x',
    'gh pr comment 5 $ARGS',
    'gh -R $R pr view 5',
    'cmd //c "git log | git push --no-verify"',
    'cmd //c "git log & git !S! -m x"',
    'cmd //c "(git log) ^& (git push)"',
    '$G push $(git rev-parse HEAD) $OPTS',
  ]
  for (const command of writes) {
    const plan = inspect(command, false)
    expect([command, plan.unread.length > 0 || plan.block !== undefined]).toEqual([command, true])
  }
  expect(inspect('eval "git $(cat sub) -m x"', false).block).toContain('eval')
  expect(inspect('eval "bash -c \'git push $X\'"', false).block).toContain('eval')
})

// A value set where it may not run (a branch, after `&&` or `||`), may run later (a function body, a trap,
// a sourced file) or runs in a subshell (a pipeline part, a background job) is never taken as the only one.
test('a value set in a branch is known inside it and unknown after it', () => {
  const unread = [
    "if [ -n \"$x\" ]; then M='made by a bot'; else M='fix: x'; fi; git commit -m \"$M\"",
    "[ -n \"$M\" ] || M='fix: x'; git commit -m \"$M\"",
    "M='fix: x'; test -f a && M='fix: y'; git commit -m \"$M\"",
    "while read -r l; do M=\"$l\"; done < f; git commit -m \"$M\"",
    "for m in a b; do M='fix: x'; done; git commit -m \"$M\"",
    "f() { M='made by a bot'; }; M='fix: x'; f; git commit -m \"$M\"",
    "function f { M='made by a bot'; }; M='fix: x'; f; git commit -m \"$M\"",
    "trap 'M=bot' DEBUG; M='fix: x'; git commit -m \"$M\"",
    "M='fix: x'; . ./env.sh; git commit -m \"$M\"",
    "M='fix: x' | cat; git commit -m \"$M\"",
    "M='fix: x' & git commit -m \"$M\"",
    "export M='fix: x'; BASH_ENV=e.sh bash -c 'git commit -m \"$M\"'",
  ]
  for (const command of unread) {
    expect([command, inspect(command, false).unread]).toEqual([command, expect.arrayContaining(['the commit message'])])
  }
  const ps = [
    "if ($a) { $m = 'made by a bot' } else { $m = 'fix: x' }; git commit -m $m",
    "function f { $script:m = 'made by a bot' }; $m = 'fix: x'; f; git commit -m $m",
  ]
  for (const command of ps) expect([command, inspect(command, true).unread]).not.toEqual([command, []])
  const message = (c: string, ps = false) =>
    inspect(c, ps).texts.filter(t => !t.creditOnly && t.where === 'the commit message').map(t => t.text)
  // Inside the branch that set it, after `&&` in the same list, or in a plain `{ }` group, it is known.
  expect(message("if c; then M='fix: x'; git commit -m \"$M\"; fi")).toEqual(['fix: x'])
  expect(message("cd repo && M='fix: x' && git commit -m \"$M\"")).toEqual(['fix: x'])
  expect(message("M='fix: x'; git commit -m \"$M\" || echo failed")).toEqual(['fix: x'])
  expect(message("{ M='fix: x'; }; git commit -m \"$M\"")).toEqual(['fix: x'])
  expect(message("$m = 'fix: x'; $script:m = 'chore: y'; git commit -m $m", true)).toEqual(['chore: y'])
  // A `cd` in a branch leaves the folder unknown after it.
  expect(inspect('test -d sub && cd sub; git commit -m x', false).targets[0]?.folder.isUnknown).toBe(true)
  expect(inspect('cd sub && git commit -m x', false).targets[0]?.folder).toEqual({ path: 'sub', isUnknown: false })
  // A body file a branch may write: every writer back to one that surely ran is read, and the file on disk.
  const twice = "cat > b.md <<'EOF'\none\nEOF\n[ -f x ] && cat > b.md <<'EOF'\ntwo\nEOF\ngh pr create -t t -F b.md"
  const plan = inspect(twice, false)
  expect(['one', 'two'].map(w => plan.texts.some(t => t.text.includes(w) && !t.creditOnly))).toEqual([true, true])
  expect(plan.files.find(f => f.path === 'b.md')?.written).toBe(true)
  const maybe = inspect("[ -f x ] && cat > b.md <<'EOF'\ntwo\nEOF\ngh pr create -t t -F b.md", false)
  expect(maybe.files.find(f => f.path === 'b.md')?.written).toBeUndefined()
})

// Bash reads a list left to right: in `a || b && c`, `c` also runs when `b` never did.
test('after an || then an &&, a value or cd the || part set is unknown', () => {
  const plan = inspect(`[ -n "$M" ] || M='fix: x' && git commit -m "$M"`, false)
  expect(plan.unread).toContain('the commit message')
  expect(inspect('test -d .git || cd repo && git commit -am x', false).targets[0]?.folder.isUnknown).toBe(true)
  expect(inspect(`a && b || M='fix: x' && git commit -m "$M"`, false).unread).toContain('the commit message')
  // Inside one `&&` run after the `||`, the value set there is still known.
  expect(inspect(`a || b && M='fix: x' && git commit -m "$M"`, false).unread).toEqual([])
})

// Only a real setting moves git's config: a path or a read named like one never does.
test('a word named like a git alias or include is no setting', () => {
  for (const command of [
    'git diff include.php',
    'git log -p alias.go',
    'git config --get alias.co',
    "git add include.php && git commit -m 'fix: x'",
    "git commit -m 'alias.x: y'",
    'unset GIT_CONFIG_GLOBAL; git status',
  ]) {
    const plan = inspect(command, false)
    expect([command, plan.unread, plan.block]).toEqual([command, [], undefined])
  }
  expect(inspect("export GIT_CONFIG_GLOBAL=/tmp/h.cfg; git commit -m 'fix: x'", false).unread).toEqual([
    'a git setting built at run time',
  ])
})

test('a branch name built at run time is unread in every spelling', () => {
  for (const command of ['git branch "$NAME"', 'git branch -m old "$NAME"', 'git checkout -b "$NAME"']) {
    expect([command, inspect(command, false).unread]).toEqual([command, ['the new branch name']])
  }
})

// PowerShell has its own spellings for the same routes: a git setting, an environment variable, a dot-source.
test('PowerShell git settings, env drive and .NET spellings, and dot-sourcing are read', () => {
  for (const command of [
    'git -c alias.ci="commit --no-verify" ci -m x',
    "git config alias.ci 'commit --no-verify'; git ci -m x",
    'git config --global include.path h.cfg; git commit -m x',
    '. $git commit -m x',
  ]) {
    expect([command, inspect(command, true).unread]).not.toEqual([command, []])
  }
  for (const [command, reason] of [
    ['Set-Item env:LEFTHOOK 0; git commit -m x', 'lefthook'],
    ['Set-Item -Path Env:LEFTHOOK -Value 0; git commit -m x', 'lefthook'],
    ["[Environment]::SetEnvironmentVariable('LEFTHOOK', '0'); git commit -m x", 'lefthook'],
    ['. git commit --no-verify -m x', 'skipping git hooks'],
  ] as const) {
    expect([command, inspect(command, true).block]).toEqual([command, expect.stringContaining(reason)])
  }
  expect(inspect('Set-Item env:GIT_DIR C:/x; git commit -m x', true).targets[0]?.folder.isUnknown).toBe(true)
})

test('a git branch listing option takes its value, never names a new branch', () => {
  for (const command of [
    'git branch --points-at "$(git rev-parse HEAD)"',
    'git branch --no-contains "$BASE"',
    'git branch --format "$F"',
    'git branch --sort refname',
  ]) {
    const plan = inspect(command, false)
    expect([command, plan.unread, plan.branches]).toEqual([command, [], []])
  }
})
