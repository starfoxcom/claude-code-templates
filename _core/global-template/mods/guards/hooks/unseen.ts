// The parts of a statement that may run a git or gh call the reading never reads as a statement of its own:
// a launcher's quoted text (`ssh host '...'`), a shell or launcher fed its script on stdin, an `env -S` text,
// a program word built at run time or by a brace expansion, a command line handed to another program as one
// argument (`tmux new -d '...'`), a flag held in a variable the command sets, and the words Windows
// PowerShell hands a native program changed. Each is judged on the parsed statement, never on the command's
// raw text, so a comment, a message or a search text that names a git call is never one. Pure.

import { bypassOf, launched, runsHooks } from './bypass'
import type { HookState } from './bypass'
import { programOf } from './programs'
import { SHELLS as READ_SHELLS } from './scripts'
import { parse } from './shell'
import type { Statement, Word } from './shell'
import { holdsFlag } from './vars'
import type { VarState } from './vars'

/** What the reading hands on: its hook state and its variables. */
type Feed = HookState & Partial<VarState>

// Programs whose arguments the reading follows itself: git and gh, the shells (`bash -c`), `eval` and `trap`.
const FOLLOWED = /^(git|gh|bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|eval|iex|invoke-expression|trap)$/
const SHELL = /^(bash|sh|zsh|dash|ksh|fish|pwsh|powershell|cmd)$/
// Programs that only print or match their words: a git word among them is data (`echo git commit -n`).
const PRINTS = /^(echo|printf|write-output|write-host|grep|egrep|fgrep|rg|select-string|sls|sed)$/
// Programs whose text is data to them or code in their own language (`cat >> notes.md`, `node -e`).
const DATA = /^(cat|tee|type|get-content|gc|node|deno|python\d*(\.\d+)?|py|perl|ruby|php|awk|gawk|jq)$/
// Programs that pass what they read on stdin to stdout: a pipe through them still feeds the next program.
const PASSES = /^(tee|cat|head|tail|sort|uniq|tr|sed)$/
// Programs that run their quoted argument, or what they read on stdin, as a command the reading does not
// follow (`flock -c '...'`, `ssh host '...'`, `Start-Process git -ArgumentList '...'`, an alias's value).
const LAUNCHERS =
  /^(flock|watch|parallel|script|ssh|su|setsid|stdbuf|doas|runas|wsl|fish|start-process|saps|start|alias)$/i
// git or gh as a program word in a text, quotes taken out: not `git@github.com` or `app.git`.
const NAMES_CALL = /(?:^|[\s;&|(=])(?:[\w.~-]*\/)*(?:git|gh)(?:\.exe)?(?=[\s;&|)]|$)/i
const WRITE_WORD =
  /^(commit|merge|push|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace|pr|issue|release|api)$/
export const SHELL_TEXT =
  "a git or gh call in text a wrapper runs as a shell command (`sudo -s '...'`) cannot be read. Run the git " +
  'or gh call directly, as its own command.'
export const FLAG_IN_VARIABLE =
  'a flag held in a variable cannot be read. Type the flags of the git or gh call out.'
