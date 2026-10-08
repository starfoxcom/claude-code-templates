import type { EngineInterface as Engine, Register } from 'claude-code'

import { foldDots } from './folders'
import { HELPER_BLOCK, helpersCommand, helpersLine, isHelperChecked } from './helpers'
import { inspect } from './inspect'
import type { Folder, Plan, Target } from './inspect'
import { describeName, findName, readNameRules } from './names'
import type { NameRule } from './names'
import { checkAddedLines, checkBranch, checkText, describe } from './policy'
import { checkBody, checkCall, hasRow, ruleFor } from './prbody'
import type { PrCall, PrRules } from './prbody'
import { applyFile, register as settings, SETTINGS_PANE } from './settings'

// guards: one in-process check on every Bash and PowerShell call, replacing the attribution,
// `gh run watch` and PR-body scripts. It reads the command (which program, which flags, which message) instead of
// scanning raw text, so paths, branch names and flags never trip it. Hot reload watches this file only:
// change it after editing shell.ts, inspect.ts or policy.ts. Opt-in per repo, from files in
// mods-data/guards: the PR-body contract (pr-body.json) and banned names (names.json). Opt-in by
// setting: helper agents (`helpers` = block refuses Agent and Workflow calls; see helpers.ts).
//
// mode `shadow` (the default while it is new): never blocks; it logs what it would block, and what the
// scripts beside it blocked, to mods-data/guards/decisions.jsonl. mode `enforce`: blocks.

const LOG_CAP = 256 * 1024
const live = { mode: 'shadow', mentionRepos: ['*'] as string[], home: '', dir: '', isWindows: false, temp: '' }
// The helper setting, and the sessions that typed `/guards helpers allow` (module state: a replaced
// hooks worker forgets them, which errs toward the block).
const helpers = { setting: 'allow' as 'allow' | 'block', allowedIn: new Set<string>() }

// Makes the data folder and records when, and in which mode, the mod loaded.
const MARK_LOADED = [
  'const fs=require("fs")',
  'fs.mkdirSync(process.argv[1],{recursive:true})',
  'const at=new Date().toISOString()',
  'fs.writeFileSync(process.argv[1]+"/loaded.json",JSON.stringify({at,mode:process.argv[2]}))',
].join(';')

async function setUp($: Engine) {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  live.isWindows = (await $.env.get('OS')) === 'Windows_NT'
  live.home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.').replace(/\\/g, '/')
  live.temp = ((await $.env.get('TEMP')) ?? (await $.env.get('TMP')) ?? '').replace(/\\/g, '/').replace(/\/$/, '')
  live.dir = `${(configured ?? `${live.home}/.claude`).replace(/\\/g, '/')}/mods-data/guards`
  // The engine's fs writes no missing folders; node makes it once per session.
  await $.process.run(['node', '-e', MARK_LOADED, live.dir, live.mode], { timeoutMs: 10_000 }).catch(() => undefined)
}

// Bash on Windows writes /c/Users/...; the engine's fs takes C:/Users/... Only on Windows: elsewhere
// `/u/me` is a real one-letter folder. Git Bash also mounts the Windows temp folder at /tmp, so a body
// file a Bash command names there is read from TEMP (PowerShell has no such mount).
function osPath(path: string, cwd: string, isBash = false): string {
  let p = path.replace(/\\/g, '/')
  if (p.startsWith('~/')) p = live.home + p.slice(1)
  if (isBash && live.isWindows && live.temp && /^\/tmp(?:\/|$)/.test(p)) p = live.temp + p.slice(4)
  const drive = live.isWindows ? /^\/([a-zA-Z])\//.exec(p) : null
  if (drive) p = `${drive[1]?.toUpperCase()}:/${p.slice(3)}`
  if (!/^[a-zA-Z]:\//.test(p) && !p.startsWith('/')) p = `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/${p}`
  return p
}

// `isCut`: the output went past the engine's cap, so what came back is only its start.
async function gitRun($: Engine, cwd: string, args: string[]): Promise<{ out: string; isCut: boolean }> {
  try {
    const run = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 8_000 })
    return run.exitCode === 0 ? { out: run.stdout, isCut: Boolean(run.isStdoutTruncated) } : { out: '', isCut: false }
  } catch {
    return { out: '', isCut: false }
  }
}

