// How the words of a git or gh call are read where they decide what it does: tag and branch flags that
// list instead of creating, a commit that takes the working tree, a `-c` setting that may move the hooks,
// and words built at run time that may become flags. Pure.

import { programOf } from './programs'
import type { Statement, Word } from './shell'
import { COMMIT, GH_WRITES, gitLong, RAW_WRITES } from './specs'
import { setsEnvAtRunTime } from './vars'

// A `-c` setting built at run time that may move the hooks or run commands: its key is, or it is a hooks
// path, an alias or an include whose value is. `user.name=$N` changes no such thing.
export function isUnknownSetting(w: Word | undefined): boolean {
  if (!w?.dynamic) return false
  const key = w.text.split('=')[0] ?? ''
  return /[$`(]/.test(key) || /^(core\.hookspath|hooks\.|alias\.|include)/i.test(key)
}

// `git tag` flags that list, verify or delete instead of creating a tag.
export const TAG_READS = /^-[ldv]$|^-n\d*$|^--(list|delete|verify|contains|no-contains|points-at|merged|no-merged)(=|$)/

// `git branch` flags that list, delete or configure instead of creating a branch.
const BRANCH_NOT_CREATE = new RegExp(
  '^-[dDlarvu]|^--(' +
    'delete|list|all|remotes|show-current|contains|no-contains|merged|no-merged|points-at|sort|format|column|' +
    'ignore-case|omit-empty|set-upstream|unset-upstream|edit-description' +
    ')',
)

// `git branch <name>` creates one (a rename or copy names the new one last); listing flags create none.
export function branchesOf(rest: Word[]): Word[] {
  const flags = rest.filter(a => a.text.startsWith('-')).map(a => gitLong('branch', a.text))
  const names = rest.filter(a => !a.text.startsWith('-'))
  if (flags.some(f => /^-(m|M|c|C)$|^--(move|copy)$/.test(f))) return names.slice(-1)
  return flags.some(f => BRANCH_NOT_CREATE.test(f)) ? [] : names.slice(0, 1)
}

// `-a` in a bundle counts only before the first letter that takes a value: in `-Sabc` or `-uall` it is
// part of that value, read the same way `walk` reads the bundle.
export function isCommitAll(text: string): boolean {
  if (gitLong('commit', text) === '--all') return true
  if (!/^-[A-Za-z]/.test(text)) return false
  for (const letter of text.slice(1)) {
    if (letter === 'a') return true
    if (!/[A-Za-z]/.test(letter) || COMMIT[`-${letter}`]) return false
  }
  return false
}

// A word the shell splits into more words at run time, which may carry options.
export const splitsAt = (w: Word | undefined) => Boolean((w?.dynamic && w.splits) || w?.list || w?.expr)

// A PowerShell splat (`@a`) hands over the items of a list: any words at all.
export const isSplat = (w: Word | undefined, ps: boolean) => Boolean(ps && w && /^@\w/.test(w.text))

// A call as the write patterns read it. A `;`, `&`, `|` or line break inside a quoted word is text there,
// never the end of the call (`git -c 'x=!f() { a; }; f' push`).
export const lineOf = (name: string, args: Word[]) =>
  [name, ...args.map(a => a.text.replace(/[|;&\n]/g, ' '))].join(' ')

// A word built at run time that the program may read as a flag: split by the shell, or starting with an
// expansion or a dash.
export const mayBeFlag = (w: Word) =>
  w.list === true || w.expr === true || (w.dynamic && (w.splits === true || /^[-$`(]/.test(w.text)))


// A git alias, a config include or another config file the command sets may turn any later git call into a
// write that skips the hooks (`git -c alias.ci="commit --no-verify" ci`, `GIT_CONFIG_GLOBAL=x git commit`).
// Read only where git reads a setting: a `-c` or `--config-env` value, a `git config` key, and an assignment
// to a config variable (in front of the program, or through `export`).
const CONFIG_KEY = /^(alias|include|includeif)\./i
const CONFIG_ENV = /^GIT_CONFIG(_GLOBAL|_SYSTEM|_PARAMETERS|_COUNT|_KEY_\d+|_VALUE_\d+)?(\+?=|$)/i
const CONFIG_READS =
  /^(--(get|get-all|get-regexp|get-urlmatch|get-color|get-colorbool|list|show-origin|show-scope)|-l|get|list)$/

