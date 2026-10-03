import { expect, test } from 'claude-code/testing'

import { modelName, parseStatus } from '../hooks/git'

const STATUS_CASES = [
  {
    name: 'upstream, ahead and behind',
    stdout: '## develop...origin/develop [ahead 2, behind 3]\n M a.ts\n?? b.ts\n',
    want: { branch: 'develop', ahead: 2, behind: 3, changed: [' M a.ts', '?? b.ts'] },
  },
  {
    name: 'ahead only',
    stdout: '## x...origin/x [ahead 1]\n',
    want: { branch: 'x', ahead: 1, behind: 0, changed: [] },
  },
  {
    name: 'behind only',
    stdout: '## x...origin/x [behind 4]',
    want: { branch: 'x', ahead: 0, behind: 4, changed: [] },
  },
  {
    name: 'no upstream',
    stdout: '## feature/a-b\n',
    want: { branch: 'feature/a-b', ahead: 0, behind: 0, changed: [] },
  },
  {
    name: 'upstream gone',
    stdout: '## x...origin/x [gone]\n',
    want: { branch: 'x', ahead: 0, behind: 0, changed: [] },
  },
  {
    name: 'detached',
    stdout: '## HEAD (no branch)\n M a\n',
    want: { ahead: 0, behind: 0, changed: [' M a'] },
  },
  {
    name: 'fresh repository',
    stdout: '## No commits yet on main\n?? a\n',
    want: { branch: 'main', ahead: 0, behind: 0, changed: ['?? a'] },
  },
  {
    name: 'CRLF output',
    stdout: '## x\r\n M a\r\n',
    want: { branch: 'x', ahead: 0, behind: 0, changed: [' M a'] },
  },
  {
    name: 'rename keeps both paths',
    stdout: '## x\nR  old.ts -> new.ts\n',
    want: { branch: 'x', ahead: 0, behind: 0, changed: ['R  old.ts -> new.ts'] },
  },
  { name: 'empty output', stdout: '', want: { ahead: 0, behind: 0, changed: [] } },
  {
    name: 'not porcelain',
    stdout: 'fatal: not a git repository\n',
    want: { ahead: 0, behind: 0, changed: [] },
  },
]

for (const { name, stdout, want } of STATUS_CASES) {
  test(`parseStatus: ${name}`, () => {
    expect(parseStatus(stdout)).toEqual(want)
  })
}

const MODEL_CASES: [string, string][] = [
  ['claude-opus-5-5[1m]', 'Opus 5.5'],
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-fable-5-1', 'Fable 5.1'],
  ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
  ['claude-sonnet-4-20250514', 'Sonnet 4'],
  ['opus', 'opus'],
  ['', ''],
]

for (const [id, want] of MODEL_CASES) {
  test(`modelName: ${id || '(empty)'}`, () => {
    expect(modelName(id)).toBe(want)
  })
}
