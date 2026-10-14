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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-watch-'))
  for (const name of [...names, ...recent]) fs.writeFileSync(path.join(dir, name), '{}')
  for (const name of names) fs.utimesSync(path.join(dir, name), THREE_DAYS_AGO, THREE_DAYS_AGO)
  return dir
}

const run = (...args) => execFileSync(process.execPath, [SWEEP, ...args], { encoding: 'utf8', stdio: 'pipe' })

test("the sweep removes only other sessions' old state and owner files", () => {
  const kept = ['settings.json', 'rounds.json', `${ID}.json`, `${ID}.owner`, 'notes.txt', `${OTHER}.json.bak`]
  const dir = folderWith([...kept, `${OTHER}.json`, `${OTHER}.owner`], [`${RECENT}.json`, `${RECENT}.owner`])
  run(dir, ID, '2')
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [...kept, `${RECENT}.json`, `${RECENT}.owner`].sort())
})

test('the sweep keeps files younger than its days', () => {
  const dir = folderWith([`${OTHER}.json`])
  run(dir, ID, '4')
  assert.deepStrictEqual(fs.readdirSync(dir), [`${OTHER}.json`])
})

test('the sweep leaves a missing folder missing', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-watch-')), 'mods-data', 'ci-watch')
  run(dir, ID, '2')
  assert.strictEqual(fs.existsSync(dir), false)
})

test('the sweep refuses to run without a folder, a session and a day count', () => {
  for (const args of [[], ['d'], ['d', ID], ['d', ID, '0'], ['d', ID, 'x']])
    assert.throws(() => run(...args), { status: 2 }, JSON.stringify(args))
})
