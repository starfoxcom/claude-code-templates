import type { GitState } from '../types'

export const GIT_STATUS = ['git', 'status', '--porcelain=v1', '--branch', '--untracked-files=normal']

const EMPTY: GitState = { ahead: 0, behind: 0, changed: [] }

// The header line: `## main...origin/main [ahead 1, behind 2]`, `## main` with no upstream,
// `## HEAD (no branch)` when detached, `## No commits yet on main` in a fresh repository.
function readHeader(header: string): Omit<GitState, 'changed'> {
  const text = header.slice(3)
  if (text.startsWith('HEAD (no branch)')) return { ahead: 0, behind: 0 }
  const fresh = /^(?:No commits yet|Initial commit) on (.+)$/.exec(text)
  if (fresh) return { branch: fresh[1], ahead: 0, behind: 0 }
  const branch = text.split('...')[0]?.split(' ')[0]
  const ahead = Number(/ahead (\d+)/.exec(text)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(text)?.[1] ?? 0)
  return { branch: branch || undefined, ahead, behind }
}

/** Reads `git status --porcelain=v1 --branch` output; empty or foreign output reads as no repository. */
export function parseStatus(stdout: string): GitState {
  const lines = stdout.split(/\r?\n/).filter(Boolean)
  const header = lines[0]
  if (!header?.startsWith('## ')) return EMPTY
  return { ...readHeader(header), changed: lines.slice(1) }
}

/** `claude-opus-5-5[1m]` reads `Opus 5.5`; a name it does not know is shown as given. */
export function modelName(id: string): string {
  const bare = id.replace(/\[[^\]]*\]$/, '')
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(bare)
  if (!match) return bare
  const [, family = '', major, minor] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`
}
