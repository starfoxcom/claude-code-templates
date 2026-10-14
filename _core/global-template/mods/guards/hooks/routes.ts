// The routes around the check, looked for in a command's text, where the reading never sees them as a
// statement: every git or gh call the text names (a launcher's quoted text, a here-doc a shell runs) is
// checked by the rules a typed call meets (`callRoute`), and in a command the reading could not fully follow,
// the routes that are no git or gh call (a hook manager switched off, a hooks setting in git's environment)
// are looked for by their text (`routeIn`). Pure, no engine access.

import { bypassOf, HOOK_SKIP, HOOKS_OFF } from './bypass'
import type { Statement, Word } from './statement'

// A hooks setting through git's environment.
const HOOKS_ENV = String.raw`\bGIT_CONFIG_(?:PARAMETERS|KEY_\d+)\s*\+?=\s*['"]*[^\s]*(?:core\.hookspath|hooks\.)`

const ROUTES: [RegExp, string][] = [
  [new RegExp(String.raw`${HOOKS_ENV}|--config-env[=\s]+(?:core\.hookspath|hooks\.)`, 'i'), HOOK_SKIP],
  [
    new RegExp(
      String.raw`\b(?:LEFTHOOK|HUSKY)\s*\+?=\s*['"]?(?:0|false)\b|\b(?:HUSKY_SKIP_HOOKS|SKIP_SIMPLE_GIT_HOOKS|` +
        String.raw`LEFTHOOK_EXCLUDE)\b|\b(?:lefthook|husky|pre-commit)\s+uninstall\b`,
      'i',
    ),
    HOOKS_OFF,
  ],
  // pre-commit's `SKIP` names the hooks to skip; the name is upper case, so code's `skip = 1` is none.
  [/(?:^|[\s;&|('"])SKIP\s*\+?=\s*\S/, HOOKS_OFF],
]

/** The first route around the check the text names, or undefined. */
export function routeIn(text: string): string | undefined {
  return ROUTES.find(([route]) => route.test(text))?.[1]
}

// git or gh as a program word anywhere in the text (a launcher's quoted text, a here-doc a shell runs, a
// Windows path), with quotes taken out.
const CALL = /(?:^|[\s;&|(`])(?:[\w.~:-]*[\\/])?(git|gh)(?:\.exe)?(?=[ \t])/gi

/** Each git or gh call the text names, its words up to the end of its statement, checked by the same rules a
 * typed call meets (`bypassOf`): every spelling git or gh accepts for a route is caught, not only the
 * spellings the table above lists. */
export function callRoute(text: string): string | undefined {
  const plain = text.replace(/['"]/g, ' ')
  for (const m of plain.matchAll(CALL)) {
    const rest = plain.slice((m.index ?? 0) + m[0].length)
    const end = rest.search(/[;&|\n`)]/)
    const words = (end === -1 ? rest : rest.slice(0, end)).split(/[ \t]+/).filter(Boolean)
    const args: Word[] = words.map(w => ({ text: w, dynamic: /[$`]/.test(w), bodies: [] }))
    const name = (m[1] as string).toLowerCase()
    const head: Word = { text: name, dynamic: false, bodies: [] }
    const st: Statement = { words: [head, ...args], heredocs: [], writes: [], reads: [], pipeIn: false, inner: [] }
    const reason = bypassOf(st, name, args)
    if (reason) return reason
  }
  return undefined
}
