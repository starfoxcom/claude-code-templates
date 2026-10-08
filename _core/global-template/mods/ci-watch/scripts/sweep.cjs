// Host-side sweep for the ci-watch mod (the mod's sandbox deletes no files).
//   node sweep.cjs <dir> <sessionId> <days>
// Removes other sessions' own files not written for <days>. Nothing else in the folder (settings.json)
// is ever touched, and a missing folder is left missing.
'use strict'

const fs = require('fs')
const path = require('path')

// A session's own files, named by its id: its watch state and its owner stamp.
const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(json|owner)$/i
const DAY_MS = 24 * 60 * 60 * 1000

/** Whether the sweep removes a file once it is old: another session's own file. */
function isSwept(name, keep) {
  return SESSION_FILE.test(name) && !name.startsWith(`${keep}.`)
}

function sweep(dir, keep, days, now = Date.now()) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (!isSwept(name, keep)) continue
    try {
      const file = path.join(dir, name)
      if (fs.statSync(file).mtimeMs < now - days * DAY_MS) fs.unlinkSync(file)
    } catch {
      // Removed by another session meanwhile, or held open: the next sweep tries again.
    }
  }
}

module.exports = { SESSION_FILE, isSwept, sweep }

if (require.main === module) {
  const [dir, keep, days] = process.argv.slice(2)
  if (!dir || !keep || !(Number(days) > 0)) {
    process.stderr.write('usage: node sweep.cjs <dir> <sessionId> <days>\n')
    process.exit(2)
  }
  sweep(dir, keep, Number(days))
}
