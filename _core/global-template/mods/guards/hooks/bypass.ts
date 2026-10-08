// The routes around the attribution check, refused outright whatever the message says: history rewrites,
// skipped git hooks, `--trailer`, a reused commit message and a hook manager switched off (`eval` is judged by
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
const CONFIG_UNREAD = 'a git config setting built at run time cannot be read.'
export const EVAL = 'eval builds the command at run time, so its message cannot be read.'
const HOOKS_OFF =
  "switching the repo's git hooks off (lefthook, husky, pre-commit or simple-git-hooks) is not allowed: they " +
  'hold its commit gates.'

// git's global options that take the next word as their value; the subcommand comes after them.
const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--attr-source',
  '--super-prefix',
])
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
const ENV_HOOKS =
  /^(GIT_CONFIG_PARAMETERS\+?=.*(core\.hookspath|hooks\.)|GIT_CONFIG_KEY_\d+\+?=(core\.hookspath|hooks\.))/i
// The hook managers the bundles ship, and the switches that skip their hooks: lefthook every hook with
// `LEFTHOOK=0` or `false` and named ones with `LEFTHOOK_EXCLUDE`, husky with `HUSKY=0` (v9) or
// `HUSKY_SKIP_HOOKS` (v4), pre-commit the hooks `SKIP` names, simple-git-hooks with `SKIP_SIMPLE_GIT_HOOKS`.
const HOOKS_OFF_SET =
  /^(LEFTHOOK\+?=(0|false)|HUSKY\+?=0|(LEFTHOOK_EXCLUDE|HUSKY_SKIP_HOOKS|SKIP|SKIP_SIMPLE_GIT_HOOKS)\+?=.+)$/i
// The same settings given a value built at run time (`LEFTHOOK=$V`): what they switch off is unknown.
const HOOKS_OFF_NAME = /^(LEFTHOOK|LEFTHOOK_EXCLUDE|HUSKY|HUSKY_SKIP_HOOKS|SKIP|SKIP_SIMPLE_GIT_HOOKS)\+?=/i
const GIT_ENV_NAME = /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)\+?=/i
// Package runners that start a tool by name (`npx lefthook uninstall`, `pnpm exec husky ...`, `uvx pre-commit`).
const RUNNERS = /^(npx|pnpx|bunx|pnpm|yarn|bun|npm|pipx|uvx|uv)$/
const MANAGER_TOOL = /^((@evilmartians\/)?lefthook|husky|pre-commit|pre_commit)(@\S*)?$/

/** What the reading keeps between statements: a hook manager's switch was set (`export HUSKY=0`), a git
 * call that runs hooks was read, and the functions the command defines (a prefix on one reaches its body). */
export type HookState = { hooksOff?: boolean; isHooked?: boolean; functions?: Set<string> }

/** A switch set anywhere in the command reaches every hooked git call in it: a trap action, a function or
 * a loop body may run after the switch though it is read before. */
export const hooksOffReason = (state: HookState) => (state.hooksOff && state.isHooked ? HOOKS_OFF : undefined)

