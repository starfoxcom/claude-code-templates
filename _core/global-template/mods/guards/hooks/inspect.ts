// Turns one Bash or PowerShell command into what the guards must check: the message texts it writes
// to history, the body files it hands over, the branches it creates, and whether a commit's added
// lines need a look. Pure, no engine access.
//
// A command that names a git or GitHub write, a hook switch, a git or hook config file, or a program built
// at run time is first held to the plain rule (plain.ts): one that is not plain is refused outright, so
// the reading below only ever sees plain git, gh and read-only calls. The reading (`readCommand`) follows
// what the shell runs: messages from `-m`, `-F` files, here-docs and the `$(cat <<'EOF' ...)` form, and
// body files the command writes itself. Where a message exists but its text is made by something the
// reading cannot follow, the message is named in `unread`, and the call is refused: what reaches history
// unread is never passed.
// What it cannot see at all (also listed in mods/README.md):
// - commands run from a script file or fed to a shell from a file or a pipe, an alias or shell function,
//   a git alias (`git ci -m ...`), `ssh host ...`, a command held in a variable from outside it
//   (`eval "$CMD"`, `bash -c "$CMD"`), or any other program that writes to GitHub on its own (a Python
//   script, an SDK);
// - a body file another program writes in the same command (`Set-Content`, `Out-File`, `tee`): the
//   file does not exist yet, so it reports that it could not read it, and any body file in a command that
//   runs a program that may write files is refused as unread; one that inline script code in the
//   command may write is noted instead, and passes;
// - the output of another program used as a message (`git log --format=%B | git commit -F -`): named
//   unread and refused, its text never checked;
// - AI credit hidden on purpose (assembled from pieces, encoded, fetched): out of scope.

import { bypassOf, EVAL, functionsOf, hooksOffReason } from './bypass'
import { stripPaths } from './policy'
import { readPr } from './prbody'
import {
  aloneOf,
  folderNow,
  isSameFolder,
  landsAt,
  moveTo,
  norm,
  placeHere,
  ranBefore,
  repoMoves,
  targetOf,
  writersOf,
} from './folders'
import type { Folder, Here, Place } from './folders'
import {
  branchesOf,
  builtReasons,
  isCommitAll,
  isSplat,
  cmdWrites,
  evalWrites,
  isUnknownSetting,
  withProgram,
  mayBeFlag,
  splitsAt,
  TAG_READS,
  writesAsAny,
  writesHistory,
} from './gitwords'
import { psEvalWords, script } from './scripts'
import { mayWriteFiles, programOf, runsInlineCode, setsRunner } from './programs'
import { joinWords, sliceWord } from './quoting'
import { parse } from './shell'
import { assign, catValue, expand, expandBody, forget, inherit, lookup, psEnvSet, setVar, within } from './vars'
import { assignPsTargets, forgetOutVars, knownPath, psAssignment, setCounts, setsNameAtRunTime } from './vars'
import { psSetsUnknown, type Seen, seenOf, varsIn, withWords } from './vars'
import type { Var, VarState } from './vars'
import {
  COMMIT,
  CURL,
  GH_API,
  GH_WRITES,
  ghSpec,
  gitLong,
  MESSAGE,
  NOTES,
  PS_WEB,
  RAW_WRITES,
  SWITCH,
} from './specs'
import type { Kind, Spec } from './specs'
import { emptyPlan, type Plan } from './plan'
import { namesWrite, NOT_PLAIN, notPlain } from './plain'
import type { Statement, Word } from './shell'

export type { Plan } from './plan'

export type { Folder, Target } from './folders'

// The statement that writes a file, where it runs, and the values of the variables its path names there.
type Writer = { st: Statement; ps: boolean; scope: string; vars: (Var | undefined)[]; folder: Folder; path: string }
  & { seen: Seen; isLater: boolean; index: number }

