// What the guards make of one Bash or PowerShell command: the reading (inspect.ts), with what it could not
// follow sorted into refusals and notes. A command the reading cannot fully follow is treated as the
// shipped attribution hook treats every command: its whole text is checked for credit, its bypass routes
// are refused, and a message whose text is built at run time is refused. Refusing every such command
// blocked about one write in seven of real work that the hook passes (2026-10-14 replay), so a shape the
// reading misses is noted; a route around the check named in it is still refused (routes.ts). Pure, no
// engine access.

import { launched } from './bypass'
import { readCommand } from './inspect'
import type { Plan } from './plan'
import { launcherIn, namesWrite, notPlain, QUOTED_STRING, runsShellText, withoutDataBodies } from './plain'
import { routeIn } from './routes'

// The unread kinds real work produces (2026-10-14 replay) that only the shell can fill in, and that the
// shipped hook passes: noted. Every other unread kind stays refused.
const NOTED = new Set(['a word built at run time', 'a gh subcommand built at run time'])

export function inspect(command: string, powershell: boolean): Plan {
  const why = namesWrite(command, powershell) ? notPlain(command, powershell) : undefined
  const plan = readCommand(command, powershell)
  if (why) plan.notes.push(`not plain: ${why}`)
  plan.notes.push(...plan.unread.filter(what => NOTED.has(what)))
  plan.unread = plan.unread.filter(what => !NOTED.has(what))
  // Where the reading could not follow every word, a route around the check named anywhere in the command is
  // refused (`flock /tmp/l -c 'git filter-repo --force'`, `ARGS=(--no-verify); git commit -m x "${ARGS[@]}"`).
  const route = plan.notes.length > 0 ? routeIn(scanText(command, plan, why, powershell)) : undefined
  // A git or gh call inside a launcher's quoted text runs unread, as one inside `eval` does; a flag word built at run
  // time from a variable the command sets to a flag (`ARGS=(-n); git commit -m x "${ARGS[@]}"`) is unread too.
  const launcher = launcherIn(command)
  const isFlagHeld = plan.notes.some(n => MAY_HOLD_FLAG.test(n)) && FLAG_HELD.test(flagText(command, powershell))
  const reason = route ?? (launcher ? launched(launcher) : isFlagHeld ? FLAG_IN_VARIABLE : undefined)
  if (reason) {
    plan.isWrite = true
    plan.block ??= reason
  }
  return plan
}

// The notes a word that may be a flag leaves: one `walk` or `take` could not place, or one in a call it never
// walks (`git rebase "${ARGS[@]}" main`).
const MAY_HOLD_FLAG = /may be a flag|may carry more options|a word built at run time/
// A variable the command sets to a flag: `X=-n`, `X=$'-n'`, `X=(-C HEAD)`, `printf -v X -- -n`, `for X in -n`,
// `set -- -n`, `mapfile -t X <<< -n`, a default (`${X:--n}`, `${X:=-n}`) or an element (`A[0]=-n`).
const FLAG_HELD = new RegExp(
  String.raw`\b\w+(?:\[[^\]]*\])?\+?=(?:\((?:[^)]*?[\s'"])?-|\$?['"]?-)|\$\{\w+:?[-=+?]['"]?-|` +
    String.raw`\b(?:printf\s+-v|for\s+\w+\s+in|set\s+--|(?:mapfile|readarray|read)\b[^;&|\n]*<<<)` +
    String.raw`[^;&|\n]*?[\s<]\$?['"]?-`,
)
const FLAG_IN_VARIABLE = 'a flag held in a variable cannot be read. Type the flags of the git or gh call out.'

// The command's code, where an assignment sets a variable: quoted text keeps only its dashes (a value's own,
// `ARGS=("-n")`), so a message that reads `X=-1` sets nothing; data here-doc bodies are left out.
function flagText(command: string, powershell: boolean): string {
  const code = runsShellText(command) ? command : withoutDataBodies(command, powershell)
  return code.replace(QUOTED_STRING, s => s[0] + s.slice(1, -1).replace(/[^-]/g, '\u0001') + s.slice(-1))
}

// The command's text, quoted text included, less the messages the reading read and, unless a program in it
// runs shell text, the here-doc and here-string bodies it passes as data. Windows PowerShell breaks a word
// holding `"` apart (`-m 'a "b" --no-verify'` reaches git as `a b --no-verify`), so then the whole text counts.
function scanText(command: string, plan: Plan, why: string | undefined, powershell: boolean): string {
  if (why?.startsWith('a word Windows PowerShell passes on changed')) return command
  let text = runsShellText(command) ? command : withoutDataBodies(command, powershell)
  for (const { text: message, creditOnly } of plan.texts) {
    if (creditOnly || message.length === 0) continue
    for (const quoted of spellings(message, powershell)) text = text.split(quoted).join(' ')
  }
  return text
}

// The ways a message the reading read is typed in quotes: as is, and with its quotes escaped (Bash's `\"`,
// PowerShell's doubled `''` and `""`).
const spellings = (m: string, powershell: boolean) =>
  powershell
    ? [`'${m.replace(/'/g, "''")}'`, `"${m.replace(/"/g, '""')}"`, `"${m.replace(/"/g, '`"')}"`]
    : [`'${m}'`, `"${m}"`, `"${m.replace(/["\\$`]/g, '\\$&')}"`]
