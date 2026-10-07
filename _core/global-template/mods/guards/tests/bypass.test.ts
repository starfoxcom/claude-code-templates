import { expect, test } from 'claude-code/testing'

import { bypassReason, maskQuoted } from '../hooks/bypass'
import { inspect } from '../hooks/inspect'

// Each route around the check, refused as the shipped attribution hook refuses it.
const REFUSED: [string, string][] = [
  ['git filter-repo --version', 'history rewriting'],
  ['git filter-branch --tree-filter x HEAD', 'history rewriting'],
  ["git commit --no-verify -m 'fix: x'", 'hook bypass'],
  ["git commit -n -m 'fix: x'", 'hook bypass'],
  ["git -c core.hooksPath=/dev/null commit -m 'fix: x'", 'hook bypass'],
  ["LEFTHOOK=0 git commit -m 'fix: x'", 'hook bypass'],
  ["git commit -m 'fix: x' --trailer 'Reviewed-by: a'", '--trailer'],
  ['git commit -C HEAD~1', "reusing another commit's message"],
  ['git commit --reuse-message=HEAD', "reusing another commit's message"],
  ['eval git commit -m "$MSG"', 'eval'],
  ['lefthook uninstall', 'disabling lefthook'],
  ['$env:LEFTHOOK=0; git status', 'disabling lefthook'],
]

for (const [command, reason] of REFUSED) {
  test(`refused: ${command}`, () => {
    expect(bypassReason(command, false)).toContain(reason)
    // The reading carries it as the command's block.
    expect(inspect(command, false).block).toContain(reason)
  })
}

// One step either side: the same words as text, as another git command, or with no write at all.
const PASSED = [
  "git commit -m 'docs: explain --no-verify and --trailer'",
  'git commit -F - <<\'EOF\'\ndocs: never run git filter-repo here\nEOF',
  "gh pr create --title 'docs: eval is refused' --body 'x'",
  'git tag -n',
  // A push writes no message, so the hook reads none: its `-n` (a dry run) passes.
  'git push -n origin main',
  // Quoted, the eval's command is text: only what is typed as arguments counts.
  'eval "git commit -m x"',
  'git cherry-pick -n abc123',
  'git log --format=%B -n 1',
  'git config --get core.hooksPath',
  'eval "$(ssh-agent)"',
  "git commit -m 'fix: x'",
]

for (const command of PASSED) {
  test(`passed: ${command}`, () => {
    expect(bypassReason(command, false)).toBeUndefined()
  })
}

test('maskQuoted blanks quoted text and here-doc bodies, keeping line breaks and length', () => {
  const command = "git commit -m 'a --no-verify' -m \"b \\\" c\" <<'EOF'\n--trailer\nEOF\ngit status"
  const masked = maskQuoted(command, false)
  expect(masked).toHaveLength(command.length)
  expect(masked).not.toContain('--no-verify')
  expect(masked).not.toContain('--trailer')
  expect(masked).toContain('git status')
  expect(masked.split('\n')).toHaveLength(command.split('\n').length)
  // PowerShell escapes with a backtick inside double quotes.
  expect(maskQuoted('git commit -m "a `" --no-verify"', true)).not.toContain('--no-verify')
})