// The reading's working state while it walks one command.
type Reading = VarState & {
  plan: Plan
  /** The folder each `cd` so far leads to, and the `pushd` stack, by the scope that moved them. */
  places: Map<string, Place>
  /** Body files matched to the statements that may have written them, latest first. */
  matched: Map<object, Writer[]>
  /** What the statement being read sets for itself: its `git -C` folder, `gh --repo`, its commit's lines. */
  at: Here
  /** While a writer's statement is fed in after the walk: the folder it ran in, and how many writers ran
   * before it (a file it reads was written by one of those, never by a later one). */
  feedFolder?: Folder
  writersBefore?: number
  /** A statement so far set a git alias, include or config file (`-c alias.x=`, `GIT_CONFIG_GLOBAL=`). */
  isConfigMoved?: boolean
  /** An environment variable named at run time was set: any later git or gh call may run under it. */
  isEnvUnknown?: boolean
  /** An earlier statement pointed git at another repo for what follows (`export GIT_DIR=x`). */
  isRepoMoved?: boolean
  /** `$(...)` substitutions and child shells read so far, which number their scopes. */
  opened: number
  /** A statement anywhere in the command, run or deferred, may write files beyond its `>`: see `mayWriteFiles`. */
  mayRewrite?: boolean
  /** The statements that write files (`> file`), in order, each with its normalized path and where it runs. */
  writers: Writer[]
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
  /** A hook switch set, a hooked git call read, the functions defined: see `HookState`. */
  hooksOff?: boolean
  isHooked?: boolean
  functions?: Set<string>
}

export function inspect(command: string, powershell: boolean): Plan {
  // A command naming a history write is read only when it is plain: anything else is refused (plain.ts).
  const why = namesWrite(command, powershell) ? notPlain(command, powershell) : undefined
  if (why) return { ...emptyPlan(), isWrite: true, block: `${NOT_PLAIN} Not plain here: ${why}.` }
  return readCommand(command, powershell)
}

/** The reading itself, of a plain command or one that names no history write. */
export function readCommand(command: string, powershell: boolean): Plan {
  const plan = emptyPlan()
  const r: Reading = {
    plan,
    places: new Map([['', { folder: { isUnknown: false }, folders: [] }]]),
    matched: new Map(),
    at: {},
    ps: powershell,
    vars: new Map(),
    isIfsSet: /\bIFS\b/.test(command),
    sets: setCounts(command, powershell),
    functions: functionsOf(command),
    scope: '',
    opened: 0,
    writers: [],
    stdin: 0,
    writes: 0,
  }
  const statements = parse(command, powershell)
  r.alone = aloneOf(statements)
  read(statements, r)
  // `eval` and `Invoke-Expression` build their command at run time: refused in a command that writes
  // history anywhere, as the reading finds it.
  if (r.hasEval && plan.isWrite) plan.block ??= EVAL
  plan.block ??= hooksOffReason(r)
  // A body file this same command writes is read from the statement that writes it. What another
  // program writes into it cannot be read; the maintainer's rule passes a file the command writes itself,
  // so that is noted, not refused.
  // By position, so a file a writer reads (`cat a.md > b.md` after `cat > a.md`) is fed in turn; each
  // writer once per path, so one that reads its own file ends.
  const fed = new Map<Writer, Set<string>>()
  for (let i = 0; i < plan.files.length; i++) {
    const f = plan.files[i] as Plan['files'][number]
    // The writers it had where it was named: one after it writes over a file the command already read.
    for (const writer of r.matched.get(f) ?? []) {
      const paths = fed.get(writer) ?? new Set<string>()
      if (paths.has(norm(f.path))) continue
      fed.set(writer, paths.add(norm(f.path)))
      const before = plan.unread.length
      const named = plan.files.length
      // Fed with the variables as they stood where it ran. One that may run later (a function body, a trap
      // action, a loop) sees each name's last value, so a name set more than once is unknown there.
      const vars = writer.isLater ? {} : seenOf(writer.seen)
      const at = { ...r, ...vars, ps: writer.ps, scope: writer.scope, at: {}, feedFolder: writer.folder }
      at.writersBefore = writer.index
      at.isDeferredRead = writer.isLater
      feed(writer.st, at, `${f.where} (file ${f.path})`)
      // A file the writer reads (`cat CHANGES.md > b.md`) is where the writer ran.
      for (const g of plan.files.slice(named)) g.folder ??= writer.folder
      plan.notes.push(...plan.unread.splice(before))
    }
  }
  // A program of the command that may write files may rewrite any body file, in any order the shell runs
  // them: none is read as it stands now.
  if (r.mayRewrite) for (const f of plan.files) f.named = true
  // The backstop the shipped attribution hook has always had: a write's whole command text is checked last
  // for credit lines, so a spelling the reading does not model still cannot carry one into history. The
  // hook's own raw-text patterns are the floor: a write hidden in backticks or fed to `bash` on stdin is
  // missed by the reading, never by them. `isWrite` stays the reading's own answer; the hook checks any
  // command that has text to check.
  if (plan.isWrite || RAW_WRITES.some(re => re.test(command)))
    plan.texts.push({ where: 'the command text', text: stripPaths(command), creditOnly: true })
  return plan
}

