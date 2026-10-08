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
    'uname',
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
    String.raw`toupper|replace|split|substring|contains|startswith|endswith|indexof|tostring|padleft|padright|` +
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
  (words[1] === 'merge' && args.some(a => /^(-d|--delete-branch)$/.test(a.text)))

/** Whether a statement may write files beyond its own `>`: any program not known to write none (`Set-Content`,
 * `cp`, `tee`, `npm`, a .NET call, a function, `xargs cp`), git outside its read subcommands or with an
 * output file (`git log --output=x`), and gh outside its read and send groups (`gh release download`). */
export function mayWriteFiles(st: Statement): boolean {
  const { name, args } = programOf(st)
  const words = args.filter(a => !a.text.startsWith('-')).map(a => a.text)
  // `-o` names an output file only on `diff`, `log` and `show`: on `push` it is a push option.
  const isLogLike = /^(diff|log|show)$/.test(words[0] ?? '')
  const isOutput = args.some(a => /^--output(=|$)/.test(a.text) || (a.text === '-o' && isLogLike))
  // `env -S 'cp x b.md'` runs the program in its string.
  const isSplit = st.words.some(w => w.text === 'env') && st.words.some(w => /^(-S|--split-string)/.test(w.text))
  if (isSplit || args.some(a => RUNS.test(a.text))) return true
  if (PURE_CALL.test(st.words[0]?.text ?? '')) return false
  if (READERS.has(name) || (name === 'git' && GIT_READS.test(words[0] ?? '') && !isOutput)) return false
  return !(name === 'gh' && GH_READS.test(words[0] ?? '') && !words.includes('download') && !GH_SWITCHES(words, args))
}
