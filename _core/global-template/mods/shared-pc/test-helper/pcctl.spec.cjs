// Run: node --test test-helper/pcctl.spec.cjs
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const PCCTL = path.join(__dirname, '..', 'bin', 'pcctl.cjs')

function sandbox(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-pc-'))
  fs.mkdirSync(path.join(dir, 'sessions'))
  const fullEnv = { ...process.env, SHARED_PC_DIR: dir, SHARED_PC_POLL_MS: '50', ...env }
  const register = (id, name = id, lastBeat = Date.now()) =>
    fs.writeFileSync(path.join(dir, 'sessions', `${id}.json`), JSON.stringify({ id, name, project: 'p', lastBeat }))
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [PCCTL, ...args], { env: fullEnv, encoding: 'utf8' }))
  const runAsync = (...args) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [PCCTL, ...args], { env: fullEnv })
      let out = ''
      child.stdout.on('data', d => (out += d))
      child.on('error', reject)
      child.on('close', code => resolve({ code, out: out.trim() ? JSON.parse(out) : null }))
    })
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))
  return { dir, register, run, runAsync, state }
}

test('ten simultaneous claims: exactly one seat, nine in line, no duplicates', async () => {
  const sb = sandbox()
  const ids = Array.from({ length: 10 }, (_, i) => `s${i}`)
  ids.forEach(id => sb.register(id))
  const results = await Promise.all(ids.map(id => sb.runAsync('claim', id, 'build')))
  assert.strictEqual(results.filter(r => r.out.granted).length, 1)
  const s = sb.state()
  assert.strictEqual(s.line.length, 9)
  assert.strictEqual(new Set(s.line.map(e => e.session)).size, 9)
  assert.ok(!s.line.some(e => e.session === s.seat.session))
})

test('release hands the seat to the front of the line', () => {
  const sb = sandbox()
  ;['a', 'b', 'c'].forEach(id => sb.register(id))
  assert.ok(sb.run('claim', 'a', 'build').granted)
  assert.strictEqual(sb.run('claim', 'b', 'test').position, 1)
  assert.strictEqual(sb.run('claim', 'c', 'run').position, 2)
  sb.run('done', 'a')
  sb.run('release', 'a')
  const s = sb.state()
  assert.strictEqual(s.seat.session, 'b')
  assert.deepStrictEqual(s.line.map(e => e.session), ['c'])
})

test('a dead holder loses the seat and dead waiters leave the line', () => {
  const sb = sandbox()
  sb.register('a')
  sb.register('b')
  sb.register('c')
  sb.run('claim', 'a', 'build')
  sb.run('claim', 'c', 'x')
  sb.register('c', 'c', Date.now() - 60_000)
  sb.register('a', 'a', Date.now() - 60_000)
  const out = sb.run('claim', 'b', 'test')
  assert.ok(out.granted)
  assert.strictEqual(sb.state().line.length, 0)
})

test('the seat lingers after a command, then passes on', async () => {
  const sb = sandbox({ SHARED_PC_LINGER_MS: '300' })
  sb.register('a')
  sb.register('b')
  sb.run('claim', 'a', 'build')
  sb.run('done', 'a')
  assert.ok(sb.run('claim', 'a', 'test').granted, 'a reuses its seat inside the linger')
  sb.run('done', 'a')
  assert.strictEqual(sb.run('claim', 'b', 'x').granted, false)
  await new Promise(r => setTimeout(r, 400))
  assert.strictEqual(sb.run('status', 'b').mine, 'seat')
})

test('a background task keeps the seat until it is done', async () => {
  const sb = sandbox({ SHARED_PC_LINGER_MS: '100' })
  sb.register('a')
  sb.register('b')
  sb.run('claim', 'a', 'build')
  sb.run('done', 'a', 'task-1')
  await new Promise(r => setTimeout(r, 200))
  assert.strictEqual(sb.run('claim', 'b', 'x').granted, false)
  sb.run('taskdone', 'a', 'task-1')
  await new Promise(r => setTimeout(r, 200))
  assert.strictEqual(sb.run('status', 'b').mine, 'seat')
})

test('a repeated task notice does not restart the linger', async () => {
  const sb = sandbox({ SHARED_PC_LINGER_MS: '300' })
  sb.register('a')
  sb.register('b')
  sb.run('claim', 'a', 'build')
  sb.run('done', 'a', 'task-1')
  sb.run('taskdone', 'a', 'task-1')
  const endedAt = sb.state().seat.lastHeavyEnd
  await new Promise(r => setTimeout(r, 150))
  sb.run('taskdone', 'a', 'task-1')
  assert.strictEqual(sb.state().seat.lastHeavyEnd, endedAt)
  await new Promise(r => setTimeout(r, 250))
  assert.strictEqual(sb.run('status', 'b').seat, null)
})

