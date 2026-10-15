// The routes around the check, looked for in a command's text, where the reading never sees them as a
// statement: every git or gh call the text names (a launcher's quoted text, a here-doc a shell runs) is
// checked by the rules a typed call meets (`callRoute`), and in a command the reading could not fully follow,
// the routes that are no git or gh call (a hook manager switched off, a hooks setting in git's environment)
// are looked for by their text (`routeIn`). Pure, no engine access.

import { bypassOf, HOOK_SKIP, HOOKS_OFF } from './bypass'
import { QUOTED_STRING } from './plain'
import type { Statement, Word } from './statement'

// A hooks setting through git's environment.
const HOOKS_ENV = String.raw`\bGIT_CONFIG_(?:PARAMETERS|KEY_\d+)\s*\+?=\s*['"]*[^\s]*(?:core\.hookspath|hooks\.)`

// A hook manager's switch (`HUSKY=0`, `SKIP=`) counts only where it reaches a git call that runs hooks, which
// the reading judges on its statements, and `callRoute` in text it never parsed: a switch in front of `npm ci`
// skips no gate, so no text form of it is here.
const ROUTES: [RegExp, string][] = [
  [new RegExp(String.raw`${HOOKS_ENV}|--config-env[=\s]+(?:core\.hookspath|hooks\.)`, 'i'), HOOK_SKIP],
  [/\b(?:lefthook|husky|pre-commit)\s+uninstall\b/i, HOOKS_OFF],
]

/** The first route around the check the text names, or undefined. */
export function routeIn(text: string): string | undefined {
  return ROUTES.find(([route]) => route.test(text))?.[1]
}

// git or gh as a program word anywhere in the text (a launcher's quoted text, a here-doc a shell runs, a
// Windows path), with quotes taken out.
// A path names a folder before git (`/usr/bin/git`, `C:\Git\cmd\git.exe`); a pattern's `/git ...` names none.
// The `NAME=value` words typed in front of it are its environment (`HUSKY=0 git commit`).
const CALL = /(?:^|[\s;&|(`])((?:[A-Za-z_]\w*=\S*[ \t]+)*)(?:[\\/]?(?:[\w.~:-]+[\\/])+)?(git|gh)(?:\.exe)?(?=[ \t])/gi

const wordOf = (text: string): Word => ({ text, dynamic: /[$`]/.test(text), bodies: [] })

/** Each git or gh call the text names, its words up to the end of its statement, checked by the same rules a
 * typed call meets (`bypassOf`): every spelling git or gh accepts for a route is caught, not only the
 * spellings the table above lists. */
export function callRoute(text: string): string | undefined {
  // A separator inside quotes ends no statement (`-m "fix(x): y" -n`): blanked before the quotes go.
  // A `$(...)` or backtick span is one word of the call (`-m $(date) -n`), so its `)` ends nothing.
  const plain = text
    .replace(QUOTED_STRING, s => s.replace(/[;&|()`\n]/g, ' '))
    .replace(/\$\([^()\n]*\)|`[^`\n]*`/g, 'X')
    .replace(/['"]/g, ' ')
  for (const m of plain.matchAll(CALL)) {
    const rest = plain.slice((m.index ?? 0) + m[0].length)
    const end = rest.search(/[;&|\n`)]/)
    const args = (end === -1 ? rest : rest.slice(0, end)).split(/[ \t]+/).filter(Boolean).map(wordOf)
    const name = (m[2] as string).toLowerCase()
    const env = (m[1] ?? '').split(/[ \t]+/).filter(Boolean).map(wordOf)
    const words = [...env, wordOf(name), ...args]
    const st: Statement = { words, heredocs: [], writes: [], reads: [], pipeIn: false, inner: [] }
    const reason = bypassOf(st, name, args)
    if (reason) return reason
  }
  return undefined
}
