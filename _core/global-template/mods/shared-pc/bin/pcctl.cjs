#!/usr/bin/env node
// shared-pc state helper. Every change to the shared seat/line state goes through here, under a mutex
// directory (mkdir is atomic on NTFS and POSIX). The hooks module reads state.json directly and only
// spawns this helper to change it. Output: one line of JSON on stdout.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

// Same data root as the other global mods (mods-data/<mod>), outside every mod folder so writes here
// never hot-reload a mod.
const DIR =
  process.env.SHARED_PC_DIR ||
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'mods-data', 'shared-pc')
const SESSIONS = path.join(DIR, 'sessions')
const STATE = path.join(DIR, 'state.json')
const LOG = path.join(DIR, 'log.jsonl')
const MUTEX = path.join(DIR, '.mutex')

const ALIVE_MS = Number(process.env.SHARED_PC_ALIVE_MS || 45_000)
const LINGER_MS = Number(process.env.SHARED_PC_LINGER_MS || 60_000)
const NEXT_UP_MS = 3 * 60_000
const REQUEST_TTL_MS = 15 * 60_000
const MUTEX_STALE_MS = 5_000
const WAIT_POLL_MS = Number(process.env.SHARED_PC_POLL_MS || 2_000)
const SESSION_FILE_TTL_MS = 24 * 60 * 60_000

const now = () => Date.now()
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// The mutex directory holds an `owner` file with the holder's token; its mtime is when it was taken.
// Only the holder removes it, and a breaker only moves away the very mutex it judged stale, so a writer
// that stalls past MUTEX_STALE_MS can lose its mutex but never removes the next writer's.
const OWNER = path.join(MUTEX, 'owner')
let held = null

class MutexLost extends Error {}

function ownerOf(dir) {
  try {
    const file = path.join(dir, 'owner')
    return { token: fs.readFileSync(file, 'utf8'), at: fs.statSync(file).mtimeMs }
  } catch {
    // Taken but not stamped yet (or the holder crashed in between): the folder's own time counts.
    try {
      return { token: '', at: fs.statSync(dir).mtimeMs }
    } catch {
      return null
    }
  }
}

// The state folder and its sessions folder. The hooks module writes heartbeats there through an fs that
// makes no folders, so both exist by the time it first asks where the state lives.
function makeDirs() {
  fs.mkdirSync(SESSIONS, { recursive: true })
}

function lock() {
  makeDirs()
  const token = `${process.pid}-${now()}-${Math.random().toString(36).slice(2, 10)}`
  const deadline = now() + 10_000
  for (;;) {
    try {
      fs.mkdirSync(MUTEX)
      // Stamped only if no one has: the first stamp on a folder owns it.
      fs.writeFileSync(OWNER, token, { flag: 'wx' })
      held = token
      return
    } catch (err) {
      // A breaker moved the folder aside before the stamp: ENOENT, or EEXIST when another writer's
      // folder took the path and was stamped first. Not ours either way: try again.
      if (err.code !== 'EEXIST' && err.code !== 'ENOENT') throw err
    }
    breakStale()
    if (now() > deadline) throw new Error('mutex timeout')
    sleep(10 + Math.floor(Math.random() * 20))
  }
}

// A mutex stamped this long ago belongs to a writer that crashed or stalled. Rename is atomic, so one
// breaker wins; it then checks that it moved the mutex it judged stale, and hands back one that was
// released and taken again in between, once stamped: an unstamped one is a newcomer's, whose stamp then
// fails and who takes the mutex again, so it is not handed back. Left out of reach: a third writer
// creating the folder in the microseconds between that check and the hand-back.
function breakStale() {
  const seen = ownerOf(MUTEX)
  if (!seen || now() - seen.at <= MUTEX_STALE_MS) return
  const aside = `${MUTEX}.stale-${now()}-${process.pid}`
  try {
    fs.renameSync(MUTEX, aside)
  } catch {
    return
  }
  const moved = ownerOf(aside)
  if (moved && moved.token && moved.token !== seen.token) {
    try {
      fs.renameSync(aside, MUTEX)
      return
    } catch {
      log({ op: 'mutex-restore-failed', owner: moved.token })
    }
  }
  log({ op: 'mutex-broken', owner: seen.token })
}

