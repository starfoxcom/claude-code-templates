/** What `git status --porcelain=v1 --branch` says about the working copy. */
export type GitState = {
  /** Undefined on a detached HEAD or outside a repository. */
  branch?: string
  /** Commits on the branch not on its upstream, and the other way round. */
  ahead: number
  behind: number
  /** Changed paths, each with its two-letter status (` M`, `??`, ...). */
  changed: string[]
}

/** What the session row draws. */
export type SessionLine = {
  model: string
  /** The effort the last main-loop request was sent with, when the model takes one. */
  effort?: string
  project: string
  git: GitState
}

/** The settings pane's own state: the last refusal per field. */
export type SettingsView = { errors: Record<string, string>; saved?: Record<string, string> }

declare module 'claude-code' {
  interface PluginState {
    'session-info': { line: SessionLine | null; isExpanded: boolean; settings: SettingsView | null }
  }
}
