// Turns one Bash or PowerShell command into what the guards must check: the message texts it writes
// to history, the body files it hands over, the branches it creates, and whether a commit's added
// lines need a look. Pure, no engine access.
//
// The command is read as the shell will run it: git and gh behind `if`/`then`/`do`/`{`/`(`, `case` arms,
// `sudo`, `env`, `timeout`, `xargs`, inside `$(...)` and backticks, `eval`, `bash -c`, a here-doc fed to
// `bash` and `powershell -Command`, named through a variable the command sets, with git's long options
// shortened as git accepts them; messages from variables set earlier in the command (each where the shell
// keeps it), here-docs, `$(cat ...)`, pipes and files the command writes itself. Where a message exists
// but its text is made by something the reading cannot follow, the message is named in `unread`, and the
// call is refused: what reaches history unread is never passed.
// What it cannot see at all (also listed in mods/README.md):
// - commands run from a script file or fed to a shell from a file or a pipe, an alias or shell function,
//   a git alias (`git ci -m ...`), `ssh host ...`, a command held in a variable from outside it
//   (`eval "$CMD"`, `bash -c "$CMD"`), or any other program that writes to GitHub on its own (a Python
//   script, an SDK);
// - a body file another program writes in the same command (`Set-Content`, `Out-File`, `tee`): the
//   file does not exist yet, so it reports that it could not read it; one that inline script code in the
//   command may write is noted instead, and passes;
// - the output of another program used as a message (`git log --format=%B | git commit -F -`): named
//   unread and refused, its text never checked;
// - AI credit hidden on purpose (assembled from pieces, encoded, fetched): out of scope.

import { bypassOf, EVAL } from './bypass'
import { stripPaths } from './policy'
import { readPr } from './prbody'
import type { PrCall } from './prbody'
import { moveFolder, movePlace, placeHere, repoMoves, targetOf } from './folders'
import type { Folder, Here, Place, Target } from './folders'
import { branchesOf, isCommitAll, isSplat, isUnknownSetting, lineOf, mayBeFlag, splitsAt, TAG_READS } from './gitwords'
import { script } from './scripts'
import { parse, programOf, runsInlineCode } from './shell'
import { assign, catValue, expand, expandBody, forget, inherit, lookup, setVar, within, withWords } from './vars'
import type { Var, VarState } from './vars'
import {
  COMMIT,
  CURL,
  GH_API,
  GH_BODY,
  GH_CLOSE,
  GH_DESC,
  GH_MERGE,
  GH_RELEASE,
  GH_REVIEW,
  GH_WRITES,
  gitLong,
  MESSAGE,
  NOTES,
  PS_WEB,
  RAW_WRITES,
  SWITCH,
  TYPED_TABLE,
} from './specs'
import type { Kind, Spec } from './specs'
import type { Statement, Word } from './shell'

export type Plan = {
  /** Message text with where it goes ("the commit message", "the PR body"). `creditOnly`: command text
   * around a message (a `$(...)` as typed), checked for AI credit but not for the product name. */
  texts: { where: string; text: string; creditOnly?: boolean }[]
  /** Body files the command hands to git or gh, as written (relative to `folder` when not absolute).
   * `written`: this same command writes the file, and what it writes was read from the command text. */
  /** `folder`: where a relative path resolves, as the command stands where the file is named.
   * `scripted`: a script an earlier statement runs (python, node) may write it, unseen by the reading. */
  files: { where: string; path: string; written?: boolean; folder?: Folder; scripted?: boolean }[]
  /** Files the command itself writes (`> file`). */
  written: string[]
  branches: string[]
  /** Each write statement's folder, repo and commit lines, for the repo rules and the diff scan. */
  targets: Target[]
  /** Messages whose text is built in a way the guard cannot read ($VAR from outside, another program's output). */
  unread: string[]
  /** What was left unjudged without risk to history (the PR-body format, a diff cut short): logged, never refused. */
  notes: string[]
  block?: string
  isWrite: boolean
  /** Each `gh pr create` or `gh pr edit`: what it sets, for the PR-body contract. */
  prs: PrCall[]
  /** Every `gh` statement in the command: the PR-body contract judges only a command with one. */
  ghCalls: number
}

export type { Folder, Target } from './folders'

// The statement that writes a file, where it runs, and the values of the variables its path names there.
type Writer = { st: Statement; ps: boolean; scope: string; vars: (Var | undefined)[]; folder: Folder }

