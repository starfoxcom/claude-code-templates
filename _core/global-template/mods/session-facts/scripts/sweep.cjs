// Host-side sweep for the session-facts mod (the mod's sandbox makes no folders and deletes no files).
//   node sweep.cjs <dir> <sessionId>
// Makes the data folder, then removes other sessions' own files older than two days. Nothing else in the
// folder (settings.json, plan.json) is ever touched.
'use strict'

const fs = require('fs')
const path = require('path')

// A session's own files, named by its id: its memory and its compaction marker.
const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.compact)?\.json$/i
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000

/** Whether the sweep removes a file once it is old: another session's own file. */
function isSwept(name, keep) {
  return SESSION_FILE.test(name) && !name.startsWith(`${keep}.`)
}

function sweep(dir, keep, now = Date.now()) {
  fs.mkdirSync(dir, { recursive: true })
  for (const name of fs.readdirSync(dir)) {
    if (!isSwept(name, keep)) continue
    try {
      const file = path.join(dir, name)
      if (fs.statSync(file).mtimeMs < now - MAX_AGE_MS) fs.unlinkSync(file)
    } catch {
      // Removed by another session meanwhile, or held open: the next sweep tries again.
    }
  }
}

module.exports = { SESSION_FILE, MAX_AGE_MS, isSwept, sweep }

if (require.main === module) {
  const [dir, keep] = process.argv.slice(2)
  if (!dir || !keep) {
    process.stderr.write('usage: node sweep.cjs <dir> <sessionId>\n')
    process.exit(2)
  }
  sweep(dir, keep)
}
