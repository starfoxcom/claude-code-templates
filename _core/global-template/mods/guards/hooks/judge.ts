// What the guards make of one Bash or PowerShell command: the reading (inspect.ts), with what it could not
// follow sorted into refusals and notes. The reading is the only judge: a git or gh call is checked where the
// reading finds it as a statement, and a part of the command that may run one the reading cannot see (a
// launcher's quoted text, a shell fed through a pipe, a program word built at run time) is refused there
// (bypass.ts). A shape the reading cannot follow that runs no unseen git or gh call is noted, not refused:
// refusing every such command blocked about one write in seven of real work that the shipped attribution
// hook passes (2026-10-14 replay). Pure, no engine access.

import { readCommand } from './inspect'
import type { Plan } from './plan'
import { namesWrite, notPlain } from './plain'

// The unread kinds real work produces (2026-10-14 replay) that only the shell can fill in, and that the
// shipped hook passes: noted. Every other unread kind stays refused.
const NOTED = new Set(['a word built at run time', 'a gh subcommand built at run time'])

export function inspect(command: string, powershell: boolean): Plan {
  const why = namesWrite(command, powershell) ? notPlain(command, powershell) : undefined
  const plan = readCommand(command, powershell)
  if (why) plan.notes.push(`not plain: ${why}`)
  plan.notes.push(...plan.unread.filter(what => NOTED.has(what)))
  plan.unread = plan.unread.filter(what => !NOTED.has(what))
  return plan
}
