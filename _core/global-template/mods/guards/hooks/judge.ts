// What the guards make of one Bash or PowerShell command: the reading (inspect.ts), with what it could not
// follow sorted into refusals and notes. A command the reading cannot fully follow is treated as the
// shipped attribution hook treats every command: its whole text is checked for credit, its bypass routes
// are refused, and a message whose text is built at run time is refused. Refusing every such command
// blocked about one write in seven of real work that the hook passes (2026-10-14 replay), so a shape the
// reading misses is noted; a route around the check named in it is still refused (routes.ts). Pure, no
// engine access.

import { readCommand } from './inspect'
import type { Plan } from './plan'
import { launcherIn, namesWrite, notPlain, runsShellText, withoutBodies } from './plain'
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
  const route = plan.notes.length > 0 ? routeIn(scanText(command, plan, why)) : undefined
  // A git or gh call inside a launcher's quoted text runs unread, as one inside `eval` does; a flag word built at run
  // time from a variable the command sets to a flag (`ARGS=(-n); git commit -m x "${ARGS[@]}"`) is unread too.
  const launcher = launcherIn(command)
  const isFlagHeld = plan.notes.some(n => /may be a flag|may carry more options/.test(n)) && FLAG_HELD.test(command)
  const reason = route ?? (launcher ? launched(launcher) : isFlagHeld ? FLAG_IN_VARIABLE : undefined)
  if (reason) {
    plan.isWrite = true
    plan.block ??= reason
  }
  return plan
}

const FLAG_HELD = /\b\w+\+?=(?:\((?:[^)]*?[\s'"])?-|['"]?-)/
const FLAG_IN_VARIABLE = 'a flag held in a variable cannot be read. Type the flags of the git or gh call out.'
const launched = (name: string) =>
  `a git or gh call run through \`${name}\` cannot be read. Run the git or gh call directly, as its own command.`

// The command's text, quoted text included, less the messages the reading read and, unless a program in it
// runs shell text, the bodies of quoted here-docs. Windows PowerShell breaks a word holding `"` apart
// (`-m 'a "b" --no-verify'` reaches git as `a b --no-verify`), so then the whole text counts.
function scanText(command: string, plan: Plan, why: string | undefined): string {
  if (why?.startsWith('a word Windows PowerShell passes on changed')) return command
  let text = runsShellText(command) ? command : withoutBodies(command)
  for (const { text: message, creditOnly } of plan.texts) {
    if (creditOnly || message.length === 0) continue
    for (const quoted of [`'${message}'`, `"${message}"`]) text = text.split(quoted).join(' ')
  }
  return text
}