async function git($: Engine, cwd: string, args: string[]): Promise<string> {
  return (await gitRun($, cwd, args)).out
}

// A folder the command moved to, as a full path; none is the session folder.
function folderAt(folder: Folder | undefined, session: string, isBash: boolean) {
  return folder?.path === undefined ? session : osPath(folder.path, session, isBash)
}

// A body file's full path: from the folder in effect where it is named.
function fileAt(path: string, folder: Folder | undefined, session: string, isBash: boolean) {
  return osPath(path, folderAt(folder, session, isBash), isBash)
}

// A relative path under a folder built at run time (`cd "$REPO"`) cannot be found from here, and a file
// of the same name in the session folder is a different file: it is never read.
function isUnplaced(path: string, folder: Folder | undefined): boolean {
  return Boolean(folder?.isUnknown) && !/^([a-zA-Z]:)?[\\/]|^~/.test(path)
}

// What message text is checked for besides AI credit: the product name unless the repo may name it,
// and the repo's banned names.
type TextRules = { mayName: boolean; banned?: NameRule }

// One message text: AI credit first, then the product name, then the repo's banned names.
function textReason(text: string, where: string, rules: TextRules, creditOnly = false): string | undefined {
  const v = checkText(text, rules.mayName || creditOnly)
  if (v) return describe(v, where)
  const name = rules.banned && !creditOnly ? findName(text, rules.banned) : undefined
  return name ? describeName(name, where) : undefined
}

// The body files the command reads: the first reason to block, or undefined. Files that cannot be read
// for a known cause are named unread instead.
async function checkFiles($: Engine, plan: Plan, session: string, rules: TextRules, isBash: boolean) {
  // Each written file where its writer ran, `.` and `..` folded in on both sides.
  const placed = (path: string, folder: Folder) => foldDots(fileAt(path, folder, session, isBash)).toLowerCase()
  const written = new Set(plan.written.filter(w => !isUnplaced(w.path, w.folder)).map(w => placed(w.path, w.folder)))
  for (const { where, path, written: fromCommand, folder, scripted, named } of plan.files) {
    const full = fileAt(path, folder, session, isBash)
    if (isUnplaced(path, folder)) {
      if (!fromCommand || named) plan.unread.push(where)
      continue
    }
    let text: string
    try {
      text = String(await $.fs.read(full))
    } catch {
      // A body file this same command writes does not exist yet: what it writes was read from the
      // command text above. One written under another spelling of its path is left as a note: the
      // command text, here-doc included, is under the credit check.
      // Unless another program rewrote it after that (`cat > b.md ...; cp x b.md`).
      if (fromCommand && named) plan.unread.push(`${where} (another program in this command may write ${path})`)
      if (fromCommand) continue
      // Likewise a file a script whose code is in the command (`python - <<EOF`, `node -e`) may write: that
      // code is under the credit check.
      if (written.has(foldDots(full).toLowerCase()) || scripted) {
        plan.notes.push(`${where} (written by this command, ${scripted ? 'by its script' : 'under another spelling'})`)
        continue
      }
      // A Bash /tmp path on Windows is mapped by a guess (Git Bash's mount of TEMP): a miss cannot be read.
      const isTmpGuess = isBash && live.isWindows && /^\/tmp(?:\/|$)/.test(path.replace(/\\/g, '/'))
      // The refusal names the way out: the file may exist where Git Bash put it, under another folder.
      if (isTmpGuess) {
        plan.unread.push(`${where} (Git Bash's /tmp did not map to a folder the guard reads: give its Windows path)`)
        continue
      }
      return `could not read the body file ${full} for ${where}. Write the file first, or check the path.`
    }
    // On disk already, but an earlier program of the command may rewrite it: the text read now is not the
    // text the call sends.
    if (named) {
      plan.unread.push(`${where} (another program in this command may write ${path})`)
      continue
    }
    const reason = textReason(text, `${where} (file ${path})`, rules)
    if (reason) return reason
  }
  return undefined
}

