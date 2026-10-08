// A reading of Bash or PowerShell text good enough to tell which program runs and what its arguments
// and message texts are. Pure functions, no engine access, so tests import them directly.
//
// It is a safety net for commands written the ordinary way, not a shell: text the shell builds at run
// time is marked `dynamic` and named as unread, never guessed at.

import { ansiBody, isBalanced, isCasts, isExpression, plain, PS_ESCAPES, sliceWord } from './quoting'

export type Word = {
  /** The word as the program receives it: quotes removed, escapes applied. */
  text: string
  /** Holds an expansion ($VAR, $(...), backticks) whose value the reading cannot know. */
  dynamic: boolean
  /** Here-doc bodies written inside a `$(...)` of this word: `-m "$(cat <<'EOF' ... EOF)"`. */
  bodies: string[]
  /** Its first character came from quotes or an escape, so a leading `<` or `>` is text, not a redirect;
   * `quotedStart` when from quotes (`'`, `"`, a here-string, `$'`), so it is a value, never a command. */
  literalStart?: boolean
  quotedStart?: boolean
  /** Holds an expansion outside quotes, which the shell splits into words at blanks (`$F`, not `"$F"`). */
  splits?: boolean
  /** PowerShell: holds a comma outside quotes, so it is a list, passed to a program as several arguments. */
  list?: boolean
  /** PowerShell: an expression PowerShell computes (`'--x'.Trim()`, `$o.Trim()`, `[string]'x'`), so its
   * value is unknown. */
  expr?: boolean
  /** PowerShell: holds a quoted part, so an unquoted character after it makes the word an expression. */
  quoted?: boolean
  /** Where in `text` a `$` or a backtick was typed as plain text (in single quotes, or escaped): the shell
   * passes it on as is, so it starts no expansion. */
  literals?: number[]
}