// The reading's working state while it walks one command.
type Reading = VarState & {
  plan: Plan
  /** The folder each `cd` so far leads to, and the `pushd` stack, by the scope that moved them. */
  places: Map<string, Place>
  /** Body files matched to the statement that wrote them under the same spelling. */
  matched: Map<object, Writer>
  /** What the statement being read sets for itself: its `git -C` folder, `gh --repo`, its commit's lines. */
  at: Here
  /** While a writer's statement is fed in after the walk: the folder it ran in. */
  feedFolder?: Folder
  /** An earlier statement pointed git at another repo for what follows (`export GIT_DIR=x`). */
  isRepoMoved?: boolean
  /** `$(...)` substitutions and child shells read so far, which number their scopes. */
  opened: number
  /** The statement that writes each file (`> file`), by normalized path, with where it runs. */
  writers: Map<string, Writer>
  /** Message routes read from stdin so far (`-F -`, `--body-file -`, `--input -`, `body=@-`). */
  stdin: number
  /** Write statements found so far. */
  writes: number
  method?: string
  /** The command's one statement besides leading `cd`s to literal folders: no subshell or wrapper around it. */
  alone?: Statement
  /** An earlier statement ran script code written in the command, which may write any file. */
  ranScript?: boolean
  /** A statement runs `eval` or `Invoke-Expression`. */
  hasEval?: boolean
}


export function inspect(command: string, powershell: boolean): Plan {
  const plan: Plan = {
    texts: [],
    files: [],
    written: [],
    branches: [],
    targets: [],
    unread: [],
    notes: [],
    isWrite: false,
    prs: [],
    ghCalls: 0,
  }
  const r: Reading = {
    plan,
    places: new Map([['', { folder: { isUnknown: false }, folders: [] }]]),
    matched: new Map(),
    at: {},
    ps: powershell,
    vars: new Map(),
    scope: '',
    opened: 0,
    writers: new Map(),
    stdin: 0,
    writes: 0,
  }
  const statements = parse(command, powershell)
  r.alone = aloneOf(statements)
  read(statements, r)
  // `eval` and `Invoke-Expression` build their command at run time: refused in a command that writes
  // history anywhere, as the reading finds it.
  if (r.hasEval && plan.isWrite) plan.block ??= EVAL
  // A body file this same command writes is read from the statement that writes it. What another
  // program writes into it cannot be read; the maintainer's rule passes a file the command writes itself,
  // so that is noted, not refused.
  // By position, so a file a writer reads (`cat a.md > b.md` after `cat > a.md`) is fed in turn; each
  // writer once per path, so one that reads its own file ends.
  const fed = new Map<Writer, Set<string>>()
  for (let i = 0; i < plan.files.length; i++) {
    const f = plan.files[i] as Plan['files'][number]
    // The writer it had where it was named: one after it writes over a file the command already read.
    const writer = r.matched.get(f)
    if (!writer) continue
    f.written = true
    const paths = fed.get(writer) ?? new Set<string>()
    if (paths.has(norm(f.path))) continue
    fed.set(writer, paths.add(norm(f.path)))
    const before = plan.unread.length
    const named = plan.files.length
    const at = { ...r, ps: writer.ps, scope: writer.scope, at: {}, feedFolder: writer.folder }
    feed(writer.st, at, `${f.where} (file ${f.path})`)
    // A file the writer reads (`cat CHANGES.md > b.md`) is where the writer ran.
    for (const g of plan.files.slice(named)) g.folder ??= writer.folder
    plan.notes.push(...plan.unread.splice(before))
  }
  // The backstop the shipped attribution hook has always had: a write's whole command text is checked last
  // for credit lines, so a spelling the reading does not model still cannot carry one into history. The
  // hook's own raw-text patterns are the floor: a write hidden in backticks or fed to `bash` on stdin is
  // missed by the reading, never by them. `isWrite` stays the reading's own answer; the hook checks any
  // command that has text to check.
  if (plan.isWrite || RAW_WRITES.some(re => re.test(command)))
    plan.texts.push({ where: 'the command text', text: stripPaths(command), creditOnly: true })
  return plan
}

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

const CD_NAMES = new Set(['cd', 'set-location', 'pushd', 'push-location', 'sl'])
const PUSH_NAMES = new Set(['pushd', 'push-location'])

// The statement a command runs on its own: the only one, or the last after `cd`s to literal folders
// (`cd "C:/Repos/game" && gh pr create ...`), whose folder is then known. Any other shape has none.
function aloneOf(statements: Statement[]): Statement | undefined {
  const last = statements.at(-1)
  const isPlainCd = (st: Statement) => {
    const { name, args } = programOf(st)
    const bare = !st.inner.length && !st.heredocs.length && !st.writes.length && !st.pipeIn && !st.isNested
    return bare && CD_NAMES.has(name) && args.length === 1 && !args[0]?.dynamic && !args[0]?.text.startsWith('-')
  }
  return last && !last.pipeIn && statements.slice(0, -1).every(isPlainCd) ? last : undefined
}

// `outer`: where commands from a `$(...)` or a `bash -c` script run; their own subshells nest inside it.
function read(statements: Statement[], r: Reading, outer?: string) {
  statements.forEach((st, idx) => readStatement(st, statements[idx - 1], r, outer))
}

