import { expect, test } from 'claude-code/testing'

import { classify, compile, labelFor, segments } from '../hooks/classify'
import { RULES, rulesFor as listsFor } from '../hooks/rules'

function rulesFor(project = 'some-other-project') {
  const lists = listsFor(`C:\\Repos\\${project}`)
  return { light: compile(lists.light), heavy: compile(lists.heavy) }
}

test('segments split outside quotes only and unquote the command word', () => {
  expect(segments('git commit -m "a && b; c" && flutter test')).toEqual(['git commit -m "a && b; c"', 'flutter test'])
  expect(segments('& "C:\\Program Files\\Godot\\godot.windows.opt.tools.64.exe" --headless')).toEqual([
    'C:\\Program Files\\Godot\\godot.windows.opt.tools.64.exe --headless',
  ])
  expect(segments('CI=1 npm test | tee out.txt')).toEqual(['npm test', 'tee out.txt'])
})

test('global rules: builds and suites are heavy, git and scoped tests are light', () => {
  const { light, heavy } = rulesFor()
  const is = (c: string) => classify(c, light, heavy)
  expect(is('flutter test')).toBe('heavy')
  expect(is('cd app && flutter build windows')).toBe('heavy')
  expect(is('flutter test test/widget_test.dart')).toBe('light')
  expect(is('npm run build')).toBe('heavy')
  expect(is('npm ci')).toBe('heavy')
  expect(is('node --test')).toBe('heavy')
  expect(is('node --test test/pcctl.spec.cjs')).toBe('light')
  expect(is('node --test test/pcctl.spec.cjs 2>&1 | Select-String fail')).toBe('light')
  expect(is('flutter test test/a_test.dart > out.txt 2>&1')).toBe('light')
  expect(is('flutter test 2>&1 | tail -5')).toBe('heavy')
  expect(is('git commit -m "fix flutter test flake"')).toBe('light')
  expect(is('gh pr create --body "runs npm test and cargo build"')).toBe('light')
  expect(is('echo "npm test"')).toBe('light')
  expect(is('godot --headless --script x.gd')).toBe('heavy')
  expect(is('godot --version')).toBe('light')
  expect(is('ls -la')).toBe('light')
})

test('bar labels name the heavy part, short', () => {
  const { light, heavy } = rulesFor()
  expect(labelFor('cd app && flutter test', light, heavy)).toBe('flutter test')
  expect(
    labelFor('& "C:\\Program Files (x86)\\Steam\\Godot\\godot.windows.opt.tools.64.exe" --headless', light, heavy),
  ).toBe('godot.windows.opt.tools.64.exe …')
  expect(labelFor('node -e "x" # shared-pc: heavy', light, heavy)).toBe('node -e "x"')
})

test('markers win over every list', () => {
  const { light, heavy } = rulesFor()
  expect(classify('python tools/regen.py # shared-pc: heavy', light, heavy)).toBe('heavy')
  expect(classify('flutter test # shared-pc: light', light, heavy)).toBe('light')
})

test('a project entry: its own lists come first, by folder name or root, and stay out of other projects', () => {
  RULES.projects['my-game'] = {
    heavy: [
      String.raw`^ctest\b`,
      String.raw`tools[\\/]perf[\\/]`,
      String.raw`start-runners\.cmd`,
      String.raw`My Engine`,
    ],
    light: [String.raw`^ctest\b.*(\s-R\s|--tests-regex)`, String.raw`\bwsl(\.exe)?\s+--shutdown\b`],
  }
  try {
    const { light, heavy } = rulesFor('my-game')
    const is = (c: string) => classify(c, light, heavy)
    expect(
      is(
        '& "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Godot\\godot.windows.opt.tools.64.exe" --headless ' +
          '--path game',
      ),
    ).toBe('heavy')
    expect(is('& "$env:LOCALAPPDATA\\Programs\\My Engine\\editor.exe" --headless')).toBe('heavy')
    expect(is('& "C:\\tools\\godot.windows.opt.tools.64.exe" --version')).toBe('light')
    expect(is('cmake --build build --target engine_dll')).toBe('heavy')
    expect(is('ctest --test-dir build')).toBe('heavy')
    expect(is('ctest --test-dir build -R grid_codec')).toBe('light')
    expect(is('pwsh tools/perf/frame_budget.ps1')).toBe('heavy')
    expect(is('start-runners.cmd')).toBe('heavy')
    expect(is('wsl --shutdown')).toBe('light')
    const byRoot = listsFor('C:/Repos/my-game')
    expect(classify('ctest --test-dir build', compile(byRoot.light), compile(byRoot.heavy))).toBe('heavy')
    const other = rulesFor()
    expect(classify('ctest --test-dir build', other.light, other.heavy)).toBe('light')
  } finally {
    delete RULES.projects['my-game']
  }
})
