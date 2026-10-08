// Variables a command sets and reads back. Each value is kept with where it was set (a Bash subshell, a
// `$(...)`, a child shell), so a later read finds it exactly where the shell would: inside that place
// and the ones it opens, and gone once it closes. A child shell (`bash -c`) sees only exported values.
// Pure.

import { sliceWord } from './quoting'
import { PS_OPERATOR } from './shell'
import type { Statement, Word } from './shell'

/** A variable's value: `literal` when it is known, `scope` where it was set, `exported` when a child shell
 * sees it too, `file` the file whose text it holds (`$(cat b.md)`). */
export type Var = { text: string; literal: boolean; scope: string; exported?: boolean; file?: string; ps?: boolean }

/** What the reading knows of variables at the statement it reads. */
export type VarState = {
  /** Every value set so far by name (lower-cased in PowerShell, where case does not matter), one per scope,
   * most recent last. */
  vars: Map<string, Var[]>
  /** Where the statement being read runs, outermost first: its Bash subshells (`1/3`), each `$(...)` an
   * `s<n>` and each child shell a `p<n>`. Empty at the top. */
  scope: string
  ps: boolean
  /** While a statement that may run at any later point is read (a function body, a `trap` action): a name
   * it sets stays unknown from then on. */
  isLater?: boolean
  /** Names a function body, a `trap` action or a PowerShell block sets: unknown wherever they are read. */
  volatile?: Set<string>
  /** A file was sourced (`source x`, `. x`): it may set any variable, at once or through a trap or a
   * function, so every variable is unknown from then on. */
  isSourced?: boolean
  /** The command names Bash's `IFS` somewhere, so where an unquoted expansion splits is not known. */
  isIfsSet?: boolean
  /** How many times the command sets each name (`setCounts`), and whether a deferred statement is being
   * read: there a name set more than once is unknown. */
  sets?: Map<string, number>
  isDeferredRead?: boolean
}

// Reads one statement, marking what it sets as unknown from then on when it may run at any later point.
function unsure<T>(st: Statement, r: VarState, read: () => T): T {
  r.isLater = st.isDeferred
  try {
    return read()
  } finally {
    r.isLater = undefined
  }
}

/** Where the branch a scope sits in sits itself (`1/c4/c5` is in `1`): what the branch sets may or may not
 * be set there. The scope itself when it is in no branch, or in a subshell inside one. */
export const branchBase = (scope: string) => scope.replace(/(^|[/])c[0-9]+([/]c[0-9]+)*$/, '')

/** A place inside `outer`: `tag` alone at the top. */
export function within(outer: string, tag: string | undefined): string {
  return outer && tag ? `${outer}/${tag}` : outer || tag || ''
}

/** Sets a variable where the statement being read runs (or in `scope`, for a child shell's inherited
 * value); a value it cannot read (none given) is unknown. Its expansions are filled in where it is read. */
export function setVar(r: VarState, name: string, value: Word | undefined, exported = false, scope = r.scope) {
  if (!value) return store(r, name, { text: '', literal: false, scope }, exported)
  if (!value.dynamic) return store(r, name, { text: value.text, literal: true, scope }, exported)
  const held = catValue(value, r)
  if (held) return store(r, name, { ...held, scope }, exported)
  const e = expand(value.text, r, value.literals)
  store(r, name, { text: e.unresolved ? value.text : e.text, literal: !e.unresolved, scope }, exported)
}

/** A value that is wholly one file printed by `cat` or `Get-Content`: `$(cat b.md)`, PowerShell's
 * `(Get-Content b.md -Raw)`; its path is in the first group that matched. */
const CAT_FILE =
  /^[$<]?\(\s*(?:cat|Get-Content|gc)(?:\s+-Raw)?\s+(?:"([^"$]+)"|'([^']+)'|([^\s)$`]+))(?:\s+-Raw)?\s*\)$/i