// `outer`: where commands from a `$(...)` or a `bash -c` script run; their own subshells nest inside it.
function read(statements: Statement[], r: Reading, outer?: string) {
  statements.forEach((st, idx) => {
    const was = r.isDeferredRead
    r.isDeferredRead = was || st.isDeferred || st.isLooped
    readStatement(st, statements[idx - 1], r, outer)
    r.isDeferredRead = was
  })
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
  const filled = withProgram(withWords(typed, r), r.ps, plan)
  const assignment = r.ps ? psAssignment(filled) : undefined
  if (r.ps) forgetOutVars(filled, r)
  // PowerShell's `$env:X = v`, `env:` drive and .NET spellings are read as `$env:X = v`.
  const env = r.ps ? psEnvSet(filled, assignment) : undefined
  const st = env?.statement ?? filled
  if (env && env.name === undefined) r.isEnvUnknown = true
  // A file written under a variable set earlier (`cat > "$S/body.md"`) is known by its full path.
  const writes = st.writes.map((path, i) => knownPath(st.writeWords?.[i] ?? path, r) ?? path)
  const at = placeHere(r).folder
  plan.written.push(...writes.map(path => ({ path, folder: at })))
  const seen = writes.length > 0 ? seenOf(r) : undefined
  const isLater = Boolean(r.isDeferredRead)
  for (const path of writes) {
    const vars = varsIn(path, r)
    const index = r.writers.length
    r.writers.push({ st, ps: r.ps, scope, vars, folder: at, path: norm(path), seen: seen as Seen, isLater, index })
  }
  const { name, args } = programOf(st)
  // The routes around the check, refused outright: history rewrites, skipped hooks and the like.
  plan.block ??= bypassOf(st, name, args, r)
  for (const what of builtReasons(st, name, args, r)) unreadCall(r, what)
  const moves = repoMoves(st, name, args)
  r.mayRewrite ||= setsRunner(st)
  r.isRepoMoved ||= moves.movesLater
  if (r.ps ? psSetsUnknown(st, name, args) : setsNameAtRunTime(name, args)) r.isSourced = true
  if (/^(eval|invoke-expression|iex)$/.test(name)) return readEval(st, args, r, prev)
  if (!r.ps && name === 'trap') return readTrap(args, r)
  // A PowerShell assignment sets its variables; a command after its operator (`$r = git push`) is read in turn.
  if (assignment) assignPsTargets(st, assignment, r)
  if (assignment) return void (assignment.command && readStatement(assignment.command, prev, r, outer))
  if (assign(st, name, args, r)) return
  if (moveTo(name, args, r)) return
  if (readScript(st, name, args, r)) return
  // A wrapper shell (`bash -c`) is read above, its statements in turn; an assignment sets no file.
  r.mayRewrite ||= mayWriteFiles(st, r.ps)
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

function readWrite(st: Statement, prev: Statement | undefined, name: string, args: Word[], r: Reading) {
  const stdin = r.stdin
  const where = name === 'git' ? git(st, args, r) : name === 'gh' ? gh(st, args, r) : web(name, st, args, r)
  if (!where) return
  r.writes++
  readSplats(args, r, where)
  // A message read from stdin with no here-doc on the statement: a `< file`, or the statement piped in.
  if (r.stdin > stdin && st.heredocs.length === 0) readStdin(st, prev, r, where)
}

// `eval` and `Invoke-Expression` run their words as a command in this same shell: read here, with the
// variables set earlier filled in. Words built in a way the reading cannot follow hide the command, so
// they are refused when their text names a history write.
function readEval(st: Statement, typed: Word[], r: Reading, prev?: Statement) {
  r.hasEval = true
  const args = r.ps ? psEvalWords(st, typed, prev) : typed
  // Another program's output piped in (`gc fix.ps1 | iex`) may run anything and set anything.
  if (!args) return void (r.mayRewrite = r.isSourced = true)
  const { text, literals } = joinWords(args)
  const e = args.some(a => a.dynamic) ? expand(text, r, literals) : { text, unresolved: false }
  if (e.unresolved) {
    if (evalWrites(parse(text, r.ps), r.ps)) r.plan.block ??= EVAL
    // Text the reading cannot know may run any program.
    r.mayRewrite = true
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
    setVar(r, m[1] ?? '', m[2] ? undefined : sliceWord(w, m[0].length))
  }
  readInPlace(parse(e.text, r.ps), r, 'e', st.isDeferred)
  for (const name of names) setVar(r, name, undefined)
}

const TRAP = 'a trap action built at run time hides the command it runs, so its message cannot be read.'

// `trap 'ACTION' SIGNAL...`: the action runs in this shell later (`DEBUG` before every command), so what it
// sets may change anything read after it. One that cannot be filled in is refused when it names a write.
function readTrap(args: Word[], r: Reading) {
  const k = args.findIndex(a => !/^(-[lp]+|--)$/.test(a.text))
  const action = args[k]
  if (!action || args.length - k < 2 || action.text === '-') return
  // The action is filled in when the trap is set (`trap "rm -f $T" EXIT`), and read as an `eval` is.
  const e = action.dynamic ? expand(action.text, r, action.literals) : { text: action.text, unresolved: false }
  if (!e.unresolved) return readInPlace(parse(e.text, false), r, 'c', true)
  if (evalWrites(parse(action.text, false), false)) r.plan.block ??= TRAP
  // An `EXIT` trap of the command's own shell runs once every command is done; one set in a subshell or a
  // child shell runs as that ends, and any other may run before any command and set anything.
  const isTop = !/(^|\/)(\d+|s\d+|p\d+)(\/|$)/.test(r.scope)
  if (isTop && args.slice(k + 1).every(a => !a.dynamic && /^(EXIT|SIGEXIT|0)$/i.test(a.text))) return
  r.mayRewrite = true
  r.isSourced = true
}

// Commands an `eval` or a `trap` runs in this same shell: their subshells numbered apart from the command's.
// A trap's run later, all in a branch of their own (`c<n>`).
function readInPlace(statements: Statement[], r: Reading, tag: 'e' | 'c', isDeferred?: boolean) {
  const n = ++r.opened
  const at = r.scope
  for (const s of statements) {
    if (s.scope || tag === 'c') s.scope = within(`${tag}${n}`, s.scope)
    s.isDeferred ||= isDeferred
  }
  read(statements, r, at)
  r.scope = at
}

// `bash -c '...'` and the like: the script is read as commands of its own, run in a child shell that
// sees only exported variables. True when it was one.
function readScript(st: Statement, name: string, args: Word[], r: Reading): boolean {
  const inner = script(st, name, args)
  if (!inner) return false
  // A script held in a variable set earlier in the command, or a here-doc that names one, is read with
  // its value.
  const text = inner.dynamic ? inner.text : undefined
  const e = text === undefined ? undefined : inner.isBody ? expandBody(text, r) : expand(text, r, inner.literals)
  const isKnown = e !== undefined && !e.unresolved
  const ps = r.ps
  const writes = r.writes
  const child = within(r.scope, `p${++r.opened}`)
  inherit(st, args, r, child)
  r.ps = inner.ps
  read(isKnown ? parse(e.text, inner.ps) : inner.statements, r, child)
  r.ps = ps
  if (inner.dynamic && !isKnown && r.writes > writes) r.plan.unread.push(`a ${name} script built at run time`)
  // A script the reading cannot know may run any program; so may a cmd line split at `&` or `|`, or holding
  // a word the shell fills in, since it is read as one statement.
  if (inner.dynamic && !isKnown) r.mayRewrite = true
  // cmd fills in `%NAME%`, drops `^` and runs each part of a line split at `&` or `|`: unlike the shell.
  const line = inner.text ?? args.map(a => a.text).join(' ')
  if (name === 'cmd' && /[%^&|]/.test(line) && cmdWrites(line)) unreadCall(r, 'a cmd script built at run time')
  if (name === 'cmd' && (/[%^&|]/.test(line) || args.some(a => a.dynamic))) r.mayRewrite = true
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
    // A native program gets a hashtable as `-key:value` words (`@{ nm = 'x' }` is `-n -m :x`), a list as items.
    r.plan.unread.push(where)
  }
}

