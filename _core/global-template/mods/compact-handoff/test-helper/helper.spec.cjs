// Run: node --test test-helper/helper.spec.cjs
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const HELPER = path.join(__dirname, '..', 'scripts', 'helper.cjs')
const { PERSON_MARK } = require(HELPER)

// A config folder holding one session's transcript.
function transcript(records) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-handoff-'))
  fs.mkdirSync(path.join(config, 'projects', 'p'), { recursive: true })
  fs.writeFileSync(path.join(config, 'projects', 'p', 's1.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n')
  const out = execFileSync(process.execPath, [HELPER, 'persons', 's1'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: config },
    encoding: 'utf8',
  })
  return JSON.parse(out)
}

const user = text => ({ type: 'user', message: { role: 'user', content: text } })

test('the carried block and system lines are not read back as the person\'s messages', () => {
  const carried = `${PERSON_MARK}\n--- message ---\nkeep the parser strict`
  const found = transcript([
    user('first ask'),
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
    user(carried),
    user('[SYSTEM NOTIFICATION] a background task ended'),
    user('<command-name>/clear</command-name>'),
    user('now fix the tests'),
  ])
  assert.deepStrictEqual(found, ['now fix the tests'])
})

test('the helper and the hooks module carry the same mark', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'register.ts'), 'utf8')
  const mark = /export const PERSON_MARK = "([^"]+)"/.exec(source)
  assert.ok(mark, 'PERSON_MARK found in register.ts')
  assert.strictEqual(mark[1], PERSON_MARK)
})
