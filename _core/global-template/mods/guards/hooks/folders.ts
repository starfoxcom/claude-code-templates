// Where a command's statements run: the folder each `cd`, `pushd` and `popd` leads to, kept apart for
// each subshell, `$(...)` and child shell, as the shell keeps it. Pure.

import type { Statement, Word } from './shell'

/** A folder the command moved to: `path` is relative to the session folder unless absolute; none = there. */
export type Folder = { path?: string; isUnknown: boolean }

/** Where one write statement lands: the folder it runs in (unknown when git is pointed at another repo),
 * the repo its `--repo` names, and for a commit the lines it adds: `cached` the staged ones, `all` the
 * working tree's too (`-a`, pathspecs). */
export type Target = { folder: Folder; repo?: string; diff?: 'cached' | 'all' }

/** What the statement being read sets for itself: `git -C <dir>`, `gh --repo`, the lines its commit adds. */
export type Here = { dir?: Word; repo?: Word; diff?: 'cached' | 'all' }

// Git pointed at another repo than its folder's: `GIT_DIR=x git`, `--git-dir`, `--work-tree`, a
// `core.worktree` setting; `GH_REPO` for gh.
const REPO_ENV = /^(\$env:)?(GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR)|GH_REPO)(=|$)/i
const REPO_FLAG = /^--(git-dir|work-tree)(=|$)/
const WORKTREE = /^core\.worktree\b/i

/** Whether one statement's git or gh call runs on another repo than its folder's, and whether the
 * statement moves every write after it (`export GIT_DIR=x`, `git config core.worktree x`). */
export function repoMoves(st: Statement, name: string, args: Word[]) {
  const isTool = name === 'git' || name === 'gh'
  const lead = st.words.slice(0, st.words.length - args.length)
  const isMoved =
    (isTool && lead.some(w => REPO_ENV.test(w.text))) || (name === 'git' && args.some(a => REPO_FLAG.test(a.text)))
  const movesLater =
    (!isTool && st.words.some(w => REPO_ENV.test(w.text))) || (name === 'git' && args.some(a => WORKTREE.test(a.text)))
  return { isMoved, movesLater }
}

/** The write's target. A repo moved, or a `--repo` built at run time, leaves where it lands unknown. */
export function targetOf(folder: Folder, here: Here, isMoved: boolean): Target {
  const { repo, diff } = here
  const isUnknown = isMoved || Boolean(repo?.dynamic)
  const name = repo && !repo.dynamic ? repo.text.split('/').pop() : undefined
  return { folder: isUnknown ? { isUnknown: true } : folder, repo: name, diff }
}

/** The places moved so far, by scope, and the scope of the statement being read. */
type Places = { places: Map<string, Place>; scope: string }

// The folder a statement runs in and its `pushd` stack. Each subshell, `$(...)` or child shell moves a
// copy of its own, so a `cd` there is gone once it closes.
export type Place = { folder: Folder; folders: Folder[] }

export function placeHere(r: Places): Place {
  for (let s = r.scope; ; s = s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : '') {
    const place = r.places.get(s)
    if (place) return place
    if (s === '') return { folder: { isUnknown: false }, folders: [] }
  }
}

// The place of the scope being read, copied from the one it runs inside on its first move.
export function movePlace(r: Places): Place {
  const outer = placeHere(r)
  if (r.places.get(r.scope) === outer) return outer
  const place = { folder: outer.folder, folders: [...outer.folders] }
  r.places.set(r.scope, place)
  return place
}

// The folder after a `cd`: a literal target composes onto it, anything else (`$DIR`, `-`, `popd`, no
// target) leaves it unknown.
export function moveFolder(folder: Folder, target: Word | undefined): Folder {
  if (folder.isUnknown || !target || target.dynamic || target.text === '-') return { isUnknown: true }
  const dir = target.text.replace(/\\/g, '/')
  if (/^([a-zA-Z]:)?\/|^~/.test(dir) || folder.path === undefined) return { path: dir, isUnknown: false }
  return { path: `${folder.path.replace(/\/$/, '')}/${dir}`, isUnknown: false }
}