const CAT_HEREDOC = /^[$<]\(\s*cat\s+<<(-?)[ \t]*(\\?)(['"]?)([A-Za-z_][\w.-]*)\3[ \t]*\r?\n/

/** What a value that is wholly one `$(cat ...)` holds: a here-doc's text (filled in when its delimiter is
 * bare, `literal` false when a part stays unknown), or the file it prints. `opener`: `$` for a
 * substitution, `<` for a process substitution (`-F <(cat <<'EOF' ... EOF)`). Anything else in the value,
 * on the `cat` line or after the here-doc makes it no such value. */
export function catValue(value: Word, r: VarState, opener: '$' | '<' = '$'): Held | undefined {
  const t = value.text
  // PowerShell's `(Get-Content b.md)` runs in place, with no `$`.
  const isOpen = (t[0] === opener && t[1] === '(') || (r.ps && opener === '$' && t[0] === '(')
  if (!isOpen) return undefined
  const doc = r.ps ? null : CAT_HEREDOC.exec(t)
  if (doc) {
    const body = heredocBody(t.slice(doc[0].length), doc[4] ?? '', doc[1] === '-')
    if (body === undefined) return undefined
    const e = doc[2] || doc[3] ? { text: body, unresolved: false } : expandBody(body, r)
    return { text: e.unresolved ? body : e.text, literal: !e.unresolved }
  }
  const file = CAT_FILE.exec(t)
  if (!file) return undefined
  return { text: t, literal: false, file: file[1] ?? file[2] ?? file[3] }
}

type Held = { text: string; literal: boolean; file?: string }

// The body of a here-doc that closes its `$(...)`: the lines up to the first one that is exactly the
// delimiter (tabs stripped under `<<-`), followed by nothing but the closing paren.
function heredocBody(rest: string, delim: string, strip: boolean): string | undefined {
  const lines = rest.split('\n').map(l => l.replace(/\r$/, ''))
  const cut = (l: string) => (strip ? l.replace(/^\t+/, '') : l)
  const end = lines.findIndex(l => cut(l) === delim)
  if (end === -1 || lines.slice(end + 1).join('\n').trim() !== ')') return undefined
  return lines.slice(0, end).map(cut).join('\n')
}

/** Keeps `v` as the variable's value in its scope; a variable once exported stays exported. */
// The map key of a name: Bash names are case-sensitive (`N` and `n` are two variables), PowerShell's are not.
const keyOf = (r: VarState, name: string) => (r.ps ? name.toLowerCase() : name)

export function store(r: VarState, name: string, v: Var, exported = false) {
  const key = keyOf(r, name)
  if (r.isLater) (r.volatile ??= new Set()).add(key)
  // Set in a branch: known inside it, and unknown where the branch sits, first, so the value inside wins.
  const base = branchBase(v.scope)
  const ps = r.ps || undefined
  if (base !== v.scope) put(r, key, { text: '', literal: false, scope: base, exported: exported || v.exported, ps })
  put(r, key, { ...v, ps }, exported)
}

function put(r: VarState, key: string, v: Var, exported = false) {
  const stack = r.vars.get(key) ?? []
  const old = stack.findIndex(x => x.scope === v.scope)
  if (old !== -1) v.exported ||= stack.splice(old, 1)[0]?.exported
  v.exported ||= exported
  stack.push(v)
  r.vars.set(key, stack)
}

/** The variable as the statement being read sees it, or undefined. */
export function lookup(r: VarState, name: string): Var | undefined {
  if (r.isSourced || r.volatile?.has(keyOf(r, name))) return undefined
  if (r.isDeferredRead && (r.sets?.get(keyOf(r, name)) ?? 0) > 1) return undefined
  const stack = r.vars.get(keyOf(r, name)) ?? []
  for (let i = stack.length - 1; i >= 0; i--) {
    const v = stack[i] as Var
    // A variable of the other shell (Bash's `m` read as PowerShell's `$m` in `pwsh -Command`) is another one:
    // the child sees it only in its environment, which the reading leaves unknown.
    if (Boolean(v.ps) !== r.ps) continue
    const isInside = v.scope === '' || r.scope === v.scope || r.scope.startsWith(`${v.scope}/`)
    // Past a child shell on the way in, only an exported value is still there.
    const isSeen = v.exported || !/(^|\/)p\d+/.test(r.scope.slice(v.scope.length))
    if (isInside && isSeen) return v
  }
  return undefined
}

const SUBSTITUTION = /\$\((?:[^()]|\([^()]*\))*\)/g

/** What `expand` found: the filled-in text; `unresolved` when any part is built at run time in a way the
 * reading does not know; `files` read by variables that hold a file's text, `isFilesOnly` when those are
 * the only unknown parts. */
export type Expanded = { text: string; unresolved: boolean; files: string[]; isFilesOnly: boolean }

// Stands in for a `$` or a backtick typed as plain text while a value is filled in.
const PLAIN = ''
const PLAIN_BACKTICK = ''

/** A value with its variables replaced by what the command set them to. `literals`: where a `$` or a
 * backtick in it was typed as plain text (`Word.literals`), passed on as is. */
export function expand(typed: string, r: VarState, literals: number[] = []): Expanded {
  const chars = typed.split('')
  for (const at of literals) if (/[$`]/.test(chars[at] ?? '')) chars[at] = chars[at] === '`' ? PLAIN_BACKTICK : PLAIN
  const text = literals.length > 0 ? chars.join('') : typed
  // Only `$NAME` and a plain `${NAME}` are filled in: any other `${...}` (`${!X}`, `${X:-y}`, `${X[@]}`)
  // and Bash's special parameters (`$@`, `$1`) are built at run time.
  const special = r.ps ? /\$\{(?![A-Za-z_]\w*\})/ : /\$\{(?![A-Za-z_]\w*\})|\$[@*#?$!0-9-]/
  let isOther = /\$\(|^[<>]?\(|@[({]/.test(text) || (!r.ps && text.includes('`')) || special.test(text)
  const files: string[] = []
  const filled = text.replace(SUBSTITUTION, ' ').replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (_, b, n) => {
    const name = (b ?? n) as string
    const v = lookup(r, name)
    if (v?.literal) return v.text
    if (v?.file) files.push(v.file)
    else isOther = true
    return ' '
  })
  const out = literals.length > 0 ? filled.replaceAll(PLAIN, '$').replaceAll(PLAIN_BACKTICK, '`') : filled
  return { text: out, unresolved: isOther || files.length > 0, files, isFilesOnly: !isOther && files.length > 0 }
}

// An unquoted here-doc or here-string body as the shell fills it in. A backslash before `$`, a backtick
// or a backslash keeps that character literal, before a line break joins the lines, and before anything
// else stays as typed. A variable set earlier takes its value; any other expansion is unresolved.
const BODY_PARTS = /\\([\s\S])|\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)|\$[{(]|`/g

export function expandBody(body: string, r: VarState): { text: string; unresolved: boolean } {
  let unresolved = false
  const text = body.replace(BODY_PARTS, (part, esc?: string, braced?: string, bare?: string) => {
    if (esc !== undefined) return '$`\\'.includes(esc) ? esc : esc === '\n' ? '' : part
    const name = braced ?? bare
    const v = name === undefined ? undefined : lookup(r, name)
    if (v?.literal) return v.text
    unresolved = true
    return part
  })
  return { text, unresolved }
}

/** The statement with each word the shell fills in from variables the command set read with its value:
 * a word of known parts becomes literal, split at blanks where the shell splits it (`$F`, not `"$F"`).
 * A word with any other part, or one that would split into a glob, stays as typed. */
export function withWords(st: Statement, r: VarState): Statement {
  let changed = false
  // A PowerShell statement starting with a variable assigns to it or calls a member, unless `&` runs it: its
  // targets (`$m`, `[string] $m`, `$a, $m`, both of `$a = $m = 1`) are names, never filled in.
  const last = psAssignment(st) ? st.words.map(isOperator).lastIndexOf(true) : 1
  const targets = r.ps && !st.isCall ? Math.max(1, last) : 0
  const words = st.words.flatMap((w, i) => {
    // A PowerShell expression (`$o.Trim()`) computes its value: filling in the variable alone is wrong text.
    if (!w.dynamic || w.expr || i < targets) return [w]
    const e = expand(w.text, r, w.literals)
    const splits = !r.ps && w.splits === true
    if (splits && r.isIfsSet) return [w]
    if (e.unresolved || (splits && /[*?[]/.test(e.text))) return [w]
    changed = true
    if (!splits) return [{ ...w, text: e.text, dynamic: false }]
    return e.text.split(/[ \t\n]+/).filter(Boolean).map(text => ({ text, dynamic: false, bodies: [] }))
  })
  return changed ? { ...st, words } : st
}

// Programs that print their words and set no variable.
const PRINTS = /^(git|gh|echo|cat|type|get-content|gc|write-output|write-host)$/

/** A statement that may set a variable in a way the reading does not follow (`read M`, `for M in`,
 * `printf -v M`, `unset M`, `mapfile M`): every name it spells as a word is unknown after it. */
export function forget(st: Statement, name: string, r: VarState) {
  if (PRINTS.test(name)) return
  if (name === 'source' || name === '.' || st.isSourced) r.isSourced = true
  unsure(st, r, () => {
    for (const w of st.words) {
      const m = (r.ps ? /^\$?(?:variable:)?([A-Za-z_]\w*)$/i : /^([A-Za-z_]\w*)(?:\+?=|\[|$)/).exec(w.text)
      if (m && !w.dynamic) setVar(r, m[1] ?? '', undefined)
      // A name attached to its option: `printf -vNAME`, `read -raNAME`.
      const attached = !r.ps && /^(printf|read)$/.test(name) ? /^-[a-zA-Z]*[va]([A-Za-z_]\w*)$/.exec(w.text) : null
      if (attached && !w.dynamic) setVar(r, attached[1] ?? '', undefined)
    }
  })
}

/** What a child shell gets besides the exported values: the assignments in front of it (`M=x bash -c`,
 * `env M=x bash -c`), filled in where they are typed, and nothing of what `env -i` or `env -u M` clears. */
export function inherit(st: Statement, args: Word[], r: VarState, child: string) {
  const lead = st.words.slice(0, st.words.length - args.length - 1)
  const isEnv = lead.some(w => w.text === 'env')
  const clear = (name: string) => store(r, name, { text: '', literal: true, scope: child }, true)
  for (let i = 0; i < lead.length; i++) {
    const t = lead[i]?.text ?? ''
    if (isEnv && /^(-i|-|--ignore-environment)$/.test(t)) for (const name of r.vars.keys()) clear(name)
    const unset = isEnv ? /^(?:-u|--unset=?)(.*)$/.exec(t) : null
    if (unset) clear(unset[1] || (lead[++i]?.text ?? ''))
    const m = /^([A-Za-z_]\w*)(\+?)=/.exec(t)
    if (!m || unset) continue
    // An append in front of a child shell (`M+=x bash -c`) is left unknown.
    const value = m[2] ? undefined : sliceWord(lead[i] as Word, m[0].length)
    setVar(r, m[1] ?? '', value, true, child)
  }
  // A child Bash first runs the file `BASH_ENV` names (`sh` reads `ENV`), which may set any variable.
  const isEnvFile = (name: string) => lead.some(w => w.text.startsWith(`${name}=`)) || lookup(r, name)?.exported
  if (isEnvFile('BASH_ENV') || isEnvFile('ENV'))
    for (const name of r.vars.keys()) store(r, name, { text: '', literal: false, scope: child }, true)
}

/** Variables set earlier in the command (`MSG='...'`, `$m = @'...'@`, `read -r -d '' BODY <<'EOF'`): a
 * message that names one is read with its value. True for an assignment statement. */
export function assign(st: Statement, name: string, args: Word[], r: VarState): boolean {
  return unsure(st, r, () => assignNow(st, name, args, r))
}

function assignNow(st: Statement, name: string, args: Word[], r: VarState): boolean {
  if (r.ps) return assignPs(st.words, r)
  const pairs = name === '' ? st.words : /^(export|declare|local|readonly|typeset)$/.test(name) ? args : null
  if (pairs) {
    // `export M=x`, `declare -x M`: a child shell sees it too; `export -n M` takes that away.
    const flags = args.filter(a => a.text.startsWith('-')).map(a => a.text).join('')
    const isExport = name === 'export' ? !/n/.test(flags) : /x/.test(flags)
    // `declare -n` (a reference), `-i`, `-l`, `-u` (the value changed), `-a`/`-A` (an array): unknown.
    const changes = name !== 'export' && /[nilauA]/.test(flags)
    // A nameref (`declare -n R=M`): a write through it changes another variable, unseen.
    if (name !== 'export' && /n/.test(flags)) r.isSourced = true
    for (const a of pairs) {
      const m = /^([A-Za-z_]\w*)(\+?)=/.exec(a.text)
      if (m) setPair(r, m[1] ?? '', sliceWord(a, m[0].length), Boolean(m[2]), isExport, changes)
      else if (name === 'export')
        for (const v of r.vars.get(keyOf(r, a.text)) ?? []) v.exported = isExport
    }
    return true
  }
  if (name === 'read' && st.heredocs.length > 0) {
    const names = args.filter(a => /^[A-Za-z_]\w*$/.test(a.text))
    const body = st.heredocs[0] ?? ''
    const e = st.hasDynamicBody ? expandBody(body, r) : { text: body, unresolved: false }
    // With one name it holds the text read (all of it here, which is more than the line it reads); with
    // several the text is split among them, so each is unknown.
    const held = { text: e.unresolved ? body : e.text, literal: !e.unresolved, scope: r.scope }
    if (names.length === 1) store(r, names[0]?.text ?? '', held)
    else for (const n of names) setVar(r, n.text, undefined)
    return true
  }
  return false
}

// One `NAME=value` or `NAME+=value`: an append keeps a known value known only when both parts are.
function setPair(r: VarState, name: string, value: Word, isAppend: boolean, exported: boolean, changes: boolean) {
  if (changes) return setVar(r, name, undefined, exported)
  if (!isAppend) return setVar(r, name, value, exported)
  const old = lookup(r, name)
  const isKnown = old?.literal && !value.dynamic
  setVar(r, name, isKnown ? { ...value, text: `${old.text}${value.text}` } : undefined, exported)
}

// A PowerShell value whose text the reading knows as typed. A hashtable (`@{ title = 't' }`) is kept as
// typed: a splat of it is read entry by entry.
function isPsText(v: Word): boolean {
  if (v.expr || v.list) return false
  if (v.literalStart || /^@\{/.test(v.text)) return true
  return /^-?\d+(\.\d+)?$/.test(v.text) || (v.dynamic && /^\$\w+$/.test(v.text))
}

// A PowerShell variable as assigned to: `$m`, `${m}`, or with a scope (`$script:m`, `$global:m`), which
// names the same variable from inside a function or block.
const PS_NAME = /^\$\{?(?:(?:script|global|local|private|variable):)?(\w+)\}?$/i

// PowerShell: a method call on a variable (`$p.Add(...)`, `$p.Remove('Body')`) changes a value after it
// was typed. Assignments are read by `psAssignment`.
function assignPs(w: Word[], r: VarState): boolean {
  const member = /^\$(\w+)[.[]/.exec(w[0]?.text ?? '')
  const changed = member ? lookup(r, member[1] ?? '') : undefined
  if (changed) markChanged(r, member?.[1] ?? '', changed, w)
  return false
}

// A known value changed in place: its text, with the change after it, so a splat of it is read entry by
// entry, and no longer a known string.
function markChanged(r: VarState, name: string, old: Var, w: Word[]) {
  store(r, name, { ...old, text: `${old.text}\n${w.map(x => x.text).join(' ')}`, literal: false })
}

// PowerShell sets an environment variable in three spellings: `$env:X = v`, the `env:` drive
// (`Set-Item env:X v`, `New-Item -Path Env:\X -Value v`) and .NET (`[Environment]::SetEnvironmentVariable('X', v)`).
const ENV_ITEM = /^(set-item|si|new-item|ni|set-content|sc|add-content|ac)$/i
const ENV_PATH = /^env:[\\/]?(\w+)$/i
const DOTNET_ENV = new RegExp(
  // After any casts and a `$x =` that discards the result (`[void][Environment]::...`, `$null = [Environment]::...`).
  String.raw`^(?:\$[\w:{}]+\s*=\s*)?(?:\[[\w.]+\])*\[(?:system\.)?environment\]::setenvironmentvariable\(` +
    String.raw`\s*(['"]?)([^'",]*)\1\s*,\s*([\s\S]*?)\s*(?:,[^)]*)?\)$`,
  'i',
)

/** A PowerShell statement that sets an environment variable through the `env:` drive or .NET, as the
 * `$env:X = v` statement the readers know: `name` undefined when the name is built at run time. */
export function psEnvSet(st: Statement, a?: PsAssignment): { name?: string; statement: Statement } | undefined {
  const words = st.words
  const head = words[0]?.text ?? ''
  let name: string | undefined
  let value: Word | undefined
  const dotnet = DOTNET_ENV.exec(words.map(w => w.text).join(' '))
  const envs = a?.targets.filter(t => t.isEnv) ?? []
  if (a && envs.length > 0) {
    // `$env:X = v`: known only as one quoted string, a number or $null. A command, a list, an expression or
    // a change (`+=`) is not, and with several targets the name is not known either.
    const [only] = a.value
    const isOne = a.targets.length === 1 && a.op === '=' && !a.command && a.value.length === 1 && only
    const isNull = isOne && /^[$]null$/i.test(only.text)
    const isLiteral = isOne && !only.dynamic && (only.literalStart || /^-?[0-9]+$/.test(only.text))
    name = a.targets.length === 1 ? envs[0]?.name : undefined
    value = isNull ? { text: '', dynamic: false, bodies: [] } : isLiteral ? only : undefined
  } else if (dotnet) {
    name = /^\w+$/.test(dotnet[2] ?? '') ? dotnet[2] : undefined
    // The reader drops the quotes: a value is literal when its word started quoted, or is a number or $null.
    const raw = dotnet[3] ?? ''
    const word = words.slice(1).find(w => w.text.replace(/[,)]+$/, '') === raw)
    const isLiteral = Boolean(word?.literalStart) || /^-?[0-9]+$/.test(raw) || /^[$]null$/i.test(raw)
    value = { text: /^[$]null$/i.test(raw) ? '' : raw, dynamic: !isLiteral, bodies: [] }
  } else if (ENV_ITEM.test(head)) {
    const at = words.findIndex(w => /^env:/i.test(w.text) || (w.dynamic && /env:/i.test(w.text)))
    if (at === -1) return undefined
    const path = words[at] as Word
    name = path.dynamic ? undefined : ENV_PATH.exec(path.text)?.[1]
    const flag = words.findIndex(w => /^-value$/i.test(w.text))
    value = flag !== -1 ? words[flag + 1] : words.slice(at + 1).find(w => !w.text.startsWith('-'))
    // An append leaves the value unknown.
    if (value && /^(add-content|ac)$/i.test(head)) value = { ...value, dynamic: true }
  } else return undefined
  const set = value ?? { text: '', dynamic: true, bodies: [] }
  const literal = (text: string): Word => ({ text, dynamic: false, bodies: [] })
  return { name, statement: { ...st, words: [literal(`$env:${name ?? 'UNKNOWN'}`), literal('='), set] } }
}

const OUT_VARS = new RegExp(
  '^-(?:outvariable|ov|errorvariable|ev|warningvariable|wv|informationvariable|iv|pipelinevariable|pv)(?::(.+))?$',
  'i',
)

/** PowerShell's common parameters that store a command's output or errors in a variable (`-ov m`,
 * `-OutVariable:m`, `-ev +e`), any command's: each such variable is unknown after it. */
export function forgetOutVars(st: Statement, r: VarState) {
  st.words.forEach((w, i) => {
    const out = OUT_VARS.exec(w.text)
    const target = out?.[1] ?? (out ? st.words[i + 1]?.text : undefined)
    if (target) setVar(r, target.replace(/^[+]/, ''), undefined)
  })
}

/** One target of a PowerShell assignment: the variable it names (`$p.Body` names `p`), whether it is an
 * environment variable (`$env:X`), and whether it is the whole variable with no cast (`$m`, `${m}`,
 * `$script:m`), the one shape a plain value is known in. */
type PsTarget = { name: string; isEnv: boolean; isPlain: boolean }

/** A PowerShell assignment: its targets, its operator, the words of its value, and `command` when the value
 * runs a command (`$r = git push`, `$r = & $g ...`), as a statement of its own. The reader makes the
 * operator a word of its own (`$r=git` is `$r`, `=`, `git`). */
export type PsAssignment = { targets: PsTarget[]; op: string; value: Word[]; command?: Statement }

export function psAssignment(st: Statement): PsAssignment | undefined {
  const w = st.words
  const at = w.findIndex(isOperator)
  const head = w[0]
  if (at < 1 || st.isCall || !head || head.literalStart || !/^[$[]/.test(head.text)) return undefined
  // `$a, $b = ...` names several; a cast may hold a comma of its own (`[Dictionary[string,int]]$d`).
  const targets = splitTop(w.slice(0, at).map(x => x.text).join(' ')).flatMap(psTarget)
  let value = w.slice(at + 1)
  // A leading `.` or `&` is the call operator.
  const isCall = value[0] !== undefined && !value[0].literalStart && /^[.&]$/.test(value[0].text)
  if (isCall) value = value.slice(1)
  // A bare word first is a command (`git`, `Get-Clipboard`); a quoted string, a number, a variable, a list,
  // an expression, a hashtable or a here-string is a value.
  const f = value[0]
  const isBare = f !== undefined && !(f.literalStart || f.quoted || f.dynamic || f.list || f.expr)
  // A chained assignment (`$a = $b = 1`) is read as an assignment of its own, after the first.
  // A .NET static call (`[IO.File]::WriteAllText(...)`) runs too: it may write a file.
  // So does a method call on a variable (`$xml.Save('b.md')`).
  const isStatic = f !== undefined && /^(\[[\w.]+\]::\w+|\$[\w:]+(\.\w+)+)\(/.test(f.text)
  const isCommand = isCall || isStatic || (isBare && !/^(-?[0-9]|@)/.test(f.text)) || value.some(isOperator)
  const command = isCommand ? { ...st, words: value, inner: [], isCall: isCall || undefined } : undefined
  return { targets, op: w[at]?.text ?? '=', value, command }
}

const isOperator = (w: Word) => !w.literalStart && PS_OPERATOR.test(w.text)

// The text split at its commas outside brackets.
function splitTop(text: string): string[] {
  const parts = ['']
  let depth = 0
  for (const ch of text) {
    if ('[({'.includes(ch)) depth++
    else if ('])}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) parts.push('')
    else parts[parts.length - 1] += ch
  }
  return parts
}

// One target, past its casts and attributes (`[string] $r`, `[ValidateNotNull()][string]$r`).
function psTarget(piece: string): PsTarget[] {
  let text = piece.trim()
  let isCast = false
  while (text.startsWith('[')) {
    let depth = 0
    let end = 0
    for (; end < text.length; end++) {
      if (text[end] === '[') depth++
      else if (text[end] === ']' && --depth === 0) break
    }
    text = text.slice(end + 1).trimStart()
    isCast = true
  }
  const m = /^\$\{?(?:(\w+):)?(\w+)/.exec(text)
  if (!m) return []
  return [{ name: m[2] ?? '', isEnv: /^env$/i.test(m[1] ?? ''), isPlain: !isCast && PS_NAME.test(text) }]
}

/** What a PowerShell assignment does to its variables. A plain value into one whole variable is known (`$m =
 * 'x'`, `$m = @'...'@`, `$m = $other`). A change to one known value keeps its text, changed (`$p += @{...}`,
 * `$p.Body = 'b'`). Anything else (a command, several values, several targets, a cast) leaves each unknown. */
export function assignPsTargets(st: Statement, a: PsAssignment, r: VarState) {
  unsure(st, r, () => {
    const vars = a.targets.filter(t => !t.isEnv)
    const one = a.targets.length === 1 ? vars[0] : undefined
    const [value] = a.value
    const isWhole = one?.isPlain && a.op === '='
    const isPlain = isWhole && !a.command && a.value.length === 1 && value && isPsText(value)
    if (one && isPlain) return setVar(r, one.name, value)
    const old = one && !isWhole && !a.command ? lookup(r, one.name) : undefined
    if (one && old) return markChanged(r, one.name, old, st.words)
    for (const t of vars) setVar(r, t.name, undefined)
  })
}

/** A Bash command that sets an environment variable whose name is built at run time (`export "$k=v"`).
 * PowerShell's spellings are told by `psEnvSet`. `declare -p`, `-f` and `-F` only print. */
export function setsEnvAtRunTime(name: string, args: Word[]): boolean {
  if (!/^(export|declare|typeset)$/.test(name)) return false
  if (name !== 'export' && args.some(a => !a.dynamic && /^-[a-zA-Z]*[pfF]/.test(a.text))) return false
  return args.some(a => a.dynamic && !/^[A-Za-z_]\w*[+]?=/.test(a.text))
}

/** The values of the variables a path names, as they stand where the path is written. */
export function varsIn(path: string, r: VarState): (Var | undefined)[] {
  return [...path.matchAll(/\$\{?([A-Za-z_]\w*)\}?/g)].map(m => lookup(r, m[1] ?? ''))
}

/** A path as the command will use it: variables set earlier filled in; undefined when part of it is built at
 * run time in a way the reading does not know. A path given as text, or a word with no expansion, is
 * literal. */
export function knownPath(path: string | Word, r: VarState): string | undefined {
  if (typeof path === 'string' || !path.dynamic) return typeof path === 'string' ? path : path.text
  const e = expand(path.text, r, path.literals)
  return e.unresolved ? undefined : e.text
}

const IDENT = /[A-Za-z_]\w*/g
// Where a command sets a variable, by its text: `NAME=`, `for NAME`, `printf -v NAME`, the names after
// `read`, `local`, `unset` and the like; in PowerShell `$name =`, `foreach ($name`, `-OutVariable name`
// and `Set-Variable`. A name it counts but does not set only makes the reading stricter.
const BASH_SETS = [
  /(?:^|[^\w$-])([A-Za-z_]\w*)(?:\[[^\]]*\])?\+?=/g,
  /\bfor\s+([A-Za-z_]\w*)/g,
  // `printf -v NAME`, `printf -vNAME`, `read -a NAME`, `read -raNAME`.
  /(?:^|\s)-[a-zA-Z]*[va]\s*['"]?([A-Za-z_]\w*)/g,
]
const BASH_SETTERS = /\b(?:read|mapfile|readarray|unset|export|declare|typeset|local|readonly)\b([^;&|\n]*)/g
const PS_SETS = [
  /\$\{?(?:(?:script|global|local|private|variable):)?([A-Za-z_]\w*)\}?\s*(?:[-+*/%]|\?\?)?=(?!=)/gi,
  // Each target of a list (`$m, $n = ...`), and the `variable:` drive (`Set-Item variable:m`).
  /\$\{?(?:(?:script|global|local|private|variable):)?([A-Za-z_]\w*)\}?\s*,/gi,
  /\bvariable:([A-Za-z_]\w*)/gi,
  new RegExp(String.raw`-(?:outvariable|ov|errorvariable|ev|warningvariable|wv|informationvariable|iv|` +
    String.raw`pipelinevariable|pv)[:\s]+\+?([A-Za-z_]\w*)`, 'gi'),
  /\bforeach\s*\(\s*\$([A-Za-z_]\w*)/gi,
]
const PS_SETTERS = /\b(?:set-variable|new-variable|sv|nv)\b([^;|\n]*)/gi

/** How many times the command sets each name, by its text (lower-cased in PowerShell). A deferred statement
 * (a trap action, a function body) reads a variable when it runs: one set more than once may hold another
 * value by then. */
export function setCounts(command: string, ps: boolean): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (name: string) => {
    const key = ps ? name.toLowerCase() : name
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const re of ps ? PS_SETS : BASH_SETS) for (const m of command.matchAll(re)) add(m[1] ?? '')
  for (const m of command.matchAll(ps ? PS_SETTERS : BASH_SETTERS))
    for (const name of (m[1] ?? '').match(IDENT) ?? []) add(name)
  return counts
}

/** A Bash builtin that sets a variable whose name is built at run time (`printf -v "$v"`, `read -r "$v"`,
 * `local "$v=x"`, `unset "$v"`): it may set any variable, `IFS` included. */
export function setsNameAtRunTime(name: string, args: Word[]): boolean {
  // `printf -v "$v"`, `printf -v"$v"`, `read -ra"$v"`: a name given to an option, spaced or attached.
  const v = args.findIndex(a => a.text === '-v')
  const isAttached = args.some(a => a.dynamic && /^-[a-zA-Z]*[va]/.test(a.text))
  if (name === 'printf') return isAttached || (v !== -1 && Boolean(args[v + 1]?.dynamic))
  if (name === 'read' && isAttached) return true
  if (!/^(read|mapfile|readarray|unset|local|readonly|declare|typeset|export)$/.test(name)) return false
  return args.some(a => a.dynamic && !a.text.startsWith('-') && !/^[A-Za-z_]\w*\+?=/.test(a.text))
}

/** A PowerShell statement that may set a variable whose name the reading does not know: `Set-Variable`, `sv`,
 * `New-Variable` or `nv` given a name built at run time, the `variable:` drive under one (`Set-Item
 * "variable:$n"`), or a `[ref]$m`, through which a later write changes `$m` unseen. */
export function psSetsUnknown(st: Statement, name: string, args: Word[]): boolean {
  if (st.words.some(w => /\[ref\]\s*\$/i.test(w.text))) return true
  if (/^(set-item|si|new-item|ni|set-content|sc|add-content|ac)$/i.test(name))
    return args.some(a => a.dynamic && /variable:/i.test(a.text))
  if (!/^(set-variable|sv|new-variable|nv)$/i.test(name)) return false
  const flag = args.findIndex(a => /^-n(a(m(e)?)?)?$/i.test(a.text))
  const target = flag === -1 ? args.find(a => !a.text.startsWith('-')) : args[flag + 1]
  return Boolean(target?.dynamic)
}
