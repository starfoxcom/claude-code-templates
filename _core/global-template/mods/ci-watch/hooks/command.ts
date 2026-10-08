// What a shell command does, read from its text: a push or `gh pr create` (which starts a watch), a
// `gh pr merge` (which drops one), and the folder it ran in. Pure, no engine access.

// Matched on the command with its quoted text and here-doc bodies blanked (see `commandWords`), and on
// the subcommand word: `git commit -m "explain the push"` is not a push. Global options may come first.
const GIT_OPTS = String.raw`(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*`
const GH_OPTS = String.raw`(?:\s+(?:-R\s+\S+|--repo[=\s]\S+))*`
const AT_START = String.raw`(?:^|[\s;&|({])`
const PUSH = `${AT_START}git${GIT_OPTS}\\s+push\\b`
const PUSH_OR_PR = new RegExp(`${PUSH}|${AT_START}gh${GH_OPTS}\\s+pr${GH_OPTS}\\s+create\\b`)
const PR_MERGE = new RegExp(`${AT_START}gh${GH_OPTS}\\s+pr${GH_OPTS}\\s+merge\\b([^|;&\\n]*)`)

// The command with quoted strings emptied and here-doc bodies dropped, so message text never reads as
// a command. Folders come from the raw command (`targetFolder`).
// Each shell's own escape inside double quotes: a backslash in Bash (where a backtick runs a command and
// escapes nothing), a backtick in PowerShell (where a backslash is a plain character).
const DOUBLE_QUOTED = {
  bash: String.raw`"(?:[^"\\]|\\[\s\S])*"`,
  powershell: '"(?:[^"`]|`[\\s\\S])*"',
}

// Which lines are here-doc bodies (and their end lines): they hold text, never commands.
function hereDocLines(lines: readonly string[]): Set<number> {
  const body = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    // `<<` alone: `<<<` feeds one word, not the lines after it. Found on the line with its quoted text
    // blanked (a delimiter's own quotes kept), so a `<<EOF` inside a message opens nothing.
    const unquoted = (lines[i] ?? '').replace(/(?<!<<-?\s*)(?:'[^']*'|"(?:[^"\\`]|[\\`].)*")/g, '""')
    const doc = /(?<!<)<<(?!<)-?\s*(["']?)([A-Za-z_][\w.-]*)\1/.exec(unquoted)
    if (!doc) continue
    while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== doc[2]) body.add(++i)
    if (i + 1 < lines.length) body.add(++i)
  }
  return body
}

const quotedSpans = (isPowerShell: boolean) =>
  new RegExp(
    String.raw`@'[\s\S]*?'@|@"[\s\S]*?"@|'[^']*'|${isPowerShell ? DOUBLE_QUOTED.powershell : DOUBLE_QUOTED.bash}`,
    'g',
  )

export function commandWords(command: string, isPowerShell = false): string {
  const lines = command.split('\n')
  const body = hereDocLines(lines)
  return lines
    .filter((_, i) => !body.has(i))
    .join('\n')
    .replace(quotedSpans(isPowerShell), '""')
}

// The command at full length, with here-doc bodies blanked and the inside of each quoted string filled
// with `_`: a match on it sits at the same place in the command, and message text matches nothing.
function maskedCommand(command: string, isPowerShell: boolean): string {
  const lines = command.split('\n')
  const body = hereDocLines(lines)
  return lines
    .map((line, i) => (body.has(i) ? ' '.repeat(line.length) : line))
    .join('\n')
    .replace(quotedSpans(isPowerShell), span => span[0] + '_'.repeat(span.length - 2) + span[span.length - 1])
}

export function isPushOrPr(command: string, isPowerShell = false): boolean {
  return PUSH_OR_PR.test(commandWords(command, isPowerShell))
}

// A push alone, not `gh pr create`: the fix-round limit refuses it on a PR past the limit.
export function isPush(command: string, isPowerShell = false): boolean {
  return new RegExp(PUSH).test(commandWords(command, isPowerShell))
}

// Push options that take the next word as their value.
const PUSH_VALUES = /^(-o|--push-option|--repo|--receive-pack|--exec|--recurse-submodules)$/
// Where a push's statement ends: `;`, a pipe, a line break, or an `&` that is no part of a redirect (`2>&1`,
// `&>log`).
const STATEMENT_END = /[;|\n]|(?<![<>])&(?!>)/
// A redirect word (`2>&1`, `>log`, `*>$null`), and one that names its target in the next word (`> log`).
const REDIRECT = /^[\d*&]?(?:>>?|<)/
const REDIRECT_ALONE = /^[\d*&]?(?:>>?|<)$/
// A word read for sure: a plain name, with nothing the shell fills in when it runs (quotes, `$`, `(`). `@`
// inside a word is plain (`git@github.com:o/r.git`); a word that starts with one (`@`, `@{u}`, `@args`) is not.
const LITERAL = /^[\w./:+^~,=-][\w./:+^~,=@-]*$/

/** Each push's words, to the end of its statement, without redirects or a trailing comment; `isUnread` when
 * one of them is no plain name, so where it pushes cannot be read for sure. */
function pushes(command: string, isPowerShell: boolean): { args: string[]; isUnread: boolean }[] {
  const words = commandWords(command, isPowerShell)
  return [...words.matchAll(new RegExp(PUSH, 'g'))].map(push => {
    const rest = words.slice((push.index ?? 0) + push[0].length)
    const end = rest.search(STATEMENT_END)
    const tokens = (end < 0 ? rest : rest.slice(0, end)).split(/\s+/).filter(Boolean)
    const args: string[] = []
    let isUnread = false
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] ?? ''
      if (token.startsWith('#')) break
      if (REDIRECT.test(token)) {
        if (REDIRECT_ALONE.test(token)) i++
        continue
      }
      isUnread ||= !LITERAL.test(token)
      args.push(token)
    }
    return { args, isUnread }
  })
}