export function setsGitConfig(st: Statement, name: string, args: Word[], ps: boolean): boolean {
  // PowerShell sets one through `$env:` or the `env:` drive.
  if (ps && name !== 'git') return st.words.some(w => /^\$?env:GIT_CONFIG/i.test(w.text))
  const lead = name ? st.words.slice(0, st.words.length - args.length - 1) : st.words
  const exported = /^(export|declare|typeset|local|readonly)$/.test(name) ? args : []
  if ([...lead, ...exported].some(w => CONFIG_ENV.test(w.text))) return true
  return name === 'git' && gitSetsConfig(args)
}

function gitSetsConfig(args: Word[]): boolean {
  let k = 0
  for (; k < args.length && (args[k]?.text ?? '').startsWith('-'); k++) {
    const t = args[k]?.text ?? ''
    const attached = t.startsWith('--config-env=') ? t.slice(13) : undefined
    const value = /^(-c|--config-env)$/.test(t) ? args[++k]?.text : attached
    if (value !== undefined && CONFIG_KEY.test(value)) return true
    if (value === undefined && GIT_GLOBAL_VALUES.test(t)) k++
  }
  if (args[k]?.text !== 'config') return false
  const rest = args.slice(k + 1)
  const isKey = (w: Word) => !w.text.startsWith('-') && CONFIG_KEY.test(w.text)
  return !rest.some(w => CONFIG_READS.test(w.text)) && rest.some(isKey)
}

// git's global options that take the next word as their value, and the subcommands that write history or
// run its hooks.
const GIT_GLOBAL_VALUES = /^(-C|-c|--git-dir|--work-tree|--namespace|--config-env|--attr-source|--super-prefix)$/
const GIT_WRITE_SUBS =
  /^(commit|commit-tree|merge|push|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace)$/
// A word that may become several words, or any word at all, at run time.
const isMany = (w: Word | undefined, ps: boolean) => splitsAt(w) || isSplat(w, ps)

// git's subcommand, told from the words as parsed: a write word inside a `$(...)` or a path is not one
// (`git diff $(git merge-base a b)`, `git log -- docs/commit-format.md`). A word built at run time where
// the subcommand or a global option sits may make any call of it, so the call counts as a write.
function gitWrites(args: Word[], ps: boolean): boolean {
  let k = 0
  while (k < args.length) {
    const w = args[k] as Word
    if (w.dynamic || isMany(w, ps)) return true
    if (!w.text.startsWith('-')) return GIT_WRITE_SUBS.test(w.text)
    if (GIT_GLOBAL_VALUES.test(w.text) && isMany(args[k + 1], ps)) return true
    k += GIT_GLOBAL_VALUES.test(w.text) ? 2 : 1
  }
  return false
}

// gh's group and action as parsed. Only the groups that write have actions that do; `gh api` writes when it
// names a writing method or sends fields, and a word that may turn into a flag may be either.
function ghWrites(args: Word[], ps: boolean): boolean {
  let group: string | undefined
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as Word
    if (group === 'api') {
      const rest = args.slice(i)
      const known = rest.filter(a => !a.dynamic)
      return rest.some(a => isMany(a, ps) || mayBeFlag(a)) || RAW_WRITES[2]?.test(lineOf('gh api', known)) === true
    }
    if (isMany(w, ps)) return true
    if (/^(-R|--repo)$/.test(w.text)) {
      if (isMany(args[++i], ps)) return true
    } else if (w.dynamic && !w.text.startsWith('--repo=')) return true
    else if (w.text.startsWith('-')) continue
    else if (group === undefined) {
      group = w.text
      if (!GH_WRITES[group] && group !== 'api') return false
    } else return GH_WRITES[group]?.includes(w.text) === true
  }
  return false
}

/** Whether a git or gh call writes history, from its subcommand as parsed. */
export const writesHistory = (name: string, args: Word[], ps: boolean) =>
  name === 'git' ? gitWrites(args, ps) : name === 'gh' && ghWrites(args, ps)

/** Whether words handed to a program named at run time may write as git's or gh's: as its arguments, or
 * after a `git` or `gh` among them (`$SUDO git push`). */
export const writesAsAny = (args: Word[], ps: boolean) =>
  writesHistory('git', args, ps) ||
  writesHistory('gh', args, ps) ||
  args.some((a, i) => /^(git|gh)$/.test(a.text) && writesHistory(a.text, args.slice(i + 1), ps))

