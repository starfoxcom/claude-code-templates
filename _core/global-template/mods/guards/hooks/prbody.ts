// The PR-body contract: in the repos listed in mods-data/guards/pr-body.json, every `gh pr create` or
// `gh pr edit` that sets a body carries it from a file, in the PR format (`## What` with a bullet,
// `## Why` with text, `## Notes` only when filled), and names its board row when the repo asks for one.
// Pure, no engine access. Without the file nothing is checked. A body is checked only where it can be
// read exactly; any other spelling is named unread, never blocked and never passed in silence.

/** One repo's rules: `row`, a line every work PR carries (a regex, read line by line); `noRow`, the PR
 * titles that carry none (a regex). Both optional. */
export type RepoRule = { row?: string; noRow?: string }
export type PrRules = { repos: Record<string, RepoRule> }

/** What a `gh pr create` or `gh pr edit` sets, read from its words after the action. */
export type PrCall = {
  action: 'create' | 'edit'
  title: string
  /** A `--title` is given: without one a title exemption cannot be decided. */
  hasTitle: boolean
  /** `--body-file <path>` as typed; '-' reads the body from stdin. */
  bodyFile?: string
  /** The body file's path as the command reading resolved it (variables filled in), to find its entry. */
  filePath?: string
  /** A literal here-doc fed to the statement on stdin; none for a pipe, a `< file` or a dynamic body. */
  stdinBody?: string
  isInline: boolean
  isFilled: boolean
  /** A spelling the check does not judge: a word that may stand for several, built at run time
   * (`@params`, `$ARGS`), a command substitution, an ANSI-C `$'...'` string, or a short flag with more
   * after it (`-dF b.md`, `-tTitle`), which gh reads as several flags or an attached value. */
  isUnknown: boolean
  /** The title is built at run time, so a title exemption cannot be decided. */
  isTitleDynamic: boolean
  /** The call is the whole command: one statement, `gh` typed first, nothing wrapped around it. */
  isAlone?: boolean
}

/** A word as the command reading hands it over: its text, and whether the shell builds it at run time. */
export type PrWord = { text: string; dynamic?: boolean }

// The `gh pr create|edit` flags that take the next word as their value.
const VALUE_FLAGS = new Set(
  (
    '-t --title -b --body -F --body-file -B --base -H --head -R --repo -a --assignee -l --label -m --milestone ' +
    '-p --project -r --reviewer -T --template --add-label --remove-label --add-reviewer --remove-reviewer ' +
    '--add-assignee --remove-assignee --add-project --remove-project --recover'
  ).split(' '),
)
const FILL = /^(?:-f|-w|--fill|--fill-first|--fill-verbose|--web)$/

// The value of a flag spelled `--flag value`, `--flag=value` or `-xvalue`.
function valueAt(words: string[], i: number, long: string, short: string): string | undefined {
  const w = words[i] ?? ''
  if (w === long || w === short) return words[i + 1]
  if (w.startsWith(`${long}=`)) return w.slice(long.length + 1)
  if (w.startsWith(short) && w.length > short.length && !w.startsWith('--')) return w.slice(short.length)
  return undefined
}

