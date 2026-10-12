// Host-side sweep for the tasks mod (the mod's sandbox deletes no files).
//   node sweep.cjs <dir> <sessionId> <days> [<doneDays>]
// Removes other sessions' own files not written for <days>, and sooner, after <doneDays>, a list with
// nothing left to carry over (handed over, or no open task) with its alive stamp, and an alive stamp
// whose list is gone. Nothing else in the folder (settings.json) is ever touched, and a missing folder
// is left missing.
'use strict'

const fs = require('fs')
const path = require('path')

// A session's own files, named by its id: its task list and its alive stamp.
const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(json|alive)$/i
const DAY_MS = 24 * 60 * 60 * 1000

/** Whether the sweep removes a file once it is old: another session's own file. This session's list
 * stays, so a session resumed after <days> keeps it. */
function isSwept(name, keep) {
  return SESSION_FILE.test(name) && !name.startsWith(`${keep}.`)
}

/** Whether a list has nothing a later session would carry over: another session took it (`handedOverAt`),
 * or every task is completed or dropped. An unreadable list is not done: only the full wait removes it. */
function isDone(text) {
  try {
    const list = JSON.parse(text)
    if (!list || typeof list !== 'object') return false
    if (list.handedOverAt) return true
    const tasks = Array.isArray(list.tasks) ? list.tasks : []
    return tasks.every(task => task.status === 'completed' || Boolean(task.droppedAt))
  } catch {
    return false
  }
}

// How many days a file waits: the full count, or the shorter one for a done list and its alive stamp,
// and for an alive stamp with no list beside it. A session still stamping (its stamp younger than the
// shorter wait) is running: its list keeps the full wait.
function daysFor(dir, name, days, doneDays, now) {
  if (doneDays === undefined) return days
  const short = Math.min(days, doneDays)
  const list = path.join(dir, name.replace(/\.alive$/i, '.json'))
  if (!fs.existsSync(list)) return name.endsWith('.alive') ? short : days
  const alive = list.replace(/\.json$/, '.alive')
  if (fs.existsSync(alive) && fs.statSync(alive).mtimeMs >= now - short * DAY_MS) return days
  return isDone(fs.readFileSync(list, 'utf8')) ? short : days
}

function sweep(dir, keep, days, now = Date.now(), doneDays = undefined) {
  if (!fs.existsSync(dir)) return
  // Every wait is settled before any file goes, so a list's alive stamp is judged by the list.
  const waits = []
  for (const name of fs.readdirSync(dir)) {
    if (!isSwept(name, keep)) continue
    try {
      waits.push([name, daysFor(dir, name, days, doneDays, now)])
    } catch {
      waits.push([name, days])
    }
  }
  for (const [name, wait] of waits) {
    try {
      const file = path.join(dir, name)
      if (fs.statSync(file).mtimeMs < now - wait * DAY_MS) fs.unlinkSync(file)
    } catch {
      // Removed by another session meanwhile, or held open: the next sweep tries again.
    }
  }
}

module.exports = { SESSION_FILE, isDone, isSwept, sweep }

if (require.main === module) {
  const [dir, keep, days, doneDays] = process.argv.slice(2)
  if (!dir || !keep || !(Number(days) > 0) || (doneDays !== undefined && !(Number(doneDays) > 0))) {
    process.stderr.write('usage: node sweep.cjs <dir> <sessionId> <days> [<doneDays>]\n')
    process.exit(2)
  }
  sweep(dir, keep, Number(days), Date.now(), doneDays === undefined ? undefined : Number(doneDays))
}
