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
  const run = (...args) =>
    JSON.parse(execFileSync(process.execPath, [PCCTL, ...args], { env: fullEnv, encoding: 'utf8' }))
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

test('a fresh install: asking where the state lives makes the folders the heartbeats are written in', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-pc-')), 'not-made-yet')
  const env = { ...process.env, SHARED_PC_DIR: dir }
  const where = JSON.parse(execFileSync(process.execPath, [PCCTL, 'where'], { env, encoding: 'utf8' }))
  assert.strictEqual(where.dir, dir)
  assert.ok(fs.statSync(path.join(dir, 'sessions')).isDirectory())
  // Any change made first, before `where`, makes them too.
  fs.rmSync(dir, { recursive: true, force: true })
  execFileSync(process.execPath, [PCCTL, 'release', 'a'], { env, encoding: 'utf8' })
  assert.ok(fs.statSync(path.join(dir, 'sessions')).isDirectory())
})

test('a wait given up after its seat was granted frees the seat for the next in line', () => {
  const sb = sandbox()
  ;['a', 'b', 'c'].forEach(id => sb.register(id))
  assert.ok(sb.run('claim', 'a', 'build').granted)
  sb.run('claim', 'b', 'test')
  sb.run('claim', 'c', 'run')
  sb.run('done', 'a')
  sb.run('release', 'a')
  // b's waiter took the seat, then the person pressed Esc before the command ran.
  assert.ok(sb.run('poll', 'b').granted)
  sb.run('abandon', 'b')
  const s = sb.state()
  assert.strictEqual(s.seat.session, 'c')
  assert.deepStrictEqual(s.line, [])
  // Given up while still in line: only the line changes.
  sb.register('d')
  sb.run('claim', 'd', 'x')
  sb.run('abandon', 'd')
  assert.strictEqual(sb.state().seat.session, 'c')
  assert.deepStrictEqual(sb.state().line, [])
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
  assert.deepStrictEqual(
    s.line.map(e => e.session),
    ['c'],
  )
})