// The repos whose PRs follow the PR-body contract, from mods-data/guards/pr-body.json; none without it.
async function prRules($: Engine): Promise<PrRules | undefined> {
  try {
    const rules = JSON.parse(String(await $.fs.read(`${live.dir}/pr-body.json`))) as PrRules
    return rules && typeof rules.repos === 'object' ? rules : undefined
  } catch {
    return undefined
  }
}

// The repos' banned names, from mods-data/guards/names.json; none without it, or when it is malformed.
async function nameRules($: Engine) {
  try {
    return readNameRules(String(await $.fs.read(`${live.dir}/names.json`)))
  } catch {
    return undefined
  }
}

// The PR body exactly as it will be sent: a literal here-doc on stdin, or a file already on disk where
// the command's folder is known. Undefined for any other route, among them a body file this same command
// writes (its text as the command reading holds it may differ from what lands in the file).
async function prBody($: Engine, plan: Plan, call: PrCall, session: string, isBash: boolean) {
  if (call.bodyFile === '-') return call.stdinBody
  // Another statement naming the same path may sit in another folder: which entry is the PR's is a guess.
  const files = plan.files.filter(f => f.path === call.filePath)
  const file = files.length === 1 ? files[0] : undefined
  if (!file || file.written || isUnplaced(file.path, file.folder)) return undefined
  try {
    return String(await $.fs.read(fileAt(file.path, file.folder, session, isBash)))
  } catch {
    return undefined
  }
}

// The PR call, judged only in its plain form: the command's one gh statement, with a title written out.
// With other gh statements the repo, the body file or the title may belong to one of them, so the
// body is left as a note instead, which the shadow log shows; it never blocks and never passes in silence.
async function checkPr($: Engine, plan: Plan, session: string, repo: string | undefined, isBash: boolean) {
  const [call] = plan.prs
  if (!call) return undefined
  const isPlain =
    plan.prs.length === 1 && plan.ghCalls === 1 && call.isAlone && !call.isTitleDynamic && !call.isUnknown
  const rules = await prRules($)
  if (!rules) return undefined
  // Before the repo's rule: another statement's `--repo` may have named the wrong repo.
  if (!isPlain) return void plan.notes.push(`the PR body (format check, ${call.action}: not a single plain PR call)`)
  if (repo === undefined)
    return void plan.notes.push(`the PR body (format check, ${call.action}: repo built at run time)`)
  const rule = ruleFor(rules, repo)
  if (!rule) return undefined
  const early = checkCall(call)
  if (early) return early
  if (call.bodyFile === undefined) return undefined
  const text = await prBody($, plan, call, session, isBash)
  if (text === undefined) return void plan.notes.push(`the PR body (format check, ${call.action})`)
  try {
    const reason = checkBody(text, call.hasTitle ? call.title : undefined, rule)
    // No title: whether this PR may skip the board row is unknown, so a missing row is left as a note.
    if (!reason && !call.hasTitle && rule.row && !hasRow(text, rule))
      plan.notes.push(`the PR body's board row (format check, ${call.action}: no --title to judge it)`)
    return reason
  } catch {
    // A pattern in pr-body.json that does not compile: the body goes unjudged, the other checks still run.
    return void plan.notes.push(`the PR body (pr-body.json has an invalid pattern for ${repo})`)
  }
}

// The way out for each kind of unread entry; a message's is the last.
const WAYS_OUT: [RegExp, string][] = [
  [
    /folder or repo built at run time/,
    'Run it in a folder named out (`cd <path>` or `git -C <path>`), with no git folder or repo set at run time.',
  ],
  [/^the new branch name/, 'Type the branch name out.'],
  [
    /another program in this command may write/,
    'Write the body file in an earlier command, or in this one with `>` or a here-doc, which the guard reads.',
  ],
  [/^a program named at run time/, 'Name the program itself (`git`, `gh`).'],
  [
    /^a git setting built at run time/,
    'Leave the git alias, include or config file out of the command, and write each `-c` setting out.',
  ],
  [/^a trap action/, 'Write the trap action out, or leave the trap out of the command.'],
  [
    /^a .* built at run time$/,
    'Write each word of the git or gh call out: no variable, `$(...)`, list or splat in it.',
  ],
]

