// Variables a command sets and reads back. Each value is kept with where it was set (a Bash subshell, a
// `$(...)`, a child shell), so a later read finds it exactly where the shell would: inside that place
// and the ones it opens, and gone once it closes. A child shell (`bash -c`) sees only exported values.
// Pure.

import type { Word } from './shell'

/** A variable's value: `literal` when it is known, `scope` where it was set, `exported` when a child shell
 * sees it too. */
export type Var = { text: string; literal: boolean; scope: string; exported?: boolean }

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
  const e = expand(value.text, r)
  store(r, name, { text: e.unresolved ? value.text : e.text, literal: !e.unresolved, scope }, exported)
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

/** A value with its variables replaced by what the command set them to; `unresolved` when any part is
 * built at run time in a way the reading does not know. */
export function expand(text: string, r: VarState): { text: string; unresolved: boolean } {
  let unresolved = /\$\(|^[<>]?\(|@[({]/.test(text) || (!r.ps && text.includes('`'))
  const out = text.replace(SUBSTITUTION, ' ').replace(/\$\{?([A-Za-z_]\w*)\}?/g, (_, name: string) => {
    const v = lookup(r, name)
    if (v?.literal) return v.text
    unresolved = true
    return ' '
  })
  return { text: out, unresolved }
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