function readStatement(typed: Statement, prev: Statement | undefined, r: Reading, outer?: string) {
  const { plan } = r
  const scope = outer === undefined ? (typed.scope ?? '') : within(outer, typed.scope)
  // Each Bash `$(...)` or backtick runs in a subshell of its own; PowerShell's `$(...)` runs in place.
  const subshells = new Map<number | undefined, string>()
  const placeOf = (group?: number) => {
    if (!subshells.has(group)) subshells.set(group, within(scope, `s${++r.opened}`))
    return subshells.get(group) as string
  }
  const inner = typed.inner
  inner.forEach((st, i) => readStatement(st, inner[i - 1], r, r.ps ? scope : placeOf(st.group)))
  r.scope = scope
  const st = withProgram(withWords(typed, r), r)
  // A file written under a variable set earlier (`cat > "$S/body.md"`) is known by its full path.
  const writes = st.writes.map(path => knownPath(path, r) ?? path)
  plan.written.push(...writes)
  const at = placeHere(r).folder
  for (const path of writes) r.writers.set(norm(path), { st, ps: r.ps, scope, vars: varsIn(path, r), folder: at })
  const { name, args } = programOf(st)
  // The routes around the check, refused outright: history rewrites, skipped hooks and the like.
  plan.block ??= bypassOf(st, name, args)
  // In a git or gh call that writes, a word the shell splits at run time may become any options at all
  // (`--no-verify`, `--git-dir=...`, a flag the spec does not list): the call cannot be read.
  const line = lineOf(name, args)
  // After a literal `--` every word is a path, whatever it splits into.
  const ends = args.findIndex(a => !a.dynamic && a.text === '--')
  const flags = ends === -1 ? args : args.slice(0, ends)
  // PowerShell's `--%` passes the rest of the line raw, with `%NAME%` filled in from the environment.
  const isRaw = r.ps && args.some(a => a.text === '--%')
  if (/^(git|gh)$/.test(name) && (flags.some(splitsAt) || isRaw) && RAW_WRITES.some(re => re.test(line)))
    unreadCall(r, 'a word built at run time')
  const moves = repoMoves(st, name, args)
  r.isRepoMoved ||= moves.movesLater
  if (/^(eval|invoke-expression|iex)$/.test(name)) return readEval(st, args, r)
  if (assign(st, name, args, r)) return
  if (CD_NAMES.has(name) || POP_NAMES.has(name)) {
    const target = POP_NAMES.has(name) ? undefined : args.find(a => !a.text.startsWith('-'))
    const place = movePlace(r)
    // `pushd -n`, `popd +1`: an option or a stack place the reading does not follow leaves it unknown.
    const isStack = PUSH_NAMES.has(name) || POP_NAMES.has(name)
    if (isStack && args.some(a => /^[-+]/.test(a.text))) place.folder = { isUnknown: true }
    else {
      // `popd` returns to the folder its `pushd` left; with none left the folder is unknown.
      if (PUSH_NAMES.has(name)) place.folders.push(place.folder)
      const popped = POP_NAMES.has(name) ? (place.folders.pop() ?? { isUnknown: true }) : undefined
      place.folder = popped ?? moveFolder(place.folder, target)
    }
    return
  }
  if (readScript(st, name, args, r)) return
  forget(st, name, r)
  // Script code in the command (`python - <<EOF`, `node -e`) may write files the reading never sees; its
  // text is under the credit backstop. A script file on disk (`python gen.py`) is not, so it marks nothing.
  if (runsInlineCode(st)) r.ranScript = true
  const before = plan.files.length
  const count = r.writes
  r.at = {}
  readWrite(st, prev, name, args, r)
  // Each body file keeps the folder in effect where it is named: `cd a && ... && cd b` moves it on.
  const folder = folderNow(r)
  for (const f of plan.files.slice(before)) {
    f.folder ??= folder
    if (r.ranScript) f.scripted = true
  }
  // The repo rules and the diff scan follow each write to where it runs, never to the first `cd`.
  if (r.writes > count) plan.targets.push(targetOf(folder, r.at, moves.isMoved || Boolean(r.isRepoMoved)))
}

// A program named through a variable the command did not set (from outside it, `$(which git)`), with
// arguments that would write history as git's or gh's, is unread. One it set is filled in by `withWords`.
function withProgram(st: Statement, r: Reading): Statement {
  const { name, args } = programOf(st)
  const k = st.words.length - args.length - 1
  const head = st.words[k]
  // PowerShell runs a program named by a variable only through `&` (`& $git commit`).
  if (!name || !head?.dynamic || (r.ps && !st.isCall)) return st
  if (RAW_WRITES.some(re => re.test(lineOf('git', args)) || re.test(lineOf('gh', args)))) {
    r.plan.isWrite = true
    r.plan.unread.push('a program named at run time')
  }
  return st
}