function unreadReason(where: string): string {
  const way = WAYS_OUT.find(([kind]) => kind.test(where))?.[1]
  if (way) return `${where} cannot be read. ${way}`
  return (
    `${where} is built in a way the guard cannot read (a variable set outside this command, another ` +
    "program's output, a file it cannot find, a script built at run time). Write the text out, use a " +
    'here-doc, or write the body file in an earlier command.'
  )
}

// The repo each write lands in, lowercased: the one `--repo` names, or its folder's; undefined where that
// is built at run time. A command with no write is judged as the session folder's repo.
async function reposOf($: Engine, targets: Target[], session: string, isBash: boolean) {
  const all = targets.length > 0 ? targets : [{ folder: { isUnknown: false } }]
  return Promise.all(
    all.map(async ({ folder, repo }: Target) => {
      if (repo !== undefined) return repo.toLowerCase()
      if (folder.isUnknown) return undefined
      const top = (await git($, folderAt(folder, session, isBash), ['rev-parse', '--show-toplevel'])).trim()
      return (top.split(/[\\/]/).pop() ?? '').toLowerCase()
    }),
  )
}

// The text rules of every repo the command writes to, the strictest of them: the product name only where
// each repo may name it, and the banned names of all. A repo that cannot be known takes every repo's.
async function rulesFor($: Engine, repos: (string | undefined)[]): Promise<TextRules> {
  const mayName =
    live.mentionRepos.includes('*') || repos.every(repo => repo !== undefined && live.mentionRepos.includes(repo))
  const names = await nameRules($)
  const each = repos.flatMap(repo => (repo === undefined ? Object.values(names?.repos ?? {}) : [ruleFor(names, repo)]))
  const found = each.filter((rule): rule is NameRule => rule !== undefined)
  if (found.length === 0) return { mayName }
  return { mayName, banned: { names: found.flatMap(f => f.names ?? []), words: found.flatMap(f => f.words ?? []) } }
}

// Each commit's added lines, read in the folder it runs in: the first credit line found, or undefined.
// A commit whose folder or repo is built at run time cannot be scanned, so it is named unread.
async function diffReason($: Engine, plan: Plan, session: string, isBash: boolean) {
  for (const { folder, diff } of plan.targets) {
    if (!diff) continue
    const where = 'the lines the commit adds (in a folder or repo built at run time)'
    if (folder.isUnknown) {
      if (!plan.unread.includes(where)) plan.unread.push(where)
      continue
    }
    const args = diff === 'all' ? ['diff', 'HEAD', '-U0', '--no-color'] : ['diff', '--cached', '-U0', '--no-color']
    const run = await gitRun($, folderAt(folder, session, isBash), args)
    const hit = checkAddedLines(run.out)
    if (hit) return `AI credit line added to ${hit.file}: "${hit.line}". Remove it before committing.`
    // A diff past the output cap was read only in part: the rest is noted, never passed as clean.
    const cut = 'the lines the commit adds past the first part of its diff'
    if (run.isCut && !plan.notes.includes(cut)) plan.notes.push(cut)
  }
  return undefined
}