// The files fed through `<`, read for `where`: one built at run time in a way the reading does not know
// names it unread.
function readFiles(st: Statement, r: Reading, where: string) {
  for (const [i, path] of st.reads.entries()) {
    const full = knownPath(st.readWords?.[i] ?? path, r)
    if (full === undefined) r.plan.unread.push(where)
    else pushFile(r, where, full)
  }
}

function readStdin(st: Statement, prev: Statement | undefined, r: Reading, where: string) {
  if (st.reads.length > 0) readFiles(st, r, where)
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
    readFiles(st, r, where)
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

// A body file named here, matched to the statements that wrote it so far, if any.
function pushFile(r: Reading, where: string, path: string) {
  const entry: Plan['files'][number] = { where, path }
  matchFile(r, entry, landsAt(path, r))
  r.plan.files.push(entry)
}

// The file's writers, back to one that surely ran before it is read. With none sure, the file on disk is
// read too: the writers may not have run.
function matchFile(r: Reading, entry: Plan['files'][number], isIt: (w: Writer) => boolean): boolean {
  const found = writersOf(r.writers.slice(0, r.writersBefore ?? r.writers.length), r.scope, isIt)
  if (found.length === 0) return false
  r.matched.set(entry, found)
  if (ranBefore(found.at(-1)?.scope ?? '', r.scope)) entry.written = true
  return true
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
    } else if (/^(-c|--git-dir|--work-tree|--namespace|--config-env|--attr-source|--super-prefix)$/.test(t)) {
      // A setting built at run time may name a hook path or an alias: what git then runs is unknown.
      if ((t === '-c' || t === '--config-env') && isUnknownSetting(args[k + 1])) {
        unreadCall(r, 'a git setting built at run time')
      }
      if (splitsAt(args[k + 1]) || isSplat(args[k + 1], r.ps)) unreadCall(r, 'a git option built at run time')
      k += 2
    } else if (t.startsWith('-')) {
      // The joined `--config-env=<key>=<variable>` is judged as the spaced one is.
      const joined = t.startsWith('--config-env=') ? sliceWord(args[k] as Word, '--config-env='.length) : undefined
      if (isUnknownSetting(joined)) unreadCall(r, 'a git setting built at run time')
      k++
    } else break
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
  const isUnwalkedWrite = !isWalked && writesHistory('git', args, r.ps)
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
      // A name built at run time is unread, as `checkout -b` names it.
      for (const w of branchesOf(rest)) take('branch', w, r, '')
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
    } else if (t.startsWith('--repo=')) take('repo', sliceWord(args[i] as Word, 7), r, '')
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

