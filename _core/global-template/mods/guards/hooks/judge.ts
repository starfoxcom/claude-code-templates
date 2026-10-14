// What the guards make of one Bash or PowerShell command: the reading (inspect.ts), with what it could not
// follow sorted into refusals and notes. A command the reading cannot fully follow is treated as the
// shipped attribution hook treats every command: its whole text is checked for credit, its bypass routes
// are refused, and a message whose text is built at run time is refused. Refusing every such command
// blocked about one write in seven of real work that the hook passes (2026-10-14 replay), so a shape the
// reading misses is noted, never refused. Pure, no engine access.

import { HOOK_SKIP } from './bypass'
import { readCommand } from './inspect'
import { emptyPlan, type Plan } from './plan'
import { namesWrite, notPlain } from './plain'
import { stripPaths } from './policy'

export function inspect(command: string, powershell: boolean): Plan {
  const why = namesWrite(command, powershell) ? notPlain(command, powershell) : undefined
  let plan: Plan
  try {
    plan = readCommand(command, powershell)
  } catch {
    plan = { ...emptyPlan(), isWrite: true, notes: ['a command the reading could not follow'] }
    plan.texts.push({ where: 'the command text', text: stripPaths(command), creditOnly: true })
  }
  if (why) plan.notes.push(`not plain: ${why}`)
  // A word the reading cannot place (a flag, a subcommand, a setting, a branch name, a script) is the
  // hook's blind spot too: noted. Message text built at run time stays refused, as the hook refuses it.
  const isShape = (what: string) => /^an? /.test(what) || what === 'the new branch name'
  plan.notes.push(...plan.unread.filter(isShape))
  plan.unread = plan.unread.filter(what => !isShape(what))
  // Where a word went unplaced, a hook skip typed outside quotes is refused, as the hook refuses it
  // (`ARGS=(--no-verify); git commit -m x "${ARGS[@]}"`).
  if (plan.isWrite && plan.notes.length > 0 && SKIP_TYPED.test(unquoted(command))) plan.block ??= HOOK_SKIP
  return plan
}

const SKIP_TYPED = /(?:^|[\s(=])--no-(?:verify|hooks)\b/
// The command with its quoted strings blanked: what the shell reads as words and options.
const unquoted = (command: string) => command.replace(/'(?:[^']|'')*'|"(?:[^"\\`]|[\\`][^]|"")*"/g, ' ')