// The first reason to block, or undefined.
async function verdict($: Engine, plan: Plan, isBash = false): Promise<string | undefined> {
  if (plan.block) return plan.block
  const session = await $.session.cwd()
  const repos = await reposOf($, plan.targets, session, isBash)
  const rules = await rulesFor($, repos)
  for (const { where, text, creditOnly } of plan.texts) {
    const reason = textReason(text, where, rules, creditOnly)
    if (reason) return reason
  }
  const fileReason = await checkFiles($, plan, session, rules, isBash)
  if (fileReason) return fileReason
  for (const branch of plan.branches) {
    const where = `the new branch name "${branch}" (it lands in merge commit titles)`
    const v = checkBranch(branch, rules.mayName)
    if (v) return describe(v, where)
    const name = rules.banned ? findName(branch, rules.banned) : undefined
    if (name) return describeName(name, where)
  }
  const diff = await diffReason($, plan, session, isBash)
  if (diff) return diff
  // A message the reading could not follow is refused: what reaches history unread is never passed.
  const [unread] = plan.unread
  if (unread) return unreadReason(unread)
  // Last: a credit anywhere outranks the PR format. A plain PR call is the command's one write.
  const prReason = await checkPr($, plan, session, repos[0], isBash)
  return prReason ? `PR-body contract: ${prReason}` : undefined
}

async function log($: Engine, entry: Record<string, unknown>) {
  if (!live.dir) return
  const file = `${live.dir}/decisions.jsonl`
  let text = ''
  try {
    text = String(await $.fs.read(file))
  } catch {
    // First entry.
  }
  if (text.length > LOG_CAP) {
    await $.fs.write(`${live.dir}/decisions.1.jsonl`, text).catch(() => undefined)
    text = ''
  }
  await $.fs.write(file, `${text}${JSON.stringify(entry)}\n`).catch(() => undefined)
}

// Per-day totals in mods-data/guards/stats.json: proof the mod runs, and the denominator for the
// shadow comparison (decisions.jsonl only holds the writes where the mod or the scripts would block).
async function count($: Engine, isModBlock: boolean, isScriptBlock: boolean) {
  if (!live.dir) return
  const file = `${live.dir}/stats.json`
  let stats: Record<string, { checked: number; mod: number; scripts: number; lastAt: number }> = {}
  try {
    stats = JSON.parse(String(await $.fs.read(file)))
  } catch {
    // First count.
  }
  const now = Date.now()
  const day = new Date(now).toISOString().slice(0, 10)
  const row = (stats[day] ??= { checked: 0, mod: 0, scripts: 0, lastAt: 0 })
  row.checked++
  if (isModBlock) row.mod++
  if (isScriptBlock) row.scripts++
  row.lastAt = now
  // Keep the last 30 days.
  for (const key of Object.keys(stats).sort().slice(0, -30)) delete stats[key]
  await $.fs.write(file, JSON.stringify(stats, null, 1)).catch(() => undefined)
}

// A check that failed before the command ran, from the guard's own catch or the engine's (a throw
// anywhere in the hook, or its time budget overrun). Shadow lets the command run, as the scripts still
// check it; enforce refuses it, so a crash never lets an unchecked write through.
async function failed($: Engine, tool: string, command: string, error: string, run: () => Promise<any>) {
  const isEnforced = live.mode === 'enforce'
  const why = error.slice(0, 200)
  const entry = { at: Date.now(), tool, error: why, command: command.slice(0, 2000) }
  await log($, isEnforced ? { ...entry, enforced: true } : entry).catch(() => undefined)
  if (!isEnforced) return run()
  return {
    deny:
      `BLOCKED (guards): the check failed before it could read this call (${why}). Retry once; ` +
      'if it fails again, the maintainer can switch guards to shadow: /guards set mode shadow.',
  }
}

