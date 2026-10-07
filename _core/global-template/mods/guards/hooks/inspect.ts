// Turns one Bash or PowerShell command into what the guards must check: the message texts it writes
// to history, the body files it hands over, the branches it creates, and whether a commit's added
// lines need a look. Pure, no engine access.
//
// guards is a safety net for commands written the ordinary way, not a sandbox. It follows the shapes
// people and agents really write: git and gh behind `if`/`then`/`do`/`{`/`(`, `sudo`, `env`, `timeout`,
// `xargs`, inside `$(...)` and backticks, `bash -c`, a here-doc fed to `bash` and `powershell -Command`;
// messages from variables set earlier in the command, here-docs, pipes and files the command writes
// itself. Where a message exists but its text is made by something the reading cannot follow, the
// message is named in `unread`, and the call is refused: what reaches history unread is never passed.
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
import { parse, programOf, runsInlineCode } from './shell'
import { expand, expandBody, lookup, setVar, store, within } from './vars'
import type { VarState } from './vars'
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
  MESSAGE,
  PS_WEB,
} from './specs'
import type { Kind, Spec } from './specs'
import type { Statement, Word } from './shell'

export type Plan = {
  /** Message text with where it goes ("the commit message", "the PR body"). `creditOnly`: command text
   * around a message (a `$(...)` as typed), checked for AI credit but not for the product name. */
  texts: { where: string; text: string; creditOnly?: boolean }[]
  /** Body files the command hands to git or gh, as written (relative to `cwd` when not absolute).
   * `written`: this same command writes the file, and what it writes was read from the command text. */
  /** `folder`: where a relative path resolves, as the command stands where the file is named.
   * `scripted`: a script an earlier statement runs (python, node) may write it, unseen by the reading. */
  files: { where: string; path: string; written?: boolean; folder?: Folder; scripted?: boolean }[]
  /** Files the command itself writes (`> file`). */
  written: string[]
  branches: string[]
  /** A commit runs: `cached` checks the staged lines, `all` the working tree's too (`-a`, pathspecs). */
  diff: 'cached' | 'all' | null
  /** Messages whose text is built in a way the guard cannot read ($VAR from outside, another program's output). */
  unread: string[]
  /** What was left unjudged without risk to history (the PR-body format, a diff cut short): logged, never refused. */
  notes: string[]
  /** `gh --repo owner/name` when given. */
  repo?: string
  /** Where relative paths resolve: a leading `cd` or `git -C`. */
  cwd?: string
  /** The `cd` or `-C` folder is built at run time (`cd "$REPO"`): relative paths cannot be found. */
  isCwdUnknown?: boolean
  block?: string
  isWrite: boolean
  /** Each `gh pr create` or `gh pr edit`: what it sets, for the PR-body contract. */
  prs: PrCall[]
  /** Every `gh` statement in the command: the PR-body contract judges only a command with one. */
  ghCalls: number
}

/** A folder the command moved to: `path` is relative to the session folder unless absolute; none = there. */
export type Folder = { path?: string; isUnknown: boolean }

