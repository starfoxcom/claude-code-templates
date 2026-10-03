#!/usr/bin/env node
// Claude Code status line, up to four lines:
//   1. the session: model and effort, project, git branch (* when dirty);
//   2. CI: this session's watched PRs, from the ci-watch mod;
//   3. local CI runners, on or off;
//   4. budgets: context fill and tokens left before compaction, plan usage
//      (or the usage-guard pause), prompt-cache countdown.
// Reads the status JSON on stdin; a line with nothing to show is left out.
// Mods that draw their own band above the prompt (shared-pc, tasks) get no
// piece here.
//
// Local runners are opt-in: list them in statusline.config.json beside this
// file, e.g. { "runners": [{ "label": "runners", "process": "Runner.Listener" }]
// } for a GitHub Actions self-hosted runner. They are machine-wide, so every
// session shows them.
//
// The compaction window and threshold are not in the status input; the
// session-facts mod writes them per session to mods-data/session-facts/.
// Without that file the window comes from settings, and the threshold is
// left out rather than guessed.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const DATA_DIR = path.join(CONFIG_DIR, 'mods-data')
const WARN_PLAN = 75
const DEFAULT_WRAP_UP_AT = 90
const CACHE_WARN_MINUTES = 10
const RUNNER_CHECK_MS = 60_000
const SWEEP_EVERY_MS = 60 * 60_000
const FACTS_MAX_AGE_MS = 3 * 24 * 60 * 60_000
const CONFIG_FILE = path.join(__dirname, 'statusline.config.json')

const color = {
  copper: s => `\x1b[38;2;181;86;31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
  } catch {
    // A status line never fails over its own cache.
  }
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function localTime(epochMs) {
  const date = new Date(epochMs)
  const day = date.toLocaleDateString('en-US', { weekday: 'short' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}`
}

function settingsValue(key) {
  for (const file of ['settings.local.json', 'settings.json']) {
    const value = readJson(path.join(CONFIG_DIR, file))?.[key]
    if (value !== undefined) return value
  }
  return undefined
}

function modelPart(input) {
  const name = (input.model?.display_name || '').replace(/\s*\([^)]*context\)/i, '')
  const effort = input.effort?.level
  return effort ? `${name} ${effort}` : name
}

function branchPart(cwd) {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch || branch === 'HEAD') return ''
  const dirty = git(cwd, ['status', '--porcelain']) ? '*' : ''
  return color.copper(`${branch}${dirty}`)
}

function contextPart(input) {
  const tokens = input.context_window?.total_input_tokens
  if (!tokens) return color.dim('ctx --')
  const facts = readJson(path.join(DATA_DIR, 'session-facts', `${input.session_id}.json`))
  const configured = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || settingsValue('autoCompactWindow')) || Infinity
  const size = facts?.size || Math.min(configured, input.context_window?.context_window_size || Infinity)
  if (!Number.isFinite(size)) return color.dim('ctx --')
  const percent = Math.round((tokens / size) * 100)
  const compactsAt = facts?.compactsAt
  const ratio = tokens / (compactsAt || size)
  const text = compactsAt
    ? `ctx ${percent}% · ${Math.max(0, Math.round((compactsAt - tokens) / 1000))}k to compact`
    : `ctx ${percent}%`
  return ratio >= 0.9 ? color.red(text) : ratio >= 0.75 ? color.yellow(text) : text
}

function planPart(input) {
  const pause = readJson(path.join(DATA_DIR, 'usage-guard', 'pause.json'))
  if (pause?.status === 'active' && pause.wakeAt > Date.now()) return color.red(`PAUSED → ${localTime(pause.wakeAt)}`)

  const wrapUpAt = Number(settingsValue('pluginConfigs')?.['usage-guard']?.options?.wrapUpAt) || DEFAULT_WRAP_UP_AT
  const windows = [
    ['5h', input.rate_limits?.five_hour],
    ['week', input.rate_limits?.seven_day],
  ]
  const parts = windows
    .filter(([, limit]) => limit && typeof limit.used_percentage === 'number')
    .map(([label, limit]) => {
      const used = Math.round(limit.used_percentage)
      if (used < WARN_PLAN) return `${label} ${used}%`
      const reset = limit.resets_at ? ` → resets ${localTime(limit.resets_at * 1000)}` : ''
      const text = `${label} ${used}%${reset}`
      return used >= wrapUpAt ? color.red(text) : color.yellow(text)
    })
  return parts.join(' · ')
}