export function readPr(
  action: 'create' | 'edit',
  given: PrWord[],
  found: { stdinBody?: string; filePath?: string; isAlone?: boolean } = {},
): PrCall {
  const call: PrCall = {
    action,
    title: '',
    hasTitle: false,
    isInline: false,
    isFilled: false,
    isUnknown: false,
    isTitleDynamic: false,
    ...found,
  }
  const words = given.map(w => w.text)
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? ''
    // A splat or an unquoted variable in a flag's place (never a value-taking flag's value) may carry any flag.
    const isFlagValue = VALUE_FLAGS.has(words[i - 1] ?? '')
    if (/^[@$]/.test(w) && (given[i]?.dynamic || w.startsWith('@')) && !isFlagValue) call.isUnknown = true
    // Only plain spellings are judged; any other is named unread, never read a second, different way.
    if (/^-[A-Za-z]./.test(w) && !isFlagValue) call.isUnknown = true
    // A PR named by URL (or a branch with a slash) may live in another repo than the folder's.
    if (!w.startsWith('-') && w.includes('/') && !isFlagValue) call.isUnknown = true
    // Any word the shell may change (a variable, `$'...'`, `$(...)`, a backtick): judged only as typed.
    if (given[i]?.dynamic || /[$`]/.test(w)) call.isUnknown = true
    if (FILL.test(w)) call.isFilled = true
    else if (/^(?:-b|--body)(?:=|$)/.test(w) || /^-b./.test(w)) call.isInline = true
    const title = valueAt(words, i, '--title', '-t')
    if (title !== undefined) {
      call.title = title
      call.hasTitle = true
      const isSplit = w === '--title' || w === '-t'
      call.isTitleDynamic = Boolean(given[isSplit ? i + 1 : i]?.dynamic)
    }
    const file = valueAt(words, i, '--body-file', '-F')
    // A second body file: gh sends the last, and only one is read.
    if (file !== undefined && call.bodyFile !== undefined) call.isUnknown = true
    if (file !== undefined) call.bodyFile = file
  }
  return call
}

/** The rule for a repo: of the listed names the repo's name contains (case-insensitive), the longest. */
export function ruleFor(rules: PrRules | undefined, repo: string): RepoRule | undefined {
  const name = repo.toLowerCase()
  const keys = Object.keys(rules?.repos ?? {}).filter(k => k && name.includes(k.toLowerCase()))
  const key = keys.sort((a, b) => b.length - a.length)[0]
  return key === undefined ? undefined : rules?.repos[key]
}

/** Reasons that need no body text: how the body is passed. A call with unknown flags is not judged. */
export function checkCall(call: PrCall): string | undefined {
  if (call.isUnknown) return undefined
  if (call.isInline)
    return (
      'inline `--body` is not allowed for a PR: write the body to a file and pass `--body-file <path>` ' +
      '(inline bodies were silently cut short in the past).'
    )
  if (call.isFilled) return '`--fill*` / `--web` skip the PR format: write the body to a file and pass `--body-file`.'
  if (call.bodyFile === undefined && call.action === 'create')
    return '`gh pr create` needs `--body-file <path>` carrying the PR format.'
  return undefined
}

// The repo's board-row pattern, matched against a whole line (trailing spaces aside), so a pattern
// written without anchors never matches a bullet that merely mentions the row.
const rowOf = (rule: RepoRule) => (rule.row ? new RegExp(`^(?:${rule.row})$`) : undefined)

/** Whether the body carries a line matching the repo's board-row pattern. */
export function hasRow(text: string, rule: RepoRule): boolean {
  const row = rowOf(rule)
  return Boolean(row && text.split(/\r?\n/).some(l => row.test(l.trimEnd())))
}

// A section's text: from its heading to the next heading, or to the repo's board-row line when it has one.
function section(text: string, heading: string, row?: RegExp): string | undefined {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => l.trimEnd() === `## ${heading}`)
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => l.startsWith('## ') || Boolean(row?.test(l.trimEnd())))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** The body against the PR format and the repo's board-row rule. `title` undefined: no title was
 * given, so the row's exemption cannot be decided and the row is not required (the caller names it
 * unread). */
export function checkBody(text: string, title: string | undefined, rule: RepoRule): string | undefined {
  const row = rowOf(rule)
  const what = section(text, 'What', row)
  if (what === undefined || !/^\s*[-*] \S/m.test(what))
    return '`## What` is missing or has no bullet. The body must carry the full PR format.'
  const why = section(text, 'Why', row)
  if (why === undefined || !why.trim()) return '`## Why` is missing or empty.'
  const notes = section(text, 'Notes', row)
  if (notes !== undefined && !notes.trim()) return '`## Notes` is present but empty: drop the heading or fill it.'
  if (!rule.row || title === undefined) return undefined
  const isExempt = rule.noRow ? new RegExp(rule.noRow).test(title) : false
  if (isExempt || hasRow(text, rule)) return undefined
  return (
    `no board-row line matching \`${rule.row}\`. Every work PR here names its board row; only titles ` +
    `matching \`${rule.noRow ?? '(none)'}\` name none.`
  )
}
