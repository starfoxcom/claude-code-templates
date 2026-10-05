import { expect, test } from 'claude-code/testing'

import { ADD_USAGE, parseAdd, withRunner } from '../hooks/add'

// `/runners add`, pure: the words it takes and the list file it writes.

test('the words after add name the runner, its programs and an optional repo', () => {
  expect(parseAdd(['ci', 'Runner.Listener'])).toEqual({ label: 'ci', processes: ['Runner.Listener'] })
  expect(parseAdd(['ci', 'a,b,', 'me/my-game'])).toEqual({ label: 'ci', processes: ['a', 'b'], repo: 'me/my-game' })
  for (const words of [[], ['ci'], ['ci', ','], ['ci', 'a', 'me/x', 'extra']])
    expect([words, parseAdd(words)]).toEqual([words, { error: ADD_USAGE }])
  const notRepo = { error: `"not-a-repo" is not an owner/repo name.\n${ADD_USAGE}` }
  expect(parseAdd(['ci', 'a', 'not-a-repo'])).toEqual(notRepo)
})

test('the runner is added to the list file, which keeps what it held', () => {
  const runner = { label: 'ci', processes: ['a'] }
  expect(withRunner(undefined, runner)).toEqual({ text: `${JSON.stringify([runner], null, 2)}\n` })
  expect(withRunner('  ', runner)).toEqual({ text: `${JSON.stringify([runner], null, 2)}\n` })
  const old = { label: 'gpu', processes: ['x'], extra: 1 }
  expect(withRunner(JSON.stringify([old]), runner)).toEqual({ text: `${JSON.stringify([old, runner], null, 2)}\n` })
})

test('a file that is not a JSON list, or already names the runner, is left alone', () => {
  const runner = { label: 'CI', processes: ['a'] }
  expect(withRunner('{ broken', runner)).toEqual({
    error: 'The runners list file is not valid JSON; fix it by hand first.',
  })
  expect(withRunner('{"label":"x"}', runner)).toEqual({
    error: 'The runners list file does not hold a JSON list; fix it by hand first.',
  })
  expect(withRunner('[{"label":"ci","processes":["b"]}]', runner)).toEqual({
    error: 'A runner named "CI" is already listed.',
  })
  // An entry the mod would not read still holds its name.
  expect(withRunner('[null, {"label":"ci"}]', runner)).toEqual({ error: 'A runner named "CI" is already listed.' })
})
