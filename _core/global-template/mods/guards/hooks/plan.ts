// What the reading of one command hands the guard: the texts, files, branches and commits to check, and
// what it could not read. Types only.

import type { Folder, Target } from './folders'
import type { PrCall } from './prbody'

export type Plan = {
  /** Message text with where it goes ("the commit message", "the PR body"). `creditOnly`: command text
   * around a message (a `$(...)` as typed), checked for AI credit but not for the product name. */
  texts: { where: string; text: string; creditOnly?: boolean }[]
  /** Body files the command hands to git or gh, as written (relative to `folder` when not absolute).
   * `written`: this same command writes the file, and what it writes was read from the command text. */
  /** `folder`: where a relative path resolves, as the command stands where the file is named.
   * `scripted`: a script an earlier statement runs (python, node) may write it, unseen by the reading.
   * `named`: another program of the command may rewrite it (`Set-Content b.md`, `cp x b.md`, `npm run x`). */
  files: { where: string; path: string; written?: boolean; folder?: Folder; scripted?: boolean; named?: boolean }[]
  /** Files the command itself writes (`> file`). */
  written: { path: string; folder: Folder }[]
  branches: string[]
  /** Each write statement's folder, repo and commit lines, for the repo rules and the diff scan. */
  targets: Target[]
  /** Messages whose text is built in a way the guard cannot read ($VAR from outside, another program's output). */
  unread: string[]
  /** What was left unjudged without risk to history (the PR-body format, a diff cut short): logged, never refused. */
  notes: string[]
  block?: string
  isWrite: boolean
  /** Each `gh pr create` or `gh pr edit`: what it sets, for the PR-body contract. */
  prs: PrCall[]
  /** Every `gh` statement in the command: the PR-body contract judges only a command with one. */
  ghCalls: number
}