const owns = () => held !== null && ownerOf(MUTEX)?.token === held

function unlock() {
  const token = held
  held = null
  if (token && ownerOf(MUTEX)?.token === token) {
    // Moved aside before removal and checked again, so a breaker's swap in between is put back.
    const mine = `${MUTEX}.release-${token}`
    try {
      fs.renameSync(MUTEX, mine)
      if (ownerOf(mine)?.token === token) fs.rmSync(mine, { recursive: true, force: true })
      else fs.renameSync(mine, MUTEX)
    } catch {}
  } else if (token) log({ op: 'mutex-lost', owner: token })
  // Mutexes moved aside by breakers (or by a holder that died before removing its own): removed once
  // nobody can still be checking them.
  for (const name of safeList(DIR)) {
    const at = /^\.mutex\.(?:stale-(\d+)-|release-\d+-(\d+)-)/.exec(name)
    if (at && now() - Number(at[1] ?? at[2]) > 60_000) fs.rmSync(path.join(DIR, name), { recursive: true, force: true })
  }
}

// Runs one operation under the mutex. A writer whose mutex was broken while it stalled writes nothing
// and runs the operation again from the state as it is now.
function locked(op, args) {
  for (let attempt = 1; ; attempt++) {
    lock()
    try {
      return apply(op, args)
    } catch (err) {
      if (!(err instanceof MutexLost) || attempt >= 3) throw err
    } finally {
      unlock()
    }
  }
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    return {
      seat: s.seat ?? null,
      line: s.line ?? [],
      nextUp: s.nextUp ?? null,
      requests: s.requests ?? [],
      updatedAt: s.updatedAt ?? 0,
    }
  } catch {
    return { seat: null, line: [], nextUp: null, requests: [], updatedAt: 0 }
  }
}

