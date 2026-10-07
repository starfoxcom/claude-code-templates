// The routes around the attribution check, refused outright whatever the message says: history rewrites,
// skipped git hooks, `--trailer`, a reused commit message and lefthook switched off (`eval` is judged by
// the reading, in inspect.ts). Each one rewrites, hides or skips the text the check reads. They are read
// from the statement as the shell reader parsed it, so a message that names a flag, a quote the reader
// unescapes or a here-doc body never trips them, and a word like `commit` counts only as git's
// subcommand. Pure.

import { COMMIT, gitLong, MESSAGE, NOTES } from './specs'
import type { Spec } from './specs'
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
// Dropping or renaming a whole section takes its hooks setting with it (`--remove-section core`).
const SECTION_DROPS = /^(--)?(remove|rename)-section$/
const HOOKS_SECTION = /^(core|hooks)(\.|$)/i
// `git config` flags whose next word is their value, and the subcommand words of git 2.46+ (`config set`).
const CONFIG_VALUE_FLAGS = /^(-f|--file|--blob|-t|--type|--default|--comment|--value)$/
const CONFIG_VERBS = /^(set|unset|unset-all|replace-all|add)$/
// A hooks setting passed through the environment: `GIT_CONFIG_PARAMETERS`, or `GIT_CONFIG_KEY_<n>`.
const ENV_HOOKS = /^(GIT_CONFIG_PARAMETERS=.*(core\.hookspath|hooks\.)|GIT_CONFIG_KEY_\d+=(core\.hookspath|hooks\.))/i
// Lefthook skips every hook with `LEFTHOOK=0` or `false`, and named ones with `LEFTHOOK_EXCLUDE`.
const LEFTHOOK_OFF = /^(LEFTHOOK=(0|false)|LEFTHOOK_EXCLUDE=.*)$/i
// Package runners that start a tool by name (`npx lefthook uninstall`, `pnpm exec lefthook ...`).
const RUNNERS = /^(npx|pnpx|bunx|pnpm|yarn|bun|npm)$/
const LEFTHOOK_TOOL = /^(@evilmartians\/)?lefthook(@\S*)?$/

// Builtins whose arguments are the assignments themselves (`export LEFTHOOK=0`, `declare -x LEFTHOOK=0`).
const ASSIGNS = /^(export|declare|local|typeset|readonly)$/

/** git's subcommand and the global `-c key=value` settings before it. */
function gitParts(args: Word[]): { sub: string; rest: Word[]; settings: string[] } {
  const settings: string[] = []
  let k = 0
  while (k < args.length) {
    const t = args[k]?.text ?? ''
    if (GIT_VALUE_OPTIONS.has(t)) {
      if (t === '-c') settings.push(args[k + 1]?.text ?? '')
      k += 2
    } else if (t.startsWith('--config-env=')) {
      settings.push(t.slice('--config-env='.length))
      k++
    } else if (t === '--config-env') {
      settings.push(args[k + 1]?.text ?? '')
      k += 2
    } else if (t.startsWith('-')) k++
    else break
  }
  return { sub: args[k]?.text ?? '', rest: args.slice(k + 1), settings }
}

// The flags each message-writing subcommand reads, so a message value is never read as a flag.
const FLAGS: Record<string, Spec> = {
  commit: COMMIT,
  notes: NOTES,
  tag: { ...MESSAGE, '-u': 'skip', '--local-user': 'skip', '--cleanup': 'skip' },
  merge: { ...MESSAGE, '-s': 'skip', '--strategy': 'skip', '-X': 'skip', '--strategy-option': 'skip' },
}

