// How each git, gh and web-call option is read: the flag tables the command reading walks. Declarative data.

// `attached`: a flag whose value can only be attached (`-S<keyid>`, `--gpg-sign=<keyid>`); it never takes
// the next word, and in a bundle the rest of the word is its value.
export type Kind = 'text' | 'file' | 'skip' | 'repo' | 'branch' | 'field' | 'data' | 'method' | 'attached'
export type Spec = Record<string, Kind>

export const COMMIT: Spec = {
  '-m': 'text',
  '--message': 'text',
  '-F': 'file',
  '--file': 'file',
  '-t': 'file',
  '--template': 'file',
  '-C': 'skip',
  '-c': 'skip',
  '--reuse-message': 'skip',
  '--reedit-message': 'skip',
  '--fixup': 'skip',
  '--squash': 'skip',
  '--author': 'text',
  '--date': 'skip',
  '--trailer': 'text',
  '--cleanup': 'skip',
  '-S': 'attached',
  '--gpg-sign': 'attached',
  '-u': 'attached',
  '--untracked-files': 'attached',
}
export const MESSAGE: Spec = { '-m': 'text', '--message': 'text', '-F': 'file', '--file': 'file' }
export const GH_BODY: Spec = {
  '-t': 'text',
  '--title': 'text',
  '-b': 'text',
  '--body': 'text',
  '-F': 'file',
  '--body-file': 'file',
  '-R': 'repo',
  '--repo': 'repo',
  '-T': 'skip',
  '--template': 'skip',
  '-B': 'skip',
  '--base': 'skip',
  '-H': 'skip',
  '--head': 'skip',
  '-a': 'skip',
  '--assignee': 'skip',
  '-l': 'skip',
  '--label': 'skip',
  '-m': 'skip',
  '--milestone': 'skip',
  '-p': 'skip',
  '--project': 'skip',
  '-r': 'skip',
  '--reviewer': 'skip',
  '--add-label': 'skip',
  '--remove-label': 'skip',
  '--comment': 'text',
}
// Subcommands whose short flags mean something else: a boolean read as value-taking would swallow the
// next word (`gh pr review 5 -a -b '<text>'` would hide the body), so each gets its own table. Flags
// absent from a table are read as booleans.
export const GH_REVIEW: Spec = {
  '-b': 'text',
  '--body': 'text',
  '-F': 'file',
  '--body-file': 'file',
  '-R': 'repo',
  '--repo': 'repo',
}
export const GH_MERGE: Spec = {
  '-b': 'text',
  '--body': 'text',
  '-F': 'file',
  '--body-file': 'file',
  '-t': 'text',
  '--subject': 'text',
  '-A': 'skip',
  '--author-email': 'skip',
  '--match-head-commit': 'skip',
  '-R': 'repo',
  '--repo': 'repo',
}
export const GH_CLOSE: Spec = {
  '-c': 'text',
  '--comment': 'text',
  '-r': 'skip',
  '--reason': 'skip',
  '-R': 'repo',
  '--repo': 'repo',
}
export const GH_RELEASE: Spec = {
  '-t': 'text',
  '--title': 'text',
  '-n': 'text',
  '--notes': 'text',
  '-F': 'file',
  '--notes-file': 'file',
  '-R': 'repo',
  '--repo': 'repo',
  '--target': 'skip',
}
export const GH_DESC: Spec = { '-d': 'text', '--desc': 'text', '--description': 'text', '-R': 'repo', '--repo': 'repo' }
export const GH_API: Spec = {
  '-f': 'field',
  '--raw-field': 'field',
  '-F': 'field',
  '--field': 'field',
  '--input': 'file',
  '-X': 'method',
  '--method': 'method',
  '-H': 'skip',
  '--header': 'skip',
  '--jq': 'skip',
  '-q': 'skip',
}
export const CURL: Spec = { '-d': 'data', '--data': 'data', '--data-raw': 'data', '--data-binary': 'data' }
export const PS_WEB: Spec = { '-body': 'text', '-infile': 'file' }

export const GH_WRITES: Record<string, string[]> = {
  pr: ['create', 'edit', 'comment', 'review', 'merge', 'close', 'reopen'],
  issue: ['create', 'edit', 'comment', 'close', 'reopen'],
  release: ['create', 'edit'],
  gist: ['create', 'edit'],
  repo: ['create', 'edit'],
}

// A hashtable typed in full: each key a name or a quoted string, each value a quoted string with nothing
// to fill in, a number, or `$true`, `$false` or `$null`. Any other value runs at run time.
// A double-quoted string may escape with a backtick (`` `n ``, `` `$ ``) or double its quote; a here-string
// starts its text on the next line.
const DOUBLE = String.raw`"(?:[^"$\x60]|\x60[\s\S]|"")*"`
const HERE = String.raw`@'[ \t]*\r?\n[\s\S]*?\n'@|@"[ \t]*\r?\n(?:[^$\x60]|\x60[\s\S])*?\n"@`
const TYPED_KEY = String.raw`(?:\w+|'[^']*'|${DOUBLE})`
const TYPED_VALUE = String.raw`(?:'(?:[^']|'')*'|${DOUBLE}|${HERE}|-?\d+(?:\.\d+)?|\$(?:true|false|null))`
const TYPED_ENTRY = String.raw`${TYPED_KEY}\s*=\s*${TYPED_VALUE}`
const TYPED_ENTRIES = String.raw`(?:${TYPED_ENTRY}(?:\s*[;\n]\s*${TYPED_ENTRY})*)?`
export const TYPED_TABLE = new RegExp(String.raw`^@\{\s*${TYPED_ENTRIES}\s*;?\s*\}$`, 'i')
