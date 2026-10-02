// Host-side helper for the compact-handoff mod (the mod's sandbox has no fs
// delete and caps reads at 4 MiB, so transcript search and cleanup run here).
//   node helper.cjs recall <sessionId> <maxChars> <query...>
//   node helper.cjs persons <sessionId>
//   node helper.cjs sweep <dir> <keepNewest> <maxAgeDays>
const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function findTranscript(sessionId) {
  const projects = path.join(configDir(), 'projects')
  for (const dir of fs.readdirSync(projects)) {
    const file = path.join(projects, dir, `${sessionId}.jsonl`)
    if (fs.existsSync(file)) return file
  }
  return null
}

// The recall tool's own calls and answers would echo every past query back.
const RECALL_TOOL = 'mcp__compact-handoff__recall'
const recallCallIds = new Set()

function textsOf(record) {
  const content = record.message && record.message.content
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const out = []
  for (const block of content) {
    if (block.type === 'text') out.push(block.text)
    else if (block.type === 'tool_use') {
      if (block.name === RECALL_TOOL) recallCallIds.add(block.id)
      else out.push(`[${block.name}] ${JSON.stringify(block.input).slice(0, 400)}`)
    } else if (block.type === 'tool_result') {
      if (recallCallIds.has(block.tool_use_id)) continue
      const inner = block.content
      if (typeof inner === 'string') out.push(inner)
      else if (Array.isArray(inner)) for (const part of inner) if (part.type === 'text') out.push(part.text)
    }
  }
  return out
}

async function recall(sessionId, maxChars, query) {
  const file = findTranscript(sessionId)
  if (!file) return console.log(`No transcript found for session ${sessionId}.`)
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return console.log('Empty query.')
  const hits = []
  let lineNo = 0
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) {
    lineNo++
    let record
    try { record = JSON.parse(line) } catch { continue }
    for (const text of textsOf(record)) {
      const lower = text.toLowerCase()
      if (!terms.every(term => lower.includes(term))) continue
      const at = lower.indexOf(terms[0])
      const start = Math.max(0, at - 400)
      const snippet = text.slice(start, at + 400).replace(/\s+/g, ' ')
      const role = record.message ? record.message.role : record.type
      hits.push(`[line ${lineNo} ${record.timestamp || ''} ${role}] ${start > 0 ? '...' : ''}${snippet}...`)
    }
  }
  if (hits.length === 0) return console.log(`No match for "${query}" in the full transcript.`)
  // Newest first: the latest mention is usually the one still in force.
  let out = `${hits.length} match(es), newest first:\n`
  for (const hit of hits.reverse()) {
    if (out.length + hit.length + 2 > maxChars) { out += '[more matches cut; narrow the query]'; break }
    out += `${hit}\n\n`
  }
  console.log(out)
}

function sweep(dir, keepNewest, maxAgeDays) {
  if (!fs.existsSync(dir)) return
  const cutoff = Date.now() - maxAgeDays * 86400000
  const files = fs.readdirSync(dir)
    .map(name => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  files.forEach((file, index) => {
    if (index >= keepNewest || file.mtime < cutoff) fs.unlinkSync(path.join(dir, file.name))
  })
}

// The block the mod carries through each compaction (PERSON_MARK in
// hooks/register.ts; test-helper/helper.spec.cjs keeps the two equal). Read back
// as a message, it would carry every earlier message forward a second time.
const PERSON_MARK = "[compact-handoff] The person's messages, word for word"

// Lines the mods attach to a prompt, and whole prompts they submit, start with
// the mod's tag. The same pattern as INJECTED_LINE in hooks/register.ts (the
// spec keeps the two equal).
const INJECTED_LINE = /^\[[a-z][a-z0-9-]*\](?: |$)/

function stripInjected(text) {
  return text.split('\n').filter(line => !INJECTED_LINE.test(line.trim())).join('\n').trim()
}

// The same filter as isPersonMessage in hooks/register.ts, for the transcript's records.
function isPersonText(text) {
  return (
    !text.startsWith('<') &&
    !text.startsWith('[SYSTEM') &&
    !text.startsWith('This session is being continued') &&
    !text.startsWith(PERSON_MARK) &&
    stripInjected(text).length > 0
  )
}

// The person's own messages since the last compaction, oldest first: typed
// prompts plus those typed while a turn ran (stored as queued_command
// attachments, which the compaction's message list does not show as typed).
async function persons(sessionId) {
  const file = findTranscript(sessionId)
  // A failure, not an empty list: the hook then falls back to the compaction's
  // own message list instead of carrying none of the person's words.
  if (!file) {
    console.error(`No transcript found for session ${sessionId}.`)
    process.exitCode = 1
    return
  }
  let found = []
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) {
    let record
    try { record = JSON.parse(line) } catch { continue }
    if (record.subtype === 'compact_boundary') { found = []; continue }
    let text = ''
    if (record.type === 'attachment' && record.attachment && record.attachment.type === 'queued_command' &&
        record.attachment.origin && record.attachment.origin.kind === 'human') {
      text = String(record.attachment.prompt || '')
    } else if (record.type === 'user' && !record.isMeta && !record.isCompactSummary && record.message) {
      const content = record.message.content
      if (typeof content === 'string') text = content
      else if (Array.isArray(content) && !content.some(block => block.type === 'tool_result')) {
        text = content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      }
    }
    text = text.trim()
    if (!isPersonText(text)) continue
    text = stripInjected(text)
    if (found[found.length - 1] !== text) found.push(text)
  }
  console.log(JSON.stringify(found))
}

module.exports = { PERSON_MARK, INJECTED_LINE, isPersonText }

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'recall') recall(args[0], Number(args[1]), args.slice(2).join(' '))
  else if (command === 'persons') persons(args[0])
  else if (command === 'sweep') sweep(args[0], Number(args[1]), Number(args[2]))
  else { console.error('usage: recall|persons|sweep'); process.exit(2) }
}