export type Statement = {
  words: Word[]
  /** Here-doc, here-string and `<<<` bodies fed to this statement. */
  heredocs: string[]
  /** Files this statement writes through `>` / `>>`. */
  writes: string[]
  /** The word of each `writes` entry that holds an expansion, at the same index; none for a literal one. */
  writeWords?: (Word | undefined)[]
  /** Files fed to this statement through `<`. */
  reads: string[]
  /** The word of each `reads` entry that holds an expansion, at the same index. */
  readWords?: (Word | undefined)[]
  /** Its input comes from the statement before it, through a pipe. */
  pipeIn: boolean
  /** Commands run inside a `$(...)` of its words (`PR=$(gh pr create ...)`); they run before it. */
  inner: Statement[]
  /** A body holds an expansion the shell fills in at run time (`<<< "$MSG"`, an unquoted `<<EOF`). */
  hasDynamicBody?: boolean
  /** Inside a `( )` subshell or a PowerShell `{ }` block: a `cd` there may not move what follows. */
  isNested?: boolean
  /** Where it runs, outermost first (`1/c3`); none at the top. A number is a Bash subshell (a `( )`, a
   * pipeline part, a job sent to the background): what it sets is gone once it closes. `c<n>` is a branch
   * that may not run (an `if` or `case` arm, a loop body, the part after `&&` or `||`, a function body, a
   * PowerShell block): what it sets is known inside it, and unknown where the branch sits. */
  scope?: string
  /** For a statement inside a `$(...)` or backticks: which one, numbered within its parse. */
  group?: number
  /** PowerShell: run through the call operator (`& $git commit`), or dot-sourced (`. $git commit`). */
  isCall?: boolean
  /** PowerShell: dot-sourced, so what it runs sets variables in this scope. */
  isSourced?: boolean
  /** In a function body, a `trap` action or a PowerShell script block: it may run at any later point, so a
   * value it sets leaves the name unknown from then on. */
  isDeferred?: boolean
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

// The keywords that open a block after their own statement, closed by `fi` or `done`.
const OPENERS = new Set(['if', 'while', 'until', 'for', 'select'])
const PS_IN_PLACE = /^(if|elseif|else|foreach|for|while|do|until|switch|try|catch|finally)$/
const FN_PARENS = /^[(][ \t]*[)]/

// A block the reader is inside: a Bash subshell, a branch (`cond`), a `case` arm, a `{ }` group or a body
// that runs later (`fn`). `at`: where its scopes end; `chain`, `list`: see `Reader.levels`; `isOr`: the
// list's last operator was `||`; `from`: the index in `out` of its first statement; `isBrace`: a subshell a
// `{` opened, as a pipeline part (`echo | { read M; }`).
type Level = { kind: 'sub' | 'cond' | 'arm' | 'group' | 'fn'; at: number; chain?: number; isOr?: boolean }
  & { list: number; from: number; isBrace?: boolean }

const joined = (outer: string | undefined, inner: string) => [outer, inner].filter(Boolean).join('/')

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
  // The subshells and branches open now, outermost first: a number for a Bash subshell, `c<n>` for a branch
  // (see `Statement.scope`).
  private scopes: string[] = []
  private opened = 0
  // `$(...)` and backtick substitutions read so far.
  private groups = 0
  // The Bash `case` blocks open now, innermost last: `head` before its `in`, `pattern` while an arm's
  // pattern is due, `body` inside an arm; `at` is the index of its `case` word, `depth` where it opened.
  private cases: { state: 'head' | 'pattern' | 'body'; at: number; depth: number }[] = []
  // A Bash `$(...)` read by a reader of its own: the `)` that closes it ends the reading.
  private isClosed = false
  // The blocks open now, innermost last, each with where its own scopes end in `scopes`. `chain`: where the
  // `&&`/`||` list read at that level started there, once it has one; `list`: the index in `out` of that
  // list's first statement.
  private levels: Level[] = [{ kind: 'group', at: 0, list: 0, from: 0 }]
  // The `{ }` group whose `}` the statement being read is, by where its statements start in `out`.
  private closedGroup?: number
  // The line goes on past its end: it stopped at a `|`, `&&` or `||`.
  private continues = false
  // A function's name was just read (`f()`, `function f`): the block that follows is its body.
  private isFnNext = false

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
      if (this.redirectNext === 'write') this.redirect(false, w)
      if (this.redirectNext === 'read') this.redirect(true, w)
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
    // A redirect joined to its target, which may hold an expansion (`>"$F"`, `<$IN`), never a process
    // substitution or a here-string (`<(...)`, `<<<"$X"`).
    const attached = REDIRECT_ATTACHED.exec(w.text)
    const isJoined = !w.literalStart && (!w.dynamic || !/^[(<]/.test(attached?.[2] ?? ''))
    if (attached && isJoined && /^[\d<>]/.test(w.text)) {
      const target = attached[2] ?? ''
      this.redirect(attached[1] === '<', sliceWord(w, w.text.length - target.length))
      return
    }
    if (isPlain && this.caseWord(w.text)) return
    // PowerShell's dot-source operator runs the program after it, as `&` does, in this scope.
    if (isPlain && this.powershell && w.text === '.' && this.st.words.length === 0) {
      this.st.isCall = this.st.isSourced = true
      return
    }
    // `function f { ...`: the body starts a statement of its own.
    const words = this.st.words
    if (isPlain && w.text === '{' && words.length === 2 && words[0]?.text === 'function') this.endStatement()
    if (isPlain && !this.powershell && this.st.words.every(x => KEYWORDS.has(x.text))) this.keyword(w.text)
    this.continues = false
    this.st.words.push(w)
  }

  // A `<` or `>` target. One holding an expansion is kept whole, so it is filled in as the shell does.
  private redirect(isRead: boolean, w: Word) {
    const paths = isRead ? this.st.reads : this.st.writes
    if (w.dynamic) (isRead ? (this.st.readWords ??= []) : (this.st.writeWords ??= []))[paths.length] = w
    paths.push(w.text)
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
      if (here.state === 'body') this.closeTo(['arm'])
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
    this.open('arm')
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
    const group = this.closedGroup
    this.closedGroup = undefined
    if (st.words.length > 0 || st.heredocs.length > 0 || st.inner.length > 0) {
      // Each part of a Bash pipeline runs in a subshell of its own.
      if (!this.powershell && (pipeNext || st.pipeIn)) st.scope = joined(st.scope, String(++this.opened))
      if (this.levels.some(l => l.kind === 'fn')) st.isDeferred = true
      this.out.push(st)
      // A `{ }` group piped on (`{ cd x; } | tail`) runs in a subshell of its own, all of it.
      if (!this.powershell && pipeNext && group !== undefined) this.retag(group, this.scopes.join('/'))
    }
    this.st = fresh(pipeNext)
    if (this.depth > 0) this.st.isNested = true
    this.rescope()
    if (!this.powershell) this.opens(st)
  }

  private rescope() {
    this.st.scope = this.scopes.length > 0 ? this.scopes.join('/') : undefined
  }

  private get level(): Level {
    return this.levels.at(-1) as Level
  }

  // Opens a block for the statements after this point; all but a `{ }` group get a scope of their own.
  private open(kind: Level['kind'], isBrace?: boolean) {
    if (kind !== 'group') this.scopes.push(kind === 'sub' ? String(++this.opened) : `c${++this.opened}`)
    this.levels.push({ kind, at: this.scopes.length, list: this.out.length, from: this.out.length, isBrace })
    this.rescope()
  }

  // Closes blocks up to the innermost one of `kinds`, never past a subshell it does not name.
  private closeTo(kinds: Level['kind'][]) {
    while (this.levels.length > 1) {
      const lv = this.level
      if (lv.kind === 'sub' && !kinds.includes('sub')) return
      this.levels.pop()
      this.scopes.length = lv.at - (lv.kind === 'group' ? 0 : 1)
      this.rescope()
      if (kinds.includes(lv.kind)) return
    }
  }

  // Bash reads a list left to right (`a || b && c` is `(a || b) && c`). After `&&` the next statement runs
  // only when the list so far succeeded: in a branch inside the last one's, unless an `||` came before it,
  // when that branch may not have run. After `||` it runs only when the list failed: in a branch beside them.
  private chain(op: string) {
    const lv = this.level
    lv.chain ??= this.scopes.length
    if (op === '|' || lv.isOr) this.scopes.length = lv.chain
    lv.isOr = op === '|'
    this.scopes.push(`c${++this.opened}`)
    this.rescope()
  }

  // The end of a list (`;`, a line break, `&`): its branches close. A list sent to the background with `&`
  // runs in a subshell of its own, so what it sets is gone after it.
  private endList(isBackground = false) {
    const lv = this.level
    const start = lv.chain ?? this.scopes.length
    if (isBackground && !this.powershell) this.retag(lv.list, this.scopes.slice(0, start).join('/'))
    this.scopes.length = start
    lv.chain = undefined
    lv.isOr = undefined
    lv.list = this.out.length
    this.rescope()
  }

  // The statements of `out` from `from` on, moved into a subshell of their own inside `base`.
  private retag(from: number, base: string) {
    const tag = String(++this.opened)
    for (const st of this.out.slice(from))
      st.scope = joined(joined(base, tag), (st.scope ?? '').slice(base.length).replace(/^[/]/, ''))
  }

  // The blocks a statement's leading keywords open after it (`if`, `while`, `until`, `for`, `select`), and
  // a function named by `function f`, whose body comes later.
  private opens(st: Statement) {
    for (const w of st.words) {
      if (w.dynamic || !(KEYWORDS.has(w.text) || OPENERS.has(w.text))) break
      if (OPENERS.has(w.text)) this.open('cond')
    }
    if (st.words[0]?.text === 'function' && st.words.length === 2) this.isFnNext = true
  }

  // A keyword where a command starts that opens or closes a block at once: the statement goes on inside
  // it (`{ M=x`, `else M=y`) or after it (`fi > log`).
  private keyword(text: string) {
    const isFn = this.isFnNext
    this.isFnNext = false
    if (text === 'else' || text === 'elif') {
      if (this.level.kind !== 'cond') return
      this.closeTo(['cond'])
      this.open('cond')
    } else if (text === 'fi' || text === 'done') this.closeTo(['cond'])
    else if (text === '}') this.closeBrace()
    // After a `|` the group is a pipeline part: a subshell.
    else if (text === '{') this.open(isFn ? 'fn' : this.st.pipeIn ? 'sub' : 'group', !isFn && this.st.pipeIn)
  }

  // A `}`: it closes the subshell a piped `{` opened, or the innermost group or function body, remembered
  // for a `|` after it.
  private closeBrace() {
    const lv = this.level
    if (lv.kind === 'sub' && lv.isBrace) return this.closeTo(['sub'])
    const at = this.levels.findLastIndex(l => l.kind === 'group' || l.kind === 'fn')
    const group = at > 0 ? this.levels[at] : undefined
    this.closeTo(['group', 'fn'])
    if (group?.kind === 'group' && this.levels.length <= at) this.closedGroup = group.from
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
      if (!this.continues) this.endList()
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
    // A word of casts only (`[void]`, `[ordered]`, `[System.Collections.Generic.List[string]]`) still opens
    // what follows it: `[void](git ...)` runs the pipeline inside, `[ordered]@{ ... }` is one hashtable.
    const isCast = this.word !== null && isCasts(this.word.text)
    if (this.word && !(isCast && (c === '(' || c === '@'))) return false
    if (c === '(') this.substitution(this.startWord())
    else if (c === '{') {
      // A block an `if`, a loop, `switch` or `try` runs in place; any other is a script block that may run
      // at any later point (a function, `& { }`, `$b = { }`).
      const head = this.st.words[0]?.text.toLowerCase() ?? ''
      this.i++
      this.depth++
      this.endStatement()
      this.open(PS_IN_PLACE.test(head) ? 'cond' : 'fn')
    } else if (c === '}') {
      this.i++
      this.depth = Math.max(0, this.depth - 1)
      this.endStatement()
      this.closeTo(['cond', 'fn'])
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
    // `f()` names a function: the block after it is its body.
    const fn = c === '(' ? FN_PARENS.exec(this.command.slice(this.i)) : null
    if (fn) {
      this.i += fn[0].length
      this.endStatement()
      this.isFnNext = true
      return true
    }
    // `(` and `)` outside quotes open and close a subshell; the commands inside are statements.
    if (c !== '(' && c !== ')') return false
    this.i++
    if (c === ')' && this.isSubstitution && this.depth === 0) {
      this.isClosed = true
      return true
    }
    this.depth = Math.max(0, this.depth + (c === '(' ? 1 : -1))
    this.endStatement()
    this.isFnNext = false
    if (c === '(') this.open('sub')
    else this.closeTo(['sub'])
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
      this.continues = true
      return true
    }
    if (c !== ';' && c !== '|' && c !== '&') return false
    // `;;`, `;&` and `;;&` end a case arm: the next pattern is due.
    const top = this.cases.at(-1)
    if (c === ';' && /[;&]/.test(this.at(1)) && top?.state === 'body' && top.depth === this.depth) {
      this.i += this.command.startsWith(';;&', this.i) ? 3 : 2
      top.state = 'pattern'
      this.endStatement()
      this.closeTo(['arm'])
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
    const isChain = c !== ';' && this.at(1) === c
    this.i += this.at(1) === c ? 2 : 1
    this.endStatement()
    if (isChain) this.chain(c)
    else this.endList(c === '&')
    this.continues = isChain
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
    if (w.text === '') w.literalStart = w.quotedStart = true
    if (q === "'") plain(w, body)
    // In `@"..."@` a backtick escapes the character after it, as in `"..."`.
    else for (let k = 0; k < body.length; k++) {
      if (body[k] !== '`' || k + 1 >= body.length) w.text += body[k]
      else plain(w, PS_ESCAPES[body[++k] ?? ''] ?? body[k] ?? '')
    }
    if (q === '"' && /\$/.test(body)) w.dynamic = true
    this.i = close === -1 ? this.n : close + 3
    return true
  }

  // PowerShell ends an assignment's target at its operator, spaced or not (`$r=git`, `$a+= 1`, `$m =$x`):
  // the operator becomes a word of its own, so every reader sees `$r`, `=`, `git`. Only in a statement that
  // opens with a variable or a cast, before its first operator, and outside brackets (`[P(M=$true)]`).
  private assignOperator(c: string): boolean {
    if (!this.powershell || c !== '=' || this.at(1) === '=' || this.st.isCall) return false
    const head = this.st.words[0] ?? this.word
    if (!head || head.literalStart || !/^[$[]/.test(head.text)) return false
    // A chained assignment (`$a = $b = 1`) has targets after an operator too, up to the first value word.
    const ops = this.st.words.map(w => !w.literalStart && PS_OPERATOR.test(w.text))
    const after = this.st.words.slice(ops.lastIndexOf(true) + 1)
    if (!after.every(w => /^[$[,]|,$/.test(w.text) && !w.literalStart)) return false
    const w = this.word
    if (w && !isBalanced(w.text)) return false
    const prefix = (w && /(?:[-+*/%]|\?\?)$/.exec(w.text)?.[0]) ?? ''
    if (w) w.text = w.text.slice(0, w.text.length - prefix.length)
    if (w?.text === '') this.word = null
    this.endWord()
    this.st.words.push({ text: `${prefix}=`, dynamic: false, bodies: [] })
    this.i++
    return true
  }

  private wordChar(c: string) {
    if (this.assignOperator(c)) return
    const w = this.startWord()
    if (this.powershell && isExpression(w, c)) {
      w.expr = true
      w.dynamic = true
    }
    if ((c === "'" || c === '"' || c === this.esc) && w.text === '') w.literalStart = true
    if ((c === "'" || c === '"') && w.text === '') w.quotedStart = true
    if (c === "'" || c === '"') w.quoted = true
    if (c === "'") return this.singleQuoted(w)
    if (c === '"') return this.doubleQuoted(w)
    // Bash's `$'...'`: a quoted string with backslash escapes, no expansion.
    if (c === '$' && !this.powershell && this.at(1) === "'") {
      if (w.text === '') w.literalStart = w.quotedStart = true
      w.quoted = true
      const body = ansiBody(this.command.slice(this.i + 2))
      plain(w, body.text)
      this.i += 2 + body.length
      return
    }
    // `$NAME`, `${...}`, `$(...)` and Bash's special parameters (`$@`, `$1`, `$?`) outside quotes.
    const isExpansion = c === '$' && this.expands(this.at(1))
    // PowerShell passes a variable as one argument; only Bash splits it.
    if (!this.powershell && (isExpansion || c === '`')) w.splits = true
    if (this.powershell && c === ',') w.list = true
    // PowerShell passes a variable that holds a list as several arguments: a bare one may be many words.
    if (this.powershell && isExpansion && w.text === '' && !w.quoted) w.splits = true
    if (c === '$' && this.at(1) === '(') return this.substitution(w)
    if (isExpansion) w.dynamic = true
    if (c === '`' && !this.powershell) return this.backtick(w)
    if (c === this.esc && this.i + 1 < this.n) {
      plain(w, this.at(1))
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
      plain(w, this.command[j] ?? '')
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
    if (this.powershell) plain(w, PS_ESCAPES[nx] ?? nx)
    else if ('$`"\\'.includes(nx)) plain(w, nx)
    else if (nx !== '\n') w.text += d + nx
    this.i += 2
  }
}

/** A PowerShell assignment operator: `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `??=`. */
export const PS_OPERATOR = /^(?:[-+*/%]|\?\?)?=$/

export function parse(command: string, powershell: boolean): Statement[] {
  return new Reader(command, powershell).run()
}
