// Shells that run a script given on their command line or fed to them: `bash -c '...'`, `bash <<'EOF'`,
// `powershell -Command "..."`, `cmd /c ...`. The script is read as commands of its own. Pure.

import { parse } from './shell'
import type { Statement, Word } from './shell'

/** A script a shell runs. `text`: the script as typed, when it is one command line; `isBody`: a here-doc
 * fed to the shell, filled in as one. */
export type Script = { statements: Statement[]; ps: boolean; dynamic: boolean; text?: string; isBody?: boolean }

const SHELLS = /^(bash|sh|zsh|dash|ksh)$/

// A shell reading its script from a here-doc or here-string (`bash <<'EOF'`, `sh -s <<< '...'`): nothing
// but flags on the line.
function stdinScript(st: Statement, args: Word[]): Script | undefined {
  const text = st.heredocs[0]
  if (text === undefined || st.heredocs.length > 1 || args.some(a => !a.text.startsWith('-'))) return undefined
  return { statements: parse(text, false), ps: false, dynamic: Boolean(st.hasDynamicBody), text, isBody: true }
}

/** The script the statement's program runs, when it is a shell given one. */
export function script(st: Statement, name: string, args: Word[]): Script | undefined {
  const of = (i: number, ps: boolean) => {
    const rest = args.slice(i + 1)
    if (i === -1 || rest.length === 0) return undefined
    const text = rest.length === 1 ? (rest[0]?.text ?? '') : rest.map(a => a.text).join(' ')
    return { statements: parse(text, ps), ps, dynamic: rest.some(a => a.dynamic), text }
  }
  if (SHELLS.test(name)) {
    const i = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a.text))
    return i === -1 ? stdinScript(st, args) : of(i, false)
  }
  if (/^(pwsh|powershell)$/.test(name))
    return of(
      args.findIndex(a => /^-(c|command)$/i.test(a.text)),
      true,
    )
  if (name === 'cmd') {
    // Git Bash turns `/c` into a path, so it is typed `//c` there.
    const i = args.findIndex(a => /^\/{1,2}[ck]$/i.test(a.text))
    if (i === -1) return undefined
    const words = args.slice(i + 1)
    // `cmd /c "git commit -m \"...\""`: the command as one quoted word is read as a command line.
    if (words.length === 1) {
      const text = words[0]?.text ?? ''
      return { statements: parse(text, false), ps: false, dynamic: words[0]?.dynamic ?? false, text }
    }
    return {
      statements: [{ words, heredocs: [], writes: [], reads: [], pipeIn: false, inner: [] }],
      ps: false,
      dynamic: false,
    }
  }
  return undefined
}
