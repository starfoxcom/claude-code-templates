// The plain-command rule. A command whose text names a git history write, a GitHub write or a hook switch
// is judged only when it is plain: git, gh and a few read-only programs, joined by `&&`, `||`, `;`, a newline
// or a pipe, with each word typed out (plain or in quotes, with no `$` or backtick). Anything else that
// names such a write is refused outright. Reading every spelling a shell allows never converged: each fix
// exposed the next spelling. Refusing what cannot be read for sure does, and a refused command costs only a
// plainer retry. Pure, no engine access.

export const NOT_PLAIN =
  'this command names a git or GitHub write but is not plain, so the guard cannot read it for sure. Run the ' +
  'git or gh call with its words typed out, each word plain or in quotes, with no $ or backtick, and no ' +
  'variables, groups, loops, functions or other programs. In Bash, git, gh and cd calls may be joined by && ' +
  'or ;. In PowerShell, run each git or gh call as its own tool call (; would run the next one even after a ' +
  'failure). Write a message or PR body to a file first (with the Write tool) and pass it with -F or ' +
  "--body-file, or in a quoted here-doc (<<'EOF')."

// What the text names, read with quotes, escapes and expansion marks taken out.
const NAMES_GIT = /\bgit\b/
const GIT_WRITES = /\b(commit|merge|push|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace)\b/
const NAMES_GH = /\bgh\b/
const GH_WRITES = /\b(create|edit|comment|review|merge|close|reopen|delete|ready|lock|unlock|transfer|upload)\b/
const GH_API_WRITE =
  /\bapi\b[\s\S]*(\s-x\s*(post|patch|put|delete)|--method|\s-f\b|\s-f\S*=|--field|--raw-field|--input)/
// A hook manager named alone (`npx lefthook install`, `HUSKY=0 npm ci`) is no write: the reading refuses its
// `uninstall`, and a switch counts where it reaches a git call that runs hooks, which names a write itself.
const OTHER_WRITES = /api\.github\.com|hookspath|no-verify|\.git[/\\]+hooks/

// A git folder's hooks or config, a git config file, or a hook manager's folder or config, named anywhere
// (quotes included): writing one can switch the commit gates off, so the command is judged as plain or
// refused. A `.git` only read past (`--glob '!.git'`, `--exclude=.git`, a `.git` URL) names none of them.
const GIT_FILES = new RegExp(
  String.raw`\.git[\\/]+(?:hooks|config|info)(?![\w.-])|\.git[\\/]+(?=[\s'"]|$)` +
    String.raw`|\.git(?:config|modules|attributes)(?![\w.-])|[\\/]git[\\/]+config|\.husky|\.githooks` +
    String.raw`|\.?lefthook(?:-local)?\.(?:ya?ml|json|toml)|\.pre-commit-config`,
)

// A program that runs shell text (a shell, `eval`, `xargs`): with one in the command, its quoted text may
// run, so all of it is read. Code in another language (python, node) is that program's own: what it runs
// is out of every text reading's reach, as it always was here.
const RUNNERS = new RegExp(
  '\\b(bash|sh|zsh|dash|ksh|fish|pwsh|powershell|cmd|eval|iex|invoke-expression|source|exec|xargs|env|wsl|' +
    'sudo|doas|trap|alias|flock|watch|parallel|script|find|ssh|nohup|timeout|nice|time|stdbuf|setsid|' +
    'start-process|start|saps|runas)\\b',
  'i',
)

// git or gh itself, run by the command: then its quoted words are its arguments, read in full.
const RUNS_GIT = /\b(git|gh)\b/i

