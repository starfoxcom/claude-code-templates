// The program a statement runs, past assignments, keywords and wrappers, and whether it runs script code
// written in the command itself.
import type { Statement, Word } from './shell'

// Words that run the command after them: shell keywords (`then git commit ...` in an `if`, `do gh ...`
// in a loop) and wrappers, with the options of each that take a value.
const WRAPPERS = new Map<string, RegExp | null>(
  Object.entries({
    if: null,
    then: null,
    elif: null,
    else: null,
    while: null,
    until: null,
    do: null,
    '!': null,
    '{': null,
    time: null,
    nohup: null,
    builtin: null,
    command: null,
    exec: /^-a$/,
    sudo: /^-[ugpCDhrtTU]$|^--(user|group|prompt|chdir|host|role|type|other-user|close-from)$/,
    env: /^-[uCS]$|^--(unset|chdir|split-string)$/,
    nice: /^-n$|^--adjustment$/,
    timeout: /^-[sk]$|^--(signal|kill-after)$/,
    xargs: /^-[IiLlnPdEsa]$|^--(replace|max-lines|max-args|max-procs|delimiter|eof|max-chars|arg-file)$/,
  }),
)

/**
 * The program a statement runs: its first word past `VAR=x` assignments, shell keywords and wrappers
 * (`sudo`, `env`, `time`, `timeout 60`, `xargs -I{}`, ...), cut to the file name.
 */