// A flag that hides or reuses a message: skipped hooks (a commit's `-n` alone or in a bundle before the
// first letter that takes a value, `--no-verify` on a commit or merge), `--trailer` on a commit or tag,
// and a message taken from another object (`-C`, `-c`, `--reuse-message` on a commit or note, a commit's
// `--fixup=amend:`). Long options count as git reads them, shortened too. A flag's value is skipped, so
// a message that starts with a dash (`-m "-n is fine"`) is never a flag.
function messageReason(sub: string, rest: Word[]): string | undefined {
  const spec = FLAGS[sub] ?? {}
  const reuses = sub === 'commit' || sub === 'notes'
  for (let i = 0; i < rest.length; i++) {
    const text = gitLong(sub, rest[i]?.text ?? '')
    if (text === '--') break
    if (text === '--no-verify' && (sub === 'commit' || sub === 'merge')) return HOOK_SKIP
    if (/^--trailer(=|$)/.test(text) && (sub === 'commit' || sub === 'tag')) return TRAILER
    if (/^--(reuse|reedit)-message(=|$)/.test(text) && reuses) return REUSE
    // `--fixup=amend:<commit>` and `reword:` take that commit's whole message.
    const fixup = text === '--fixup' ? rest[i + 1]?.text : /^--fixup=(.*)$/.exec(text)?.[1]
    if (sub === 'commit' && /^(amend|reword):/.test(fixup ?? '')) return REUSE
    if (text.startsWith('--')) {
      const kind = spec[text.split('=')[0] ?? '']
      if (kind && kind !== 'attached' && !text.includes('=')) i++
      continue
    }
    if (!/^-[A-Za-z]/.test(text)) continue
    for (let j = 1; j < text.length; j++) {
      const letter = text[j] as string
      if (letter === 'n' && sub === 'commit') return HOOK_SKIP
      if ((letter === 'C' || letter === 'c') && reuses) return REUSE
      const kind = spec[`-${letter}`]
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
  // Long options as git reads them, shortened too (`--rem core`): the verb of git 2.46+ has its own.
  const verb = /^(set|unset)$/.test(rest[0]?.text ?? '') ? `config ${rest[0]?.text}` : 'config'
  const words = rest.map(w => gitLong(verb, w.text))
  // `--get core.hooksPath <pattern>` reads, whatever follows the key.
  if (words.some(w => /^--get(-all|-regexp)?$/.test(w))) return undefined
  const keys: string[] = []
  let isWrite = false
  let dropsSection = false
  for (let i = 0; i < words.length; i++) {
    const text = words[i] ?? ''
    if (CONFIG_VALUE_FLAGS.test(text)) i++
    else if (CONFIG_WRITES.test(text)) isWrite = true
    else if (SECTION_DROPS.test(text)) dropsSection = true
    else if (!text.startsWith('-')) keys.push(text)
  }
  // `git config remove-section core`, the git 2.46+ spelling.
  if (SECTION_DROPS.test(keys[0] ?? '')) {
    dropsSection = true
    keys.shift()
  }
  // A rename moves the section away or brings one in under its name: either side counts.
  if (dropsSection) return keys.slice(0, 2).some(k => HOOKS_SECTION.test(k)) ? HOOK_SKIP : undefined
  // `git config set|unset <key> ...`: the verb writes, the key follows it.
  if (CONFIG_VERBS.test(keys[0] ?? '')) {
    isWrite = true
    keys.shift()
  }
  isWrite ||= keys.length >= 2
  return isWrite && HOOKS_KEY.test(keys[0] ?? '') ? HOOK_SKIP : undefined
}

function gitReason(args: Word[]): string | undefined {
  const { sub, rest, settings } = gitParts(args)
  if (sub === 'filter-repo' || sub === 'filter-branch') return HISTORY_REWRITE
  if (sub === 'config') return configReason(rest)
  if (!HOOKED.has(sub)) return undefined
  if (settings.some(s => HOOKS_KEY.test(s))) return HOOK_SKIP
  // A message writer's flags are walked past their values (`-m '--no-verify'` is a message); on the rest
  // only a word git reads as `--no-verify` counts, and no real path is.
  if (FLAGS[sub]) return messageReason(sub, rest)
  return rest.some(w => gitLong(sub, w.text) === '--no-verify') ? HOOK_SKIP : undefined
}

// What the shell applies to a command or exports (`LEFTHOOK=0 git ...`, `env -i LEFTHOOK=0 git ...`,
// `export LEFTHOOK=false`, `$env:LEFTHOOK = 0`): lefthook switched off, or a hooks setting passed through
// git's environment. Every word before the program counts, past keywords and wrappers. `lefthook
// uninstall` too.
function envReason(st: Statement, name: string, args: Word[]): string | undefined {
  const tool = RUNNERS.test(name) ? args.findIndex(a => LEFTHOOK_TOOL.test(a.text)) : -1
  const lefthook = name === 'lefthook' ? args : tool === -1 ? [] : args.slice(tool + 1)
  if (lefthook.find(a => !a.text.startsWith('-'))?.text === 'uninstall') return LEFTHOOK
  const words = st.words.map(w => w.text)
  const ps = /^\$env:(\w+)(?:=(.*))?$/i.exec(words[0] ?? '')
  const assigned = ps ? `${ps[1]}=${ps[2] ?? (words[1] === '=' ? (words[2] ?? '') : '')}` : undefined
  const lead = words.slice(0, words.length - args.length - (name ? 1 : 0))
  const applied = ASSIGNS.test(name) ? [...lead, ...args.map(a => a.text)] : lead
  for (const text of assigned === undefined ? applied : [assigned]) {
    if (LEFTHOOK_OFF.test(text)) return LEFTHOOK
    if (ENV_HOOKS.test(text)) return HOOK_SKIP
  }
  return undefined
}

/** The reason to refuse one statement as a route around the check, or undefined. */
export function bypassOf(st: Statement, name: string, args: Word[]): string | undefined {
  return envReason(st, name, args) ?? (name === 'git' ? gitReason(args) : undefined)
}
