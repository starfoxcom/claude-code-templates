// A reading of Bash or PowerShell text good enough to tell which program runs and what its arguments
// and message texts are. Pure functions, no engine access, so tests import them directly.
//
// It is a safety net for commands written the ordinary way, not a shell: text the shell builds at run
// time is marked `dynamic` and named as unread, never guessed at.

export type Word = {
  /** The word as the program receives it: quotes removed, escapes applied. */
  text: string
  /** Holds an expansion ($VAR, $(...), backticks) whose value the reading cannot know. */
  dynamic: boolean
  /** Here-doc bodies written inside a `$(...)` of this word: `-m "$(cat <<'EOF' ... EOF)"`. */
  bodies: string[]
  /** Its first character came from quotes or an escape, so a leading `<` or `>` is text, not a redirect. */
  literalStart?: boolean
}

export type Statement = {
  words: Word[]
  /** Here-doc, here-string and `<<<` bodies fed to this statement. */
  heredocs: string[]
  /** Files this statement writes through `>` / `>>`. */
  writes: string[]
  /** Files fed to this statement through `<`. */
  reads: string[]
  /** Its input comes from the statement before it, through a pipe. */
  pipeIn: boolean
  /** Commands run inside a `$(...)` of its words (`PR=$(gh pr create ...)`); they run before it. */
  inner: Statement[]
}

const REDIRECT = /^(\d*)(>>?|<)(&\d+|&-)?$/
const REDIRECT_ATTACHED = /^\d*(>>?|<)(?!&)(.+)$/

