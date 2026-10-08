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
  /** Holds an expansion outside quotes, which the shell splits into words at blanks (`$F`, not `"$F"`). */
  splits?: boolean
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
  /** Inside a `( )` subshell or a PowerShell `{ }` block: a `cd` there may not move what follows. */
  isNested?: boolean
  /** The Bash subshells it runs in, outermost first (`1/3`); none at the top. A variable set in one is
   * known inside it and gone once it closes. A PowerShell `{ }` block keeps its variables, so has none. */
  scope?: string
  /** For a statement inside a `$(...)` or backticks: which one, numbered within its parse. */
  group?: number
  /** PowerShell: run through the call operator (`& $git commit`). */
  isCall?: boolean
}

const REDIRECT = /^(\d*)(>>?|<)(&\d+|&-)?$/
const REDIRECT_ATTACHED = /^\d*(>>?|<)(?!&)(.+)$/

// `<<EOF`, `<<'EOF'`, `<<"EOF"` and `<<\EOF` (quoted with a backslash), each with an optional `-`.
const HEREDOC = /^<<(-?)[ \t]*(\\?)(["']?)([A-Za-z_][\w.-]*)\3/

// A here-doc queued on the current line. `owner`: the statement that opened it; a line can go on past
// it (`<<'EOF' && git push`). `isQuoted`: its delimiter was quoted, so the body is literal.
type Pending = { delim: string; strip: boolean; owner?: Statement; isQuoted?: boolean }

// An expansion in an unquoted here-doc body: `$NAME`, `${...}`, `$(...)`, a backtick, or a backslash (the
// shell drops a backslash-newline, joining two lines, and turns `\$`, `\\` and `` \` `` into one character).
const BODY_EXPANSION = /\$[A-Za-z_{(]|`|\\/

// Words after which the next one is still in command position, where `case` opens a block.
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!', '{', 'time'])

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
  // How many `( )` subshells or PowerShell `{ }` blocks the reading is inside.
  private depth = 0
  // The Bash subshells open now, each with its own number.
  private scopes: number[] = []
  private opened = 0
  // `$(...)` and backtick substitutions read so far.
  private groups = 0
  // The Bash `case` blocks open now, innermost last: `head` before its `in`, `pattern` while an arm's
  // pattern is due, `body` inside an arm; `at` is the index of its `case` word, `depth` where it opened.
  private cases: { state: 'head' | 'pattern' | 'body'; at: number; depth: number }[] = []
  // A Bash `$(...)` read by a reader of its own: the `)` that closes it ends the reading.
  private isClosed = false

  constructor(
    private readonly command: string,
    private readonly powershell: boolean,
    start = 0,
    private readonly isSubstitution = false,
  ) {
    this.esc = powershell ? '`' : '\\'
    this.n = command.length
    this.i = start
  }

  run(): Statement[] {
    while (this.i < this.n && !this.isClosed) this.step(this.command[this.i] ?? '')
    this.endStatement()
    return this.out
  }

  /** Where the reading stopped: past the `)` that closed a substitution, or the end of the text. */
  get position(): number {
    return this.i
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
    if (isPlain && this.caseWord(w.text)) return
    this.st.words.push(w)
  }

  // `case`, its `in` and `esac` where the shell reads them as its own words. True for an `esac`, which
  // ends the block and is no command word.
  private caseWord(text: string): boolean {
    if (this.powershell) return false
    const words = this.st.words
    const top = this.cases.at(-1)
    const here = top?.depth === this.depth ? top : undefined
    const isCommand = words.every(x => KEYWORDS.has(x.text))
    if (text === 'case' && isCommand) this.cases.push({ state: 'head', at: words.length, depth: this.depth })
    // `in` after the subject, on its line or a line of its own (`case $x` newline `in`).
    else if (text === 'in' && here?.state === 'head' && (words.length === here.at + 2 || words.length === 0))
      here.state = 'pattern'
    else if (text === 'esac' && words.length === 0 && here && here.state !== 'head') {
      this.cases.pop()
      return true
    }
    return false
  }

  // A case pattern (`a)`, `(a|b)`, `@(x|y))`) where one is due, read whole: it runs nothing, and its `)`
  // closes no subshell. An `esac` there ends the block. True when the reading took `c` so.
  private casePattern(c: string): boolean {
    const top = this.cases.at(-1)
    if (this.word || top?.state !== 'pattern' || top.depth !== this.depth) return false
    // The `case ... in` words are a statement of their own: a `$(...)` in its subject runs.
    this.endStatement()
    if (/^esac(?=$|[\s;&|)])/.test(this.command.slice(this.i, this.i + 5))) {
      this.cases.pop()
      this.i += 4
      return true
    }
    if (c === '(') this.i++
    let nest = 0
    let quote = ''
    // A `$(...)` or backtick in a pattern runs: its commands are read, as statements of the arm.
    const runs: Word = { text: '', dynamic: false, bodies: [] }
    while (this.i < this.n) {
      const d = this.command[this.i]
      if (quote !== "'" && d === '$' && this.at(1) === '(') this.substitution(runs)
      else if (quote !== "'" && d === '`') this.backtick(runs)
      else if (this.patternChar(d, quote, nest)) break
      else {
        if (quote && d === quote) quote = ''
        else if (d === '\\' && quote !== "'") this.i++
        else if (!quote && (d === "'" || d === '"')) quote = d
        else if (!quote && d === '(') nest++
        else if (!quote && d === ')') nest--
        this.i++
      }
    }
    this.i++
    top.state = 'body'
    return true
  }

  // The `)` that ends a case pattern: outside quotes, with every paren the pattern opened closed.
  private patternChar(d: string | undefined, quote: string, nest: number): boolean {
    return d === ')' && !quote && nest === 0
  }

  private endStatement(pipeNext = false) {
    this.endWord()
    this.redirectNext = null
    const st = this.st
    if (st.words.length > 0 || st.heredocs.length > 0 || st.inner.length > 0) this.out.push(st)
    this.st = fresh(pipeNext)
    if (this.depth > 0) this.st.isNested = true
    if (this.scopes.length > 0) this.st.scope = this.scopes.join('/')
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
        // Only a line that is exactly the delimiter ends the body; ` EOF` or `EOF ` is body text.
        if (line === delim) break
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
    const isQuoted = m[2] !== '' || m[3] !== ''
    this.pending.push({ delim: m[4] ?? '', strip: m[1] === '-', owner: this.st, isQuoted })
    this.i += m[0].length
    return true
  }

  // `$(`, `<(` or `>(` at `i` (PowerShell `$(`, `(`, `@(` and `@{`): the substitution read whole and kept
  // raw, and the commands inside it read as statements of their own. In Bash a reader of its own reads
  // them up to the `)` that closes them, as the shell does, and their here-doc bodies are the word's.
  private substitution(w: Word, braces = false) {
    const start = this.i
    w.dynamic = true
    if (this.powershell) {
      this.skipSubstitution(braces)
      const raw = this.command.slice(start, this.i)
      w.text += raw
      const open = raw.indexOf('(')
      if (!braces && open !== -1 && raw.endsWith(')')) this.pushInner(parse(raw.slice(open + 1, -1), true))
      return
    }
    const sub = new Reader(this.command, false, this.command.indexOf('(', start) + 1, true)
    const statements = sub.run()
    this.i = sub.position
    w.text += this.command.slice(start, this.i)
    w.bodies.push(...statements.flatMap(st => st.heredocs))
    this.pushInner(statements)
  }

  // A Bash backtick substitution at `i`, kept raw like `$(...)`; the commands inside, with the backslash
  // before a backtick, `$` or backslash dropped, are read as statements of their own.
  private backtick(w: Word) {
    let j = this.i + 1
    let inner = ''
    while (j < this.n && this.command[j] !== '`') {
      const nx = this.command[j + 1] ?? ''
      const isEscape = this.command[j] === '\\' && nx !== '' && '`$\\'.includes(nx)
      inner += isEscape ? nx : this.command[j]
      j += isEscape ? 2 : 1
    }
    w.text += this.command.slice(this.i, Math.min(j + 1, this.n))
    w.dynamic = true
    this.pushInner(parse(inner, false))
    this.i = j + 1
  }

  // The statements of one substitution, marked as one group: each runs in a subshell of its own.
  private pushInner(statements: Statement[]) {
    const group = ++this.groups
    for (const st of statements) st.group = group
    this.st.inner.push(...statements)
  }

  // Moves `i` past the closing bracket of the PowerShell substitution at `i`, past quotes and here-strings.
  private skipSubstitution(braces: boolean) {
    let depth = 0
    let quote = ''
    while (this.i < this.n) {
      const c = this.command[this.i]
      const hereString = !quote && c === '@' ? /^@(['"])[ \t]*\r?\n/.exec(this.command.slice(this.i)) : null
      if (hereString) {
        const close = this.command.indexOf(`\n${hereString[1]}@`, this.i)
        this.i = close === -1 ? this.n : close + 3
      } else if (quote) {
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
      } else this.i++
    }
  }

  private step(c: string) {
    if (this.layout(c) || this.casePattern(c) || this.structure(c) || this.separator(c)) return
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
      this.depth = Math.max(0, this.depth + (c === '{' ? 1 : -1))
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
    // `X=(a b)` and `X+=(c)`: an array, whose value the reading does not keep.
    if (c === '(' && this.word && /^[A-Za-z_]\w*\+?=$/.test(this.word.text)) return this.arrayValue(this.word)
    // `(` and `)` outside quotes open and close a subshell; the commands inside are statements.
    if (c !== '(' && c !== ')') return false
    this.i++
    if (c === ')' && this.isSubstitution && this.depth === 0) {
      this.isClosed = true
      return true
    }
    this.depth = Math.max(0, this.depth + (c === '(' ? 1 : -1))
    if (c === '(') this.scopes.push(++this.opened)
    else this.scopes.pop()
    this.endStatement()
    return true
  }

  // The `( ... )` of an array assignment at `i`, read into the word up to its own `)`, with quotes and
  // nested parens skipped and a `$(...)` or backtick in it read as commands that run. Its value is unknown.
  private arrayValue(w: Word): boolean {
    w.dynamic = true
    let quote = ''
    let nest = 0
    while (this.i < this.n) {
      const d = this.command[this.i] ?? ''
      if (quote !== "'" && d === '$' && this.at(1) === '(') this.substitution(w)
      else if (quote !== "'" && d === '`') this.backtick(w)
      else {
        w.text += d
        this.i++
        if (d === '\\' && quote !== "'") w.text += this.command[this.i++] ?? ''
        else if (quote && d === quote) quote = ''
        else if (!quote && (d === "'" || d === '"')) quote = d
        else if (!quote && d === '(') nest++
        else if (!quote && d === ')' && --nest === 0) break
      }
    }
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
    // `;;`, `;&` and `;;&` end a case arm: the next pattern is due.
    const top = this.cases.at(-1)
    if (c === ';' && /[;&]/.test(this.at(1)) && top?.state === 'body' && top.depth === this.depth) {
      this.i += this.command.startsWith(';;&', this.i) ? 3 : 2
      top.state = 'pattern'
      this.endStatement()
      return true
    }
    // PowerShell's call operator `& "path"` and a redirect's `>&` are not separators.
    if (c === '&' && this.powershell && !this.word && this.st.words.length === 0) {
      this.st.isCall = true
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
    // `$NAME`, `${...}`, `$(...)` and Bash's special parameters (`$@`, `$1`, `$?`) outside quotes.
    const isExpansion = c === '$' && this.expands(this.at(1))
    // PowerShell passes a variable as one argument; only Bash splits it.
    if (!this.powershell && (isExpansion || c === '`')) w.splits = true
    if (c === '$' && this.at(1) === '(') return this.substitution(w)
    if (isExpansion) w.dynamic = true
    if (c === '`' && !this.powershell) return this.backtick(w)
    if (c === this.esc && this.i + 1 < this.n) {
      w.text += this.at(1)
      this.i += 2
      return
    }
    w.text += c
    this.i++
  }

  // A `$` followed by `next` starts an expansion: a name, `{`, `(`, and in Bash a special parameter.
  private expands(next: string): boolean {
    return /[A-Za-z_{(]/.test(next) || (!this.powershell && /[@*#?$!0-9-]/.test(next))
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
      else if (d === '`' && !this.powershell) this.backtick(w)
      else {
        if (d === '$' && this.expands(this.at(1))) w.dynamic = true
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