// The `$(...)` and backtick parts of a word, two levels deep.
const SUBSTITUTIONS = /\$\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|`[^`]*`/g

/** Whether the statements of an `eval` text the reading cannot fill in may write history: a git or gh call
 * by its subcommand, a program named at run time by its words, and any other by the write patterns on its
 * words, `$(...)` parts left out (each one is a statement of its own, checked in turn). */
export function evalWrites(statements: Statement[], ps: boolean): boolean {
  return statements.some(st => {
    const { name, args } = programOf(st)
    const head = st.words[st.words.length - args.length - 1]
    const known = args.map(a => (a.dynamic ? { ...a, text: a.text.replace(SUBSTITUTIONS, ' ') } : a))
    const writes = /^(git|gh)$/.test(name)
      ? writesHistory(name, args, ps)
      : head?.dynamic
        ? writesAsAny(args, ps)
        : RAW_WRITES.some(re => re.test(lineOf(name, known)))
    return writes || evalWrites(st.inner, ps)
  })
}

// cmd fills in `%NAME%` before it splits a line, so the value may be whole commands; `!NAME!` (delayed
// expansion) fills in a word. It splits at `&` and `|` outside double quotes only, and drops `^`.
const CMD_VAR = /%[^%]+%/
const CMD_GIT = /^(?:.*[\\/])?(git|gh)(?:\.exe|\.cmd|\.bat)?$/i

/** Whether a cmd script line may run a git or gh write. */
export function cmdWrites(line: string): boolean {
  if (!/\b(git|gh)\b/i.test(line)) return false
  if (CMD_VAR.test(line)) return true
  const parts = (line.replace(/\^/g, '').match(/("[^"]*"?|[^"&|])+/g) ?? []).map(p => p.match(/("[^"]*"?|\S)+/g) ?? [])
  return parts.some(tokens => {
    // A bracket of a block or a leading `@` (echo off) is cmd's, not the word's.
    const text = (t: string) => t.replace(/"/g, '').replace(/^[(@]+|\)+$/g, '')
    const words = tokens.map(t => ({ text: text(t), dynamic: t.includes('!'), bodies: [] }))
    return words.some((w, i) => {
      const name = CMD_GIT.exec(w.text)?.[1]?.toLowerCase()
      return name !== undefined && writesHistory(name, words.slice(i + 1), false)
    })
  })
}

/** What the reading carries from statement to statement for `builtReasons`. */
export type BuiltState = { ps: boolean; isConfigMoved?: boolean; isEnvUnknown?: boolean }

/** The words of a git or gh call that the shell builds at run time, and the git settings and environment
 * names the command changes: why the call is unread, if it is. Updates `state` for the statements after. */
export function builtReasons(st: Statement, name: string, args: Word[], state: BuiltState): string[] {
  const reasons: string[] = []
  // In a git or gh call that writes, a word the shell splits at run time may become any options at all
  // (`--no-verify`, `--git-dir=...`, a flag the spec does not list): the call cannot be read. Whether it
  // writes is told from its subcommand, never from a write word inside a `$(...)` or a path.
  // After a literal `--` every word is a path, whatever it splits into.
  const ends = args.findIndex(a => !a.dynamic && a.text === '--')
  const flags = ends === -1 ? args : args.slice(0, ends)
  // PowerShell's `--%` passes the rest of the line raw, with `%NAME%` filled in from the environment.
  const isRaw = state.ps && args.some(a => a.text === '--%')
  // Raw mode hides even the subcommand (`git --% %S% -m x`), so any git or gh call in it is unread.
  if (/^(git|gh)$/.test(name) && (isRaw || (flags.some(splitsAt) && writesHistory(name, args, state.ps))))
    reasons.push('a word built at run time')
  // Once the command sets a git alias, include or config file, any git call may be a write the reading
  // cannot follow (`git -c alias.ci="commit --no-verify" ci`).
  state.isConfigMoved ||= setsGitConfig(st, name, args, state.ps)
  if (state.isConfigMoved && name === 'git') reasons.push('a git setting built at run time')
  // An environment variable named at run time may be any (`LEFTHOOK`, `GIT_DIR`): later git and gh calls.
  state.isEnvUnknown ||= !state.ps && setsEnvAtRunTime(name, args)
  if (state.isEnvUnknown && /^(git|gh)$/.test(name)) reasons.push('an environment variable named at run time')
  return reasons
}
