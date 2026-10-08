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

// Programs that only read the files they name, with none of their options writing one, and shell keywords.
const READERS = new Set(
  [
    'cat', 'type', 'get-content', 'gc', 'head', 'tail', 'wc', 'grep', 'egrep', 'rg', 'select-string', 'sls',
    'test-path', 'ls', 'dir', 'get-item', 'gi', 'get-childitem', 'gci', 'stat', 'echo', 'write-output',
    'write-host', 'printf', 'for', 'select', 'case', 'foreach', 'while', 'until', 'elseif', 'switch', 'done',
    'fi', 'esac', 'function', 'return', 'exit', 'break', 'continue', 'test', '[', '[[', 'true', 'false', ':',
  ],
)
// git subcommands that leave the work tree as it is, unless an output file is named (`git log --output=x`).
const GIT_READS = /^(add|diff|status|log|show|commit|push|ls-files|rev-parse|branch|fetch|remote)$/
// gh groups that only read files or send them: every other group (`release download`, `run download`,
// `codespace cp`, `repo clone`, an extension) may write one.
const GH_READS = /^(pr|issue|api|search|label|browse|status|auth|workflow|secret|variable|ruleset|cache)$/

/** The file names (lowercased, folder dropped) a statement may write: every name in its words, unless its
 * program only reads (`cat b.md`, `git add b.md`). `Set-Content b.md`, `cp x b.md`, `tee b.md` and
 * `[IO.File]::WriteAllText('b.md', ...)` each name one. `*` when a word is built at run time (`cp x "$F"`),
 * or a download names none: any file. */
export function namedFiles(st: Statement): string[] {
  const { name, args } = programOf(st)
  const words = args.filter(a => !a.text.startsWith('-')).map(a => a.text)
  const isOutput = args.some(a => /^(--output|-o)(=|$)/.test(a.text))
  if (READERS.has(name) || (name === 'git' && GIT_READS.test(words[0] ?? '') && !isOutput)) return []
  if (name === 'gh' && GH_READS.test(words[0] ?? '') && !words.includes('download')) return []
  // A word split at quotes, parens, `=` and a PowerShell parameter's colon (`-Path:b.md`).
  const names = st.words.flatMap(w => w.text.split(/[\s(),;'"=]+|^-\w+:/)).map(baseName).filter(Boolean)
  const isAny = st.words.some(w => w.dynamic) || (name === 'gh' && words.includes('download'))
  return isAny ? [...names, '*'] : names
}

/** A path's file name, lowercased: what `namedFiles` compares. */
export const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? '').toLowerCase()
