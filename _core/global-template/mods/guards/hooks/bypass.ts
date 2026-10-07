// The routes around the attribution check, refused outright whatever the message says: history rewrites,
// skipped git hooks, `--trailer`, a reused commit message and lefthook switched off (`eval` is judged by
// the reading, in inspect.ts). Each one rewrites, hides or skips the text the check reads. They are read
// from the statement as the shell reader parsed it, so a message that names a flag, a quote the reader
// unescapes or a here-doc body never trips them, and a word like `commit` counts only as git's
// subcommand. Pure.

import { COMMIT } from './specs'
import type { Statement, Word } from './shell'

const HISTORY_REWRITE = 'history rewriting tools (git filter-repo, git filter-branch) are not allowed from a session.'
const HOOK_SKIP = 'skipping git hooks (--no-verify, commit -n, a hooks setting) is not allowed.'
const TRAILER = '--trailer is not allowed; write the message body directly.'
const REUSE = "reusing another commit's message (-C, -c, --reuse-message, --reedit-message) cannot be read."
export const EVAL = 'eval builds the command at run time, so its message cannot be read.'
const LEFTHOOK = 'disabling lefthook removes the commit-msg attribution check.'

// git's global options that take the next word as their value; the subcommand comes after them.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
// Subcommands that run git's hooks or write history: a hooks setting passed to one of them skips them.
const HOOKED = new Set(['commit', 'merge', 'push', 'am', 'rebase', 'cherry-pick', 'revert', 'tag', 'notes'])
const HOOKS_KEY = /^(core\.hookspath|hooks\.)/i
const CONFIG_WRITES = /^--(unset|unset-all|replace-all|add)$/
// Words that may stand before an assignment the shell applies to the command (`env LEFTHOOK=0 git ...`).
const ASSIGN_LEAD = /^[A-Za-z_]\w*=|^(env|export|sudo|declare|local|typeset|readonly)$/

/** git's subcommand and the global `-c key=value` settings before it. */
function gitParts(args: Word[]): { sub: string; rest: Word[]; settings: string[] } {
  const settings: string[] = []
  let k = 0
  while (k < args.length) {
    const t = args[k]?.text ?? ''
    if (GIT_VALUE_OPTIONS.has(t)) {
      if (t === '-c') settings.push(args[k + 1]?.text ?? '')
      k += 2
    } else if (t.startsWith('-')) k++
    else break
  }
  return { sub: args[k]?.text ?? '', rest: args.slice(k + 1), settings }
}

// A `git commit` flag: `-n` alone or in a bundle before the first letter that takes a value, `--trailer`,
// or a message taken from another commit.
// A flag's value is skipped, so a message that starts with a dash (`-m "-n is fine"`) is never a flag.
function commitReason(rest: Word[]): string | undefined {
  for (let i = 0; i < rest.length; i++) {
    const text = rest[i]?.text ?? ''
    if (text === '--') break
    if (text === '--trailer' || text.startsWith('--trailer=')) return TRAILER
    if (/^--(reuse|reedit)-message(=|$)/.test(text)) return REUSE
    if (text.startsWith('--')) {
      const kind = COMMIT[text]
      if (kind && kind !== 'attached') i++
      continue
    }
    if (!/^-[A-Za-z]/.test(text)) continue
    for (let j = 1; j < text.length; j++) {
      const letter = text[j] as string
      if (letter === 'n') return HOOK_SKIP
      if (letter === 'C' || letter === 'c') return REUSE
      const kind = COMMIT[`-${letter}`]
      if (!kind) continue
      // A letter that takes a value takes the rest of the word, or the next word when it is last.
      if (kind !== 'attached' && j === text.length - 1) i++
      break
    }
  }
  return undefined
}

// `git config core.hooksPath x` (or `--unset`): a setting that moves or drops the hooks. Reading it passes.
function configReason(rest: Word[]): string | undefined {
  const keys = rest.filter(w => !w.text.startsWith('-')).map(w => w.text)
  const isWrite = keys.length >= 2 || rest.some(w => CONFIG_WRITES.test(w.text))
  return isWrite && HOOKS_KEY.test(keys[0] ?? '') ? HOOK_SKIP : undefined
}

function gitReason(args: Word[]): string | undefined {
  const { sub, rest, settings } = gitParts(args)
  if (sub === 'filter-repo' || sub === 'filter-branch') return HISTORY_REWRITE
  if (sub === 'config') return configReason(rest)
  if (!HOOKED.has(sub)) return undefined
  if (settings.some(s => HOOKS_KEY.test(s))) return HOOK_SKIP
  if (rest.some(w => w.text === '--no-verify')) return HOOK_SKIP
  return sub === 'commit' ? commitReason(rest) : undefined
}

// `LEFTHOOK=0` applied to a command or exported, `$env:LEFTHOOK = 0` in PowerShell, or `lefthook uninstall`.
function lefthookReason(st: Statement, name: string, args: Word[]): string | undefined {
  if (name === 'lefthook' && args[0]?.text === 'uninstall') return LEFTHOOK
  const words = st.words.map(w => w.text)
  const ps = /^\$env:LEFTHOOK$/i.test(words[0] ?? '') && words[1] === '=' && words[2] === '0'
  if (ps || /^\$env:LEFTHOOK=0$/i.test(words[0] ?? '')) return LEFTHOOK
  for (const text of words) {
    if (/^LEFTHOOK=0$/i.test(text)) return LEFTHOOK
    if (!ASSIGN_LEAD.test(text)) break
  }
  return undefined
}

/** The reason to refuse one statement as a route around the check, or undefined. */
export function bypassOf(st: Statement, name: string, args: Word[]): string | undefined {
  return lefthookReason(st, name, args) ?? (name === 'git' ? gitReason(args) : undefined)
}
