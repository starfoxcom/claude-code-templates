import type { Mirror, MirrorTask } from './register'

// Keep going: a turn that ends while a task on the list needs no one gets a prompt to carry on, so an
// unattended run never sits idle with work left that nobody has to wait for. Pure, no engine access:
// register.ts decides when to look and sends the prompt.

/** Prompts in a row, with no change to the task list between them, before the mod stops asking. */
export const MAX_IDLE_PROMPTS = 2

/** The tasks the model can work on now: open, not on hold, not waiting on another open task. */
export function workable(mirror: Mirror): MirrorTask[] {
  const isOpen = (task: MirrorTask) => task.status !== 'completed' && !task.droppedAt
  const openIds = new Set(mirror.tasks.filter(isOpen).map(task => task.id))
  const ready = mirror.tasks.filter(
    task => isOpen(task) && !task.hold && !(task.blockedBy ?? []).some(id => openIds.has(id)),
  )
  // The one in progress first: it is the work the turn stopped in.
  const isStarted = (task: MirrorTask) => task.status === 'in_progress'
  return [...ready.filter(isStarted), ...ready.filter(task => !isStarted(task))]
}

/** What is still coming that wakes the session on its own: a CI watch not yet settled or not yet sent. */
export function hasPendingWake(ciWatchState: string | undefined): boolean {
  if (!ciWatchState) return false
  try {
    const watches = (JSON.parse(ciWatchState) as { watches?: { outcome?: string; wakePending?: boolean }[] })
      .watches
    return (watches ?? []).some(watch => !watch.outcome || watch.wakePending)
  } catch {
    return false
  }
}

export function keepGoingText(tasks: readonly MirrorTask[]): string {
  const [first, ...rest] = tasks
  const more = rest.length > 0 ? ` (and ${rest.length} more with no hold)` : ''
  return (
    `[tasks] The turn ended with nothing pending to wake the session, and task #${first?.id} ` +
    `"${first?.subject}"${more} needs no one. Continue it now. If it waits on a person, a decision or ` +
    'another task, put it on hold with what it waits on; if it is done, mark it completed.'
  )
}