function cachePart(input) {
  const cache = input.prompt_cache
  if (!cache?.expires_at || !input.context_window?.total_input_tokens) return ''
  const minutes = Math.floor((cache.expires_at * 1000 - Date.now()) / 60_000)
  if (minutes > CACHE_WARN_MINUTES) return ''
  return minutes <= 0 ? color.red('cache cold') : color.yellow(`cache ${minutes}m`)
}

function isProcessRunning(name) {
  try {
    if (process.platform === 'win32') {
      const image = name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`
      const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { encoding: 'utf8', timeout: 3000 })
      return out.toLowerCase().includes(image.toLowerCase())
    }
    execFileSync('pgrep', ['-f', name], { stdio: 'ignore', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

function runnerPart() {
  const runners = readJson(CONFIG_FILE)?.runners
  if (!Array.isArray(runners) || runners.length === 0) return ''
  const file = path.join(DATA_DIR, 'statusline', 'runners.json')
  let state = readJson(file)
  if (!state || Date.now() - state.checkedAt > RUNNER_CHECK_MS) {
    state = { checkedAt: Date.now(), on: runners.map(runner => isProcessRunning(runner.process)) }
    writeJson(file, state)
  }
  return runners
    .map((runner, index) => {
      const label = runner.label || runner.process
      return state.on?.[index] ? color.green(`${label} on`) : color.dim(`${label} off`)
    })
    .join(' · ')
}

// This session's watched PRs, from the ci-watch mod's per-session state.
function ciPart(sessionId) {
  const watches = readJson(path.join(DATA_DIR, 'ci-watch', `${sessionId}.json`))?.watches
  if (!Array.isArray(watches)) return ''
  return watches
    .map(watch => {
      const buckets = Object.values(watch.checks || {})
      const done = buckets.filter(bucket => bucket !== 'pending').length
      const failed = Object.entries(watch.checks || {}).filter(([, bucket]) => bucket === 'fail' || bucket === 'cancel')
      const pr = `PR ${watch.number}`
      if (watch.outcome === 'passed') return color.green(`${pr} · all ${buckets.length} passed`)
      if (failed.length) return color.red(`${pr} · failed: ${failed.map(([name]) => name).join(', ')}`)
      if (watch.outcome === 'timeout') return color.yellow(`${pr} · stuck pending`)
      return color.yellow(`${pr} · ${done}/${buckets.length} done`)
    })
    .join(' | ')
}

// Session-facts files outlive their sessions; drop old ones once an hour.
function sweepFacts() {
  const stamp = path.join(DATA_DIR, 'statusline', 'swept.json')
  if (Date.now() - (readJson(stamp)?.at || 0) < SWEEP_EVERY_MS) return
  writeJson(stamp, { at: Date.now() })
  const dir = path.join(DATA_DIR, 'session-facts')
  try {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name)
      if (Date.now() - fs.statSync(file).mtimeMs > FACTS_MAX_AGE_MS) fs.unlinkSync(file)
    }
  } catch {
    // Nothing to sweep yet.
  }
}

function main(raw) {
  let input = {}
  try {
    input = JSON.parse(raw)
  } catch {
    // Draw what can be drawn without input.
  }
  // `null`, a number or a list parse fine but are not the input object.
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {}
  const cwd = input.workspace?.current_dir || input.cwd || process.cwd()
  const project = path.basename(input.workspace?.project_dir || cwd)
  const lines = [
    [modelPart(input), project, branchPart(cwd)],
    [ciPart(input.session_id)],
    [runnerPart()],
    [contextPart(input), planPart(input), cachePart(input)],
  ]
    .map(parts => parts.filter(Boolean).join(' | '))
    .filter(Boolean)
  process.stdout.write(`${lines.join('\n')}\n`)
  sweepFacts()
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => (raw += chunk))
process.stdin.on('end', () => main(raw))