test('a jump moves a waiting session to the front, behind the holder', () => {
  const sb = sandbox()
  ;['a', 'b', 'c', 'd'].forEach(id => sb.register(id, `name-${id}`))
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('claim', 'c', 'x')
  sb.run('claim', 'd', 'x')
  sb.run('next', 'name-d')
  const s = sb.state()
  assert.strictEqual(s.seat.session, 'a')
  assert.deepStrictEqual(s.line.map(e => e.session), ['d', 'b', 'c'])
})

test('a jump for a session not waiting yet reserves the next seat for it', () => {
  const sb = sandbox()
  ;['a', 'b', 'c'].forEach(id => sb.register(id))
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('next', 'c')
  sb.run('done', 'a')
  sb.run('release', 'a')
  assert.strictEqual(sb.state().seat, null, 'b does not take the seat while c holds the reservation')
  assert.ok(sb.run('claim', 'c', 'x').granted)
  assert.deepStrictEqual(sb.state().line.map(e => e.session), ['b'])
})

test('a hold blocks other sessions until it ends', () => {
  const sb = sandbox()
  sb.register('a')
  sb.register('b')
  sb.run('hold', 'a', '5', 'GPU timing')
  const s = sb.state()
  assert.strictEqual(s.seat.kind, 'hold')
  assert.strictEqual(s.seat.reason, 'GPU timing')
  assert.strictEqual(sb.run('claim', 'b', 'x').granted, false)
  sb.run('release', 'a')
  assert.strictEqual(sb.state().seat.session, 'b')
})

test('wait returns once the seat is ours, and exits 3 after leaving the line', async () => {
  const sb = sandbox()
  ;['a', 'b', 'c'].forEach(id => sb.register(id))
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('claim', 'c', 'x')
  const waitingB = sb.runAsync('wait', 'b')
  const waitingC = sb.runAsync('wait', 'c')
  await new Promise(r => setTimeout(r, 150))
  sb.run('leave', 'c')
  sb.run('done', 'a')
  sb.run('release', 'a')
  const b = await waitingB
  const c = await waitingC
  assert.strictEqual(b.code, 0)
  assert.ok(b.out.granted)
  assert.strictEqual(c.code, 3)
})

test('a skip request is shared, answered from another session, and cleared on ack', () => {
  const sb = sandbox()
  ;['a', 'b', 'c'].forEach(id => sb.register(id, `name-${id}`))
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('claim', 'c', 'x')
  sb.run('ask', 'c', 'window', 'closing')
  const asked = sb.run('status', 'b').requests
  assert.deepStrictEqual(asked.map(r => [r.session, r.name, r.reason, r.answer]), [['c', 'name-c', 'window closing', null]])
  sb.run('answer', 'c', 'approve')
  const s = sb.state()
  assert.deepStrictEqual(s.line.map(e => e.session), ['c', 'b'])
  assert.strictEqual(s.requests[0].answer, 'approved')
  assert.ok(sb.run('answer', 'c', 'decline').error, 'an answered request cannot be answered again')
  sb.run('ack', 'c')
  assert.strictEqual(sb.state().requests.length, 0)
})

test('a declined request keeps the line as it was', () => {
  const sb = sandbox()
  ;['a', 'b', 'c'].forEach(id => sb.register(id))
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('claim', 'c', 'x')
  sb.run('ask', 'c', 'please')
  sb.run('answer', 'c', 'decline')
  assert.deepStrictEqual(sb.state().line.map(e => e.session), ['b', 'c'])
  assert.strictEqual(sb.state().requests[0].answer, 'declined')
})

test('an open request ends when its session dies or gets the seat anyway', () => {
  const sb = sandbox()
  ;['a', 'b', 'c'].forEach(id => sb.register(id))
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('ask', 'b', 'please')
  sb.run('ask', 'c', 'me too')
  sb.register('c', 'c', Date.now() - 60_000)
  sb.run('done', 'a')
  sb.run('release', 'a')
  assert.strictEqual(sb.state().seat.session, 'b')
  assert.strictEqual(sb.run('status', 'a').requests.length, 0)
})

test('a stale mutex left by a crash is broken', () => {
  const sb = sandbox()
  sb.register('a')
  const mutex = path.join(sb.dir, '.mutex')
  fs.mkdirSync(mutex)
  const old = (Date.now() - 10_000) / 1000
  fs.utimesSync(mutex, old, old)
  assert.ok(sb.run('claim', 'a', 'x').granted)
  assert.ok(!fs.existsSync(mutex))
})

test('session end frees the seat and removes the registry file', () => {
  const sb = sandbox()
  sb.register('a')
  sb.register('b')
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('end', 'a')
  assert.strictEqual(sb.state().seat.session, 'b')
  assert.ok(!fs.existsSync(path.join(sb.dir, 'sessions', 'a.json')))
})
