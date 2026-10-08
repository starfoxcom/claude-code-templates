// The plain-command rule. A command whose text names a git history write, a GitHub write or a hook switch
// is judged only when it is plain: git, gh and a few read-only programs, joined by `&&`, `||`, `;`, a newline
// or a pipe, with each word typed out (plain or in quotes, with no `$` or backtick). Anything else that
// names such a write is refused outright. Reading every spelling a shell allows never converged: each fix
// exposed the next spelling. Refusing what cannot be read for sure does, and a refused command costs only a
// plainer retry. Pure, no engine access.

export const NOT_PLAIN =
  'this command names a git or GitHub write but is not plain, so the guard cannot read it for sure. Run the ' +
  'git or gh call with its words typed out: git, gh and cd calls joined by && or ;, each word plain or in ' +
  'quotes, with no $ or backtick, and no variables, groups, loops, functions or other programs. Write a ' +
  'message or PR body to a file first (with the Write tool) and pass it with -F or --body-file, or in a ' +
  "quoted here-doc (<<'EOF')."

// What the text names, read with quotes, escapes and expansion marks taken out, so `g''it`, `g\it` and
// `$(echo git)` still read as git.
const NAMES_GIT = /\bgit\b/
const GIT_WRITES = /\b(commit|merge|push|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace)\b/
const NAMES_GH = /\bgh\b/
const GH_WRITES = /\b(create|edit|comment|review|merge|close|reopen|delete|ready|lock|unlock|transfer|upload)\b/
const GH_API_WRITE = /\bapi\b[\s\S]*(\s-x\s*(post|patch|put|delete)|--method|\s-f\b|\s-f\S*=|--field|--raw-field|--input)/
const OTHER_WRITES = /api\.github\.com|hookspath|husky|lefthook|pre-commit|pre_commit|simple-git-hooks|no-verify|\.git[/\\]+hooks/

// A program that runs shell text (a shell, `eval`, `xargs`): with one in the command, its quoted text may
// run, so all of it is read. Code in another language (python, node) is that program's own: what it runs
// is out of every text reading's reach, as it always was here.
const RUNNERS =
  /\b(bash|sh|zsh|dash|ksh|fish|pwsh|powershell|cmd|eval|iex|invoke-expression|source|exec|xargs|env|wsl|sudo|trap|alias)\b/i

// git or gh itself, run by the command: then its quoted words are its arguments, read in full.
const RUNS_GIT = /\b(git|gh)\b/i

