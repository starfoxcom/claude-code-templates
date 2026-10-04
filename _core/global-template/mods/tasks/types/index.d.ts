/** One task as the mirror keeps it (hooks/register.ts writes mods-data/tasks/<session>.json). */
export type TaskRow = {
  id: string
  subject: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Set while the task waits on a decision or another task: what it waits on. */
  hold?: string
  /** Set when the task was deleted unfinished (epoch ms): shown as dropped, not done. */
  droppedAt?: number
}

/** What the view draws: the mirrored list and when it last changed. */
export type TasksView = {
  tasks: TaskRow[]
  updatedAt: number
  /** The previous session in this folder left these unfinished; shown until this session makes its own list. */
  carried: TaskRow[]
}

/** The settings pane's own state: the last refusal per field. */
export type SettingsView = { errors: Record<string, string> }

declare module 'claude-code' {
  interface PluginState {
    tasks: { view: TasksView | null; settings: SettingsView | null }
  }
}
