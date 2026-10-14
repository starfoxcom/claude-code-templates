// What the guards make of one Bash or PowerShell command: the reading (inspect.ts), with what it could not
// follow sorted into refusals and notes. A command the reading cannot fully follow is treated as the
// shipped attribution hook treats every command: its whole text is checked for credit, its bypass routes
// are refused, and a message whose text is built at run time is refused. Refusing every such command
// blocked about one write in seven of real work that the hook passes (2026-10-14 replay), so a shape the
// reading misses is noted; a hook skip typed in such a command is still refused. Pure, no engine access.

import { HOOK_SKIP } from './bypass'
import { readCommand } from './inspect'
import type { Plan } from './plan'
import { namesWrite, notPlain, runsShellText, withoutBodies } from './plain'

// The unread kinds real work produces (2026-10-14 replay) that only the shell can fill in, and that the
// shipped hook passes: noted. Every other unread kind stays refused.
const NOTED = new Set([
  'a word built at run time',
  'a gh subcommand built at run time',
  'a program named at run time',
])

export function inspect(command: string, powershell: boolean): Plan {
  const why = namesWrite(command, powershell) ? notPlain(command, powershell) : undefined
  const plan = readCommand(command, powershell)
  if (why) plan.notes.push(`not plain: ${why}`)
  plan.notes.push(...plan.unread.filter(what => NOTED.has(what)))
  plan.unread = plan.unread.filter(what => !NOTED.has(what))
  // Where the reading could not follow every word, a hook skip typed in the command is refused, as the hook
  // refuses it (`ARGS=(--no-verify); git commit -m x "${ARGS[@]}"`, `$G commit -n -m x`).
  if (plan.notes.length > 0 && SKIP_TYPED.test(skipText(command, plan, why))) {
    plan.isWrite = true
    plan.block ??= HOOK_SKIP
  }
  return plan
}

const SKIP_TYPED = /(?:^|[\s(=])--no-(?:verify|hooks)\b|\bcommit\b[^|;&\n]*?\s-[a-zA-Z]*n[a-zA-Z]*(?=[\s;&|)]|$)/
// Where a skip may be typed: outside quotes and quoted here-doc bodies; anywhere but the messages read when a
// launcher runs quoted text as shell code (`flock /tmp/l -c 'git commit --no-verify -m x'`); anywhere when
// Windows PowerShell breaks a quoted word apart (`-m 'a "b" --no-verify'` reaches git as `a b --no-verify`).
function skipText(command: string, plan: Plan, why: string | undefined): string {
  if (why?.startsWith('a word Windows PowerShell passes on changed')) return command
  if (!runsShellText(command)) return withoutBodies(command).replace(QUOTED, ' ')
  const messages = plan.texts.filter(t => !t.creditOnly && t.text.length > 0).map(t => t.text)
  return messages.reduce((text, message) => text.split(message).join(' '), command)
}

const QUOTED = /'(?:[^']|'')*'|"(?:[^"\\`]|[\\`][^]|"")*"/g
