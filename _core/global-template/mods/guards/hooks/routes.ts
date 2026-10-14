// The routes around the check, looked for in a command's text: the backstop for a command the reading could
// not fully follow (a launcher's quoted shell text, a program named at run time), where `bypassOf` never sees
// a git or gh statement. Each route `bypass.ts` refuses in a statement has its text form here, as the shipped
// attribution hook spells it. Pure, no engine access.

import { bypassOf, HISTORY_REWRITE, HOOK_SKIP, HOOKS_OFF, REUSE, RUNS_COMMAND, TRAILER } from './bypass'
import type { Statement, Word } from './statement'

// git, past its global options, or a program word built at run time (`$G`, `/usr/bin/g[i]t`, `{gi,commi}t`,
// `& (gcm g?t)`), right before the subcommand: a `-n` or `-C` after it is the commit's own.
const VALUED = String.raw`-[cC]|--(?:git-dir|work-tree|namespace|config-env|super-prefix|attr-source|exec-path)`
const GIT = String.raw`\bgit(?:\s+(?:${VALUED})\s+\S+|\s+--?[A-Za-z][\w-]*(?:=\S+)?)*`
const PROGRAM = String.raw`(?:${GIT}|[^\s;&|]*[$*?[{)][^\s;&|]*)`
const COMMIT = String.raw`${PROGRAM}\s+commit\b`
// A brace expansion may hold the subcommand itself (`{gi,commi}t` runs `git commit`).
const BRACED = String.raw`(?:^|[\s;&|(])[^\s;&|$]*\{[^\s;&|$}]*,[^\s;&|]*`
const REST = String.raw`[^|;&\n]*?`
// The hooks path set or dropped (`-c core.hooksPath=x`, `git config core.hooksPath x`, `config set`,
// `--unset`, `config unset`, past `-f <file>`); a read (`git config --get core.hooksPath`) is none.
const CONFIG_OPTS = String.raw`(?:\s+(?:-f|--file|--blob|--type|--comment)\s+\S+|\s+--?(?!get|list|show)[\w-]+)*`
const HOOKS_SET =
  String.raw`core\.hookspath\s*=|--unset(?:-all)?\s+core\.hookspath|` +
  String.raw`\bconfig${CONFIG_OPTS}(?:\s+set${CONFIG_OPTS})?\s+core\.hookspath\s+(?![0-9]*[<>|;&])\S|` +
  String.raw`\bconfig${CONFIG_OPTS}\s+unset${CONFIG_OPTS}\s+core\.hookspath\b`
const ENDS = String.raw`(?=[\s;&|)'"]|$)`

// A commit's `-n` in a bundle of short flags (`-n`, `-an`, `-anm`); `-u` and `-S` take a value (`-uno`).
const SKIP_N = String.raw`(?:${COMMIT}|${BRACED})${REST}\s-(?![uS])[a-zA-Z]*n[a-zA-Z]*${ENDS}`
// A hooks setting through git's environment, or a hooks section dropped or renamed.
const HOOKS_ENV = String.raw`\bGIT_CONFIG_(?:PARAMETERS|KEY_\d+)\s*\+?=\s*['"]*[^\s]*(?:core\.hookspath|hooks\.)`
const SECTION = String.raw`(?:--|\s)(?:remove|rename)-section\s+['"]?(?:core|hooks)\b`
// A message reused from another commit or object, by `commit` or `notes`.
const REUSED =
  String.raw`(?:${PROGRAM}\s+(?:commit|notes)\b|${BRACED})${REST}` +
  String.raw`(?:--re(?:use|edit)-message|--fixup[=\s]+(?:amend|reword):|\s-[cC]${ENDS})`

const ROUTES: [RegExp, string][] = [
  [/\bfilter-(?:repo|branch)\b/i, HISTORY_REWRITE],
  [new RegExp(String.raw`--no-(?:verify|hooks)\b|${SKIP_N}`), HOOK_SKIP],
  [
    new RegExp(
      String.raw`${HOOKS_SET}|${HOOKS_ENV}|${SECTION}|\bhooks\.\w+\s*=|` +
        String.raw`--config-env[=\s]+(?:core\.hookspath|hooks\.)`,
      'i',
    ),
    HOOK_SKIP,
  ],
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
  [/--trailer\b/, TRAILER],
  [new RegExp(REUSED), REUSE],
  [
    new RegExp(
      String.raw`\b(?:rebase|difftool)\b${REST}\s(?:-[A-Za-z]*x|--exec)\b|\bsubmodule\s+foreach\b|\bbisect\s+run\b|` +
        String.raw`--extcmd\b|(?:\bgh|[^\s;&|]*[$*?[{)][^\s;&|]*)\s+alias\s+(?:set|import)\b`,
    ),
    RUNS_COMMAND,
  ],
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
