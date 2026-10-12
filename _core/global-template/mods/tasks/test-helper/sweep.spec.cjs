// Run: node --test test-helper/sweep.spec.cjs
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const SWEEP = path.join(__dirname, '..', 'scripts', 'sweep.cjs')

const ID = '0f8c2b3a-1d4e-4f5a-9b6c-7d8e9f0a1b2c'
const OTHER = '11111111-2222-4333-8444-555555555555'
const RECENT = '22222222-3333-4444-8555-666666666666'
const THREE_DAYS_AGO = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000

// A data folder holding each file, all three days old but `recent`.
function folderWith(names, recent = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-'))
  for (const name of [...names, ...recent]) fs.writeFileSync(path.join(dir, name), '{}')
  for (const name of names) fs.utimesSync(path.join(dir, name), THREE_DAYS_AGO, THREE_DAYS_AGO)
  return dir
}

const run = (...args) => execFileSync(process.execPath, [SWEEP, ...args], { encoding: 'utf8', stdio: 'pipe' })

test("the sweep removes only other sessions' old task lists and alive stamps", () => {
  const kept = ['settings.json', `${ID}.json`, `${ID}.alive`, 'notes.txt', `${OTHER}.json.bak`]
  const dir = folderWith([...kept, `${OTHER}.json`, `${OTHER}.alive`], [`${RECENT}.json`, `${RECENT}.alive`])
  run(dir, ID, '2')
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [...kept, `${RECENT}.json`, `${RECENT}.alive`].sort())
})

test('the sweep keeps files younger than its days', () => {
  const dir = folderWith([`${OTHER}.json`])
  run(dir, ID, '4')
  assert.deepStrictEqual(fs.readdirSync(dir), [`${OTHER}.json`])
})

test('the sweep leaves a missing folder missing', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-')), 'mods-data', 'tasks')
  run(dir, ID, '2')
  assert.strictEqual(fs.existsSync(dir), false)
})

test('the sweep refuses to run without a folder, a session and a day count', () => {
  for (const args of [[], ['d'], ['d', ID], ['d', ID, '0'], ['d', ID, 'x']])
    assert.throws(() => run(...args), { status: 2 }, JSON.stringify(args))
})

// Done lists go after the shorter wait: a folder of other sessions' lists, each written with its content
// and age in days, and alive stamps beside some.
const DAY_S = 24 * 60 * 60
const ids = n => `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`
function folderOf(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-'))
  for (const [name, text, days] of files) {
    fs.writeFileSync(path.join(dir, name), text)
    const at = Date.now() / 1000 - days * DAY_S
    fs.utimesSync(path.join(dir, name), at, at)
  }
  return dir
}
const list = (tasks, extra = {}) => JSON.stringify({ session: 'x', tasks, ...extra })
const OPEN = list([{ id: '1', status: 'completed' }, { id: '2', status: 'pending' }])
const DONE = list([{ id: '1', status: 'completed' }, { id: '2', status: 'pending', droppedAt: 1 }])
const HANDED = list([{ id: '1', status: 'pending' }], { handedOverAt: 1 })

test('a done or handed-over list goes after the shorter wait, unless its session still runs', () => {
  const J = `${ids(1)}.json`
  const A = `${ids(1)}.alive`
  const OWN = `${ID}.json`
  // [label, files written as [name, text, age in days], the names left after the sweep]
  const cases = [
    ['an open list, 8 days', [[J, OPEN, 8]], [J]],
    ['a done list, 8 days', [[J, DONE, 8]], []],
    ['an empty list, 8 days', [[J, list([]), 8]], []],
    ['a handed-over list, 8 days', [[J, HANDED, 8]], []],
    ['a done list, 6 days', [[J, DONE, 6]], [J]],
    ['an unreadable list, 8 days', [[J, '{', 8]], [J]],
    ['a done list still stamped alive', [[J, DONE, 8], [A, '', 0]], [A, J]],
    ['a done list stamped 8 days ago', [[J, DONE, 8], [A, '', 8]], []],
    ['an open list stamped 8 days ago', [[J, OPEN, 8], [A, '', 8]], [A, J]],
    ['an alive stamp with no list, 8 days', [[A, '', 8]], []],
    ['an alive stamp with no list, 6 days', [[A, '', 6]], [A]],
    ["this session's own done list, 30 days", [[OWN, DONE, 30]], [OWN]],
  ]
  for (const [label, files, left] of cases) {
    const dir = folderOf(files)
    run(dir, ID, '14', '7')
    assert.deepStrictEqual([label, fs.readdirSync(dir).sort()], [label, [...left].sort()])
  }
})

test('without a done count the sweep keeps its one wait', () => {
  const dir = folderOf([[`${ids(1)}.json`, DONE, 8]])
  run(dir, ID, '14')
  assert.deepStrictEqual(fs.readdirSync(dir), [`${ids(1)}.json`])
})

test('the sweep refuses a done count that is not a positive number', () => {
  for (const done of ['0', 'x', '-1']) assert.throws(() => run('d', ID, '14', done), { status: 2 }, done)
})
