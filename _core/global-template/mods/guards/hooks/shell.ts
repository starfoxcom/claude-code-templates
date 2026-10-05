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
  /** A body holds an expansion the shell fills in at run time (`<<< "$MSG"`, an unquoted `<<EOF`). */
  hasDynamicBody?: boolean
}

const REDIRECT = /^(\d*)(>>?|<)(&\d+|&-)?$/
const REDIRECT_ATTACHED = /^\d*(>>?|<)(?!&)(.+)$/

const HEREDOC = /^<<(-?)[ \t]*(["']?)([A-Za-z_][\w.-]*)\2/

// A here-doc queued on the current line. `owner`: the statement that opened it; a line can go on past
// it (`<<'EOF' && git push`). `isQuoted`: its delimiter was quoted, so the body is literal.
type Pending = { delim: string; strip: boolean; owner?: Statement; isQuoted?: boolean }

// An expansion in an unquoted here-doc body: `$NAME`, `${...}`, `$(...)` or a backtick.
const BODY_EXPANSION = /\$[A-Za-z_{(]|`/

const fresh = (pipeIn = false): Statement => ({ words: [], heredocs: [], writes: [], reads: [], pipeIn, inner: [] })

// One pass over the command text, a character at a time; each method reads one kind of thing.
class Reader {
  private readonly esc: string
  private readonly n: number
  private readonly out: Statement[] = []
  private st: Statement = fresh()
  private word: Word | null = null
  private pending: Pending[] = []
  private redirectNext: 'write' | 'read' | 'text' | null = null
  private i = 0

  constructor(
    private readonly command: string,
    private readonly powershell: boolean,
  ) {
    this.esc = powershell ? '`' : '\\'
    this.n = command.length
  }

  run(): Statement[] {
    while (this.i < this.n) this.step(this.command[this.i] ?? '')
    this.endStatement()
    return this.out
  }

  private at(offset: number): string {
    return this.command[this.i + offset] ?? ''
  }

  private startWord(): Word {
    return (this.word ??= { text: '', dynamic: false, bodies: [] })
  }

  private endWord() {
    if (!this.word) return
    const w = this.word
    this.word = null
    if (this.redirectNext) {
      if (this.redirectNext === 'write') this.st.writes.push(w.text)
      if (this.redirectNext === 'read') this.st.reads.push(w.text)
      if (this.redirectNext === 'text') {
        this.st.heredocs.push(w.text)
        if (w.dynamic) this.st.hasDynamicBody = true
      }
      this.redirectNext = null
      return
    }
    const isPlain = !w.dynamic && !w.literalStart
    const bare = REDIRECT.exec(w.text)
    if (bare && isPlain) {
      if (!bare[3]) this.redirectNext = bare[2] === '<' ? 'read' : 'write'
      return
    }
    const attached = REDIRECT_ATTACHED.exec(w.text)
    if (attached && isPlain && /^[\d<>]/.test(w.text)) {
      ;(attached[1] === '<' ? this.st.reads : this.st.writes).push(attached[2] ?? '')
      return
    }
    this.st.words.push(w)
  }

  private endStatement(pipeNext = false) {
    this.endWord()
    this.redirectNext = null
    if (this.st.words.length > 0 || this.st.heredocs.length > 0) this.out.push(this.st)
    this.st = fresh(pipeNext)
  }

  // Reads the here-doc bodies queued on the line that just ended; `i` sits after its newline.
  private readBodies(into: string[]) {
    for (const { delim, strip, owner, isQuoted } of this.pending) {
      const lines: string[] = []
      while (this.i < this.n) {
        const end = this.command.indexOf('\n', this.i)
        const raw = this.command.slice(this.i, end === -1 ? this.n : end).replace(/\r$/, '')
        this.i = end === -1 ? this.n : end + 1
        const line = strip ? raw.replace(/^\t+/, '') : raw
        if (line.trim() === delim) break
        lines.push(line)
      }
      const body = lines.join('\n')
      ;(owner?.heredocs ?? into).push(body)
      if (owner && !isQuoted && BODY_EXPANSION.test(body)) owner.hasDynamicBody = true
    }
    this.pending = []
  }

  // `<<` at `i`: queues a here-doc; `<<<` makes the next word a body.
  private heredocStart(): boolean {
    if (this.command.startsWith('<<<', this.i)) {
      this.endWord()
      // An ANSI-C string (`$'a\nb'`): the shell turns its escapes into the text the program reads.
      if (this.command.slice(this.i + 3).trimStart().startsWith("$'")) this.st.hasDynamicBody = true
      this.redirectNext = 'text'
      this.i += 3
      return true
    }
    const m = HEREDOC.exec(this.command.slice(this.i))
    if (!m) return false
    this.endWord()
    this.pending.push({ delim: m[3] ?? '', strip: m[1] === '-', owner: this.st, isQuoted: m[2] !== '' })
    this.i += m[0].length
    return true
  }

  // `$(` at `i` (PowerShell also `(`, `@(` and `@{`): the substitution read whole and kept raw, its own
  // here-doc bodies collected, and the commands inside it read as statements of their own.
  private substitution(w: Word, braces = false) {
    const start = this.i
    this.skipSubstitution(w, braces)
    const raw = this.command.slice(start, this.i)
    w.text += raw
    w.dynamic = true
    const open = raw.indexOf(braces ? '{' : '(')
    if (!braces && open !== -1 && raw.endsWith(')'))
      this.st.inner.push(...parse(raw.slice(open + 1, -1), this.powershell))
  }

  // Moves `i` past the closing bracket of the substitution at `i`, reading its here-doc bodies into `w`.
  private skipSubstitution(w: Word, braces: boolean) {
    let depth = 0
    let quote = ''
    let inner: Pending[] = []
    while (this.i < this.n) {
      const c = this.command[this.i]
      if (quote) {
        if (c === quote) quote = ''
        else if (c === this.esc && quote === '"') this.i++
        this.i++
      } else if (c === "'" || c === '"') {
        quote = c
        this.i++
      } else if (c === '(' || (braces && c === '{')) {
        depth++
        this.i++
      } else if (c === ')' || (braces && c === '}')) {
        depth--
        this.i++
        if (depth === 0) return
      } else if (c === '\n' && inner.length > 0) {
        this.i++
        this.innerBodies(inner, w)
        inner = []
      } else if (!this.innerHeredoc(c, inner)) this.i++
    }
  }

  // A here-doc opened inside a substitution: queued apart from the line's own. True when one was.
  private innerHeredoc(c: string | undefined, inner: Pending[]): boolean {
    if (c !== '<' || !this.command.startsWith('<<', this.i) || this.command.startsWith('<<<', this.i)) return false
    const m = HEREDOC.exec(this.command.slice(this.i))
    if (!m) return false
    inner.push({ delim: m[3] ?? '', strip: m[1] === '-' })
    this.i += m[0].length
    return true
  }

  private innerBodies(inner: Pending[], w: Word) {
    const saved = this.pending
    this.pending = inner
    this.readBodies(w.bodies)
    this.pending = saved
  }

  private step(c: string) {
    if (this.layout(c) || this.structure(c) || this.separator(c)) return
    if (c === '<' && this.heredocStart()) return
    if (this.hereString(c)) return
    this.wordChar(c)
  }

  // Line continuations, newlines, blanks and comments. True when `c` was one.
  private layout(c: string): boolean {
    if (c === this.esc && (this.at(1) === '\n' || (this.at(1) === '\r' && this.at(2) === '\n'))) {
      this.i += this.at(1) === '\r' ? 3 : 2
    } else if (c === '\n') {
      this.i++
      const bodies: string[] = []
      this.readBodies(bodies)
      this.st.heredocs.push(...bodies)
      this.endStatement()
    } else if (c === ' ' || c === '\t' || c === '\r') {
      this.endWord()
      this.i++
    } else if (!this.word && c === '#') {
      const end = this.command.indexOf('\n', this.i)
      this.i = end === -1 ? this.n : end
    } else return false
    return true
  }

  // Subshells, process substitutions and PowerShell blocks. True when `c` opened or closed one.
  private structure(c: string): boolean {
    if (!this.powershell) return this.bashStructure(c)
    if (this.word) return false
    if (c === '(') this.substitution(this.startWord())
    else if (c === '{' || c === '}') {
      this.i++
      this.endStatement()
    } else if (c === '@' && (this.at(1) === '(' || this.at(1) === '{'))
      this.substitution(this.startWord(), this.at(1) === '{')
    else return false
    return true
  }

  private bashStructure(c: string): boolean {
    // `<(...)` and `>(...)` are process substitutions, a file name built at run time.
    if ((c === '<' || c === '>') && this.at(1) === '(') {
      const w = this.startWord()
      w.text += c
      this.i++
      this.substitution(w)
      return true
    }
    // `(` and `)` outside quotes open and close a subshell; the commands inside are statements.
    if (c !== '(' && c !== ')') return false
    this.i++
    this.endStatement()
    return true
  }

  // Pipes and statement separators. True when `c` was one, or a `&` that is not a separator.
  private separator(c: string): boolean {
    if (c === '|' && this.at(1) !== '|') {
      this.i += this.at(1) === '&' ? 2 : 1
      this.endStatement(true)
      return true
    }
    if (c !== ';' && c !== '|' && c !== '&') return false
    // PowerShell's call operator `& "path"` and a redirect's `>&` are not separators.
    if (c === '&' && this.powershell && !this.word && this.st.words.length === 0) {
      this.i++
      return true
    }
    if (c === '&' && this.word && /[<>]$/.test(this.word.text)) {
      this.word.text += c
      this.i++
      return true
    }
    this.i += this.at(1) === c ? 2 : 1
    this.endStatement()
    return true
  }

  // A PowerShell here-string, `@'...'@` or `@"..."@`, as one word. True when `c` opened one.
  private hereString(c: string): boolean {
    if (!this.powershell || this.word || c !== '@' || (this.at(1) !== "'" && this.at(1) !== '"')) return false
    const q = this.at(1)
    const open = /^@['"][ \t]*\r?\n/.exec(this.command.slice(this.i))
    if (!open) return false
    const close = this.command.indexOf(`\n${q}@`, this.i + open[0].length - 1)
    const end = close === -1 ? this.n : close
    const body = this.command.slice(this.i + open[0].length, end).replace(/\r$/, '')
    const w = this.startWord()
    if (w.text === '') w.literalStart = true
    w.text += body
    if (q === '"' && /\$/.test(body)) w.dynamic = true
    this.i = close === -1 ? this.n : close + 3
    return true
  }

  private wordChar(c: string) {
    const w = this.startWord()
    if ((c === "'" || c === '"' || c === this.esc) && w.text === '') w.literalStart = true
    if (c === "'") return this.singleQuoted(w)
    if (c === '"') return this.doubleQuoted(w)
    if (c === '$' && this.at(1) === '(') return this.substitution(w)
    if (c === '$' && /[A-Za-z_{]/.test(this.at(1))) w.dynamic = true
    if (c === '`' && !this.powershell) w.dynamic = true
    if (c === this.esc && this.i + 1 < this.n) {
      w.text += this.at(1)
      this.i += 2
      return
    }
    w.text += c
    this.i++
  }

  private singleQuoted(w: Word) {
    let j = this.i + 1
    while (j < this.n) {
      if (this.command[j] === "'") {
        if (!this.powershell || this.command[j + 1] !== "'") break
        w.text += "'"
        j += 2
        continue
      }
      w.text += this.command[j]
      j++
    }
    this.i = j + 1
  }

  private doubleQuoted(w: Word) {
    this.i++
    while (this.i < this.n && this.command[this.i] !== '"') {
      const d = this.command[this.i] ?? ''
      if (d === this.esc && this.i + 1 < this.n) this.escapeInDouble(w, d)
      else if (d === '$' && this.at(1) === '(') this.substitution(w)
      else {
        if (d === '$' && /[A-Za-z_{]/.test(this.at(1))) w.dynamic = true
        if (d === '`' && !this.powershell) w.dynamic = true
        w.text += d
        this.i++
      }
    }
    this.i++
  }

  // Bash keeps a backslash inside double quotes unless it escapes $ ` " \ or a newline (a continuation,
  // dropped whole): "C:\Users\me" stays as typed.
  private escapeInDouble(w: Word, d: string) {
    const nx = this.at(1)
    if (this.powershell) w.text += ({ n: '\n', t: '\t', '`': '`' } as Record<string, string>)[nx] ?? nx
    else if ('$`"\\'.includes(nx)) w.text += nx
    else if (nx !== '\n') w.text += d + nx
    this.i += 2
  }
}

export function parse(command: string, powershell: boolean): Statement[] {
  return new Reader(command, powershell).run()
}

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
