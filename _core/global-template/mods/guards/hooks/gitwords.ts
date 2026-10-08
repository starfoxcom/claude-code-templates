// How the words of a git or gh call are read where they decide what it does: tag and branch flags that
// list instead of creating, a commit that takes the working tree, a `-c` setting that may move the hooks,
// and words built at run time that may become flags. Pure.

import type { Word } from './shell'
import { COMMIT, gitLong } from './specs'

// A `-c` setting built at run time that may move the hooks or run commands: its key is, or it is a hooks
// path, an alias or an include whose value is. `user.name=$N` changes no such thing.
export function isUnknownSetting(w: Word | undefined): boolean {
  if (!w?.dynamic) return false
  const key = w.text.split('=')[0] ?? ''
  return /[$`(]/.test(key) || /^(core\.hookspath|hooks\.|alias\.|include)/i.test(key)
}

// `git tag` flags that list, verify or delete instead of creating a tag.
export const TAG_READS = /^-[ldv]$|^-n\d*$|^--(list|delete|verify|contains|no-contains|points-at|merged|no-merged)(=|$)/

// `git branch` flags that list, delete or configure instead of creating a branch.
const BRANCH_NOT_CREATE = new RegExp(
  '^-[dDlarvu]|^--(' +
    'delete|list|all|remotes|show-current|contains|merged|no-merged|set-upstream|unset-upstream|edit-description' +
    ')',
)

// `git branch <name>` creates one (a rename or copy names the new one last); listing flags create none.
export function branchesOf(rest: Word[]): string[] {
  const flags = rest.filter(a => a.text.startsWith('-')).map(a => gitLong('branch', a.text))
  const names = rest.filter(a => !a.text.startsWith('-')).map(a => a.text)
  if (flags.some(f => /^-(m|M|c|C)$|^--(move|copy)$/.test(f))) return names.slice(-1)
  return flags.some(f => BRANCH_NOT_CREATE.test(f)) ? [] : names.slice(0, 1)
}

// `-a` in a bundle counts only before the first letter that takes a value: in `-Sabc` or `-uall` it is
// part of that value, read the same way `walk` reads the bundle.
export function isCommitAll(text: string): boolean {
  if (gitLong('commit', text) === '--all') return true
  if (!/^-[A-Za-z]/.test(text)) return false
  for (const letter of text.slice(1)) {
    if (letter === 'a') return true
    if (!/[A-Za-z]/.test(letter) || COMMIT[`-${letter}`]) return false
  }
  return false
}

// A word the shell splits into more words at run time, which may carry options.
export const splitsAt = (w: Word | undefined) => Boolean((w?.dynamic && w.splits) || w?.list || w?.expr)

// A PowerShell splat (`@a`) hands over the items of a list: any words at all.
export const isSplat = (w: Word | undefined, ps: boolean) => Boolean(ps && w && /^@\w/.test(w.text))

// A call as the write patterns read it. A `;`, `&`, `|` or line break inside a quoted word is text there,
// never the end of the call (`git -c 'x=!f() { a; }; f' push`).
export const lineOf = (name: string, args: Word[]) =>
  [name, ...args.map(a => a.text.replace(/[|;&\n]/g, ' '))].join(' ')

// A word built at run time that the program may read as a flag: split by the shell, or starting with an
// expansion or a dash.
export const mayBeFlag = (w: Word) =>
  w.list === true || w.expr === true || (w.dynamic && (w.splits === true || /^[-$`(]/.test(w.text)))