async function guard($: Engine, tool: string, command: string, run: () => Promise<any>) {
  const plan = inspect(command, tool === 'PowerShell')
  // A write the reading missed still carries the command-text backstop, so text alone is reason to check.
  if (!plan.isWrite && plan.texts.length === 0 && plan.branches.length === 0 && !plan.block) return run()
  // A hot reload starts the module over without a new session.start: set up on first use.
  if (!live.dir) await setUp($)
  let reason: string | undefined
  try {
    reason = await verdict($, plan, tool === 'Bash')
  } catch (err) {
    return failed($, tool, command, String(err), run)
  }
  // An enforced block is counted and logged like any other decision: it is the one a false block is
  // debugged from. The command never ran, so the scripts' answer is unknown.
  const isBlocked = live.mode === 'enforce' && reason !== undefined
  const result = isBlocked ? { deny: `BLOCKED (guards): ${reason}` } : await run()
  const scripts = isBlocked
    ? undefined
    : (result?.deny ?? (result?.isError && /BLOCKED/.test(String(result?.text)) ? String(result.text) : undefined))
  await count($, Boolean(reason), Boolean(scripts))
  if (reason || scripts || plan.unread.length > 0 || plan.notes.length > 0) {
    await log($, {
      at: Date.now(),
      session: await $.session.id(),
      tool,
      mod: reason ?? null,
      scripts: scripts ? String(scripts).slice(0, 300) : null,
      ...(isBlocked ? { enforced: true } : {}),
      unread: plan.unread,
      notes: plan.notes,
      command: command.slice(0, 2000),
    })
  }
  return result
}

async function helperState($: Engine) {
  const { setting, allowedIn } = helpers
  if (setting === 'allow' || allowedIn.size === 0) return { setting, isAllowedHere: false }
  return { setting, isAllowedHere: allowedIn.has(await $.session.id()) }
}

// An Agent or Workflow call: refused in enforce, logged in shadow, while the setting blocks helpers.
async function helperGuard($: Engine, tool: string, run: () => Promise<any>) {
  if (!isHelperChecked(await helperState($))) return run()
  if (!live.dir) await setUp($)
  const isBlocked = live.mode === 'enforce'
  // Logged, never counted: stats.json counts shell writes, the denominator of the shadow comparison.
  const entry ={ at: Date.now(), session: await $.session.id(), tool, mod: HELPER_BLOCK, scripts: null }
  await log($, { ...entry, ...(isBlocked ? { enforced: true } : {}), unread: [], command: '' })
  return isBlocked ? { deny: `BLOCKED (guards): ${HELPER_BLOCK}` } : run()
}

// The settings file at the session's start, before any tool call: the settings module follows it from
// there. Read here, since an engine handle is never passed into another file.
async function readSettings($: Engine): Promise<void> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const file = await $.fs.read(`${config}/mods-data/guards/settings.json`.replace(/\\/g, '/')).catch(() => '')
  const manifest = (dir: string) => $.fs.read(`${$.plugin.root}${dir}/plugin.json`)
  applyFile(String(file), String(await manifest('/.claude-plugin').catch(() => manifest('').catch(() => ''))))
}

export const register: Register = (on, options) => {
  // The settings come from the mod's own file over the loaded options, read again as it changes.
  settings(on, options, values => {
    live.mode = String(values.mode ?? 'shadow') === 'enforce' ? 'enforce' : 'shadow'
    live.mentionRepos = String(values.mentionRepos ?? '*')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
    helpers.setting = String(values.helpers ?? 'allow') === 'block' ? 'block' : 'allow'
  })

  on('session.start', async ($, e, next) => {
    // A settings file that cannot be read never costs the start: the loaded options stand.
    await readSettings($).catch(() => undefined)
    const result = await next(e)
    await setUp($)
    await $.command.register({
      name: 'guards',
      description: 'The guard mode and what it caught. Also: settings, set, help',
      argumentHint: ARGUMENT_HINT,
    })
    return result
  })
  on('command.run', { command: 'guards' }, async ($, e) => ({ text: await runCommand($, e.args) }))
  // Without a `.catch` the engine skips a hook that throws or overruns its budget, and the command
  // runs unchecked. A failure after the command ran replays its result.
  const bash = (e: { command?: unknown }) => String(e.command ?? '')
  const ps = (e: unknown) => String((e as { command?: unknown }).command ?? '')
  on('tool.call', { tool: 'Bash' }, ($, e, next) => guard($, 'Bash', bash(e), () => next(e))).catch(
    ($, e, next) =>
      next.called ? next(e) : failed($, 'Bash', bash(e), caughtError(next.error), () => next(e)),
  )
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => guard($, 'PowerShell', ps(e), () => next(e))).catch(
    ($, e, next) =>
      next.called ? next(e) : failed($, 'PowerShell', ps(e), caughtError(next.error), () => next(e)),
  )
  // A failed helper check refuses only where helpers are blocked: with the setting at allow it never stops one.
  on('tool.call', { tool: ['Agent', 'Workflow'] }, ($, e, next) => helperGuard($, e.tool, () => next(e))).catch(
    ($, e, next) =>
      next.called || helpers.setting === 'allow'
        ? next(e)
        : failed($, e.tool, '', caughtError(next.error), () => next(e)),
  )
}

