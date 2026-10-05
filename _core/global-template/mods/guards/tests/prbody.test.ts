import { expect, test } from 'claude-code/testing'
import { checkBody, checkCall, readPr, ruleFor } from '../hooks/prbody'
import type { PrWord } from '../hooks/prbody'

// The PR-body contract, pure: how a `gh pr` call passes its body, and the body against the format.

const RULE = { row: '^(Resolves|Part of) #\\d+\\s*$', noRow: '^(docs|chore)\\(' }
const GOOD = '## What\n- add the thing\n\n## Why\nIt was missing.\n\nResolves #12\n'

// Plain words as the reading hands them over; `dyn` marks one the shell builds at run time.
const pr = (action: 'create' | 'edit', words: (string | PrWord)[]) =>
  readPr(action, words.map(w => (typeof w === 'string' ? { text: w } : w)))
const dyn = (text: string): PrWord => ({ text, dynamic: true })

test('reads the title, body file and inline or fill flags in every spelling', () => {
  expect(pr('create', ['--title', 'feat: x', '--body-file', 'b.md'])).toMatchObject({
    title: 'feat: x',
    bodyFile: 'b.md',
    isInline: false,
    isFilled: false,
  })
  const equals = pr('create', ['--title=feat: y', '--body-file=c.md'])
  expect(equals).toMatchObject({ title: 'feat: y', bodyFile: 'c.md' })
  expect(pr('create', ['-tfeat: z', '-Fd.md'])).toMatchObject({ title: 'feat: z', bodyFile: 'd.md' })
  expect(pr('create', ['--body', 'text']).isInline).toBe(true)
  expect(pr('edit', ['5', '-b', 'text']).isInline).toBe(true)
  expect(pr('create', ['--body=text']).isInline).toBe(true)
  for (const flag of ['-f', '-w', '--fill', '--fill-first', '--fill-verbose', '--web'])
    expect(pr('create', [flag]).isFilled).toBe(true)
  expect(pr('create', ['--base', 'develop', '--title', 't']).isFilled).toBe(false)
})

test('a body must come from a file; an edit that sets no body passes', () => {
  expect(checkCall(pr('create', ['--title', 't', '--body', 'x']))).toContain('inline `--body`')
  expect(checkCall(pr('create', ['--fill']))).toContain('`--fill*`')
  expect(checkCall(pr('create', ['--title', 't']))).toContain('needs `--body-file')
  expect(checkCall(pr('edit', ['5', '--add-label', 'bug']))).toBeUndefined()
  expect(checkCall(pr('create', ['--title', 't', '--body-file', 'b.md']))).toBeUndefined()
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
  const rules = { repos: { emberholm: RULE } }
  expect(ruleFor(rules, 'Emberholm')).toBe(RULE)
  expect(ruleFor(rules, 'emberholm-smoke')).toBe(RULE)
  expect(ruleFor(rules, 'peh-board')).toBeUndefined()
  expect(ruleFor(undefined, 'emberholm')).toBeUndefined()
})

test('a word that may stand for several flags makes the call unknown, never judged', () => {
  expect(pr('create', ['@params']).isUnknown).toBe(true)
  expect(pr('create', [dyn('$ARGS')]).isUnknown).toBe(true)
  expect(pr('create', ['--title', dyn('$T'), '--body-file', 'b.md']).isUnknown).toBe(false)
  expect(pr('create', [dyn('--title=$T'), '--body-file', 'b.md']).isUnknown).toBe(false)
  expect(checkCall(pr('create', ['@params']))).toBeUndefined()
})

test("a section ends at the repo's own board-row line, whatever its verb", () => {
  const closes = { row: '^Closes #\\d+$' }
  expect(checkBody('## What\n- a\n## Why\nCloses #4', 'feat: x', closes)).toContain('`## Why` is missing or empty')
  expect(checkBody('## What\n- a\n## Why\nb\n## Notes\n\nCloses #4', 'feat: x', closes)).toContain('`## Notes`')
  expect(checkBody('## What\n- a\n## Why\nb\nCloses #4', 'feat: x', closes)).toBeUndefined()
  // Without a row rule only headings end a section: such a line is part of the text.
  expect(checkBody('## What\n- a\n## Why\nResolves #4', 'feat: x', {})).toBeUndefined()
})

test('a variable after a flag that takes no value may carry any flag', () => {
  expect(pr('create', ['--draft', dyn('$FLAGS')]).isUnknown).toBe(true)
  expect(pr('create', ['-d', dyn('$FLAGS')]).isUnknown).toBe(true)
  expect(pr('create', ['--label', dyn('$L'), '--body-file', 'b.md']).isUnknown).toBe(false)
})

test('of overlapping repo keys the longest wins, whatever the file order', () => {
  const short = { row: 'a' }
  const long = { row: 'b' }
  expect(ruleFor({ repos: { game: short, 'game-smoke': long } }, 'game-smoke')).toBe(long)
  expect(ruleFor({ repos: { 'game-smoke': long, game: short } }, 'game-smoke')).toBe(long)
  expect(ruleFor({ repos: { game: short, 'game-smoke': long } }, 'game')).toBe(short)
})

test('a title built at run time is marked, in every spelling', () => {
  expect(pr('create', ['--title', dyn('$T')]).isTitleDynamic).toBe(true)
  expect(pr('create', [dyn('--title=$T')]).isTitleDynamic).toBe(true)
  expect(pr('create', [dyn('-t$T')]).isTitleDynamic).toBe(true)
  expect(pr('create', ['--title', 'feat: x', '--base', dyn('$B')]).isTitleDynamic).toBe(false)
})

test('the value of --recover is a value, never a flag', () => {
  expect(pr('create', ['--recover', dyn('$STATE'), '--body-file', 'b.md']).isUnknown).toBe(false)
})
