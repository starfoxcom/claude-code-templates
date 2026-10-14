// The routes around the check, looked for in a command's text: the backstop for a command the reading could
// not fully follow (a launcher's quoted shell text, a program named at run time), where `bypassOf` never sees
// a git or gh statement. Each route `bypass.ts` refuses in a statement has its text form here, as the shipped
// attribution hook spells it. Pure, no engine access.

import { HISTORY_REWRITE, HOOK_SKIP, HOOKS_OFF, REUSE, RUNS_COMMAND, TRAILER } from './bypass'

// git, past its global options, or a program word built at run time (`$G`, `/usr/bin/g[i]t`, `& (gcm g?t)`),
// right before `commit`: a `-n` or `-C` after it is the commit's own.
const GIT = String.raw`\bgit(?:\s+-[cC]\s+\S+|\s+--?[A-Za-z][\w-]*(?:=\S+)?)*`
const COMMIT = String.raw`(?:${GIT}|[^\s;&|]*[$*?[)][^\s;&|]*)\s+commit\b`
const REST = String.raw`[^|;&\n]*?`
// The hooks path set or dropped (`-c core.hooksPath=x`, `git config core.hooksPath x`, `--unset`); a read
// (`git config --get core.hooksPath`) is none.
const HOOKS_SET =
  String.raw`core\.hookspath\s*=|--unset(?:-all)?\s+core\.hookspath|` +
  String.raw`\bconfig(?:\s+--?(?!get|list|show)[\w-]+)*\s+core\.hookspath\s+(?![0-9]*[<>|;&])\S`
const ENDS = String.raw`(?=[\s;&|)'"]|$)`

const ROUTES: [RegExp, string][] = [
  [/\bfilter-(?:repo|branch)\b/i, HISTORY_REWRITE],
  [new RegExp(String.raw`--no-(?:verify|hooks)\b|${COMMIT}${REST}\s-[a-zA-Z]*n[a-zA-Z]*${ENDS}`), HOOK_SKIP],
  [new RegExp(String.raw`${HOOKS_SET}|\bhooks\.\w+\s*=|--config-env[=\s]+(?:core\.hookspath|hooks\.)`, 'i'), HOOK_SKIP],
  [
    new RegExp(
      String.raw`\b(?:LEFTHOOK|HUSKY)\s*\+?=\s*['"]?(?:0|false)\b|\b(?:HUSKY_SKIP_HOOKS|SKIP_SIMPLE_GIT_HOOKS|` +
        String.raw`LEFTHOOK_EXCLUDE)\b|\b(?:lefthook|husky|pre-commit)\s+uninstall\b`,
      'i',
    ),
    HOOKS_OFF,
  ],
  [/--trailer\b/, TRAILER],
  [
    new RegExp(String.raw`${COMMIT}${REST}(?:--re(?:use|edit)-message|--fixup=(?:amend|reword):|\s-[cC]${ENDS})`),
    REUSE,
  ],
  [
    new RegExp(
      String.raw`\brebase\b${REST}\s(?:-x|--exec)\b|\bsubmodule\s+foreach\b|\bbisect\s+run\b|--extcmd\b|` +
        String.raw`\bgh\s+alias\s+(?:set|import)\b`,
    ),
    RUNS_COMMAND,
  ],
]

/** The first route around the check the text names, or undefined. */
export function routeIn(text: string): string | undefined {
  return ROUTES.find(([route]) => route.test(text))?.[1]
}