function readWrite(st: Statement, prev: Statement | undefined, name: string, args: Word[], r: Reading) {
  const stdin = r.stdin
  const where = name === 'git' ? git(st, args, r) : name === 'gh' ? gh(st, args, r) : web(name, st, args, r)
  if (!where) return
  r.writes++
  readSplats(args, r, where)
  // A message read from stdin with no here-doc on the statement: a `< file`, or the statement piped in.
  if (r.stdin > stdin && st.heredocs.length === 0) readStdin(st, prev, r, where)
}

const POP_NAMES = new Set(['popd', 'pop-location'])

// `eval` and `Invoke-Expression` run their words as a command in this same shell: read here, with the
// variables set earlier filled in. Words built in a way the reading cannot follow hide the command, so
// they are refused when their text names a history write.
function readEval(st: Statement, args: Word[], r: Reading) {
  r.hasEval = true
  const text = args.map(a => a.text).join(' ')
  const e = args.some(a => a.dynamic) ? expand(text, r) : { text, unresolved: false }
  if (e.unresolved) {
    if (RAW_WRITES.some(re => re.test(text))) r.plan.block ??= EVAL
    return
  }
  // `M=x eval '...'`: the words see `M=x`; whether the shell keeps it afterwards depends on its mode, so
  // after the eval it is unknown.
  const names: string[] = []
  for (const w of st.words.slice(0, st.words.length - args.length - 1)) {
    const m = /^([A-Za-z_]\w*)(\+?)=/.exec(w.text)
    if (!m) continue
    names.push(m[1] ?? '')
    // An append (`M+=x eval ...`) is left unknown.
    setVar(r, m[1] ?? '', m[2] ? undefined : { ...w, text: w.text.slice(m[0].length) })
  }
  // The eval's own subshells are numbered apart from the command's; its top level runs in place.
  const n = ++r.opened
  const at = r.scope
  const statements = parse(e.text, r.ps)
  for (const s of statements) if (s.scope) s.scope = `e${n}/${s.scope}`
  read(statements, r, at)
  r.scope = at
  for (const name of names) setVar(r, name, undefined)
}

// `bash -c '...'` and the like: the script is read as commands of its own, run in a child shell that
// sees only exported variables. True when it was one.
function readScript(st: Statement, name: string, args: Word[], r: Reading): boolean {
  const inner = script(st, name, args)
  if (!inner) return false
  // A script held in a variable set earlier in the command, or a here-doc that names one, is read with
  // its value.
  const fill = inner.isBody ? expandBody : expand
  const e = inner.dynamic && inner.text !== undefined ? fill(inner.text, r) : undefined
  const isKnown = e !== undefined && !e.unresolved
  const ps = r.ps
  const writes = r.writes
  const child = within(r.scope, `p${++r.opened}`)
  inherit(st, args, r, child)
  r.ps = inner.ps
  read(isKnown ? parse(e.text, inner.ps) : inner.statements, r, child)
  r.ps = ps
  if (inner.dynamic && !isKnown && r.writes > writes) r.plan.unread.push(`a ${name} script built at run time`)
  return true
}

// PowerShell splatting (`gh pr create @params`): the hashtable built earlier is checked as typed; one
// from outside the command cannot be read.
function readSplats(args: Word[], r: Reading, where: string) {
  for (const a of args) {
    const splat = r.ps ? /^@(\w+)$/.exec(a.text) : null
    if (!splat) continue
    const v = lookup(r, splat[1] ?? '')
    if (v) r.plan.texts.push({ where, text: v.text, creditOnly: true })
    // A hashtable built at run time (`@{ Title = "$env:T" }`, `Body = Get-Content b.md`, changed after
    // it was typed) cannot be read either.
    if (!v || !TYPED_TABLE.test(v.text)) r.plan.unread.push(where)
  }
}

function readStdin(st: Statement, prev: Statement | undefined, r: Reading, where: string) {
  if (st.reads.length > 0) for (const path of st.reads) pushFile(r, where, path)
  else if (st.pipeIn && prev) feed(prev, r, where)
  else r.plan.unread.push(where)
}

// What a statement prints, read as message text for `where`: the input of a pipe, or a file it writes.
function feed(st: Statement, r: Reading, where: string) {
  const { plan } = r
  pushBodies(r, st, where)
  const { name, args } = programOf(st)
  if (/^(cat|type|get-content|gc)$/.test(name)) {
    const paths = args.filter(a => !a.text.startsWith('-'))
    for (const p of paths) take('file', p, r, where)
    for (const path of st.reads) pushFile(r, where, path)
    if (paths.length + st.reads.length + st.heredocs.length === 0) plan.unread.push(where)
    return
  }
  // PowerShell: a statement that is only a string (`'text' | gh ...`, `@'...'@ | gh ...`).
  if (r.ps && st.words.length === 1) return message(st.words[0] as Word, r, where)
  if (/^(echo|printf|write-output|write-host)$/.test(name)) {
    for (const a of args) message(a, r, where)
    return
  }
  // Another program's output: its words are checked for credit, the output itself cannot be read.
  for (const w of st.words) plan.texts.push({ where, text: w.text, creditOnly: true })
  plan.unread.push(where)
}

