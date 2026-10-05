// Banned names, opt-in per repo: in the repos listed in mods-data/guards/names.json, the names a repo
// keeps out of its history (a clean-room project's reference titles) are blocked in commit messages,
// PR and issue text, body files and new branch names. Pure, no engine access. Without the file nothing
// is checked. Added lines in project files stay the project's own CI check.

/** One repo's list: `names` match anywhere, in any case ("oldkeep" catches "OldkeepPLUS");
 * `words` match as whole words, case kept ("OK" catches "OK-normal" but never "BOOK" or "ok"). */
export type NameRule = { names?: string[]; words?: string[] }
export type NameRules = { repos: Record<string, NameRule> }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The rules file as read, or undefined when its shape is not a list of strings per repo. */
export function readNameRules(text: string): NameRules | undefined {
  const rules = JSON.parse(text) as NameRules
  if (!rules || typeof rules.repos !== 'object') return undefined
  const isList = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(s => typeof s === 'string'))
  const isValid = Object.values(rules.repos).every(r => r && isList(r.names) && isList(r.words))
  return isValid ? rules : undefined
}

/** The first banned name in the text, as written there, or undefined. */
export function findName(text: string, rule: NameRule): string | undefined {
  // A name of several words matches across any run of spaces or a line break.
  const names = (rule.names ?? []).filter(Boolean).map(n => escape(n.trim()).replace(/\s+/g, '\\s+'))
  const words = (rule.words ?? []).filter(Boolean).map(w => `(?<![\\p{L}\\p{N}_])${escape(w)}(?![\\p{L}\\p{N}_])`)
  const hits = [
    names.length > 0 ? new RegExp(names.join('|'), 'iu').exec(text) : null,
    words.length > 0 ? new RegExp(words.join('|'), 'u').exec(text) : null,
  ].filter(h => h !== null)
  // The earliest hit in the text, so the message points at the first one a reader meets.
  return hits.sort((a, b) => a.index - b.index)[0]?.[0]
}

export function describeName(match: string, where: string): string {
  return (
    `"${match}" named in ${where}. This repo keeps that name out of its history (mods-data/guards/names.json): ` +
    'reword it with neutral terms.'
  )
}
