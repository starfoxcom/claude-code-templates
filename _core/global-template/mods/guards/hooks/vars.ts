// Variables a command sets and reads back. Each value is kept with where it was set (a Bash subshell, a
// `$(...)`, a child shell), so a later read finds it exactly where the shell would: inside that place
// and the ones it opens, and gone once it closes. A child shell (`bash -c`) sees only exported values.
// Pure.

import type { Statement, Word } from './shell'

/** A variable's value: `literal` when it is known, `scope` where it was set, `exported` when a child shell
 * sees it too, `file` the file whose text it holds (`$(cat b.md)`). */
export type Var = { text: string; literal: boolean; scope: string; exported?: boolean; file?: string }

/** What the reading knows of variables at the statement it reads. */
export type VarState = {
  /** Every value set so far by lower-cased name, one per scope, most recent last. */
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
  const e = expand(value.text, r)
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
export function store(r: VarState, name: string, v: Var, exported = false) {
  const key = name.toLowerCase()
  if (r.isLater) (r.volatile ??= new Set()).add(key)
  // Set in a branch: known inside it, and unknown where the branch sits, first, so the value inside wins.
  const base = branchBase(v.scope)
  if (base !== v.scope) put(r, key, { text: '', literal: false, scope: base, exported: exported || v.exported })
  put(r, key, v, exported)
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
  if (r.isSourced || r.volatile?.has(name.toLowerCase())) return undefined
  const stack = r.vars.get(name.toLowerCase()) ?? []
  for (let i = stack.length - 1; i >= 0; i--) {
    const v = stack[i] as Var
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

/** A value with its variables replaced by what the command set them to. */
export function expand(text: string, r: VarState): Expanded {
  // Only `$NAME` and a plain `${NAME}` are filled in: any other `${...}` (`${!X}`, `${X:-y}`, `${X[@]}`)
  // and Bash's special parameters (`$@`, `$1`) are built at run time.
  const special = r.ps ? /\$\{(?![A-Za-z_]\w*\})/ : /\$\{(?![A-Za-z_]\w*\})|\$[@*#?$!0-9-]/
  let isOther = /\$\(|^[<>]?\(|@[({]/.test(text) || (!r.ps && text.includes('`')) || special.test(text)
  const files: string[] = []
  const out = text.replace(SUBSTITUTION, ' ').replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (_, b, n) => {
    const name = (b ?? n) as string
    const v = lookup(r, name)
    if (v?.literal) return v.text
    if (v?.file) files.push(v.file)
    else isOther = true
    return ' '
  })
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
  const words = st.words.flatMap((w, i) => {
    // A PowerShell statement starting with a variable assigns to it or calls a member, unless `&` runs it.
    // A PowerShell expression (`$o.Trim()`) computes its value: filling in the variable alone is wrong text.
    if (!w.dynamic || w.expr || (r.ps && i === 0 && !st.isCall)) return [w]
    const e = expand(w.text, r)
    const splits = !r.ps && w.splits === true
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
  // PowerShell's common parameters that store a command's output or errors in a variable, any command's.
  if (r.ps) {
    st.words.forEach((w, i) => {
      const out = OUT_VARS.exec(w.text)
      const target = out?.[1] ?? (out ? st.words[i + 1]?.text : undefined)
      if (target) setVar(r, target.replace(/^[+]/, ''), undefined)
    })
  }
  if (PRINTS.test(name)) return
  if (name === 'source' || name === '.' || st.isSourced) r.isSourced = true
  unsure(st, r, () => {
    for (const w of st.words) {
      const m = (r.ps ? /^\$?(?:variable:)?([A-Za-z_]\w*)$/i : /^([A-Za-z_]\w*)(?:\+?=|\[|$)/).exec(w.text)
      if (m && !w.dynamic) setVar(r, m[1] ?? '', undefined)
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
    const value = m[2] ? undefined : { ...(lead[i] as Word), text: t.slice(m[0].length) }
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
    for (const a of pairs) {
      const m = /^([A-Za-z_]\w*)(\+?)=/.exec(a.text)
      if (m) setPair(r, m[1] ?? '', { ...a, text: a.text.slice(m[0].length) }, Boolean(m[2]), isExport, changes)
      else if (name === 'export')
        for (const v of r.vars.get(a.text.toLowerCase()) ?? []) v.exported = isExport
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

// PowerShell: `$m = ...`; `$p += @{...}`, `$p.Body = ...`, `$p['Body'] = ...`, `$p.Add(...)`: a value
// changed after it was typed is no longer known.
function assignPs(w: Word[], r: VarState): boolean {
  const spaced = PS_NAME.exec(w[0]?.text ?? '')
  if (spaced && w[1]?.text === '=') {
    // Known only as one string, a here-string, a number or another variable. A bare word is a command
    // (`$m = Get-Date`), a list (`'a','b'`, `@(...)`) several values, an expression (`'x'.Trim()`) computed.
    const value = w.length === 3 ? w[2] : undefined
    setVar(r, spaced[1] ?? '', value && isPsText(value) ? value : undefined)
    return true
  }
  const isCompound = spaced !== null && /^([-+*/%]|\?\?)=$/.test(w[1]?.text ?? '')
  const member = isCompound ? spaced : /^\$(\w+)[.[]/.exec(w[0]?.text ?? '')
  const changed = member ? lookup(r, member[1] ?? '') : undefined
  // A fresh value, so a statement that kept the old one sees the change.
  const text = `${changed?.text ?? ''}\n${w.map(x => x.text).join(' ')}`
  if (changed) store(r, member?.[1] ?? '', { ...changed, text, literal: false })
  else if (isCompound) setVar(r, spaced?.[1] ?? '', undefined)
  const joined = w.length === 1 ? /^\$(\w+)=([\s\S]*)$/.exec(w[0]?.text ?? '') : null
  if (joined && w[0]?.expr) setVar(r, joined[1] ?? '', undefined)
  else if (joined) setVar(r, joined[1] ?? '', { ...(w[0] as Word), text: joined[2] ?? '' })
  return Boolean(joined) || isCompound
}

// PowerShell sets an environment variable in three spellings: `$env:X = v`, the `env:` drive
// (`Set-Item env:X v`, `New-Item -Path Env:\X -Value v`) and .NET (`[Environment]::SetEnvironmentVariable('X', v)`).
const ENV_ITEM = /^(set-item|si|new-item|ni|set-content|sc|add-content|ac)$/i
const ENV_PATH = /^env:[\\/]?(\w+)$/i
const DOTNET_ENV = new RegExp(
  String.raw`^\[(?:system\.)?environment\]::setenvironmentvariable\(` +
    String.raw`\s*(['"]?)([^'",]*)\1\s*,\s*([\s\S]*?)\s*(?:,[^)]*)?\)$`,
  'i',
)

/** A PowerShell statement that sets an environment variable through the `env:` drive or .NET, as the
 * `$env:X = v` statement the readers know: `name` undefined when the name is built at run time. */
export function psEnvSet(st: Statement): { name?: string; statement: Statement } | undefined {
  const words = st.words
  const head = words[0]?.text ?? ''
  let name: string | undefined
  let value: Word | undefined
  const dotnet = DOTNET_ENV.exec(words.map(w => w.text).join(' '))
  if (dotnet) {
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
const PS_TYPED = /^\[[\w.]+(?:\[\])?\]\$(\w+)$/

/** A PowerShell assignment whose value is a command (`$r = git push 2>&1`, `[string]$r += gh pr ...`): the
 * variable, set unknown, and the command as a statement of its own, to be read in turn. A typed target with
 * a plain value only sets its variable unknown. */
export function psAssignedCommand(st: Statement, r: VarState): { command?: Statement } | undefined {
  const w = st.words
  const plain = PS_NAME.exec(w[0]?.text ?? '')?.[1]
  const name = plain ?? PS_TYPED.exec(w[0]?.text ?? '')?.[1]
  if (!name || !/^([-+*/%]|[?][?])?=$/.test(w[1]?.text ?? '')) return undefined
  let tail = w.slice(2)
  // A leading `.` or `&` there is the call operator.
  const isCall = !tail[0]?.literalStart && /^[.&]$/.test(tail[0]?.text ?? '')
  if (isCall) tail = tail.slice(1)
  const first = tail[0]
  const isValue = first && (first.dynamic || first.literalStart || first.list || first.expr || isPsText(first))
  const isPlainValue = !isCall && tail.length <= 1 && (isValue || !first)
  if (plain && isPlainValue) return undefined
  setVar(r, name, undefined)
  if (isPlainValue) return {}
  return { command: { ...st, words: tail, inner: [], isCall: isCall || undefined } }
}

/** A Bash command that sets an environment variable whose name is built at run time (`export "$k=v"`).
 * PowerShell's spellings are told by `psEnvSet`. */
export function setsEnvAtRunTime(name: string, args: Word[]): boolean {
  return /^(export|declare|typeset)$/.test(name) && args.some(a => a.dynamic && !/^[A-Za-z_]\w*[+]?=/.test(a.text))
}