// The values of the variables a path names, as they stand where the path is written.
function varsIn(path: string, r: Reading): (Var | undefined)[] {
  return [...path.matchAll(/\$\{?([A-Za-z_]\w*)\}?/g)].map(m => lookup(r, m[1] ?? ''))
}

const MKTEMP = /^\$\(\s*mktemp(\s+(-[dqu]+|-t\s+[\w.]+|--suffix=[\w.]+))*\s*\)$/

// A relative path names the written file only where both are named in the same known folder: a `cd`
// between them, or one built at run time, makes it another file.
function isSameFolder(path: string, writer: Writer, r: Reading): boolean {
  if (/^([a-zA-Z]:)?[\\/]|^~/.test(path)) return true
  // `$(mktemp)` prints a full path (in the temp folder) unless given a template or folder of its own.
  const lead = /^\$\{?([A-Za-z_]\w*)\}?/.exec(path)
  if (lead && MKTEMP.test(lookup(r, lead[1] ?? '')?.text ?? '')) return true
  const here = folderNow(r)
  return !here.isUnknown && !writer.folder.isUnknown && here.path === writer.folder.path
}

// The folder the statement being read runs in, moved by its own `git -C`.
function folderNow(r: Reading): Folder {
  if (r.feedFolder) return r.feedFolder
  const here = placeHere(r).folder
  return r.at.dir ? moveFolder(here, r.at.dir) : here
}

// A body file named here, matched to the statement that wrote it so far, if any.
function pushFile(r: Reading, where: string, path: string) {
  const entry = { where, path }
  const writer = r.writers.get(norm(path))
  if (writer && isSameFolder(path, writer, r)) r.matched.set(entry, writer)
  r.plan.files.push(entry)
}

// A call whose own words are built at run time: a write, since what it does cannot be read.
function unreadCall(r: Reading, what: string) {
  r.plan.isWrite = true
  if (!r.plan.unread.includes(what)) r.plan.unread.push(what)
}

// A write statement: its here-doc bodies are message text (a `--body-file -` or `-F -` reads them).
function write(r: Reading, st: Statement, where: string): string {
  r.plan.isWrite = true
  pushBodies(r, st, where)
  return where
}

// A statement's here-doc bodies as message text, as typed and as the shell fills them in. A body with a
// part the reading cannot fill in (a variable from outside the command, a `$(...)`) is named unread.
function pushBodies(r: Reading, st: Statement, where: string) {
  const { plan } = r
  for (const body of st.heredocs) {
    plan.texts.push({ where, text: body })
    if (!st.hasDynamicBody) continue
    const e = expandBody(body, r)
    if (e.text !== body) plan.texts.push({ where, text: e.text })
    if (e.unresolved && where && !plan.unread.includes(where)) plan.unread.push(where)
  }
}

// The index of git's subcommand, past its global options; `-C <dir>` sets the folder.
function gitSubcommand(args: Word[], r: Reading): number {
  const { plan } = r
  let k = 0
  while (k < args.length) {
    const t = args[k]?.text ?? ''
    if (t === '-C') {
      if (splitsAt(args[k + 1]) || isSplat(args[k + 1], r.ps)) unreadCall(r, 'a git option built at run time')
      r.at.dir = args[k + 1]
      k += 2
    } else if (/^(-c|--git-dir|--work-tree|--namespace|--config-env)$/.test(t)) {
      // A setting built at run time may name a hook path or an alias: what git then runs is unknown.
      if ((t === '-c' || t === '--config-env') && isUnknownSetting(args[k + 1])) {
        unreadCall(r, 'a git setting built at run time')
      }
      if (splitsAt(args[k + 1]) || isSplat(args[k + 1], r.ps)) unreadCall(r, 'a git option built at run time')
      k += 2
    } else if (t.startsWith('-')) k++
    else break
  }
  return k
}

function gitCommit(st: Statement, rest: Word[], r: Reading): string {
  const { plan } = r
  const where = write(r, st, 'the commit message')
  const positional = walk(rest, COMMIT, r, where, 'commit')
  const all = rest.some(a => isCommitAll(a.text))
  r.at.diff = all || positional.length > 0 ? 'all' : 'cached'
  return where
}

