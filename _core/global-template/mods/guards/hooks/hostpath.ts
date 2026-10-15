// File paths as the shipped hook scripts resolve them: Python 3.9's `os.path` (`ntpath` on Windows,
// `posixpath` elsewhere), then the file their `open()` reads. A Git Bash path such as `/c/Users/x` is a
// rooted path to Python on Windows, so it opens `C:\c\Users\x`, exactly as the scripts do. Pure.

export type Host = { isWindows: boolean; home: string }

const SEPS = /[\\/]/

// `ntpath.splitdrive`: a drive letter, or a UNC share.
function splitDrive(p: string): [string, string] {
  const m = /^(?:[A-Za-z]:|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.exec(p)
  return m ? [m[0], p.slice(m[0].length)] : ['', p]
}

/** `os.path.isabs`. */
export function isAbs(p: string, host: Host): boolean {
  if (!host.isWindows) return p.startsWith('/')
  return SEPS.test(splitDrive(p)[1][0] ?? '')
}

/** `os.path.join` of two parts. */
export function join(a: string, b: string, host: Host): string {
  if (!host.isWindows) return b.startsWith('/') ? b : a === '' || a.endsWith('/') ? a + b : `${a}/${b}`
  let [drive, path] = splitDrive(a)
  const [bDrive, bPath] = splitDrive(b)
  if (SEPS.test(bPath[0] ?? '')) return (bDrive || !drive ? bDrive : drive) + bPath
  if (bDrive && bDrive.toLowerCase() !== drive.toLowerCase()) return bDrive + bPath
  if (bDrive) drive = bDrive
  if (path && !SEPS.test(path[path.length - 1] as string)) path += '\\'
  path += bPath
  if (path && !SEPS.test(path[0] as string) && drive && !drive.endsWith(':')) return `${drive}\\${path}`
  return drive + path
}

/** `os.path.expanduser`: `~` and `~/...` from the home folder; on Windows `~name` is a sibling of it. */
export function expandUser(p: string, host: Host): string {
  if (!p.startsWith('~')) return p
  const end = p.search(SEPS) === -1 ? p.length : p.search(SEPS)
  const name = p.slice(1, end)
  if (!name) return host.home + p.slice(1)
  if (!host.isWindows) return p
  const parent = host.home.replace(/[\\/][^\\/]*$/, '')
  return join(parent, name, host) + p.slice(end)
}

/** The file `open(p)` reads when the script runs in `cwd`: a relative path from there, and on Windows a
 * rooted path with no drive on that folder's drive. Forward slashes, for the engine's file reads. */
export function opened(p: string, cwd: string, host: Host): string {
  let full = p
  if (host.isWindows) {
    const [drive, rest] = splitDrive(p)
    if (!drive && SEPS.test(rest[0] ?? '')) full = splitDrive(cwd)[0] + p
    else if (!drive) full = join(cwd, p, host)
  } else if (!p.startsWith('/')) full = join(cwd, p, host)
  return full.replace(/\\/g, '/')
}
