// Where a command's statements run: the folder each `cd`, `pushd` and `popd` leads to, kept apart for
// each subshell, `$(...)` and child shell, as the shell keeps it. Pure.

import type { Word } from './shell'

/** A folder the command moved to: `path` is relative to the session folder unless absolute; none = there. */
export type Folder = { path?: string; isUnknown: boolean }

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