function git(st: Statement, args: Word[], r: Reading): string | undefined {
  const { plan } = r
  const k = gitSubcommand(args, r)
  if (args[k]?.dynamic || isSplat(args[k], r.ps)) return void unreadCall(r, 'a git subcommand built at run time')
  const sub = args[k]?.text ?? ''
  const rest = args.slice(k + 1)
  // A write whose flags are not walked (push, rebase, am): any word built at run time may be one, even
  // after a `--` (`push -o -- $REF` gives `-o` the `--`, and push reads flags after its refspecs).
  const isWalked = /^(commit|tag|merge|commit-tree|notes)$/.test(sub)
  const isUnwalkedWrite = !isWalked && RAW_WRITES.some(re => re.test(lineOf('git', args)))
  if (isUnwalkedWrite && rest.some(w => mayBeFlag(w) || isSplat(w, r.ps))) unreadCall(r, 'a word built at run time')
  switch (sub) {
    case 'commit':
      return gitCommit(st, rest, r)
    case 'tag':
    case 'merge':
    case 'commit-tree': {
      // Listing, verifying or deleting tags, or no arguments at all, writes no message.
      const isRead = (a: Word) => TAG_READS.test(gitLong('tag', a.text))
      if (sub === 'tag' && (rest.length === 0 || rest.some(isRead))) return undefined
      const where = write(r, st, `the ${sub} message`)
      walk(rest, MESSAGE, r, where, sub)
      return where
    }
    case 'notes': {
      // Listing, showing or removing notes writes no message.
      if (/^(list|show|get-ref|prune|remove)$/.test(rest[0]?.text ?? '')) return undefined
      const where = write(r, st, 'the git note')
      walk(rest.slice(1), NOTES, r, where, 'notes')
      return where
    }
    case 'checkout':
      walk(rest, { '-b': 'branch', '-B': 'branch', '--orphan': 'branch' }, r, '', 'checkout')
      return undefined
    case 'switch':
      walk(rest, SWITCH, r, '', 'switch')
      return undefined
    case 'worktree':
      if (rest[0]?.text === 'add') walk(rest.slice(1), { '-b': 'branch', '-B': 'branch' }, r, '')
      return undefined
    case 'branch':
      plan.branches.push(...branchesOf(rest))
      return undefined
  }
  return undefined
}

// The positions of gh's two subcommand words, past global options: `gh -R owner/name pr comment ...`.
function ghWords(args: Word[], r: Reading): { gi: number; ai: number } {
  let gi = -1
  let ai = -1
  for (let i = 0; i < args.length && ai === -1; i++) {
    const t = args[i]?.text ?? ''
    if (t === '-R' || t === '--repo') {
      const value = args[++i]
      if (value) take('repo', value, r, '')
    } else if (t.startsWith('--repo=')) take('repo', { ...(args[i] as Word), text: t.slice(7) }, r, '')
    else if (t.startsWith('-')) continue
    else if (gi === -1) gi = i
    else ai = i
  }
  return { gi, ai }
}

// `gh api`: a write when it sends fields or names a writing method; a GET never is.
function ghApi(st: Statement, args: Word[], r: Reading): string | undefined {
  const { plan } = r
  const before = plan.files.length + plan.texts.length + r.stdin
  r.method = undefined
  walk(args, GH_API, r, 'the GitHub API call')
  const hasFields = plan.files.length + plan.texts.length + r.stdin > before
  if (r.method === 'GET' || (!hasFields && !/^(POST|PATCH|PUT)$/.test(r.method ?? ''))) return undefined
  return write(r, st, 'the GitHub API call')
}

function ghSpec(group: string, action: string): Spec {
  if (group === 'release') return GH_RELEASE
  if (group === 'gist' || group === 'repo') return GH_DESC
  if (group === 'pr' && action === 'review') return GH_REVIEW
  if (group === 'pr' && action === 'merge') return GH_MERGE
  return action === 'close' || action === 'reopen' ? GH_CLOSE : GH_BODY
}

