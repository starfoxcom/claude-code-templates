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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-facts-'))
  for (const name of [...names, ...recent]) fs.writeFileSync(path.join(dir, name), '{}')
  for (const name of names) fs.utimesSync(path.join(dir, name), THREE_DAYS_AGO, THREE_DAYS_AGO)
  return dir
}

const run = (dir, id) => execFileSync(process.execPath, [SWEEP, dir, id], { encoding: 'utf8' })

test("the sweep removes only other sessions' old memory and marker files", () => {
  const kept = ['settings.json', 'plan.json', `${ID}.json`, `${ID}.compact.json`, 'notes.txt', `${OTHER}.json.bak`]
  const dir = folderWith([...kept, `${OTHER}.json`, `${OTHER}.compact.json`], [`${RECENT}.json`])
  run(dir, ID)
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [...kept, `${RECENT}.json`].sort())
})

test('the sweep makes a missing data folder, nested', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'session-facts-')), 'mods-data', 'session-facts')
  run(dir, ID)
  assert.deepStrictEqual(fs.readdirSync(dir), [])
})

test('the sweep refuses to run without a folder and a session', () => {
  assert.throws(() => execFileSync(process.execPath, [SWEEP], { stdio: 'pipe' }), { status: 2 })
})