function gh(st: Statement, args: Word[], r: Reading): string | undefined {
  const { plan } = r
  plan.ghCalls++
  const { gi, ai } = ghWords(args, r)
  // A splat up to the action word may hand over the subcommand or global options.
  if ((ai === -1 ? args : args.slice(0, ai + 1)).some(w => isSplat(w, r.ps)))
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
  const apiArgs = args.filter((_, i) => i !== gi)
  if (group === 'api') return ghApi(st, apiArgs, r)
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
    const lowered = args.map(a => ({ ...a, text: a.text.startsWith('-') ? a.text.toLowerCase() : a.text }))
    walk(lowered, PS_WEB, r, where)
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
      const value = eq === -1 ? args[++i] : sliceWord(w, t.length - (full.length - eq - 1))
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
        const value = attached ? sliceWord(w, j + 1) : args[++i]
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
  const isMany = splitsAt(value) || isSplat(value, r.ps)
  if (isMany && /^(skip|repo|method)$/.test(kind)) unreadCall(r, where || 'a flag value built at run time')
  // A PowerShell list hands a write its first item as the value and the rest as more words.
  if (value.list && (where || kind === 'branch')) unreadCall(r, 'a flag value built at run time')
  switch (kind) {
    case 'text':
      return message(value, r, where)
    case 'file': {
      if (value.text === '-') return void r.stdin++
      if (!value.dynamic) return void pushFile(r, where, value.text)
      const e = expand(value.text, r, value.literals)
      if (!e.unresolved) return void pushFile(r, where, e.text)
      // A file this command writes under the same spelling (`F=$(mktemp); cat > "$F"`), with every
      // variable in it unchanged since: the same file.
      const now = varsIn(value.text, r)
      const isTracked = now.length > 0 && now.every(Boolean) && !/\$[({@*#?$!0-9-]|`|\$env:/i.test(value.text)
      const isSame = (w: Writer) => w.path === norm(value.text) && isSameFolder(value.text, w.folder, r)
      const isIt = (w: Writer) => isSame(w) && w.vars.length === now.length && w.vars.every((v, i) => v === now[i])
      const entry = { where, path: value.text }
      if (isTracked && matchFile(r, entry, isIt)) return void plan.files.push(entry)
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
      // A PowerShell splat or list hands git several words: a start point after the name, perhaps.
      if (value.dynamic || isMany || value.list) unreadCall(r, 'the new branch name')
      else plan.branches.push(value.text)
      return
    case 'field': {
      const eq = value.text.indexOf('=')
      // A whole field built at run time (`-f "$KV"`): its value cannot be read.
      if (eq === -1 && value.dynamic) return void (where && plan.unread.push(where))
      const v = sliceWord(value, eq === -1 ? value.text.length : eq + 1)
      if (v.text === '@-') return void r.stdin++
      if (v.text.startsWith('@')) return filePath(sliceWord(v, 1), r, where)
      return message(v, r, where)
    }
    case 'data':
      if (value.text === '@-') return void r.stdin++
      if (value.text.startsWith('@')) return filePath(sliceWord(value, 1), r, where)
      return message(value, r, where)
  }
}

// A body file named after `@` in a field (`-F query=@$q`): read from its full path, or named unread.
function filePath(path: Word, r: Reading, where: string) {
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
  const e = expand(value.text, r, value.literals)
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