/** The functions a command defines (`f() {`, `function f`), by its text. */
export const functionsOf = (command: string) =>
  new Set([...command.matchAll(/(?:^|[\s;&|{(])(?:function\s+([^\s(){};&|<>]+)|([^\s(){};&|<>$'"=\x60]+)\s*\(\s*\))/g)]
    .map(m => (m[1] ?? m[2] ?? '').toLowerCase()))
// Shells and `eval`, whose commands the reading reads (`HUSKY=0 bash -c '...'`).
const CHILDREN = /^(bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|eval)$/

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
  for (let i = 0; i < rest.length; i++) {
    const text = gitLong(sub, rest[i]?.text ?? '')
    if (text === '--') break
    const isLong = text.startsWith('--')
    if (!isLong && !/^-[A-Za-z]/.test(text)) continue
    const read = isLong ? longReason(sub, text, rest[i + 1]?.text) : bundleReason(sub, text)
    if (typeof read === 'string') return read
    i += read
  }
  return undefined
}

const reuses = (sub: string) => sub === 'commit' || sub === 'notes'

// A long option: why it is refused, or how many words after it its value takes.
function longReason(sub: string, text: string, next: string | undefined): string | number {
  if (text === '--no-verify' && (sub === 'commit' || sub === 'merge')) return HOOK_SKIP
  if (/^--trailer(=|$)/.test(text) && (sub === 'commit' || sub === 'tag')) return TRAILER
  if (/^--(reuse|reedit)-message(=|$)/.test(text) && reuses(sub)) return REUSE
  // `--fixup=amend:<commit>` and `reword:` take that commit's whole message.
  const fixup = text === '--fixup' ? next : /^--fixup=(.*)$/.exec(text)?.[1]
  if (sub === 'commit' && /^(amend|reword):/.test(fixup ?? '')) return REUSE
  const kind = FLAGS[sub]?.[text.split('=')[0] ?? '']
  return kind && kind !== 'attached' && !text.includes('=') ? 1 : 0
}

// A bundle of short flags (`-anm`): why it is refused, or how many words after it its value takes. A letter
// that takes a value takes the rest of the word, or the next word when it is last.
function bundleReason(sub: string, text: string): string | number {
  for (let j = 1; j < text.length; j++) {
    const letter = text[j] as string
    if (letter === 'n' && sub === 'commit') return HOOK_SKIP
    if ((letter === 'C' || letter === 'c') && reuses(sub)) return REUSE
    const kind = FLAGS[sub]?.[`-${letter}`]
    if (kind) return kind !== 'attached' && j === text.length - 1 ? 1 : 0
  }
  return 0
}

// `git config core.hooksPath x` (or `--unset`): a setting that moves or drops the hooks. Reading it passes.
function configReason(rest: Word[]): string | undefined {
  // Long options as git reads them, shortened too (`--rem core`): the verb of git 2.46+ has its own.
  const verb = /^(set|unset)$/.test(rest[0]?.text ?? '') ? `config ${rest[0]?.text}` : 'config'
  const all = rest.map(w => gitLong(verb, w.text))
  // The classic form stops reading options at the key: every word after it is a value
  // (`git config core.hooksPath -x` sets the path to `-x`).
  const keyAt = verb === 'config' ? optionsEnd(all) : all.length
  const words = [...all.slice(0, keyAt), ...all.slice(keyAt).map(w => (w.startsWith('-') ? `=${w}` : w))]
  // `--get core.hooksPath <pattern>` reads, whatever follows the key.
  if (all.slice(0, keyAt).some(w => /^--get(-all|-regexp)?$/.test(w))) return undefined
  // A word built at run time where the key or a verb is read, or beside a hooks key: the setting is unknown.
  const isDynamic = rest.map(w => w.dynamic)
  const nearHooks = all.some(w => HOOKS_KEY.test(w) || HOOKS_SECTION.test(w)) && isDynamic.some(Boolean)
  // `remove-section` and `rename-section` (git 2.46+) name their sections after the verb; the classic
  // `--rename-section old new` names its second one after the key.
  const isVerbDrop = SECTION_DROPS.test(all[keyAt] ?? '')
  const isFlagDrop = all.slice(0, keyAt).some(w => SECTION_DROPS.test(w))
  const keyEnd = keyAt + (isVerbDrop ? 3 : isFlagDrop ? 2 : 1)
  if (isDynamic.slice(0, keyEnd).some(Boolean) || nearHooks) return CONFIG_UNREAD
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

// Where the classic `git config` options end: the first word that is no option or an option's value.
function optionsEnd(words: string[]): number {
  for (let i = 0; i < words.length; i++) {
    const t = words[i] ?? ''
    if (!t.startsWith('-')) return i
    if (CONFIG_VALUE_FLAGS.test(t)) i++
  }
  return words.length
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
// `export LEFTHOOK=false`, `$env:LEFTHOOK = 0`): a hook manager switched off, or a hooks setting passed
// through git's environment. Every word before the program counts, past keywords and wrappers. A manager's
// switch counts only where it reaches a git call that runs hooks: in front of it, or set earlier in the
// command (`HUSKY=0 npm ci` skips no gate). A manager's `uninstall` is refused outright.
function envReason(st: Statement, name: string, args: Word[], state: HookState): string | undefined {
  // A manager run by name, through a package runner, or as `python -m pre_commit`, told to uninstall.
  const isRunner = RUNNERS.test(name) || (/^(python3?|py)$/.test(name) && args[0]?.text === '-m')
  const tool = isRunner ? args.findIndex(a => MANAGER_TOOL.test(a.text)) : -1
  const manager = MANAGER_TOOL.test(name) ? args : tool === -1 ? [] : args.slice(tool + 1)
  if (manager.find(a => !a.text.startsWith('-'))?.text === 'uninstall') return HOOKS_OFF
  const words = st.words
  const ps = /^\$env:(\w+)(?:=(.*))?$/i.exec(words[0]?.text ?? '')
  const spaced = words[1]?.text === '=' ? words[2] : undefined
  const assigned = ps && {
    text: `${ps[1]}=${ps[2] ?? spaced?.text ?? ''}`,
    // `$env:` itself is no run-time value; one after the `=` is.
    dynamic: /[$`(]/.test(ps[2] ?? '') || Boolean(spaced?.dynamic),
  }
  const lead = words.slice(0, words.length - args.length - (name ? 1 : 0))
  const applied = ASSIGNS.test(name) ? [...lead, ...args] : lead
  const isHooked = name === 'git' && HOOKED.has(gitParts(args).sub)
  // A prefix reaches only its program, unless that program is a shell that runs more of them.
  const isSet = Boolean(assigned) || ASSIGNS.test(name) || !name || CHILDREN.test(name) || state.functions?.has(name)
  state.isHooked ||= isHooked
  for (const { text, dynamic } of assigned ? [assigned] : applied) {
    const isOff = HOOKS_OFF_SET.test(text) || (dynamic && HOOKS_OFF_NAME.test(text))
    if (isOff && isSet) state.hooksOff = true
    if (isOff && isHooked) return HOOKS_OFF
    if (ENV_HOOKS.test(text) || (dynamic && GIT_ENV_NAME.test(text))) return HOOK_SKIP
  }
  return state.hooksOff && isHooked ? HOOKS_OFF : undefined
}

/** The reason to refuse one statement as a route around the check, or undefined. */
export function bypassOf(st: Statement, name: string, args: Word[], state: HookState = {}): string | undefined {
  // `git-filter-repo` and `git-filter-branch` run on their own, as installed on the path.
  if (/^git-filter-(repo|branch)$/.test(name)) return HISTORY_REWRITE
  return envReason(st, name, args, state) ?? (name === 'git' ? gitReason(args) : undefined)
}