test('release also gives up a reservation, so the free seat goes to whoever claims it', () => {
  const sb = sandbox()
  ;['b', 'c'].forEach(id => sb.register(id))
  // An approved request on an idle machine reserves the next seat for the requester.
  sb.run('ask', 'b', 'GPU window')
  sb.run('answer', 'b', 'approve')
  assert.strictEqual(sb.state().nextUp.session, 'b')
  sb.run('release', 'b')
  assert.strictEqual(sb.state().nextUp, null)
  assert.ok(sb.run('claim', 'c', 'build').granted)
  // Another session's release leaves a reservation alone.
  sb.run('done', 'c')
  sb.run('next', 'b')
  sb.run('release', 'c')
  assert.strictEqual(sb.state().nextUp.session, 'b')
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
  assert.deepStrictEqual(
    s.line.map(e => e.session),
    ['d', 'b', 'c'],
  )
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
  assert.deepStrictEqual(
    sb.state().line.map(e => e.session),
    ['b'],
  )
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
  assert.deepStrictEqual(
    asked.map(r => [r.session, r.name, r.reason, r.answer]),
    [['c', 'name-c', 'window closing', null]],
  )
  sb.run('answer', 'c', 'approve')
  const s = sb.state()
  assert.deepStrictEqual(
    s.line.map(e => e.session),
    ['c', 'b'],
  )
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
  assert.deepStrictEqual(
    sb.state().line.map(e => e.session),
    ['b', 'c'],
  )
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

test('a request ends in the same write that hands its session the seat', () => {
  const sb = sandbox()
  ;['a', 'b'].forEach(id => sb.register(id))
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('ask', 'b', 'please')
  sb.run('done', 'a')
  sb.run('release', 'a')
  // Read straight from the file: no later command may be needed to sweep it.
  const s = sb.state()
  assert.strictEqual(s.seat.session, 'b')
  assert.deepStrictEqual(s.requests, [])
})

test('drop gives up the seat, a reservation and the place in line in one write, and says which', () => {
  const sb = sandbox()
  ;['a', 'b', 'c'].forEach(id => sb.register(id))
  sb.run('claim', 'a', 'x')
  sb.run('claim', 'b', 'x')
  sb.run('claim', 'c', 'x')
  const left = sb.run('drop', 'c')
  assert.deepStrictEqual([left.freed, left.left, left.mine], [false, true, 'none'])
  assert.deepStrictEqual(sb.state().line.map(e => e.session), ['b'])
  sb.run('done', 'a')
  const freed = sb.run('drop', 'a')
  assert.deepStrictEqual([freed.freed, freed.left], [true, false])
  assert.strictEqual(sb.state().seat.session, 'b')
  const none = sb.run('drop', 'a')
  assert.deepStrictEqual([none.freed, none.left], [false, false])
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

// Two writers in one process: each `require` of a fresh module copy is its own writer.
function writer(dir) {
  const saved = process.env.SHARED_PC_DIR
  process.env.SHARED_PC_DIR = dir
  delete require.cache[require.resolve(PCCTL)]
  try {
    return require(PCCTL)
  } finally {
    if (saved === undefined) delete process.env.SHARED_PC_DIR
    else process.env.SHARED_PC_DIR = saved
  }
}

test("a writer whose stale mutex was broken never removes the next writer's mutex", () => {
  const sb = sandbox()
  const a = writer(sb.dir)
  const b = writer(sb.dir)
  a.lock()
  // A stalls past the stale limit while holding the mutex.
  const old = (Date.now() - 10_000) / 1000
  fs.utimesSync(path.join(a.MUTEX, 'owner'), old, old)
  b.lock()
  assert.ok(b.owns(), 'b broke the stale mutex and holds its own')
  assert.ok(!a.owns(), 'a sees it lost the mutex, so it writes nothing')
  a.unlock()
  assert.ok(fs.existsSync(b.MUTEX), "a's unlock leaves b's mutex in place")
  assert.ok(b.owns())
  assert.throws(() => fs.mkdirSync(b.MUTEX), /EEXIST/, 'a third writer still waits')
  b.unlock()
  assert.ok(!fs.existsSync(b.MUTEX))
})

// Runs `before` once, ahead of the first call of `fs[name]` that `match` accepts.
function once(name, match, before) {
  const real = fs[name]
  fs[name] = (...args) => {
    if (match(...args)) {
      fs[name] = real
      before()
    }
    return real(...args)
  }
  return () => (fs[name] = real)
}

test('a newcomer whose unstamped mutex a breaker moves aside takes it again', () => {
  const sb = sandbox()
  const b = writer(sb.dir)
  const owner = path.join(b.MUTEX, 'owner')
  // A breaker that judged an earlier holder stale renames the folder right after b made it.
  const restore = once(
    'writeFileSync',
    file => file === owner,
    () => fs.renameSync(b.MUTEX, `${b.MUTEX}.stale-${Date.now()}-1`),
  )
  try {
    b.lock()
  } finally {
    restore()
  }
  assert.ok(b.owns(), 'b took the mutex again instead of failing')
  b.unlock()
})

test('a newcomer never stamps over a folder another writer stamped first', () => {
  const sb = sandbox()
  const b = writer(sb.dir)
  const owner = path.join(b.MUTEX, 'owner')
  // b's folder was moved aside and another writer's took the path and was stamped (here already stale,
  // so b can break it and finish) before b's own stamp lands.
  const restore = once(
    'writeFileSync',
    file => file === owner,
    () => {
      fs.writeFileSync(owner, 'other-writer')
      const old = (Date.now() - 10_000) / 1000
      fs.utimesSync(owner, old, old)
    },
  )
  try {
    b.lock()
  } finally {
    restore()
  }
  assert.ok(b.owns())
  const asides = fs.readdirSync(sb.dir).filter(name => name.startsWith('.mutex.stale-'))
  const owners = asides.map(name => fs.readFileSync(path.join(sb.dir, name, 'owner'), 'utf8'))
  assert.deepStrictEqual(owners, ['other-writer'], "b took a fresh folder, never the other writer's stamp")
  b.unlock()
})

test("a breaker never hands back a newcomer's unstamped mutex", () => {
  const sb = sandbox()
  const a = writer(sb.dir)
  const b = writer(sb.dir)
  a.lock()
  const old = (Date.now() - 10_000) / 1000
  fs.utimesSync(path.join(a.MUTEX, 'owner'), old, old)
  // Between b's stale judgment and its rename, a finishes and a newcomer makes the folder, unstamped.
  const restore = once(
    'renameSync',
    (from, to) => from === b.MUTEX && String(to).includes('.stale-'),
    () => {
      fs.rmSync(a.MUTEX, { recursive: true, force: true })
      fs.mkdirSync(a.MUTEX)
    },
  )
  const started = Date.now()
  try {
    b.lock()
  } finally {
    restore()
  }
  assert.ok(Date.now() - started < 2_000, 'b did not wait out an orphaned folder')
  assert.ok(b.owns())
  b.unlock()
})

test('a fresh mutex is never broken', () => {
  const sb = sandbox()
  const a = writer(sb.dir)
  a.lock()
  const out = sb.runAsync('status', 'x')
  return new Promise(r => setTimeout(r, 300)).then(async () => {
    assert.ok(a.owns(), 'the waiting writer did not take a live mutex')
    a.unlock()
    const done = await out
    assert.strictEqual(done.code, 0)
  })
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
