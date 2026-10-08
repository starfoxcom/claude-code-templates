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
