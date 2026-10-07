// Variables a command sets and reads back. Each value is kept with where it was set (a Bash subshell, a
// `$(...)`, a child shell), so a later read finds it exactly where the shell would: inside that place
// and the ones it opens, and gone once it closes. A child shell (`bash -c`) sees only exported values.
// Pure.

import type { Word } from './shell'

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
}

/** A place inside `outer`: `tag` alone at the top. */
export function within(outer: string, tag: string | undefined): string {
  return outer && tag ? `${outer}/${tag}` : outer || tag || ''
}

/** Sets a variable where the statement being read runs; a value it cannot read (none given) is unknown. */
export function setVar(r: VarState, name: string, value: Word | undefined, exported = false) {
  const scope = r.scope
  if (!value) return store(r, name, { text: '', literal: false, scope }, exported)
  if (!value.dynamic) return store(r, name, { text: value.text, literal: true, scope }, exported)
  const held = catValue(value, r)
  if (held) return store(r, name, { ...held, scope }, exported)
  const e = expand(value.text, r)
  store(r, name, { text: e.unresolved ? value.text : e.text, literal: !e.unresolved, scope }, exported)
}

/** A file printed by `cat` or `Get-Content` inside `$(...)`: its path is in the first group that matched. */
export const CAT_FILE =
  /(?:\$|^)\(\s*(?:cat|Get-Content|gc)(?:\s+-Raw)?\s+(?:"([^"$]+)"|'([^']+)'|([^\s)$]+))(?:\s+-Raw)?\s*\)/i
const CAT_HEREDOC = /^\$\(\s*cat\s+<<-?[ \t]*(['"]?)[A-Za-z_][\w.-]*\1[^\n]*\n[\s\S]*\)$/

// A value that is wholly one `$(cat ...)`: a here-doc's text (filled in when its delimiter is bare), or a
// file the reading can read.
function catValue(value: Word, r: VarState): { text: string; literal: boolean; file?: string } | undefined {
  const doc = CAT_HEREDOC.exec(value.text)
  const body = value.bodies[0]
  if (doc && value.bodies.length === 1 && body !== undefined) {
    const e = doc[1] ? { text: body, unresolved: false } : expandBody(body, r)
    return { text: e.unresolved ? body : e.text, literal: !e.unresolved }
  }
  const file = CAT_FILE.exec(value.text)
  if (!file || file.index !== 0 || file[0].length !== value.text.length) return undefined
  return { text: value.text, literal: false, file: file[1] ?? file[2] ?? file[3] }
}

/** Keeps `v` as the variable's value in its scope; a variable once exported stays exported. */
export function store(r: VarState, name: string, v: Var, exported = false) {
  const key = name.toLowerCase()
  const stack = r.vars.get(key) ?? []
  const old = stack.findIndex(x => x.scope === v.scope)
  if (old !== -1) v.exported ||= stack.splice(old, 1)[0]?.exported
  v.exported ||= exported
  stack.push(v)
  r.vars.set(key, stack)
}

/** The variable as the statement being read sees it, or undefined. */
export function lookup(r: VarState, name: string): Var | undefined {
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
  let isOther = /\$\(|^[<>]?\(|@[({]/.test(text) || (!r.ps && text.includes('`'))
  const files: string[] = []
  const out = text.replace(SUBSTITUTION, ' ').replace(/\$\{?([A-Za-z_]\w*)\}?/g, (_, name: string) => {
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