export function parse(command: string, powershell: boolean): Statement[] {
  const esc = powershell ? '`' : '\\'
  const out: Statement[] = []
  const fresh = (pipeIn = false): Statement => ({ words: [], heredocs: [], writes: [], reads: [], pipeIn, inner: [] })
  let st = fresh()
  let word: Word | null = null
  // `owner`: the here-doc list of the statement that opened it; a line can go on past it (`<<'EOF' && git push`).
  let pending: { delim: string; strip: boolean; owner?: string[] }[] = []
  let redirectNext: 'write' | 'read' | 'text' | null = null
  let i = 0
  const n = command.length

  const startWord = () => (word ??= { text: '', dynamic: false, bodies: [] })
  const endWord = () => {
    if (!word) return
    const w = word
    word = null
    if (redirectNext) {
      if (redirectNext === 'write') st.writes.push(w.text)
      if (redirectNext === 'read') st.reads.push(w.text)
      if (redirectNext === 'text') st.heredocs.push(w.text)
      redirectNext = null
      return
    }
    const bare = REDIRECT.exec(w.text)
    if (bare && !w.dynamic && !w.literalStart) {
      if (!bare[3]) redirectNext = bare[2] === '<' ? 'read' : 'write'
      return
    }
    const attached = REDIRECT_ATTACHED.exec(w.text)
    if (attached && !w.dynamic && !w.literalStart && /^[\d<>]/.test(w.text)) {
      const target = attached[1] === '<' ? st.reads : st.writes
      target.push(attached[2] ?? '')
      return
    }
    st.words.push(w)
  }
  const endStatement = (pipeNext = false) => {
    endWord()
    redirectNext = null
    if (st.words.length > 0 || st.heredocs.length > 0) out.push(st)
    st = fresh(pipeNext)
  }
  // Reads the here-doc bodies queued on the line that just ended; `i` sits after its newline.
  const readBodies = (into: string[]) => {
    for (const { delim, strip, owner } of pending) {
      const lines: string[] = []
      while (i < n) {
        const end = command.indexOf('\n', i)
        const raw = command.slice(i, end === -1 ? n : end).replace(/\r$/, '')
        i = end === -1 ? n : end + 1
        const line = strip ? raw.replace(/^\t+/, '') : raw
        if (line.trim() === delim) break
        lines.push(line)
      }
      ;(owner ?? into).push(lines.join('\n'))
    }
    pending = []
  }
  // `<<` at `i`: queues a here-doc; `<<<` makes the next word a body.
  const heredocStart = (): boolean => {
    if (command.startsWith('<<<', i)) {
      endWord()
      redirectNext = 'text'
      i += 3
      return true
    }
    const m = /^<<(-?)[ \t]*(["']?)([A-Za-z_][\w.-]*)\2/.exec(command.slice(i))
    if (!m) return false
    endWord()
    pending.push({ delim: m[3] ?? '', strip: m[1] === '-', owner: st.heredocs })
    i += m[0].length
    return true
  }
  // `$(` at `i` (PowerShell also `(`, `@(` and `@{`): the substitution read whole and kept raw, its own
  // here-doc bodies collected, and the commands inside it read as statements of their own.
  const substitution = (w: Word, braces = false) => {
    let depth = 0
    let quote = ''
    const start = i
    let innerPending: { delim: string; strip: boolean }[] = []
    while (i < n) {
      const c = command[i]
      if (quote) {
        if (c === quote) quote = ''
        else if (c === esc && quote === '"') i++
        i++
        continue
      }
      if (c === "'" || c === '"') quote = c
      else if (c === '(' || (braces && c === '{')) depth++
      else if (c === ')' || (braces && c === '}')) {
        depth--
        if (depth === 0) {
          i++
          break
        }
      } else if (c === '<' && command.startsWith('<<', i) && !command.startsWith('<<<', i)) {
        const m = /^<<(-?)[ \t]*(["']?)([A-Za-z_][\w.-]*)\2/.exec(command.slice(i))
        if (m) {
          innerPending.push({ delim: m[3] ?? '', strip: m[1] === '-' })
          i += m[0].length
          continue
        }
      } else if (c === '\n' && innerPending.length > 0) {
        i++
        const saved = pending
        pending = innerPending
        readBodies(w.bodies)
        pending = saved
        innerPending = []
        continue
      }
      i++
    }
    const raw = command.slice(start, i)
    w.text += raw
    w.dynamic = true
    const open = raw.indexOf(braces ? '{' : '(')
    if (!braces && open !== -1 && raw.endsWith(')')) st.inner.push(...parse(raw.slice(open + 1, -1), powershell))
  }

  while (i < n) {
    const c = command[i] ?? ''
    // Line continuation.
    if (c === esc && (command[i + 1] === '\n' || (command[i + 1] === '\r' && command[i + 2] === '\n'))) {
      i += command[i + 1] === '\r' ? 3 : 2
      continue
    }
    if (c === '\n') {
      i++
      const bodies: string[] = []
      readBodies(bodies)
      st.heredocs.push(...bodies)
      endStatement()
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
      continue
    }
    if (!word && c === '#') {
      const end = command.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    // Bash: `<(...)` and `>(...)` are process substitutions, a file name built at run time.
    if (!powershell && (c === '<' || c === '>') && command[i + 1] === '(') {
      const w = startWord()
      w.text += c
      i++
      substitution(w)
      continue
    }
    // Bash: `(` and `)` outside quotes open and close a subshell; the commands inside are statements.
    if (!powershell && (c === '(' || c === ')')) {
      i++
      endStatement()
      continue
    }
    // PowerShell: `(...)` is a value built at run time, and `{` `}` hold script blocks (`foreach`, `if`).
    if (powershell && !word && c === '(') {
      substitution(startWord())
      continue
    }
    if (powershell && !word && (c === '{' || c === '}')) {
      i++
      endStatement()
      continue
    }
    if (powershell && !word && c === '@' && (command[i + 1] === '(' || command[i + 1] === '{')) {
      substitution(startWord(), command[i + 1] === '{')
      continue
    }
    if (c === '|' && command[i + 1] !== '|') {
      i += command[i + 1] === '&' ? 2 : 1
      endStatement(true)
      continue
    }
    if (c === ';' || c === '|' || c === '&') {
      // PowerShell's call operator `& "path"` and a redirect's `>&` are not separators.
      if (c === '&' && powershell && !word && st.words.length === 0) {
        i++
        continue
      }
      if (c === '&' && word && /[<>]$/.test((word as Word).text)) {
        (word as Word).text += c
        i++
        continue
      }
      i += command[i + 1] === c ? 2 : 1
      endStatement()
      continue
    }
    if (c === '<' && heredocStart()) continue
    if (powershell && !word && c === '@' && (command[i + 1] === "'" || command[i + 1] === '"')) {
      const q = command[i + 1]
      const open = /^@['"][ \t]*\r?\n/.exec(command.slice(i))
      if (open) {
        const close = command.indexOf(`\n${q}@`, i + open[0].length - 1)
        const end = close === -1 ? n : close
        const body = command.slice(i + open[0].length, end).replace(/\r$/, '')
        const w = startWord()
        if (w.text === '') w.literalStart = true
        w.text += body
        if (q === '"' && /\$/.test(body)) w.dynamic = true
        i = close === -1 ? n : close + 3
        continue
      }
    }
    const w = startWord()
    if ((c === "'" || c === '"' || c === esc) && w.text === '') w.literalStart = true
    if (c === "'") {
      let j = i + 1
      while (j < n) {
        if (command[j] === "'") {
          if (powershell && command[j + 1] === "'") {
            w.text += "'"
            j += 2
            continue
          }
          break
        }
        w.text += command[j]
        j++
      }
      i = j + 1
      continue
    }
    if (c === '"') {
      i++
      while (i < n && command[i] !== '"') {
        const d = command[i] ?? ''
        if (d === esc && i + 1 < n) {
          const nx = command[i + 1] ?? ''
          // Bash keeps a backslash inside double quotes unless it escapes $ ` " \ or a newline (a
          // continuation, dropped whole): "C:\Users\me" stays as typed.
          if (powershell) w.text += ({ n: '\n', t: '\t', '`': '`' } as Record<string, string>)[nx] ?? nx
          else if ('$`"\\'.includes(nx)) w.text += nx
          else if (nx !== '\n') w.text += d + nx
          i += 2
          continue
        }
        if (d === '$' && command[i + 1] === '(') {
          substitution(w)
          continue
        }
        if (d === '$' && /[A-Za-z_{]/.test(command[i + 1] ?? '')) w.dynamic = true
        if (d === '`' && !powershell) w.dynamic = true
        w.text += d
        i++
      }
      i++
      continue
    }
    if (c === '$' && command[i + 1] === '(') {
      substitution(w)
      continue
    }
    if (c === '$' && /[A-Za-z_{]/.test(command[i + 1] ?? '')) w.dynamic = true
    if (c === '`' && !powershell) w.dynamic = true
    if (c === esc && i + 1 < n) {
      w.text += command[i + 1]
      i += 2
      continue
    }
    w.text += c
    i++
  }
  endStatement()
  return out
}

// Words that run the command after them: shell keywords (`then git commit ...` in an `if`, `do gh ...`
// in a loop) and wrappers, with the options of each that take a value.
const WRAPPERS = new Map<string, RegExp | null>(Object.entries({
  if: null, then: null, elif: null, else: null, while: null, until: null, do: null, '!': null, '{': null,
  time: null, nohup: null, builtin: null, command: null,
  exec: /^-a$/,
  sudo: /^-[ugpCDhrtTU]$|^--(user|group|prompt|chdir|host|role|type|other-user|close-from)$/,
  env: /^-[uCS]$|^--(unset|chdir|split-string)$/,
  nice: /^-n$|^--adjustment$/,
  timeout: /^-[sk]$|^--(signal|kill-after)$/,
  xargs: /^-[IiLlnPdEsa]$|^--(replace|max-lines|max-args|max-procs|delimiter|eof|max-chars|arg-file)$/,
}))

/**
 * The program a statement runs: its first word past `VAR=x` assignments, shell keywords and wrappers
 * (`sudo`, `env`, `time`, `timeout 60`, `xargs -I{}`, ...), cut to the file name.
 */
export function programOf(st: Statement): { name: string; args: Word[] } {
  const words = st.words
  let k = 0
  for (;;) {
    while (k < words.length && /^[A-Za-z_]\w*=/.test(words[k]?.text ?? '')) k++
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