function gh(st: Statement, args: Word[], r: Reading): string | undefined {
  const { plan } = r
  plan.ghCalls++
  const { gi, ai } = ghWords(args, r)
  // A splat up to the action word may hand over the subcommand or global options.
  if (args.slice(0, (ai === -1 ? gi : ai) + 1).some(w => isSplat(w, r.ps)))
    return void unreadCall(r, 'a gh subcommand built at run time')
  // The subcommand, or a `gh api` endpoint that may turn into a flag, built at run time.
  const isApi = args[gi]?.text === 'api'
  if (args[gi]?.dynamic || (args[ai] && (isApi ? mayBeFlag(args[ai]) : args[ai]?.dynamic)))
    return void unreadCall(r, 'a gh subcommand built at run time')
  const group = args[gi]?.text ?? ''
  const action = args[ai]?.text ?? ''
  const rest = args.filter((_, i) => i !== gi && i !== ai)
  if (group === 'run' && action === 'watch') {
    plan.block =
      '`gh run watch` streams a live log into the tool call. Watch checks with the ci-watch mod (it starts on ' +
      'push), or the Monitor tool when that mod is not loaded.'
    return undefined
  }
  // The endpoint is a positional; keep it out of the field walk.
  if (group === 'api')
    return ghApi(
      st,
      args.filter((_, i) => i !== gi),
      r,
    )
  if (!GH_WRITES[group]?.includes(action)) {
    walk(rest, { '-R': 'repo', '--repo': 'repo' }, r, '')
    return undefined
  }
  const where = write(r, st, `the ${group === 'pr' ? 'PR' : group} ${action === 'create' ? 'text' : action}`)
  const before = plan.files.length
  walk(rest, ghSpec(group, action), r, where)
  if (group === 'pr' && (action === 'create' || action === 'edit')) {
    // Stdin is read exactly only from a literal here-doc: a pipe or a `< file` may feed it instead.
    const isLiteral = st.heredocs.length === 1 && !st.hasDynamicBody && !st.pipeIn && st.reads.length === 0
    const stdinBody = isLiteral ? st.heredocs.join('\n') : undefined
    const filePath = plan.files.slice(before).find(f => f.where === where)?.path
    // The PR call is the whole command, typed as `gh ...` itself, after nothing but `cd`s to literal
    // folders: nothing before it sets a variable or wraps it in another shell.
    const isAlone = r.alone === st && st.inner.length === 0 && st.words[0]?.text === 'gh'
    plan.prs.push(readPr(action, rest, { stdinBody, filePath, isAlone }))
  }
  return where
}

// `curl` and `Invoke-RestMethod` calls to the GitHub API.
function web(name: string, st: Statement, args: Word[], r: Reading): string | undefined {
  if (!args.some(a => a.text.includes('api.github.com'))) return undefined
  const where = 'the GitHub API call'
  if (name === 'curl') {
    write(r, st, where)
    walk(args, CURL, r, where)
    return where
  }
  if (/^(invoke-restmethod|invoke-webrequest|irm|iwr)$/.test(name)) {
    write(r, st, where)
    walk(
      args.map(a => ({ ...a, text: a.text.startsWith('-') ? a.text.toLowerCase() : a.text })),
      PS_WEB,
      r,
      where,
    )
    return where
  }
  return undefined
}

// Reads options by the spec; returns the positional words. Short flags may be bundled (`-am "msg"`)
// or carry their value attached (`-m"msg"`, `-Fbody.md`, `-XPOST`); long ones may use `=`, and a git
// subcommand's (`sub`) may be shortened as git reads them (`--mess`).
function walk(args: Word[], spec: Spec, r: Reading, where: string, sub?: string): Word[] {
  const positional: Word[] = []
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as Word
    const t = w.text
    if (t === '--') {
      positional.push(...args.slice(i + 1))
      break
    }
    if (t.startsWith('--')) {
      const full = sub ? gitLong(sub, t) : t
      const eq = full.indexOf('=')
      const kind = spec[eq === -1 ? full : full.slice(0, eq)]
      if (!kind || kind === 'attached') continue
      const value = eq === -1 ? args[++i] : { ...w, text: full.slice(eq + 1) }
      if (value) take(kind, value, r, where)
      else missing(kind, r, where)
      continue
    }
    // A word built at run time is still a flag when a letter before its first expansion is one: `-m"$MSG"`
    // and `-am"$MSG"` carry their value attached, and `take` names a value it cannot read as unread.
    const lead = /^-([A-Za-z]+)/.exec(t)?.[1] ?? ''
    const isFlag = !w.dynamic || [...lead].some(letter => spec[`-${letter}`] !== undefined)
    if (t.startsWith('-') && t.length > 1 && isFlag) {
      if (spec[t] === 'attached') continue
      if (spec[t]) {
        const value = args[++i]
        if (value) take(spec[t] as Kind, value, r, where)
        else missing(spec[t] as Kind, r, where)
        continue
      }
      // A bundle: the first letter that takes a value takes the rest of the word, or the next word.
      for (let j = 1; j < t.length; j++) {
        const kind = spec[`-${t[j]}`]
        if (!kind) continue
        if (kind === 'attached') break
        const attached = t.slice(j + 1)
        const value = attached ? { ...w, text: attached } : args[++i]
        if (value) take(kind, value, r, where)
        else missing(kind, r, where)
        break
      }
      continue
    }
    // A word built at run time where a flag could stand may turn into one (`$NV`, `"$@"`).
    if (where && mayBeFlag(w) && !r.plan.unread.includes(where)) r.plan.unread.push(where)
    positional.push(w)
  }
  return positional
}

// A message flag with nothing after it: the reading lost its value (a word it could not split, such as
// `-F <(...)` cut short), so the message is named as unread.
function missing(kind: Kind, r: Reading, where: string) {
  if (where && (kind === 'text' || kind === 'file' || kind === 'field' || kind === 'data')) r.plan.unread.push(where)
}

