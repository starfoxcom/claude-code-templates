// The PR-body contract: in the repos listed in mods-data/guards/pr-body.json, every `gh pr create` or
// `gh pr edit` that sets a body carries it from a file, in the PR format (`## What` with a bullet,
// `## Why` with text, `## Notes` only when filled), and names its board row when the repo asks for one.
// Pure, no engine access. Without the file nothing is checked.

/** One repo's rules: `row`, a line every work PR carries (a regex, read line by line); `noRow`, the PR
 * titles that carry none (a regex). Both optional. */
export type RepoRule = { row?: string; noRow?: string }
export type PrRules = { repos: Record<string, RepoRule> }

/** What a `gh pr create` or `gh pr edit` sets, read from its words after the action. */
export type PrCall = {
  action: 'create' | 'edit'
  title: string
  /** `--body-file <path>`; '-' reads the body from stdin (a here-doc on the statement). */
  bodyFile?: string
  /** The here-docs the statement feeds it, joined. */
  stdinBody?: string
  isInline: boolean
  isFilled: boolean
}

const FILL = /^(?:-f|-w|--fill|--fill-first|--fill-verbose|--web)$/

// The value of a flag spelled `--flag value`, `--flag=value` or `-xvalue`.
function valueAt(words: string[], i: number, long: string, short: string): string | undefined {
  const w = words[i] ?? ''
  if (w === long || w === short) return words[i + 1]
  if (w.startsWith(`${long}=`)) return w.slice(long.length + 1)
  if (w.startsWith(short) && w.length > short.length && !w.startsWith('--')) return w.slice(short.length)
  return undefined
}

export function readPr(action: 'create' | 'edit', words: string[], stdinBody?: string): PrCall {
  const call: PrCall = { action, title: '', isInline: false, isFilled: false, stdinBody }
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? ''
    if (FILL.test(w)) call.isFilled = true
    else if (/^(?:-b|--body)(?:=|$)/.test(w) || /^-b./.test(w)) call.isInline = true
    const title = valueAt(words, i, '--title', '-t')
    if (title !== undefined) call.title = title
    const file = valueAt(words, i, '--body-file', '-F')
    if (file !== undefined) call.bodyFile = file
  }
  return call
}

/** The rule for a repo: the first listed name the repo's name contains (case-insensitive). */
export function ruleFor(rules: PrRules | undefined, repo: string): RepoRule | undefined {
  const name = repo.toLowerCase()
  const key = Object.keys(rules?.repos ?? {}).find(k => k && name.includes(k.toLowerCase()))
  return key === undefined ? undefined : rules?.repos[key]
}

/** Reasons that need no body text: how the body is passed. */
export function checkCall(call: PrCall): string | undefined {
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

// A section's text: from its heading to the next heading or board-row line.
function section(text: string, heading: string): string | undefined {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => l.trimEnd() === `## ${heading}`)
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => /^## |^(?:Resolves|Part of) /.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** The body against the PR format and the repo's board-row rule. */
export function checkBody(text: string, title: string, rule: RepoRule): string | undefined {
  const what = section(text, 'What')
  if (what === undefined || !/^\s*[-*] \S/m.test(what))
    return '`## What` is missing or has no bullet. The body must carry the full PR format.'
  const why = section(text, 'Why')
  if (why === undefined || !why.trim()) return '`## Why` is missing or empty.'
  const notes = section(text, 'Notes')
  if (notes !== undefined && !notes.trim()) return '`## Notes` is present but empty: drop the heading or fill it.'
  if (!rule.row) return undefined
  const isExempt = rule.noRow ? new RegExp(rule.noRow).test(title) : false
  if (isExempt || new RegExp(rule.row, 'm').test(text)) return undefined
  return (
    `no board-row line matching \`${rule.row}\`. Every work PR here names its board row; only titles ` +
    `matching \`${rule.noRow ?? '(none)'}\` name none.`
  )
}