// Why the engine caught the hook, in words for the log and the refusal.
function caughtError(error: { kind: string; message?: string }): string {
  if (error.kind !== 'timeout') return error.message ?? 'the check threw'
  return error.message ? `ran past its time budget: ${error.message}` : 'ran past its time budget'
}

const ARGUMENT_HINT = '[help | settings | set | helpers]'
const HELP = [
  '/guards: reads every shell command that writes history (commits, PRs, issues, releases) for AI credit.',
  '  /guards           the mode, where the product may be named, and what it caught',
  '  /guards settings  open the settings pane',
  '  /guards set       change a setting: set <name> <value>; alone, list them',
  '  /guards helpers   helper agents: allow or block them for this session',
  '  /guards help      this list',
].join('\n')

type DayCount = { checked: number; mod: number; scripts: number }

// The counts of the last `days` days in stats.json, today included.
export function sumDays(stats: Record<string, DayCount>, now: number, days: number): DayCount {
  const total = { checked: 0, mod: 0, scripts: 0 }
  for (let back = 0; back < days; back++) {
    const row = stats[new Date(now - back * 86_400_000).toISOString().slice(0, 10)]
    if (!row) continue
    total.checked += row.checked
    total.mod += row.mod
    total.scripts += row.scripts
  }
  return total
}

async function statusText($: Engine): Promise<string> {
  if (!live.dir) await setUp($)
  let stats: Record<string, DayCount> = {}
  try {
    stats = JSON.parse(String(await $.fs.read(`${live.dir}/stats.json`)))
  } catch {
    // Nothing checked yet.
  }
  const isEnforced = live.mode === 'enforce'
  const names = live.mentionRepos.includes('*') ? 'every repo' : live.mentionRepos.join(', ') || 'no repo'
  const line = (label: string, c: DayCount) =>
    `${label}: ${c.checked} writes checked, ${c.mod} ${isEnforced ? 'blocked' : 'it would block'}, ` +
    `${c.scripts} the guard scripts blocked.`
  const now = await $.clock.now()
  const banned = Object.keys((await nameRules($))?.repos ?? {})
  return [
    isEnforced ? 'Guards: enforce (blocks).' : 'Guards: shadow (never blocks; logs what it would block).',
    `The product name may appear in ${names}; AI credit is blocked everywhere.`,
    ...(banned.length > 0 ? [`Banned names (names.json) are checked in: ${banned.join(', ')}.`] : []),
    helpersLine(await helperState($), isEnforced),
    line('Today (UTC)', sumDays(stats, now, 1)),
    line('Last 7 days (UTC)', sumDays(stats, now, 7)),
  ].join('\n')
}

// `/guards [help | settings | helpers]`; with no argument, the status. Another word gets the list.
async function runCommand($: Engine, args: string): Promise<string> {
  const [verb = '', word = ''] = args.trim().split(/\s+/)
  if (verb === 'helpers') {
    const state = await helperState($)
    const answer = helpersCommand(word, state)
    // Each session adds or removes only its own allow; a status look changes nothing.
    if (answer.isAllowedHere !== state.isAllowedHere) {
      const session = await $.session.id()
      if (answer.isAllowedHere) helpers.allowedIn.add(session)
      else helpers.allowedIn.delete(session)
    }
    return answer.text
  }
  if (verb === 'settings') {
    await $.ui.open({ id: SETTINGS_PANE, title: 'Guards settings', focus: true })
    return 'Opened the guards settings.'
  }
  return verb ? HELP : statusText($)
}