function take(kind: Kind, value: Word, r: Reading, where: string) {
  const { plan } = r
  // A value the shell splits at run time may carry more options (`--base $B` with `B='main -F x'`).
  if (splitsAt(value) && /^(skip|repo|method)$/.test(kind)) unreadCall(r, where || 'a flag value built at run time')
  // A PowerShell list hands a write its first item as the value and the rest as more words.
  if (value.list && (where || kind === 'branch')) unreadCall(r, 'a flag value built at run time')
  switch (kind) {
    case 'text':
      return message(value, r, where)
    case 'file': {
      if (value.text === '-') return void r.stdin++
      if (!value.dynamic) return void pushFile(r, where, value.text)
      const e = expand(value.text, r)
      if (!e.unresolved) return void pushFile(r, where, e.text)
      // A file this command writes under the same spelling (`F=$(mktemp); cat > "$F"`), with every
      // variable in it unchanged since: the same file.
      const writer = r.writers.get(norm(value.text))
      const now = varsIn(value.text, r)
      const isTracked = now.length > 0 && now.every(Boolean) && !/\$[({@*#?$!0-9-]|`|\$env:/i.test(value.text)
      const isSame = writer && isTracked && isSameFolder(value.text, writer, r)
      if (writer && isSame && writer.vars.length === now.length && writer.vars.every((v, i) => v === now[i])) {
        const entry = { where, path: value.text }
        r.matched.set(entry, writer)
        return void plan.files.push(entry)
      }
      // `-F <(cat <<'EOF' ... EOF)` hands over the here-doc's text; any other path built at run time
      // names a file the reading cannot know.
      if (!held(value, r, where, '<')) plan.unread.push(where)
      return
    }
    case 'repo':
      r.at.repo = value
      return
    case 'method':
      r.method = value.text.toUpperCase()
      return
    case 'branch':
      if (value.dynamic) unreadCall(r, 'the new branch name')
      else plan.branches.push(value.text)
      return
    case 'field': {
      const eq = value.text.indexOf('=')
      // A whole field built at run time (`-f "$KV"`): its value cannot be read.
      if (eq === -1 && value.dynamic) return void (where && plan.unread.push(where))
      const v = eq === -1 ? '' : value.text.slice(eq + 1)
      if (v === '@-') return void r.stdin++
      if (v.startsWith('@')) return filePath(v.slice(1), r, where)
      return message({ ...value, text: v }, r, where)
    }
    case 'data':
      if (value.text === '@-') return void r.stdin++
      if (value.text.startsWith('@')) return filePath(value.text.slice(1), r, where)
      return message(value, r, where)
  }
}

// A path as the command will use it: variables set earlier filled in; undefined when part of it is built
// at run time in a way the reading does not know.
function knownPath(path: string, r: Reading): string | undefined {
  if (!/[$`]/.test(path)) return path
  const e = expand(path, r)
  return e.unresolved ? undefined : e.text
}

// A body file named after `@` in a field (`-F query=@$q`): read from its full path, or named unread.
function filePath(path: string, r: Reading, where: string) {
  const full = knownPath(path, r)
  if (full === undefined) return void r.plan.unread.push(where)
  pushFile(r, where, full)
}

// A message value: literal text is checked; text built at run time is read where the reading can (a
// variable set earlier, a value that is wholly `$(cat <<'EOF' ... EOF)` or `$(cat file)`) and named as
// unread otherwise. The value as typed is checked for credit too: a credit inside `$(echo '...')` or
// `$(printf ...)` is in the command text itself.
function message(value: Word, r: Reading, where: string) {
  const { plan } = r
  if (!value.dynamic) return void plan.texts.push({ where, text: value.text })
  for (const body of value.bodies) plan.texts.push({ where, text: body })
  plan.texts.push({ where, text: value.text, creditOnly: true })
  if (held(value, r, where)) return
  const e = expand(value.text, r)
  plan.texts.push({ where, text: e.text })
  // Variables that hold a file's text (`BODY=$(cat b.md)`): the file is read instead.
  if (e.isFilesOnly) for (const path of e.files) pushFile(r, where, path)
  else if (e.unresolved) plan.unread.push(where)
}

// A value that is wholly one `cat` of a here-doc or a file: the here-doc's text is checked (unread when
// a part of it stays unknown), the file is read. True when it was one.
function held(value: Word, r: Reading, where: string, opener: '$' | '<' = '$'): boolean {
  const v = catValue(value, r, opener)
  if (!v) return false
  if (v.file) pushFile(r, where, v.file)
  else r.plan.texts.push({ where, text: v.text })
  if (!v.file && !v.literal) r.plan.unread.push(where)
  return true
}
