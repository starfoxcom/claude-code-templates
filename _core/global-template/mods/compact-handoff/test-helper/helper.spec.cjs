// Run: node --test test-helper/helper.spec.cjs
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const HELPER = path.join(__dirname, '..', 'scripts', 'helper.cjs')
const { PERSON_MARK, MOD_TAGS, INJECTED_LINE, ENGINE_TAGS } = require(HELPER)

// A config folder holding one session's transcript.
function configWith(records) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-handoff-'))
  fs.mkdirSync(path.join(config, 'projects', 'p'), { recursive: true })
  fs.writeFileSync(
    path.join(config, 'projects', 'p', 's1.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n',
  )
  return config
}

function transcript(records) {
  const out = execFileSync(process.execPath, [HELPER, 'persons', 's1'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configWith(records) },
    encoding: 'utf8',
  })
  return JSON.parse(out)
}

const user = text => ({ type: 'user', message: { role: 'user', content: text } })

test("the carried block and system lines are not read back as the person's messages", () => {
  const carried = `${PERSON_MARK}\n--- message ---\nkeep the parser strict`
  const found = transcript([
    user('first ask'),
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
    user(carried),
    user('[SYSTEM NOTIFICATION] a background task ended'),
    user('<command-name>/clear</command-name>'),
    user('<system-reminder>context</system-reminder>'),
    user('now fix the tests'),
    // A message the person types may start with a `<` of its own.
    user('<details> renders empty on mobile, fix it'),
  ])
  assert.deepStrictEqual(found, ['now fix the tests', '<details> renders empty on mobile, fix it'])
})

const queued = prompt => ({
  type: 'attachment',
  attachment: { type: 'queued_command', prompt, origin: { kind: 'human' } },
})
const answer = text => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })

test('the same answer given twice is kept twice; a queued prompt recorded again is one message', () => {
  const found = transcript([
    user('yes'),
    answer('And the shadows too?'),
    user('yes'),
    queued('ship it'),
    user('ship it'),
  ])
  assert.deepStrictEqual(found, ['yes', 'yes', 'ship it'])
})

test("prompts the mods submit and the lines they attach are not the person's words", () => {
  const found = transcript([
    user('[ci-watch] #12: all 3 checks settled with no failure. Verify it is mergeable.'),
    user('[usage-guard] Plan usage limit nearly reached (automatic wrap-up).'),
    user('[shared-pc] The person approved your request: this session goes next on the PC.'),
    user('[skill-check] /session-close is not finished: no sign of the push.'),
    user('[tasks] Open: #1 Fix the parser (in progress).\n[session-facts] 2026-10-02 10:00 | ctx 40%'),
    user('keep the parser strict\n[tasks] Open: #1 Fix the parser.\n[session-facts] 2026-10-02 10:01 | ctx 41%'),
    user('[link](https://example.com) is the spec to follow'),
  ])
  assert.deepStrictEqual(found, ['keep the parser strict', '[link](https://example.com) is the spec to follow'])
})

test("no transcript for the session is a failure, so the hook falls back to the compaction's list", () => {
  const run = spawnSync(process.execPath, [HELPER, 'persons', 'other-session'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configWith([user('first ask')]) },
    encoding: 'utf8',
  })
  assert.notStrictEqual(run.status, 0)
  assert.strictEqual(run.stdout.trim(), '')
})

test('the helper and the hooks module carry the same mark and the same injected-line pattern', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'register.ts'), 'utf8')
  const mark = /export const PERSON_MARK = "([^"]+)"/.exec(source)
  assert.ok(mark, 'PERSON_MARK found in register.ts')
  assert.strictEqual(mark[1], PERSON_MARK)
  // The same tag list, and the same pattern built from it.
  const tags = /export const MOD_TAGS = \[([^\]]+)\]/.exec(source)
  assert.ok(tags, 'MOD_TAGS found in register.ts')
  assert.deepStrictEqual(
    [...tags[1].matchAll(/'([^']+)'/g)].map(m => m[1]),
    MOD_TAGS,
  )
  const helperSource = fs.readFileSync(HELPER, 'utf8')
  const built = /INJECTED_LINE = (new RegExp\(.+\))\s*$/m
  assert.strictEqual(built.exec(source)?.[1], built.exec(helperSource)?.[1])
  // The engine's tags too.
  const engineTags = /export const ENGINE_TAGS = \[([^\]]+)\]/.exec(source)
  assert.ok(engineTags, 'ENGINE_TAGS found in register.ts')
  assert.deepStrictEqual(
    [...engineTags[1].matchAll(/'([^']+)'/g)].map(m => m[1]),
    ENGINE_TAGS,
  )
  const engineBuilt = /ENGINE_TAG = (new RegExp\(.+\))\s*$/m
  assert.strictEqual(engineBuilt.exec(source)?.[1], engineBuilt.exec(helperSource)?.[1])
  // And both read the same fixture the same way.
  const hooksLine = new RegExp(INJECTED_LINE.source)
  for (const line of [
    '[tasks] Open: #1',
    '[ci-watch] #12: all checks settled',
    '[link](https://example.com)',
    '[x] done',
    '[wip] refactor the parser',
    'plain words',
  ]) {
    assert.strictEqual(hooksLine.test(line), INJECTED_LINE.test(line), line)
  }
  assert.ok(INJECTED_LINE.test('[tasks] Open: #1') && INJECTED_LINE.test('[ci-watch] #12: all checks settled'))
  // Lines the person types with a bracket tag of their own are their words.
  for (const line of ['[x] done', '[wip] refactor the parser', '[q] why is it slow', '[bug] crash on load']) {
    assert.ok(!INJECTED_LINE.test(line), line)
  }
})