function writeState(s) {
  s.updatedAt = now()
  const tmp = `${STATE}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1))
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, STATE)
      return
    } catch (err) {
      // A reader holding state.json open blocks the replace on Windows for a moment.
      if (i >= 50 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err
      sleep(10)
    }
  }
}

// The log is capped: past LOG_CAP it moves to log.1.jsonl (replacing the older one), so the folder never
// holds more than about twice the cap.
const LOG_CAP = 256 * 1024

function log(entry) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > LOG_CAP) fs.renameSync(LOG, path.join(DIR, 'log.1.jsonl'))
    fs.appendFileSync(LOG, JSON.stringify({ at: now(), ...entry }) + '\n')
  } catch {}
}

function sessions() {
  const out = {}
  for (const name of safeList(SESSIONS)) {
    if (!name.endsWith('.json')) continue
    const file = path.join(SESSIONS, name)
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (now() - s.lastBeat > SESSION_FILE_TTL_MS) fs.rmSync(file, { force: true })
      else out[s.id] = s
    } catch {}
  }
  return out
}

const isAlive = (all, id) => all[id] !== undefined && now() - all[id].lastBeat < ALIVE_MS

function beat(id) {
  const file = path.join(SESSIONS, `${id}.json`)
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    s.lastBeat = now()
    fs.writeFileSync(file, JSON.stringify(s))
  } catch {}
}

// Brings the state up to date: drops dead sessions, ends expired seats, holds and reservations, and
// hands a free seat to the front of the line.
function normalize(s, all) {
  const t = now()
  s.line = s.line.filter(entry => {
    const keep = isAlive(all, entry.session)
    if (!keep) log({ op: 'pruned-from-line', session: entry.session })
    return keep
  })
  if (s.nextUp && (t > s.nextUp.until || !isAlive(all, s.nextUp.session))) s.nextUp = null
  if (s.seat) {
    const seat = s.seat
    let reason = null
    if (!isAlive(all, seat.session)) reason = 'holder-gone'
    else if (seat.kind === 'hold' && t > seat.until) reason = 'hold-ended'
    else if (seat.kind === 'work' && seat.running === 0 && seat.tasks.length === 0 && t - seat.lastHeavyEnd > LINGER_MS)
      reason = 'linger-ended'
    if (reason) {
      log({ op: 'seat-freed', session: seat.session, reason, heldMs: t - seat.since })
      s.seat = null
    }
  }
  if (!s.seat && s.line.length > 0) {
    const reserved = s.nextUp && !s.line.some(e => e.session === s.nextUp.session)
    if (!reserved) grant(s, s.line.shift())
  }
  // Skip-the-line requests: shown in every session until answered; an unanswered one ends when its
  // session dies, gets the seat anyway, or after 15 minutes. An answered one waits for its session to
  // read it (`ack`), unless that session died. Swept after the seat changes hands, so a request whose
  // session was just granted the seat ends in the same pass.
  s.requests = s.requests.filter(r => {
    if (!isAlive(all, r.session)) return false
    if (r.answer) return true
    const isServed = s.seat && s.seat.session === r.session && s.seat.since > r.at
    return !isServed && t - r.at < REQUEST_TTL_MS
  })
  return s
}

function grant(s, entry) {
  const t = now()
  s.seat =
    entry.kind === 'hold'
      ? {
          session: entry.session,
          kind: 'hold',
          since: t,
          until: t + entry.minutes * 60_000,
          reason: entry.reason,
          label: entry.label,
        }
      : { session: entry.session, kind: 'work', since: t, running: 0, tasks: [], lastHeavyEnd: t, label: entry.label }
  if (s.nextUp && s.nextUp.session === entry.session) s.nextUp = null
  log({ op: 'seat-granted', session: entry.session, kind: s.seat.kind, waitedMs: entry.since ? t - entry.since : 0 })
}

function enqueue(s, entry) {
  const at = s.line.findIndex(e => e.session === entry.session)
  if (at >= 0) {
    s.line[at] = { ...s.line[at], ...entry, since: s.line[at].since }
    return
  }
  if (s.nextUp && s.nextUp.session === entry.session) {
    s.line.unshift(entry)
    s.nextUp = null
  } else s.line.push(entry)
}

function view(s, all, id) {
  const position = s.line.findIndex(e => e.session === id)
  return {
    seat: s.seat,
    line: s.line,
    nextUp: s.nextUp,
    requests: s.requests,
    mine: s.seat && s.seat.session === id ? 'seat' : position >= 0 ? 'line' : 'none',
    position: position >= 0 ? position + 1 : 0,
    names: Object.fromEntries(
      Object.values(all)
        .filter(x => isAlive(all, x.id))
        .map(x => [x.id, x.name]),
    ),
  }
}

function resolveTarget(all, target) {
  const live = Object.values(all).filter(x => isAlive(all, x.id))
  const lower = target.toLowerCase()
  const hits = live.filter(x => x.id === target || x.name.toLowerCase() === lower || x.id.startsWith(target))
  return hits.length === 1 ? hits[0].id : null
}

// Whether `id` may take a free seat now: it holds the reservation, or nobody else does and it is first.
function mayTakeFreeSeat(s, id) {
  if (s.seat) return false
  if (s.nextUp) return s.nextUp.session === id
  return s.line.length === 0 || s.line[0].session === id
}

// Moves `target` to the front of the line, behind the seat holder, or reserves the next seat for it.
function jump(s, all, target) {
  if (s.seat && s.seat.session === target) return { ...view(s, all, target), note: 'already has the seat' }
  const at = s.line.findIndex(e => e.session === target)
  if (at >= 0) s.line.unshift(...s.line.splice(at, 1))
  else s.nextUp = { session: target, until: now() + NEXT_UP_MS }
  log({ op: 'jump', session: target, waiting: at >= 0 })
  return view(normalize(s, all), all, target)
}

// One function per operation, each given the state, the live sessions, the caller's id, the arguments
// and the time; each returns what goes to stdout.
const OPS = {
  status: (s, all, id) => view(s, all, id),
  // args: id label
  claim(s, all, id, args, t) {
    const label = args[1] || ''
    if (s.seat && s.seat.session === id) {
      if (s.seat.kind === 'work') {
        s.seat.running += 1
        if (label) s.seat.label = label
      }
      return { ...view(s, all, id), granted: true }
    }
    if (mayTakeFreeSeat(s, id)) {
      s.line = s.line.filter(e => e.session !== id)
      grant(s, { session: id, kind: 'work', label })
      s.seat.running = 1
      return { ...view(s, all, id), granted: true }
    }
    enqueue(s, { session: id, kind: 'work', label, since: t })
    log({ op: 'queued', session: id, label })
    return { ...view(s, all, id), granted: false }
  },
  // The waiter's step: the seat is ours once normalize handed it over.
  poll(s, all, id) {
    beat(id)
    const isMine = Boolean(s.seat && s.seat.session === id)
    if (isMine && s.seat.kind === 'work') s.seat.running += 1
    return { ...view(s, all, id), granted: isMine }
  },
  // args: id [backgroundTaskId]
  done(s, all, id, args, t) {
    if (s.seat && s.seat.session === id && s.seat.kind === 'work') {
      s.seat.running = Math.max(0, s.seat.running - 1)
      s.seat.lastHeavyEnd = t
      if (args[1]) s.seat.tasks.push(args[1])
    }
    return view(s, all, id)
  },
  // Only a task the seat still holds counts: a repeated notice must not restart the linger.
  taskdone(s, all, id, args, t) {
    if (s.seat && s.seat.session === id && s.seat.kind === 'work' && s.seat.tasks.includes(args[1])) {
      s.seat.tasks = s.seat.tasks.filter(x => x !== args[1])
      s.seat.lastHeavyEnd = t
      log({ op: 'task-done', session: id, task: args[1] })
    }
    return view(s, all, id)
  },
  leave(s, all, id) {
    if (s.line.some(e => e.session === id)) log({ op: 'left-line', session: id })
    s.line = s.line.filter(e => e.session !== id)
    if (s.nextUp && s.nextUp.session === id) s.nextUp = null
    return view(s, all, id)
  },
  // A wait given up (Esc, or the waiter out of line): it leaves the line, and a work seat it holds is
  // freed. A wait only starts while the seat is someone else's, so a seat this session holds now was
  // granted during the wait, for the command that will not run.
  abandon(s, all, id, args, t) {
    OPS.leave(s, all, id)
    if (s.seat && s.seat.session === id && s.seat.kind === 'work') {
      log({ op: 'seat-freed', session: id, reason: 'abandoned', heldMs: t - s.seat.since })
      s.seat = null
    }
    return view(normalize(s, all), all, id)
  },
  // Done with the seat: frees it, and gives up a reservation for it too (an approved request or a
  // `next`), so an idle machine is not held for a session that has nothing to run.
  release(s, all, id, args, t) {
    if (s.seat && s.seat.session === id) {
      log({ op: 'seat-freed', session: id, reason: 'released', heldMs: t - s.seat.since })
      s.seat = null
    }
    if (s.nextUp && s.nextUp.session === id) {
      log({ op: 'reservation-released', session: id })
      s.nextUp = null
    }
    return view(normalize(s, all), all, id)
  },
  // The tool's release: the seat, a reservation and the place in line, all in this one write, so a seat
  // freed by another session can never be granted to this one between giving up the seat and the line.
  // `freed` and `left` say what it gave up.
  drop(s, all, id, args, t) {
    const freed = Boolean(s.seat && s.seat.session === id)
    const left = s.line.some(e => e.session === id)
    OPS.leave(s, all, id)
    return { ...OPS.release(s, all, id, args, t), freed, left }
  },
  end(s, all, id, args, t) {
    s.line = s.line.filter(e => e.session !== id)
    if (s.nextUp && s.nextUp.session === id) s.nextUp = null
    if (s.seat && s.seat.session === id) {
      log({ op: 'seat-freed', session: id, reason: 'session-ended', heldMs: t - s.seat.since })
      s.seat = null
    }
    fs.rmSync(path.join(SESSIONS, `${id}.json`), { force: true })
    delete all[id]
    return view(normalize(s, all), all, id)
  },
  // args: id minutes reason
  hold(s, all, id, args, t) {
    const minutes = Math.min(60, Math.max(1, Number(args[1]) || 0))
    const reason = args.slice(2).join(' ') || 'hold'
    if (mayTakeFreeSeat(s, id)) {
      s.line = s.line.filter(e => e.session !== id)
      grant(s, { session: id, kind: 'hold', minutes, reason, label: reason })
    } else if (s.seat && s.seat.session === id) {
      s.seat = { ...s.seat, kind: 'hold', until: t + minutes * 60_000, reason, label: reason }
    } else enqueue(s, { session: id, kind: 'hold', minutes, reason, label: reason, since: t })
    return view(s, all, id)
  },
  // args: target (id, name or id prefix): front of the line, behind the seat holder.
  next(s, all, id, args) {
    const target = resolveTarget(all, args[0] || '')
    if (!target) return { error: `no single live session matches "${args[0]}"` }
    return jump(s, all, target)
  },
  // args: id reason...: a skip-the-line request every session shows until the person answers.
  ask(s, all, id, args, t) {
    const reason = args.slice(1).join(' ').trim()
    s.requests = s.requests.filter(r => r.session !== id)
    s.requests.push({ session: id, name: all[id] ? all[id].name : id.slice(0, 8), reason, at: t, answer: null })
    log({ op: 'ask', session: id, reason })
    return view(s, all, id)
  },
  // args: requester approve|decline: answered from any session; approving jumps the requester.
  answer(s, all, id, args) {
    const r = s.requests.find(x => x.session === args[0] && !x.answer)
    if (!r) return { error: 'no open request from that session' }
    r.answer = args[1] === 'approve' ? 'approved' : 'declined'
    log({ op: 'answer', session: r.session, answer: r.answer })
    return r.answer === 'approved' ? jump(s, all, r.session) : view(s, all, r.session)
  },
  // The requester read its answer.
  ack(s, all, id) {
    s.requests = s.requests.filter(r => !(r.session === id && r.answer))
    return view(s, all, id)
  },
}

// One operation under the mutex. Returns what goes to stdout.
function apply(op, args) {
  const run = Object.hasOwn(OPS, op) ? OPS[op] : undefined
  if (!run) throw new Error(`unknown op ${op}`)
  const all = sessions()
  const s = normalize(readState(), all)
  const out = run(s, all, args[0], args, now())
  if (!owns()) throw new MutexLost('mutex lost')
  writeState(s)
  return out
}

function main() {
  const [op, ...args] = process.argv.slice(2)
  if (op === 'where') {
    // The hooks module has no Node: it asks here where the shared state lives and the timings in force.
    makeDirs()
    process.stdout.write(JSON.stringify({ dir: DIR, aliveMs: ALIVE_MS, lingerMs: LINGER_MS }) + '\n')
    return
  }
  if (op === 'wait') {
    // Blocks until the seat is ours (exit 0) or we left the line (exit 3). Killed on Esc.
    for (;;) {
      const out = locked('poll', args)
      if (out.granted) {
        process.stdout.write(JSON.stringify(out) + '\n')
        return
      }
      if (out.mine === 'none') {
        process.stdout.write(JSON.stringify(out) + '\n')
        process.exitCode = 3
        return
      }
      sleep(WAIT_POLL_MS)
    }
  }
  process.stdout.write(JSON.stringify(locked(op, args)) + '\n')
}

module.exports = { lock, unlock, locked, owns, MUTEX }

if (require.main === module) {
  try {
    main()
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String(err && err.message) }) + '\n')
    process.exitCode = 1
  }
}
