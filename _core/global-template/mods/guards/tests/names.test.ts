import { expect, test } from 'claude-code/testing'
import { findName, readNameRules } from '../hooks/names'

// Banned names, pure: what a repo's list catches in message text, and the rules file's shape.

const RULE = { names: ['oldkeep', 'engine9x', '.okpak', 'Lantern Studio'], words: ['OK', 'XQ', 'PLUS'] }

test('a name is caught anywhere, in any case', () => {
  const cases: [string, string | undefined][] = [
    ['port the Oldkeep sky', 'Oldkeep'],
    ['same as OldkeepPLUS does', 'Oldkeep'],
    ['load oldkeep_plus.okpak first', 'oldkeep'],
    ['the ENGINE9X renderer', 'ENGINE9X'],
    ['read base.OKPAK', '.OKPAK'],
    ['by Lantern\n  Studio', 'Lantern\n  Studio'],
    ['lantern lighting pass', undefined],
    ['a model file, not a mod', undefined],
  ]
  for (const [text, hit] of cases) expect([text, findName(text, RULE)]).toEqual([text, hit])
})

test('a word is caught whole and in its own case only', () => {
  const cases: [string, string | undefined][] = [
    ['fix: OK-normal world width', 'OK'],
    ['(XQ) behavior', 'XQ'],
    ['the PLUS water mod', 'PLUS'],
    ['read the BOOK', undefined],
    ['run check.ok', undefined],
    ['a plus of a fix', undefined],
    ['OKAY the log', undefined],
    ['LOG_OK_X', undefined],
  ]
  for (const [text, hit] of cases) expect([text, findName(text, RULE)]).toEqual([text, hit])
})

test('the first hit in the text is named, whichever list it is in', () => {
  expect(findName('the OK data from oldkeep', RULE)).toBe('OK')
  expect(findName('oldkeep data, as in OK', RULE)).toBe('oldkeep')
})

test('an empty list and empty entries catch nothing', () => {
  expect(findName('oldkeep OK', {})).toBeUndefined()
  expect(findName('oldkeep OK', { names: [''], words: [''] })).toBeUndefined()
  // A blank entry neither turns off the names after it nor matches a space.
  const blank = { names: [' ', 'oldkeep'], words: ['  ', 'OK'] }
  expect(findName('fix:  (x) "y"', blank)).toBeUndefined()
  expect(findName('port the Oldkeep sky', blank)).toBe('Oldkeep')
  expect(findName('fix: OK width', blank)).toBe('OK')
  // Spaces around an entry are not part of it.
  expect(findName('fix: OK width', { words: [' OK '] })).toBe('OK')
})

test('the rules file must hold lists of strings per repo', () => {
  expect(readNameRules('{"repos":{"my-game":{"names":["a"],"words":["B"]}}}')).toBeDefined()
  expect(readNameRules('{"repos":{"my-game":{"names":"a"}}}')).toBeUndefined()
  expect(readNameRules('{"repos":{"my-game":{"words":[1]}}}')).toBeUndefined()
  expect(readNameRules('{"names":["a"]}')).toBeUndefined()
  expect(() => readNameRules('{oops')).toThrow()
})