/** Whether a push in the command updates `branch`, the folder's checked-out one: with no refspec (the
 * branch itself, or every branch with `--all`/`--mirror`), a refspec to `HEAD` or to that branch, `:` (every
 * matching branch), or any word that cannot be read for sure. Only a tag push, `--tags` alone, a delete
 * (`--delete`, `-d`, `:<branch>`) or a plain refspec to another branch adds no round to its PR. */
export function pushesBranch(command: string, branch: string, isPowerShell = false): boolean {
  for (const { args, isUnread } of pushes(command, isPowerShell)) {
    if (args.some(a => a === '--delete' || a === '-d')) continue
    if (isUnread) return true
    const plain = args.filter((a, i) => !a.startsWith('-') && !PUSH_VALUES.test(args[i - 1] ?? ''))
    const refs = plain.slice(1).map(ref => ref.replace(/^\+/, ''))
    const isEvery = args.includes('--all') || args.includes('--mirror')
    if (refs.length === 0 && (isEvery || !args.includes('--tags'))) return true
    const isOurs = (ref: string) => {
      if (ref === ':') return true
      if (ref.startsWith(':')) return false
      // Git reads `heads/<branch>` and `refs/heads/<branch>` as the branch too.
      const dst = (ref.split(':').pop() ?? '').replace(/^(?:refs\/)?heads\//, '')
      return dst === 'HEAD' || dst === branch
    }
    if (refs.some(isOurs)) return true
  }
  return false
}

// A merged PR's watch is noise: the chat already says it merged. Returns the
// PR number a `gh pr merge` names, 0 when it names none (the branch's PR).
export function mergedNumber(command: string, isPowerShell = false): number | undefined {
  const merge = PR_MERGE.exec(commandWords(command, isPowerShell))
  if (!merge) return undefined
  const named = /(?:^|\s)#?(\d+)(?=\s|$)/.exec(merge[1] ?? '')
  return named ? Number(named[1]) : 0
}

// The folder a push or `gh pr create` ran in: `git -C <dir>` or the `cd <dir>` / `Set-Location <dir>`
// steps before it, on the same line or the lines above. Undefined means the session's folder.
const GIT_C = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/
const CD = /(?:^|[;&|\n]\s*)(?:cd|Set-Location|Push-Location|pushd)\s+(?:-Path\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/g
const PUSH_AT = /\bgit\b[^;&|\n]*\bpush\b|\bgh\s+pr\s+create\b/
const ABSOLUTE = /^(?:[a-zA-Z]:|[/\\~])/

// The patterns run on the masked command, so text inside quotes or here-docs steers nothing; each path
// is then read from the command at the same place.
export function targetFolder(command: string, isWindows: boolean, isPowerShell = false): string | undefined {
  // Git Bash paths (/c/Users/...) mean nothing to a Windows process: turn them into C:/Users/...
  // Only on Windows: elsewhere `/u/me` is a real one-letter folder.
  const masked = maskedCommand(command, isPowerShell)
  const pathAt = (match: RegExpExecArray | RegExpMatchArray, offset = 0) => {
    const at = offset + (match.index ?? 0) + match[0].length - match[1]!.length
    const bare = command.slice(at, at + match[1]!.length).replace(/^["']|["']$/g, '')
    return isWindows ? bare.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : bare
  }
  const push = PUSH_AT.exec(masked)
  // `git -C <dir>` on the push itself wins.
  const gitC = push ? GIT_C.exec(push[0]) : null
  if (push && gitC) return pathAt(gitC, push.index)
  // Each `cd` before the push moves on from the one before it, unless it names a whole path.
  let folder: string | undefined
  for (const step of masked.slice(0, push?.index ?? masked.length).matchAll(CD)) {
    const next = pathAt(step)
    folder = folder === undefined || ABSOLUTE.test(next) ? next : `${folder}/${next}`
  }
  return folder
}