// Each statement's program word, found on the command with every quoted string masked to marks of the same
// length (so the data inside a string starts no statement) and then read from the command at that place. A
// Bash assignment (`S="x"`) or a PowerShell one (`$s = 'x'`) is no program.
const QUOTED_STRING = /'[^']*'|"(?:[^"\\]|\\[\s\S])*"/g
const PROGRAM_WORD = /(?:^|[;&|\n({])[ \t]*(?:[A-Za-z_]\w*=\S*[ \t]+)*(?![A-Za-z_]\w*=|\$[\w:]+[ \t]*=)([^\s;&|()]+)/g

/** Whether a statement's program may be git or gh named so that no reading of its text sees it: built at
 * run time (`$g`, `` `echo git` ``, `${g}t`, Bash's `g\it` and `gi$(x)t`, PowerShell's `` g`it ``), or with
 * quotes around a name that is git or gh (`'git'`, `g''it`, PowerShell's `& "C:/Git/cmd/git.exe"`). */
function hidesProgram(code: string, powershell: boolean): boolean {
  const masked = code.replace(QUOTED_STRING, s => '\u0001'.repeat(s.length))
  // PowerShell's `& (...)` or `. (...)` runs whatever the expression resolves to (`& (gcm g?t)`).
  if (powershell && /(?:^|[;|\n{])[ \t]*[&.][ \t]*\(/.test(masked)) return true
  for (const m of masked.matchAll(PROGRAM_WORD)) {
    const at = (m.index ?? 0) + m[0].length - (m[1] as string).length
    const word = code.slice(at, at + (m[1] as string).length)
    const bare = m[1] as string
    // Bash builds a name from a brace expansion or a glob too (`{gi,commi}t`, `/usr/bin/g[i]t`); `[` and
    // `[[` alone are the test commands.
    const isPattern = !powershell && /[*?[{]/.test(bare) && bare !== '[' && bare !== '[['
    const built = isPattern || (powershell ? /^["']?\$|`/.test(word) : /[$`\\]/.test(word))
    const base = (word.replace(/['"]/g, '').split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
    if (built || (/['"]/.test(word) && (base === 'git' || base === 'gh'))) return true
  }
  return false
}

// The curly quotes Windows PowerShell reads as quote marks: no plain reading follows them.
const SMART_QUOTES = /[‘-„]/

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
export function namesWrite(command: string, powershell = false): boolean {
  if (SMART_QUOTES.test(command) || GIT_FILES.test(command.toLowerCase())) return true
  const code = withoutBodies(command)
  if (hidesProgram(code, powershell)) return true
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

// A redirect or a `cd` into a git folder or config file (the repo's `.git`, `~/.gitconfig`, `~/.config/git`),
// a hook folder (`.husky`, `.githooks`), a hook manager's config or a file named after a git hook could switch
// the commit gates: never plain. Matched on path segments, so a folder that only holds the word (`src/hooks`,
// `webhook-relay`, `C:\git\app`) is ordinary.
const AT_SEGMENT = String.raw`(?:^|[\\/\s<>'"=])`
const SEGMENT_END = String.raw`(?=[\\/\s'"]|$)`
const HOOK_NAMES =
  'applypatch-msg|pre-applypatch|post-applypatch|pre-commit|pre-merge-commit|prepare-commit-msg|commit-msg|' +
  'post-commit|pre-rebase|post-checkout|post-merge|pre-push|post-rewrite|push-to-checkout|' +
  'reference-transaction|pre-auto-gc|fsmonitor-watchman|sendemail-validate|post-index-change'
const HOOK_FILES = String.raw`${HOOK_NAMES}|\.pre-commit-config\.ya?ml|\.?lefthook(?:-local)?\.(?:ya?ml|json|toml)`
const INTO_HOOKS = new RegExp(
  String.raw`${AT_SEGMENT}(?:\.git(?:config|modules|attributes)?|\.husky|\.githooks)${SEGMENT_END}` +
    String.raw`|${AT_SEGMENT}\.config[\\/]+git${SEGMENT_END}|${AT_SEGMENT}(?:${HOOK_FILES})['"]?$`,
  'i',
)
const CD_HEADS = ['cd', 'pushd', 'set-location', 'sl']

// Unquoted characters that stand for themselves in each shell.
const BASH_PLAIN_CHAR = /[A-Za-z0-9_\-./:=@%+,~]/
const PS_PLAIN_CHAR = /[A-Za-z0-9_\-./:=%+~\\]/

// `quoted`: a PowerShell word that starts with a quote or a here-string, a value when it stands alone.
type Token = { op?: string; word?: string; quoted?: boolean }
type Scan = { tokens: Token[]; reason?: undefined } | { reason: string }
type Doc = { delim: string; isQuoted: boolean; strip: boolean }

const shown = (c: string) => (c === '\n' ? 'a line break' : `\`${c}\``)

// The message form commits are written with, `-m "$(cat <<'EOF'` ... `EOF` ... `)"`, at a double quote the
// tokenizer met outside quotes. Bash ends the here-doc at the first line that is the delimiter alone, and
// that line must be followed by `)"`. Where the form ends (its closing quote), why it is not plain, or
// undefined when the quote opens an ordinary string.
function catMessageEnd(s: string, i: number): number | string | undefined {
  const open = /^"\$\(cat <<'([A-Za-z_]\w*)'\n/.exec(s.slice(i))
  if (!open) return undefined
  const delim = open[1] as string
  for (let at = i + open[0].length; ; ) {
    const next = s.indexOf('\n', at)
    if (next === -1) return `a -m "$(cat <<'${delim}' ...)" message not closed by ${delim} and )"`
    if (s.slice(at, next) === delim) {
      return s.startsWith(')"', next + 1) ? next + 2 : `a -m "$(cat <<'${delim}' ...)" message not closed by )"`
    }
    at = next + 1
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
      if (!doc.isQuoted && /[$`\\]/.test(line))
        return `a here-doc body with $, a backtick or a backslash (quote ${doc.delim})`
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
  if (/\r(?!\n)/.test(command)) return { reason: 'a carriage return' }
  const s = command.replace(/\r\n/g, '\n')
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
      const message = catMessageEnd(s, i)
      const close = message ?? bashDoubleQuoted(s, i)
      if (typeof close === 'string') return { reason: close }
      word = (word ?? '') + (message === undefined ? s.slice(i + 1, close) : '-')
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

// What makes a whole PowerShell command not plain before its words are read.
function psCommandFlaw(command: string): string | undefined {
  if (/\r(?!\n)/.test(command)) return 'a carriage return'
  if (SMART_QUOTES.test(command)) return 'a curly quote, which Windows PowerShell reads as a quote mark'
  if (/&&|\|\|/.test(command.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, '')))
    return 'Windows PowerShell has no && or ||: run each git or gh call as its own tool call'
  return undefined
}

// A word Windows PowerShell hands a native program changed: empty, holding `"`, blank and ending in `\`, or
// unquoted, starting with `-` and holding a dot, which it splits there (`--no-verify.` reaches git as
// `--no-verify .`).
function psWordFlaw(word: string, quoted: boolean): string | undefined {
  if (word === '' || word.includes('"') || (/\s/.test(word) && word.endsWith('\\')))
    return 'a word Windows PowerShell passes on changed (empty, holding ", or ending in \\)'
  if (!quoted && word.startsWith('-') && word.includes('.'))
    return 'a word that starts with - and holds a dot, which Windows PowerShell splits at the dot (quote it)'
  return undefined
}

// A here-string, or a quoted string, at the start of `rest`: its text and length, or why it is not plain.
// `atStart`: no word is open, so a here-string may start here.
function psQuoted(rest: string, atStart: boolean): { text: string; length: number; isHere: boolean } | string {
  const here = atStart ? /^@(['"])\n([\s\S]*?)\n\1@/.exec(rest) : null
  if (here) {
    if (here[1] === '"' && /[$`]/.test(here[2] as string)) return 'a @" here-string with $ or a backtick'
    return { text: here[2] as string, length: here[0].length, isHere: true }
  }
  const c = rest[0]
  const m = (c === "'" ? /^'((?:[^']|'')*)'/ : /^"((?:[^"]|"")*)"/).exec(rest)
  if (!m) return 'an unclosed quote'
  if (c === '"' && /[$`]/.test(m[1] as string)) return '$ or a backtick inside double quotes'
  return { text: (m[1] as string).replace(c === "'" ? /''/g : /""/g, c as string), length: m[0].length, isHere: false }
}

// PowerShell's words and operators, or why the command is not plain. Windows PowerShell hands a native
// program a word holding `"` (or blank and ending in `\`) re-quoted wrongly, and drops an empty one: what
// git receives is then not what was typed, so those are not plain either.
function psTokens(command: string): Scan {
  const flaw = psCommandFlaw(command)
  if (flaw) return { reason: flaw }
  const s = command.replace(/\r\n/g, '\n')
  const tokens: Token[] = []
  let word: string | undefined
  let quoted = false
  let bad: string | undefined
  const end = () => {
    if (word === undefined) return
    bad ??= psWordFlaw(word, quoted)
    tokens.push({ word, quoted })
    word = undefined
    quoted = false
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    const rest = s.slice(i)
    const redirect = word === undefined ? PS_REDIRECT.exec(rest)?.[0] : undefined
    const isHere = word === undefined && /^@['"]\n/.test(rest)
    if (isHere || c === "'" || c === '"') {
      const q = psQuoted(rest, word === undefined)
      if (typeof q === 'string') return { reason: q }
      if (q.isHere) tokens.push({ word: q.text, quoted: true })
      else {
        quoted ||= word === undefined
        word = (word ?? '') + q.text
      }
      i += q.length - 1
    } else if (c === ' ' || c === '\t') end()
    else if (c === '\n' || c === ';' || c === '|') {
      end()
      tokens.push({ op: c === '\n' ? ';' : c })
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
  let isCd = false
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
      isCd = CD_HEADS.includes(name)
    } else if (isCd && INTO_HOOKS.test(t.word as string)) return 'a cd into a git folder, a config or a hooks folder'
    isStart = false
  }
  return isPiped && isStart ? 'a pipe into nothing' : undefined
}