// The reading's working state while it walks one command.
type Reading = VarState & {
  plan: Plan
  /** The folder each `cd` so far leads to. */
  folder: Folder
  /** A `git -C <dir>` on the statement being read: its folder, for this statement only. */
  statementDir?: Word
  /** `$(...)` substitutions and child shells read so far, which number their scopes. */
  opened: number
  /** The statement that writes each file (`> file`), by normalized path, with where it runs. */
  writers: Map<string, { st: Statement; ps: boolean; scope: string }>
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
    diff: null,
    unread: [],
    notes: [],
    isWrite: false,
    prs: [],
    ghCalls: 0,
  }
  const r: Reading = {
    plan,
    folder: { isUnknown: false },
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
  // history anywhere.
  if (r.hasEval && (plan.isWrite || RAW_WRITES.some(re => re.test(command)))) plan.block ??= EVAL
  // A body file this same command writes is read from the statement that writes it. What another
  // program writes into it cannot be read; the maintainer's rule passes a file the command writes itself,
  // so that is noted, not refused.
  for (const f of [...plan.files]) {
    const writer = r.writers.get(norm(f.path))
    if (!writer) continue
    f.written = true
    const before = plan.unread.length
    feed(writer.st, { ...r, ps: writer.ps, scope: writer.scope }, `${f.where} (file ${f.path})`)
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

// The shipped no-ai-attribution hook's write patterns (`_core/global-template/hooks/no-ai-attribution.py`),
// matched on the raw command text, plus the history rewrites. A `gh api` call counts only with a writing
// method or fields: a read reaches no history. `REST`: the rest of the same command, up to a separator or
// a line end.
const REST = String.raw`[^|;&\n]*?`
const GIT_WRITES = 'commit|merge|push|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace'
const GH_NOUNS = 'pr|issue|release|gist|repo'
const GH_VERBS = 'create|edit|comment|review|merge|close|reopen'
// A writing method, or a field: a field flag counts spaced (`-f body=x`) or attached (`-fbody=x`), as gh
// reads both.
const API_METHOD = String.raw`(?:-X|--method)[\s=]*(?:POST|PATCH|PUT|DELETE)`
const API_WRITE = String.raw`${API_METHOD}|(?<=\s)-[fF](?:\s|\S*=)|--field|--raw-field|--input`
const RAW_WRITES = [
  String.raw`\bgit\b${REST}\b(?:${GIT_WRITES})\b`,
  String.raw`\bgh\b${REST}\b(?:${GH_NOUNS})\b${REST}\b(?:${GH_VERBS})\b`,
  String.raw`\bgh\b${REST}\bapi\b(?=${REST}(?:${API_WRITE}))`,
  String.raw`\b(?:curl|Invoke-(?:RestMethod|WebRequest))\b${REST}api\.github\.com`,
].map(source => new RegExp(source, 'i'))

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

const CD_NAMES = new Set(['cd', 'set-location', 'pushd', 'sl'])

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

function readStatement(st: Statement, prev: Statement | undefined, r: Reading, outer?: string) {
  const { plan } = r
  const scope = outer === undefined ? (st.scope ?? '') : within(outer, st.scope)
  // A Bash `$(...)` or backtick runs in a subshell of its own; PowerShell's `$(...)` runs in place.
  read(st.inner, r, r.ps ? scope : within(scope, `s${++r.opened}`))
  r.scope = scope
  // A file written under a variable set earlier (`cat > "$S/body.md"`) is known by its full path.
  const writes = st.writes.map(path => knownPath(path, r) ?? path)
  plan.written.push(...writes)
  for (const path of writes) r.writers.set(norm(path), { st, ps: r.ps, scope })
  const { name, args } = programOf(st)
  // The routes around the check, refused outright: history rewrites, skipped hooks and the like.
  plan.block ??= bypassOf(st, name, args)
  if (/^(eval|invoke-expression|iex)$/.test(name)) r.hasEval = true
  if (assign(st, name, args, r)) return
  if (CD_NAMES.has(name) || POP_NAMES.has(name)) {
    const target = POP_NAMES.has(name) ? undefined : args.find(a => !a.text.startsWith('-'))
    if (!plan.cwd && !plan.isCwdUnknown && target) setCwd(plan, target)
    r.folder = moveFolder(r.folder, target)
    return
  }
  if (readScript(st, name, args, r)) return
  // Script code in the command (`python - <<EOF`, `node -e`) may write files the reading never sees; its
  // text is under the credit backstop. A script file on disk (`python gen.py`) is not, so it marks nothing.
  if (runsInlineCode(st)) r.ranScript = true
  const before = plan.files.length
  r.statementDir = undefined
  readWrite(st, prev, name, args, r)
  // Each body file keeps the folder in effect where it is named: `cd a && ... && cd b` moves it on.
  const folder = r.statementDir ? moveFolder(r.folder, r.statementDir) : r.folder
  for (const f of plan.files.slice(before)) {
    f.folder ??= folder
    if (r.ranScript) f.scripted = true
  }
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

// The folder after a `cd`: a literal target composes onto it, anything else (`$DIR`, `-`, `popd`, no
// target) leaves it unknown.
function moveFolder(folder: Folder, target: Word | undefined): Folder {
  if (folder.isUnknown || !target || target.dynamic || target.text === '-') return { isUnknown: true }
  const dir = target.text.replace(/\\/g, '/')
  if (/^([a-zA-Z]:)?\/|^~/.test(dir) || folder.path === undefined) return { path: dir, isUnknown: false }
  return { path: `${folder.path.replace(/\/$/, '')}/${dir}`, isUnknown: false }
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
  r.ps = inner.ps
  read(isKnown ? parse(e.text, inner.ps) : inner.statements, r, child)
  r.ps = ps
  if (inner.dynamic && !isKnown && r.writes > writes) r.plan.unread.push(`a ${name} script built at run time`)
  return true
}

// A hashtable typed in full: each key a name or a quoted string, each value a quoted string with nothing
// to fill in, a number, or `$true`, `$false` or `$null`. Any other value runs at run time.
const TYPED_KEY = String.raw`(?:\w+|'[^']*'|"[^"$\x60]*")`
const TYPED_VALUE = String.raw`(?:'(?:[^']|'')*'|"[^"$\x60]*"|-?\d+(?:\.\d+)?|\$(?:true|false|null))`
const TYPED_ENTRY = String.raw`${TYPED_KEY}\s*=\s*${TYPED_VALUE}`
const TYPED_TABLE = new RegExp(String.raw`^@\{\s*(?:${TYPED_ENTRY}(?:\s*[;\n]\s*${TYPED_ENTRY})*)?\s*;?\s*\}$`, 'i')

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
  if (st.reads.length > 0) for (const path of st.reads) r.plan.files.push({ where, path })
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
    for (const path of st.reads) plan.files.push({ where, path })
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

// Variables set earlier in the command (`MSG='...'`, `$m = @'...'@`, `read -r -d '' BODY <<'EOF'`):
// a message that names one is read with its value. Returns true for an assignment statement.
function assign(st: Statement, name: string, args: Word[], r: Reading): boolean {
  const w = st.words
  if (r.ps) {
    const spaced = /^\$(\w+)$/.exec(w[0]?.text ?? '')
    if (spaced && w[1]?.text === '=') {
      setVar(r, spaced[1] ?? '', w.length === 3 ? w[2] : undefined)
      return true
    }
    // `$p += @{...}`, `$p.Body = ...`, `$p['Body'] = ...`, `$p.Add(...)`: a value changed after it was
    // typed is no longer known.
    const isCompound = spaced !== null && /^([-+*/%]|\?\?)=$/.test(w[1]?.text ?? '')
    const member = isCompound ? spaced : /^\$(\w+)[.[]/.exec(w[0]?.text ?? '')
    const changed = member ? lookup(r, member[1] ?? '') : undefined
    if (changed) {
      changed.text += `\n${w.map(x => x.text).join(' ')}`
      changed.literal = false
    } else if (isCompound) setVar(r, spaced?.[1] ?? '', undefined)
    const joined = w.length === 1 ? /^\$(\w+)=([\s\S]*)$/.exec(w[0]?.text ?? '') : null
    if (joined) setVar(r, joined[1] ?? '', { ...(w[0] as Word), text: joined[2] ?? '' })
    return Boolean(joined) || isCompound
  }
  const pairs = name === '' ? w : /^(export|declare|local|readonly|typeset)$/.test(name) ? args : null
  if (pairs) {
    // `export M=x`, `declare -x M`: a child shell sees it too.
    const isExport = name === 'export' || args.some(a => /^-[a-z]*x/.test(a.text))
    for (const a of pairs) {
      const m = /^([A-Za-z_]\w*)=/.exec(a.text)
      if (m) setVar(r, m[1] ?? '', { ...a, text: a.text.slice(m[0].length) }, isExport)
      else if (isExport) for (const v of r.vars.get(a.text.toLowerCase()) ?? []) v.exported = true
    }
    return true
  }
  if (name === 'read' && st.heredocs.length > 0) {
    const v = [...args].reverse().find(a => /^[A-Za-z_]\w*$/.test(a.text))
    const body = st.heredocs[0] ?? ''
    const e = st.hasDynamicBody ? expandBody(body, r) : { text: body, unresolved: false }
    if (v) store(r, v.text, { text: e.unresolved ? body : e.text, literal: !e.unresolved, scope: r.scope })
    return true
  }
  return false
}

// `isBody`: the script is a here-doc fed to the shell, filled in as one.
type Script = { statements: Statement[]; ps: boolean; dynamic: boolean; text?: string; isBody?: boolean }

const SHELLS = /^(bash|sh|zsh|dash|ksh)$/

// A shell reading its script from a here-doc or here-string (`bash <<'EOF'`, `sh -s <<< '...'`): nothing
// but flags on the line.
function stdinScript(st: Statement, args: Word[]): Script | undefined {
  const text = st.heredocs[0]
  if (text === undefined || st.heredocs.length > 1 || args.some(a => !a.text.startsWith('-'))) return undefined
  return { statements: parse(text, false), ps: false, dynamic: Boolean(st.hasDynamicBody), text, isBody: true }
}

// `bash -c '...'`, `powershell -Command "..."`, `cmd /c ...`: the script is read as a command of its own.
// `text`: the script as typed, when it is one command line.
function script(st: Statement, name: string, args: Word[]): Script | undefined {
  const of = (i: number, ps: boolean) => {
    const rest = args.slice(i + 1)
    if (i === -1 || rest.length === 0) return undefined
    const text = rest.length === 1 ? (rest[0]?.text ?? '') : rest.map(a => a.text).join(' ')
    return { statements: parse(text, ps), ps, dynamic: rest.some(a => a.dynamic), text }
  }
  if (SHELLS.test(name)) {
    const i = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a.text))
    return i === -1 ? stdinScript(st, args) : of(i, false)
  }
  if (/^(pwsh|powershell)$/.test(name))
    return of(
      args.findIndex(a => /^-(c|command)$/i.test(a.text)),
      true,
    )
  if (name === 'cmd') {
    // Git Bash turns `/c` into a path, so it is typed `//c` there.
    const i = args.findIndex(a => /^\/{1,2}[ck]$/i.test(a.text))
    if (i === -1) return undefined
    const words = args.slice(i + 1)
    // `cmd /c "git commit -m \"...\""`: the command as one quoted word is read as a command line.
    if (words.length === 1) {
      const text = words[0]?.text ?? ''
      return { statements: parse(text, false), ps: false, dynamic: words[0]?.dynamic ?? false, text }
    }
    return {
      statements: [{ words, heredocs: [], writes: [], reads: [], pipeIn: false, inner: [] }],
      ps: false,
      dynamic: false,
    }
  }
  return undefined
}

function setCwd(plan: Plan, word: Word | undefined) {
  if (word?.dynamic) plan.isCwdUnknown = true
  else plan.cwd = word?.text
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

// `git branch` flags that list, delete or configure instead of creating a branch.
const BRANCH_NOT_CREATE = new RegExp(
  '^-[dDlarvu]|^--(' +
    'delete|list|all|remotes|show-current|contains|merged|no-merged|set-upstream|unset-upstream|edit-description' +
    ')',
)

// The index of git's subcommand, past its global options; `-C <dir>` sets the folder.
function gitSubcommand(args: Word[], r: Reading): number {
  const { plan } = r
  let k = 0
  while (k < args.length) {
    const t = args[k]?.text ?? ''
    if (t === '-C') {
      if (!plan.cwd && !plan.isCwdUnknown) setCwd(plan, args[k + 1])
      r.statementDir = args[k + 1]
      k += 2
    } else if (/^(-c|--git-dir|--work-tree|--namespace|--config-env)$/.test(t)) k += 2
    else if (t.startsWith('-')) k++
    else break
  }
  return k
}

// `git branch <name>` creates one (a rename or copy names the new one last); listing flags create none.
function gitBranch(rest: Word[], plan: Plan) {
  const flags = rest.filter(a => a.text.startsWith('-')).map(a => a.text)
  const names = rest.filter(a => !a.text.startsWith('-')).map(a => a.text)
  if (flags.some(f => /^-(m|M|c|C)$|^--(move|copy)$/.test(f))) plan.branches.push(...names.slice(-1))
  else if (!flags.some(f => BRANCH_NOT_CREATE.test(f))) plan.branches.push(...names.slice(0, 1))
}

// `-a` in a bundle counts only before the first letter that takes a value: in `-Sabc` or `-uall` it is
// part of that value, read the same way `walk` reads the bundle.
function isCommitAll(text: string): boolean {
  if (text === '--all') return true
  if (!/^-[A-Za-z]/.test(text)) return false
  for (const letter of text.slice(1)) {
    if (letter === 'a') return true
    if (!/[A-Za-z]/.test(letter) || COMMIT[`-${letter}`]) return false
  }
  return false
}

function gitCommit(st: Statement, rest: Word[], r: Reading): string {
  const { plan } = r
  const where = write(r, st, 'the commit message')
  const positional = walk(rest, COMMIT, r, where)
  const all = rest.some(a => isCommitAll(a.text))
  plan.diff = all || positional.length > 0 ? 'all' : (plan.diff ?? 'cached')
  return where
}

function git(st: Statement, args: Word[], r: Reading): string | undefined {
  const { plan } = r
  const k = gitSubcommand(args, r)
  const sub = args[k]?.text ?? ''
  const rest = args.slice(k + 1)
  switch (sub) {
    case 'commit':
      return gitCommit(st, rest, r)
    case 'tag':
    case 'merge':
    case 'commit-tree': {
      const where = write(r, st, `the ${sub} message`)
      walk(rest, MESSAGE, r, where)
      return where
    }
    case 'notes': {
      const where = write(r, st, 'the git note')
      walk(rest.slice(1), MESSAGE, r, where)
      return where
    }
    case 'checkout':
      walk(rest, { '-b': 'branch', '-B': 'branch' }, r, '')
      return undefined
    case 'switch':
      walk(rest, { '-c': 'branch', '-C': 'branch', '--create': 'branch', '--force-create': 'branch' }, r, '')
      return undefined
    case 'worktree':
      if (rest[0]?.text === 'add') walk(rest.slice(1), { '-b': 'branch', '-B': 'branch' }, r, '')
      return undefined
    case 'branch':
      gitBranch(rest, plan)
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
// or carry their value attached (`-m"msg"`, `-Fbody.md`, `-XPOST`); long ones may use `=`.
function walk(args: Word[], spec: Spec, r: Reading, where: string): Word[] {
  const positional: Word[] = []
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as Word
    const t = w.text
    if (t === '--') {
      positional.push(...args.slice(i + 1))
      break
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=')
      const flag = eq === -1 ? t : t.slice(0, eq)
      const kind = spec[flag]
      if (!kind || kind === 'attached') continue
      const value = eq === -1 ? args[++i] : { ...w, text: t.slice(eq + 1) }
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
  switch (kind) {
    case 'text':
      return message(value, r, where)
    case 'file': {
      if (value.text === '-') return void r.stdin++
      if (!value.dynamic) return void plan.files.push({ where, path: value.text })
      const e = expand(value.text, r)
      if (!e.unresolved) return void plan.files.push({ where, path: e.text })
      return fileOrUnread(value, plan, where)
    }
    case 'repo':
      plan.repo = value.text.split('/').pop()
      return
    case 'method':
      r.method = value.text.toUpperCase()
      return
    case 'branch':
      if (!value.dynamic) plan.branches.push(value.text)
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
  r.plan.files.push({ where, path: full })
}

// A message value: literal text is checked; text built at run time is read where the reading can
// (a variable set earlier, a here-doc inside `$(cat <<'EOF' ... EOF)`, a `$(cat file)`) and named as
// unread otherwise. The value as typed is checked for credit too: a credit inside `$(echo '...')` or
// `$(printf ...)` is in the command text itself.
function message(value: Word, r: Reading, where: string) {
  const { plan } = r
  if (!value.dynamic) return void plan.texts.push({ where, text: value.text })
  for (const body of value.bodies) plan.texts.push({ where, text: body })
  plan.texts.push({ where, text: value.text, creditOnly: true })
  const e = expand(value.text, r)
  plan.texts.push({ where, text: e.text })
  if (e.unresolved) fileOrUnread(value, plan, where)
}

function fileOrUnread(value: Word, plan: Plan, where: string) {
  const cat =
    /(?:\$|^)\(\s*(?:cat|Get-Content|gc)(?:\s+-Raw)?\s+(?:"([^"$]+)"|'([^']+)'|([^\s)$]+))(?:\s+-Raw)?\s*\)/i.exec(
      value.text,
    )
  if (cat) return void plan.files.push({ where, path: (cat[1] ?? cat[2] ?? cat[3]) as string })
  if (value.bodies.length > 0) return
  plan.unread.push(where)
}