// A program named at run time (`$g commit`, `` `echo git` push ``, `V=1 ${g}t`): it may be git.
const BUILT_PROGRAM = /(^|[;&|\n({]|&&|\|\|)[ \t]*(?:[A-Za-z_]\w*=\S*[ \t]+)*["']?[$`]/

// The command without the bodies of here-docs whose delimiter is quoted: they are data. A here-doc is found
// on its line with the quoted text blanked (its delimiter's own quotes kept), so a `<<'X'` inside a message
// opens nothing; one never closed keeps the whole text.
function withoutBodies(command: string): string {
  const lines = command.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    kept.push(line)
    const bare = line.replace(/(?<!<<-?[ \t]*)(?:'[^']*'|"(?:[^"\\]|\\.)*")/g, '""')
    const doc = /<<-?[ \t]*(['"])([A-Za-z_]\w*)\1/.exec(bare)
    if (!doc) continue
    const end = lines.findIndex((l, j) => j > i && l.replace(/^\t+/, '') === doc[2])
    if (end === -1) return command
    i = end
  }
  return kept.join('\n')
}

// That text without the strings it only passes as data: single-quoted ones and double-quoted ones that run
// nothing (no `$(` or backtick). Any quote left over (one that runs a command, or left open) keeps it all.
function withoutData(code: string): string {
  const text = code.replace(/'[^']*'|"(?:[^"`$\\]|\$(?!\()|\\[^\n])*"/g, ' ')
  return /['"]/.test(text) ? code : text
}

/** Whether the command's text names a history write, a GitHub write or a hook switch, outside the text it
 * only passes as data (all of it, when it runs git, gh or shell text), or runs a program named at run time. */
export function namesWrite(command: string): boolean {
  const code = withoutBodies(command)
  if (BUILT_PROGRAM.test(code)) return true
  const own = withoutData(code)
  const t = (RUNNERS.test(own) || RUNS_GIT.test(own) ? command : own).toLowerCase().replace(/['"`^\\${}()]/g, '')
  if (OTHER_WRITES.test(t)) return true
  if (NAMES_GIT.test(t) && GIT_WRITES.test(t)) return true
  return NAMES_GH.test(t) && (GH_WRITES.test(t) || GH_API_WRITE.test(t))
}

// The programs a plain statement may start with, and those a pipe may feed: none runs other code or sets a
// variable, and none writes a file but through a redirect the reading follows.
const BASH_HEADS = ['git', 'gh', 'cd', 'pushd', 'popd', 'mkdir', 'echo', 'pwd', 'ls', 'cat', 'head', 'tail', 'grep']
  .concat(['wc', 'true'])
const BASH_PIPED = ['head', 'tail', 'grep', 'wc', 'cat', 'cut', 'tr']
const PS_HEADS = ['git', 'gh', 'cd', 'set-location', 'sl', 'echo', 'write-output', 'pwd', 'get-location']
const PS_PIPED = ['select-object', 'select', 'select-string', 'sls', 'out-null', 'out-string']

// Redirects: to the null device, one output stream into the other, or to a file whose path is typed out
// (the reading follows what is written there).
const BASH_REDIRECT =
  /^(?:[12]?>>?|&>)[ \t]*(?:\/dev\/null|&[12]|'[^']*'|"[^"$`]*"|[A-Za-z0-9_\-./:@%+,~]+)(?=[\s;&|)]|$)/
const PS_REDIRECT = /^(?:[1-6*]?>>?)[ \t]*(?:\$null|&1|'[^']*'|"[^"$`]*"|[A-Za-z0-9_\-./:%+~\\]+)(?=[\s;|]|$)/i

// A redirect into the repo's own files or a hook folder could switch its commit gates: never plain.
const INTO_HOOKS = /\.git\b|\.husky|hooks/i

// Unquoted characters that stand for themselves in each shell.
const BASH_PLAIN_CHAR = /[A-Za-z0-9_\-./:=@%+,~]/
const PS_PLAIN_CHAR = /[A-Za-z0-9_\-./:=%+~\\]/

// `quoted`: a PowerShell word that starts with a quote or a here-string, a value when it stands alone.
type Token = { op?: string; word?: string; quoted?: boolean }
type Scan = { tokens: Token[]; reason?: undefined } | { reason: string }
type Doc = { delim: string; isQuoted: boolean; strip: boolean }

const shown = (c: string) => (c === '\n' ? 'a line break' : `\`${c}\``)

// The message form commits are written with: `-m "$(cat <<'EOF'` ... `EOF` ... `)"`. Bash ends the
// here-doc at the first line that is the delimiter alone, and that line must be followed by `)"`.
function withoutCatMessages(command: string): string | undefined {
  let out = ''
  let rest = command
  for (;;) {
    const at = rest.search(/"\$\(cat <<'[A-Za-z_]\w*'\n/)
    if (at === -1) return out + rest
    const delim = /<<'([A-Za-z_]\w*)'/.exec(rest.slice(at))?.[1] as string
    const lines = rest.slice(rest.indexOf('\n', at) + 1).split('\n')
    const end = lines.findIndex(l => l === delim)
    if (end === -1 || !lines.slice(end + 1).join('\n').startsWith(')"')) return undefined
    out += `${rest.slice(0, at)}'-'`
    rest = lines.slice(end + 1).join('\n').slice(2)
  }
}

// Steps past the here-doc bodies queued on a line, from `i` (the line's end): where reading goes on, or
// why it cannot (a body never closed, or an unquoted one holding an expansion).
function skipBodies(text: string, i: number, docs: Doc[]): number | string {
  let at = i
  for (const doc of docs) {
    for (;;) {
      if (at >= text.length) return `a here-doc never closed by ${doc.delim}`
      const next = text.indexOf('\n', at + 1)
      const line = text.slice(at + 1, next === -1 ? text.length : next)
      at = next === -1 ? text.length : next
      if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.delim) break
      if (!doc.isQuoted && /[$`\\]/.test(line)) return `a here-doc body with $, a backtick or a backslash (quote ${doc.delim})`
    }
  }
  return at
}

// The end of a Bash double-quoted string opened at `i`, or why it is not plain. A backslash there escapes
// only `$`, a backtick, `"`, `\` and a line break, and is a plain character before anything else.
function bashDoubleQuoted(s: string, i: number): number | string {
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j] as string
    if (c === '"') return j
    // A `$` before a blank or the closing quote is a plain character (`grep -v "^\s*$"`).
    if (c === '$' && /["\s]/.test(s[j + 1] ?? '')) continue
    if (c === '$' || c === '`') return `${shown(c)} inside double quotes`
    if (c === '\\' && s[j + 1] === '\n') return 'a backslash line break inside double quotes'
    if (c === '\\') j++
  }
  return 'an unclosed double quote'
}

// Bash's words and operators, or why the command is not plain.
function bashTokens(command: string): Scan {
  const text = withoutCatMessages(command)
  if (text === undefined) return { reason: "a -m \"$(cat <<'EOF' ... EOF)\" message not closed by EOF and )\"" }
  if (/\r(?!\n)/.test(text)) return { reason: 'a carriage return' }
  const s = text.replace(/\r\n/g, '\n')
  const tokens: Token[] = []
  let word: string | undefined
  let docs: Doc[] = []
  const end = () => {
    if (word !== undefined) tokens.push({ word })
    word = undefined
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    const rest = s.slice(i)
    const redirect = word === undefined ? BASH_REDIRECT.exec(rest)?.[0] : undefined
    const doc = word === undefined ? /^<<(-?)[ \t]*(['"]?)([A-Za-z_]\w*)\2(?=[\s;&|]|$)/.exec(rest) : null
    if (c === "'") {
      const close = s.indexOf("'", i + 1)
      if (close === -1) return { reason: 'an unclosed single quote' }
      word = (word ?? '') + s.slice(i + 1, close)
      i = close
    } else if (c === '"') {
      const close = bashDoubleQuoted(s, i)
      if (typeof close === 'string') return { reason: close }
      word = (word ?? '') + s.slice(i + 1, close)
      i = close
    } else if (c === ' ' || c === '\t') end()
    else if (c === '\n') {
      end()
      tokens.push({ op: ';' })
      const at = docs.length > 0 ? skipBodies(s, i, docs) : i
      if (typeof at === 'string') return { reason: at }
      i = at
      docs = []
    } else if (/^(&&|\|\||;|\|)/.test(rest)) {
      end()
      const op = /^(&&|\|\||;|\|)/.exec(rest)?.[1] as string
      tokens.push({ op })
      i += op.length - 1
    } else if (redirect !== undefined) {
      if (INTO_HOOKS.test(redirect)) return { reason: 'a redirect into .git or a hooks folder' }
      i += redirect.length - 1
    } else if (doc) {
      docs.push({ delim: doc[3] as string, isQuoted: doc[2] !== '', strip: doc[1] === '-' })
      i += doc[0].length - 1
    } else if (BASH_PLAIN_CHAR.test(c)) word = (word ?? '') + c
    else return { reason: `${shown(c)} outside quotes` }
  }
  end()
  return docs.length > 0 ? { reason: 'a here-doc with no body' } : { tokens }
}

// PowerShell's words and operators, or why the command is not plain. Windows PowerShell hands a native
// program a word holding `"` (or blank and ending in `\`) re-quoted wrongly, and drops an empty one: what
// git receives is then not what was typed, so those are not plain either.
function psTokens(command: string): Scan {
  if (/\r(?!\n)/.test(command)) return { reason: 'a carriage return' }
  const s = command.replace(/\r\n/g, '\n')
  const tokens: Token[] = []
  let word: string | undefined
  let quoted = false
  let bad: string | undefined
  const end = () => {
    if (word === undefined) return
    if (word === '' || word.includes('"') || (/\s/.test(word) && word.endsWith('\\')))
      bad ??= 'a word Windows PowerShell passes on changed (empty, holding ", or ending in \\)'
    tokens.push({ word, quoted })
    word = undefined
    quoted = false
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    const rest = s.slice(i)
    const here = word === undefined ? /^@(['"])\n([\s\S]*?)\n\1@/.exec(rest) : null
    const redirect = word === undefined ? PS_REDIRECT.exec(rest)?.[0] : undefined
    if (here) {
      if (here[1] === '"' && /[$`]/.test(here[2] as string)) return { reason: 'a @" here-string with $ or a backtick' }
      tokens.push({ word: here[2] as string, quoted: true })
      i += here[0].length - 1
    } else if (c === "'" || c === '"') {
      const m = (c === "'" ? /^'((?:[^']|'')*)'/ : /^"((?:[^"]|"")*)"/).exec(rest)
      if (!m) return { reason: 'an unclosed quote' }
      if (c === '"' && /[$`]/.test(m[1] as string)) return { reason: '$ or a backtick inside double quotes' }
      quoted ||= word === undefined
      word = (word ?? '') + (m[1] as string).replace(c === "'" ? /''/g : /""/g, c)
      i += m[0].length - 1
    } else if (c === ' ' || c === '\t') end()
    else if (c === '\n' || /^(&&|\|\||;|\|)/.test(rest)) {
      end()
      const op = c === '\n' ? ';' : (/^(&&|\|\||;|\|)/.exec(rest)?.[1] as string)
      tokens.push({ op })
      i += op.length - 1
    } else if (redirect !== undefined) {
      if (INTO_HOOKS.test(redirect)) return { reason: 'a redirect into .git or a hooks folder' }
      i += redirect.length - 1
    } else if (rest.startsWith('--%')) return { reason: 'the stop-parsing token --%' }
    // `@` inside a word is a plain character (`query=@q.graphql`); at a word's start it splats.
    else if (PS_PLAIN_CHAR.test(c) || (c === '@' && word !== undefined)) word = (word ?? '') + c
    else return { reason: `${shown(c)} outside quotes` }
  }
  end()
  return bad ? { reason: bad } : { tokens }
}

/** Why the command is not plain, or undefined when it is: each statement starts with a program of the
 * shell's list (after a pipe, one of its piped list), and every word was typed out. */
export function notPlain(command: string, powershell: boolean): string | undefined {
  const scan = powershell ? psTokens(command) : bashTokens(command)
  if (!('tokens' in scan)) return scan.reason
  const heads = powershell ? PS_HEADS : BASH_HEADS
  const piped = powershell ? PS_PIPED : BASH_PIPED
  let isStart = true
  let isPiped = false
  // A PowerShell value standing alone (`'## What' > b.md`) only prints.
  let isValue = false
  for (const t of scan.tokens) {
    if (t.op !== undefined) {
      if (isStart && t.op !== ';') return `\`${t.op}\` with no command before it`
      isPiped = t.op === '|'
      isStart = true
      isValue = false
      continue
    }
    if (isValue) return 'a word after a value'
    if (isStart) {
      const name = powershell ? (t.word as string).toLowerCase() : (t.word as string)
      const list = isPiped ? piped : heads
      isValue = powershell && Boolean(t.quoted) && !isPiped
      if (!isValue && !list.includes(name))
        return `\`${name.slice(0, 40)}\`, which is not one of the programs a plain command runs (${list.join(', ')})`
    }
    isStart = false
  }
  return isPiped && isStart ? 'a pipe into nothing' : undefined
}