export function programOf(st: Statement): { name: string; args: Word[] } {
  const words = st.words
  let k = 0
  for (;;) {
    while (k < words.length && /^[A-Za-z_]\w*\+?=/.test(words[k]?.text ?? '')) k++
    const head = words[k]
    if (!head || head.dynamic || !WRAPPERS.has(head.text)) break
    const values = WRAPPERS.get(head.text)
    k++
    while (k < words.length && /^-./.test(words[k]?.text ?? '') && !words[k]?.dynamic) {
      const t = words[k]?.text ?? ''
      // `command -v git` only looks the program up.
      if (head.text === 'command' && /^-[vV]$/.test(t)) return { name: '', args: [] }
      k += values?.test(t) ? 2 : 1
      if (t === '--') break
    }
    // `timeout 60 git push`: the duration comes first.
    if (head.text === 'timeout') k++
  }
  const first = words[k]?.text ?? ''
  const name = (first.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
  return { name, args: words.slice(k + 1) }
}

// Interpreters, and the flags that carry the program itself on the command line.
const INLINE_FLAGS: Record<string, string[]> = {
  python: ['-c'],
  python3: ['-c'],
  py: ['-c'],
  node: ['-e', '-p', '--eval', '--print'],
  bun: ['-e', '-p', '--eval', '--print'],
  deno: ['eval'],
  ruby: ['-e'],
  perl: ['-e', '-E'],
}

/**
 * Script code written in the statement itself: an inline-code flag before the script's own words, or a
 * here-doc read as the program (`python - <<EOF`, `python <<EOF`). A script file on disk (`python gen.py`,
 * even fed a here-doc) is not, nor is a flag that belongs to the script (`python gen.py -c cfg`), nor code
 * the shell builds at run time (`-c "$(cat gen.py)"`, `-c "$CODE"`, an unquoted here-doc with an expansion).
 */
export function runsInlineCode(st: Statement): boolean {
  const { name, args } = programOf(st)
  const flags = INLINE_FLAGS[name]
  if (!flags) return false
  for (const [k, a] of args.entries()) {
    const code = args[k + 1]
    if (flags.includes(a.text)) return code !== undefined && !code.dynamic
    if (a.text === '-') break
    if (!a.text.startsWith('-')) return false
  }
  return st.heredocs.length > 0 && !st.hasDynamicBody
}

// Programs that write no file (a `>` they carry is read on its own), with none of their options writing one,
// and shell keywords.
const READERS = new Set(
  [
    'cat', 'type', 'get-content', 'gc', 'head', 'tail', 'wc', 'grep', 'egrep', 'rg', 'select-string', 'sls',
    'test-path', 'ls', 'dir', 'get-item', 'gi', 'get-childitem', 'gci', 'stat', 'echo', 'write-output',
    'write-host', 'printf', 'for', 'select', 'case', 'foreach', 'while', 'until', 'elseif', 'switch', 'done',
    'fi', 'esac', 'function', 'return', 'exit', 'break', 'continue', 'test', '[', '[[', 'true', 'false', ':',
    'cd', 'pushd', 'popd', 'set-location', 'sl', 'push-location', 'pop-location', 'pwd', 'get-location',
    'sleep', 'start-sleep', '',
    // These make, stamp or remove files and folders, or only print: none changes an existing file's text.
    'mktemp', 'mkdir', 'rm', 'rmdir', 'touch', 'date', 'basename', 'dirname', 'realpath', 'whoami', 'hostname',
    'uname', 'set', 'unset', 'shift', 'read',
  ],
)
// git subcommands that leave the work tree as it is, unless an output file is named (`git log --output=x`).
const GIT_READS = new RegExp(
  '^(add|diff|status|log|show|commit|push|ls-files|rev-parse|branch|fetch|remote|merge-base|describe|' +
    'rev-list|symbolic-ref|show-ref|for-each-ref|cat-file|ls-remote)$',
)
// .NET calls that only compute a value: string, path and math methods, and the static types made of them.
const PURE_CALL = new RegExp(
  String.raw`^(\[(system\.)?(math|string|io\.path|datetime|guid|convert|regex|text\.encoding|char|int|int32|` +
    String.raw`int64|double|bool|timespan|uri)\]::\w+|\$[\w:]+(\.\w+)*\.(trim|trimstart|trimend|tolower|` +
    String.raw`toupper|split|substring|contains|startswith|endswith|indexof|tostring|padleft|padright|` +
    String.raw`join|format|equals|getbytes|getstring))\(`,
  'i',
)
// Options that make a reader run another program (`rg --pre`, `git fetch --upload-pack`): it may write.
const RUNS = /^--(pre|upload-pack|receive-pack|exec)(=|$)/
// gh groups that only read files or send them: every other group (`release download`, `run download`,
// `codespace cp`, `repo clone`, an extension) may write one. Within them, a checkout or a merge that deletes
// the branch switches the work tree.
const GH_READS = /^(pr|issue|api|search|label|browse|status|auth|workflow|secret|variable|ruleset|cache)$/
const GH_SWITCHES = (words: string[], args: Word[]) =>
  words[1] === 'checkout' ||
  args.some(a => a.text === '--checkout') ||
  (words[1] === 'develop' && args.some(a => a.text === '-c')) ||
  (words[1] === 'merge' && args.some(a => /^--delete-branch(=true)?$|^-[a-z]*d[a-z]*$/.test(a.text)))

// Variables that configure the programs a command runs, any of which may make one run a program of its
// choosing (`GIT_EXTERNAL_DIFF`, `GIT_CONFIG_KEY_0=diff.external`, `GH_BROWSER`, a `PATH` or `HOME` of its
// own): whole families, since no list of the dangerous ones is complete.
const RUN_VARS = new RegExp(
  '^(GIT_\\w*|GH_\\w*|SSH_\\w*|RIPGREP_\\w*|XDG_\\w*|LD_\\w*|DYLD_\\w*|PATH|HOME|BROWSER|PAGER|EDITOR|VISUAL|' +
    'SHELL|BASH_ENV|ENV|NODE_OPTIONS|PYTHON\\w*|PSModulePath|COMSPEC|PATHEXT)$',
  'i',
)
const DECLARES = /^(export|declare|typeset|local|readonly)$/
// Members of those families that only name who, where or how quietly, and run nothing.
const RUNS_NOTHING = new RegExp(
  '^(GIT_AUTHOR_\\w*|GIT_COMMITTER_\\w*|GH_REPO|GH_HOST|GH_TOKEN|GH_ENTERPRISE_TOKEN|GH_PROMPT_DISABLED|' +
    'GH_NO_UPDATE_NOTIFIER|GIT_TERMINAL_PROMPT)$',
  'i',
)

/** Whether a statement makes a later or wrapped program run one of its own choosing: `env -S 'cp x b.md'`,
 * or a variable in `RUN_VARS` set in front of a program, by `export`/`declare`, or as `$env:X = ...`. Read
 * before any early return, since an assignment returns before `mayWriteFiles`. */
export function setsRunner(st: Statement): boolean {
  const { name, args } = programOf(st)
  // A statement of assignments only (`PATH=./bin:$PATH`) has no program: every word leads.
  const lead = name ? st.words.slice(0, Math.max(0, st.words.length - args.length - 1)) : st.words
  const isEnv = lead.some(w => w.text === 'env')
  if (isEnv && lead.some(w => /^(-[a-zA-Z]*S|--split-string)/.test(w.text))) return true
  // `NAME=v` in front of the program as typed, an argument of `export`/`declare` (quoted too, or a bare
  // `NAME` set before), or `$env:NAME` heading the statement. Never a word another program is given.
  const names = lead.filter(w => !w.literalStart).map(w => /^([A-Za-z_]\w*)\+?=/.exec(w.text)?.[1] ?? '')
  if (DECLARES.test(name)) names.push(...args.map(w => /^([A-Za-z_]\w*)(\+?=|$)/.exec(w.text)?.[1] ?? ''))
  names.push(/^\$env:(\w+)$/i.exec(st.words[0]?.text ?? '')?.[1] ?? '')
  return names.some(n => RUN_VARS.test(n) && !RUNS_NOTHING.test(n))
}

/** Whether a statement may write files beyond its own `>`: any program not known to write none (`Set-Content`,
 * `cp`, `tee`, `npm`, a .NET call, a function, `xargs cp`), git outside its read subcommands or with an
 * output file (`git log --output=x`), and gh outside its read and send groups (`gh release download`). */
export function mayWriteFiles(st: Statement, ps = false): boolean {
  // PowerShell: a statement that is one value (`'## What' > b.md`, a here-string, `$body > b.md`) only prints.
  const [only] = st.words
  // A backtick-led word (`` `make ``) is a command name, escaped.
  const isValue = (w: Word) => w.quotedStart || /^-?\d+(\.\d+)?$|^\$\w+$/.test(w.text)
  if (ps && !st.isCall && st.words.length === 1 && only && !only.expr && !only.list && isValue(only)) return false
  const { name, args } = programOf(st)
  if (args.some(a => RUNS.test(a.text))) return true
  if (PURE_CALL.test(st.words[0]?.text ?? '')) return false
  if (READERS.has(name)) return false
  if (name === 'git') return gitMayWrite(args)
  // The words past options, without the value of gh's `-R`/`--repo`, which may sit before the action.
  const words = args
    .filter((a, i) => !a.text.startsWith('-') && !/^(-R|--repo)$/.test(args[i - 1]?.text ?? ''))
    .map(a => a.text)
  return !(name === 'gh' && GH_READS.test(words[0] ?? '') && !words.includes('download') && !GH_SWITCHES(words, args))
}

// git past its global options and their values (`git -C ../repo log`): a setting typed among them may run a
// program (`-c diff.external=x`, `--config-env=core.pager=V`); then the subcommand decides.
function gitMayWrite(args: Word[]): boolean {
  let k = 0
  let isConfigured = false
  for (; k < args.length; k++) {
    const t = args[k]?.text ?? ''
    if (!t.startsWith('-')) break
    // `--exec-path=` puts its folder first on the path of every program git starts.
    if (/^(-c|--config-env)(=|$)|^--exec-path=/.test(t)) isConfigured = true
    if (/^(-C|-c|--git-dir|--work-tree|--namespace|--config-env|--attr-source|--super-prefix)$/.test(t)) k++
  }
  const sub = args[k]?.text ?? ''
  const rest = args.slice(k + 1)
  // `-o` names an output file only on `diff`, `log` and `show`: on `push` it is a push option.
  const isLogLike = /^(diff|log|show)$/.test(sub)
  const isOutput = rest.some(a => /^--output(=|$)/.test(a.text) || (a.text === '-o' && isLogLike))
  return isConfigured || !(GIT_READS.test(sub) || isNewBranch(sub, rest)) || isOutput
}

// A new branch made where HEAD is (`git checkout -b feat`, `git switch -c feat`), with no start point or path
// after it: no file's text changes.
function isNewBranch(sub: string, rest: Word[]): boolean {
  const [flag, name, more] = rest
  const flags = sub === 'checkout' ? /^-[bB]$/ : sub === 'switch' ? /^(-[cC]|--create|--force-create)$/ : null
  // A PowerShell splat, list or expression (`@a`, `'f','HEAD~1'`) may hand git a start point too.
  const isOne = name && !name.dynamic && !name.list && !name.expr && !/^[-@]/.test(name.text)
  return Boolean(flags?.test(flag?.text ?? '') && isOne && !more)
}