const baseName = (text: string) => (text.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
const namesCall = (text: string) => NAMES_CALL.test(text.replace(/['"]/g, ' '))
const isGit = (a: Word) => /^(git|gh)$/.test(baseName(a.text))
// How deep a command line inside an argument is read (`kubectl exec pod -- sh -c '...'`).
const DEPTH = 4

// `env -S '...'` past any wrapper (`sudo env -S '...'`): the text after `-S` runs as a command line.
function splitText(st: Statement): string | undefined {
  const at = st.words.findIndex((w, i) => i > 0 && /^(-S|--split-string)/.test(w.text) && isEnvBefore(st, i))
  const word = st.words[at]?.text ?? ''
  const value = /^(?:-S|--split-string=?)(.+)$/s.exec(word)?.[1] ?? st.words[at + 1]?.text ?? ''
  return at !== -1 && namesCall(value) ? SHELL_TEXT : undefined
}
const isEnvBefore = (st: Statement, i: number) => st.words.slice(0, i).some(w => baseName(w.text) === 'env')

// What a statement reads on stdin: its here-docs, or what the pipeline before it prints, followed back
// through the programs that pass their input on (`echo '...' | tee run.log | bash`).
function stdinOf(st: Statement, state: Feed, prev?: Statement): string {
  if (st.heredocs.length > 0) return st.heredocs.join('\n')
  const fed: string[] = []
  for (let at = st, feeder = prev; feeder && at.pipeIn; [at, feeder] = [feeder, state.feeders?.get(feeder)]) {
    fed.push(...feeder.words.map(w => w.text), ...feeder.heredocs)
    if (!PASSES.test(programOf(feeder).name)) break
  }
  return fed.join(' ')
}

// A shell or a launcher that runs what it reads on stdin, as the program or among its arguments (`| sudo
// bash`, `ssh host <<EOF`, `ssh host bash <<EOF`, `docker exec -i c sh <<EOF`). A shell with `-c`, or with a
// script file of its own, reads no script on stdin.
function stdinScript(st: Statement, name: string, args: Word[], state: Feed, prev?: Statement) {
  const isRunner = SHELL.test(name) || LAUNCHERS.test(name)
  // A program that reads its words itself (git, gh, a printer, a reader) runs no shell named among them.
  if (!isRunner && (FOLLOWED.test(name) || PRINTS.test(name) || DATA.test(name))) return undefined
  const at = isRunner ? -1 : args.findIndex(a => SHELL.test(baseName(a.text)))
  const runner = at === -1 ? name : baseName(args[at]?.text ?? '')
  if (!SHELL.test(runner) && !LAUNCHERS.test(runner)) return undefined
  const own = args.slice(at + 1)
  // The reading follows a here-doc fed to the shells it reads (`bash <<EOF`); any other shell runs it unread.
  if (READ_SHELLS.test(runner) && st.heredocs.length > 0 && at === -1) return undefined
  if (SHELL.test(runner) && own.some(a => /^-[a-z]*c[a-z]*$/i.test(a.text))) return undefined
  // A first word past the options is a script file, unless `-s` or `--` makes it an argument.
  // `/dev/stdin` and its kin name the pipe itself, not a script file.
  const isPipe = (a: Word) => /^\/(dev\/stdin|dev\/fd\/0|proc\/self\/fd\/0)$/.test(a.text)
  const file = own.findIndex(a => !a.text.startsWith('-') && !isPipe(a))
  const isScript = file !== -1 && !own.slice(0, file).some(a => /^-[a-z]*s/.test(a.text) || a.text === '--')
  if (SHELL.test(runner) && isScript) return undefined
  return namesCall(stdinOf(st, state, prev)) ? launched(runner) : undefined
}

// Bash's brace expansion of one word (`{gi,commi}t` gives `git` and `commit`), innermost first; quoted
// text expands nothing, and an empty result is no word. Capped, so a long list stops early.
function braces(text: string, out: string[] = []): string[] {
  const m = /\{([^{}]*,[^{}]*)\}/.exec(text)
  if (!m || out.length > 64) return [...out, text]
  const [pre, post] = [text.slice(0, m.index), text.slice(m.index + m[0].length)]
  return (m[1] as string).split(',').reduce((acc, alt) => braces(pre + alt + post, acc), out)
}

// The statement as Bash runs it after brace expansion, or undefined when no word expands.
function expanded(st: Statement, ps?: boolean): Statement | undefined {
  if (ps || !st.words.some(w => !w.quotedStart && /\{[^{}]*,[^{}]*\}/.test(w.text))) return undefined
  const made = (w: Word) => braces(w.text).filter(Boolean).map(text => ({ ...w, text }))
  const words = st.words.flatMap(w => (w.quotedStart ? [w] : made(w)))
  return { ...st, words }
}

// Windows PowerShell hands a native program its words joined into one line, quoting a word that holds a
// blank outside `"` and leaving the `"` inside as they are; the program splits the line again by the C
// runtime's rules; an empty word is left out. The words the program gets, or undefined when none changes.
export function psNativeWords(args: Word[]): Word[] | undefined {
  if (!args.some(a => /["\\]/.test(a.text) || a.text === '')) return undefined
  const line = args.map(a => (needsQuotes(a.text) ? `"${a.text}"` : a.text)).join(' ')
  const words = crtSplit(line)
  const same = words.length === args.length && words.every((t, i) => t === args[i]?.text)
  return same ? undefined : words.map(text => ({ text, dynamic: false, bodies: [] }))
}

// Windows PowerShell's test: a blank after an even count of `"`, a backslash before one or not (checked on
// this machine: `'x\" --no-verify'` reaches git as `x"` and `--no-verify`).
function needsQuotes(text: string): boolean {
  let quotes = 0
  for (const c of text) {
    if (c === '"') quotes++
    else if (/\s/.test(c) && quotes % 2 === 0) return true
  }
  return false
}

// The C runtime's split: blanks outside quotes end a word, `"` opens and closes, backslashes are literal
// unless before a `"` (2n give n and a quote mark, 2n+1 give n and a literal `"`), and `""` inside quotes
// is a literal `"` that also closes them (git's own runtime, checked on this machine).
function crtSplit(line: string): string[] {
  const words: string[] = []
  let word = ''
  let isQuoted = false
  let isWord = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    if (c === '\\') {
      let n = 0
      while (line[i + n] === '\\') n++
      i += n - 1
      const isQuote = line[i + 1] === '"'
      word += '\\'.repeat(isQuote ? Math.floor(n / 2) : n)
      // An odd count escapes the quote mark: it is a literal `"`, read here.
      if (isQuote && n % 2 === 1) word += line[++i]
      isWord = true
    } else if (c === '"' && isQuoted && line[i + 1] === '"') [word, isQuoted] = [word + line[++i], false]
    else if (c === '"') [isQuoted, isWord] = [!isQuoted, true]
    else if (/\s/.test(c) && !isQuoted) {
      if (isWord) words.push(word)
      ;[word, isWord] = ['', false]
    } else [word, isWord] = [word + c, true]
  }
  return isWord ? [...words, word] : words
}

// Each git or gh call in an argument that is a command line of its own (`tmux new -d 'git commit -n'`,
// `nix-shell --run '...'`), judged by the rules a typed call meets. A program that only prints its words,
// or reads them as its own data or code, runs none of them.
function argumentCalls(name: string, args: Word[], state: Feed, depth: number): string | undefined {
  if (PRINTS.test(name) || DATA.test(name) || depth >= DEPTH) return undefined
  for (const a of args) {
    if (!/\s/.test(a.text) || !namesCall(a.text)) continue
    for (const st of flat(parse(a.text, false))) {
      const call = programOf(st)
      if (!/^(git|gh)$/.test(call.name)) continue
      const reason = bypassIn(st, call.name, call.args, { ...state, feeders: undefined }, undefined, depth + 1)
      if (reason) return reason
    }
  }
  return undefined
}
const flat = (sts: Statement[]): Statement[] => sts.flatMap(st => [...flat(st.inner), st])

/**
 * As `bypassOf`, and for a git or gh call another program runs: a launcher past any wrapper or keyword
 * (`sudo ssh host '...'`, `if flock ...`) is refused as `eval` is, and so is a shell text a wrapper runs
 * (`sudo -s '...'`). One run from another program's arguments (`find . -exec git commit ...`, `unbuffer git
 * ...`) is checked as one typed on its own; a shell run that way (`find . -exec sh -c '...'`) or a program
 * named at run time there (`find . -exec "$GIT" commit ...`) is refused when its words name or make a call.
 */
export function bypassIn(st: Statement, name: string, args: Word[], state: Feed = {}, prev?: Statement, depth = 0) {
  const braced = depth < DEPTH ? expanded(st, state.ps) : undefined
  if (braced) return bypassIn(braced, programOf(braced).name, programOf(braced).args, state, prev, depth + 1)
  const native = state.ps && /^(git|gh)$/.test(name) ? psNativeWords(args) : undefined
  const own =
    bypassOf(st, name, args, state) ??
    (native && bypassOf(st, name, native, state)) ??
    heldFlag(name, args, state) ??
    splitText(st) ??
    stdinScript(st, name, args, state, prev)
  if (own || FOLLOWED.test(name) || PRINTS.test(name)) return own
  return otherProgram(st, name, args, state, depth)
}

// A flag held in a variable the command sets, on a git call that runs hooks or a gh call.
function heldFlag(name: string, args: Word[], state: Feed): string | undefined {
  const isCall = name === 'gh' || (name === 'git' && runsHooks(args))
  if (!isCall || !state.vars) return undefined
  return args.some(a => holdsFlag(a, state as VarState)) ? FLAG_IN_VARIABLE : undefined
}

// Programs that run the command their arguments name (`unbuffer git ...`, `taskset 1 git ...`, `uv run git
// ...`), and `find`'s options that run one (`-exec`, `-ok`).
const PREFIXES =
  /^(unbuffer|chronic|ionice|taskset|nice|nohup|xargs|stdbuf|setsid|time|timeout|uv|uvx|poetry|pipenv|npx|bunx)$/
const RUNS_NEXT = /^-(exec|execdir|ok|okdir)$/

// Whether a word built at run time stands where a program runs: right after `find -exec`, or among the
// arguments of a program that runs the command they name. Elsewhere (`cp -r "$D" api`) it is data.
const isProgramSpot = (name: string, args: Word[], i: number) =>
  PREFIXES.test(name) || RUNS_NEXT.test(args[i - 1]?.text ?? '')

// A git or gh call another program runs: from its arguments, through a launcher, or named at run time.
function otherProgram(st: Statement, name: string, args: Word[], state: Feed, depth: number) {
  const head = st.words[st.words.length - args.length - 1]
  // A program word built at run time (`$G config --unset-a core.hooksPath`) or by a Bash glob (`g[i]t`) may be
  // git or gh: their routes count, and the scan below still runs on its arguments.
  const isBuilt = head?.dynamic || (!state.ps && /[*?[]/.test(head?.text ?? '') && !/^\[\[?$/.test(head?.text ?? ''))
  const asCall = name && isBuilt ? (bypassOf(st, 'git', args, state) ?? bypassOf(st, 'gh', args, state)) : undefined
  if (asCall) return asCall
  if (LAUNCHERS.test(name) && args.some(a => isGit(a) || namesCall(a.text))) return launched(name)
  if (!state.ps && name && /\s/.test(head?.text ?? '') && NAMES_CALL.test(head?.text ?? '')) return SHELL_TEXT
  // PowerShell runs a literal git or gh word among another program's arguments (`uv run git ...`) the same way;
  // its variables, quoted strings and script blocks are read by the PowerShell reading instead.
  const isRunner = (a: Word) => isGit(a) || SHELL.test(baseName(a.text)) || LAUNCHERS.test(baseName(a.text))
  const runs = (a: Word, i: number) => (a.dynamic ? isProgramSpot(name, args, i) : isRunner(a))
  const at = args.findIndex((a, i) => (state.ps ? !a.dynamic && isGit(a) : runs(a, i)))
  const word = args[at]
  if (!word) return argumentCalls(name, args, state, depth)
  const rest = args.slice(at + 1)
  // A word built at run time where a program stands may be git or gh: their routes count, and a typed write
  // after it is unread.
  const next = rest.find(a => !a.text.startsWith('-'))
  const isWrite = next && !next.dynamic && WRITE_WORD.test(next.text)
  const route = word.dynamic ? (bypassOf(st, 'git', rest, state) ?? bypassOf(st, 'gh', rest, state)) : undefined
  if (word.dynamic) return route ?? (isWrite ? launched(name) : undefined)
  const inner = baseName(word.text)
  if (/^(git|gh)$/.test(inner)) return bypassOf(st, inner, rest, state)
  // A shell or a launcher run from the arguments (`find . -exec ssh host '...'`) runs its text unread.
  const isCalled = rest.some(a => NAMES_CALL.test(a.text.replace(/['"]/g, ' ')))
  return isCalled ? launched(SHELL.test(inner) ? name : inner) : argumentCalls(name, args, state, depth)
}
