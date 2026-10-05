import { expect, test } from 'claude-code/testing'
import { checkBody, checkCall, readPr, ruleFor } from '../hooks/prbody'

// The PR-body contract, pure: how a `gh pr` call passes its body, and the body against the format.

const RULE = { row: '^(Resolves|Part of) #\\d+\\s*$', noRow: '^(docs|chore)\\(' }
const GOOD = '## What\n- add the thing\n\n## Why\nIt was missing.\n\nResolves #12\n'

test('reads the title, body file and inline or fill flags in every spelling', () => {
  expect(readPr('create', ['--title', 'feat: x', '--body-file', 'b.md'])).toMatchObject({
    title: 'feat: x',
    bodyFile: 'b.md',
    isInline: false,
    isFilled: false,
  })
  const equals = readPr('create', ['--title=feat: y', '--body-file=c.md'])
  expect(equals).toMatchObject({ title: 'feat: y', bodyFile: 'c.md' })
  expect(readPr('create', ['-tfeat: z', '-Fd.md'])).toMatchObject({ title: 'feat: z', bodyFile: 'd.md' })
  expect(readPr('create', ['--body', 'text']).isInline).toBe(true)
  expect(readPr('edit', ['5', '-b', 'text']).isInline).toBe(true)
  expect(readPr('create', ['--body=text']).isInline).toBe(true)
  for (const flag of ['-f', '-w', '--fill', '--fill-first', '--fill-verbose', '--web'])
    expect(readPr('create', [flag]).isFilled).toBe(true)
  expect(readPr('create', ['--base', 'develop', '--title', 't']).isFilled).toBe(false)
})

test('a body must come from a file; an edit that sets no body passes', () => {
  expect(checkCall(readPr('create', ['--title', 't', '--body', 'x']))).toContain('inline `--body`')
  expect(checkCall(readPr('create', ['--fill']))).toContain('`--fill*`')
  expect(checkCall(readPr('create', ['--title', 't']))).toContain('needs `--body-file')
  expect(checkCall(readPr('edit', ['5', '--add-label', 'bug']))).toBeUndefined()
  expect(checkCall(readPr('create', ['--title', 't', '--body-file', 'b.md']))).toBeUndefined()
})

test('the body is checked section by section, then for its board row', () => {
  const cases: [string, string, string | undefined][] = [
    [GOOD, 'feat: x', undefined],
    ['## Why\nbecause\nResolves #1', 'feat: x', '`## What` is missing'],
    ['## What\nprose only\n## Why\nb\nResolves #1', 'feat: x', 'has no bullet'],
    ['## What\n- a\n## Why\n\nResolves #1', 'feat: x', '`## Why` is missing or empty'],
    ['## What\n- a\n## Why\nb\n## Notes\n\nResolves #1', 'feat: x', '`## Notes` is present but empty'],
    ['## What\n- a\n## Why\nb\n## Notes\nmanual step\nResolves #1', 'feat: x', undefined],
    ['## What\n- a\n## Why\nb\n', 'feat: x', 'no board-row line'],
    ['## What\n- a\n## Why\nb\n', 'docs(context): refresh', undefined],
    ['## What\n- a\n## Why\nb\nResolves #12 and more', 'feat: x', 'no board-row line'],
    ['## What\r\n- a\r\n## Why\r\nb\r\nPart of #3\r\n', 'fix: y', undefined],
  ]
  for (const [body, title, want] of cases) {
    const got = checkBody(body, title, RULE)
    if (want === undefined) expect(got).toBeUndefined()
    else expect(got).toContain(want)
  }
  // A repo without a row rule checks the format only.
  expect(checkBody('## What\n- a\n## Why\nb\n', 'feat: x', {})).toBeUndefined()
})

test('a rule applies to every repo whose name contains its key', () => {
  const rules = { repos: { gameproject: RULE } }
  expect(ruleFor(rules, 'GameProject')).toBe(RULE)
  expect(ruleFor(rules, 'gameproject-smoke')).toBe(RULE)
  expect(ruleFor(rules, 'the public board')).toBeUndefined()
  expect(ruleFor(undefined, 'gameproject')).toBeUndefined()
})
