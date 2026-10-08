// Shells that run a script given on their command line or fed to them: `bash -c '...'`, `bash <<'EOF'`,
// `powershell -Command "..."`, `cmd /c ...`. The script is read as commands of its own. Pure.

import { parse } from './shell'
import type { Statement, Word } from './shell'

/** A script a shell runs. `text`: the script as typed, when it is one command line; `isBody`: a here-doc
 * fed to the shell, filled in as one. */
export type Script = { statements: Statement[]; ps: boolean; dynamic: boolean; text?: string; isBody?: boolean }

const SHELLS = /^(bash|sh|zsh|dash|ksh)$/
// Options that take the next word as their value, so it is no script file (`bash -o pipefail -c ...`).
const SHELL_VALUES = /^([-+][oO]|--rcfile|--init-file)$/
const PS_VALUES = new RegExp(
  '^-(executionpolicy|ex|ep|windowstyle|w|workingdirectory|wd|inputformat|if|outputformat|of|' +
    'configurationname|settingsfile|version|v)$',
  'i',
)

// The first word that is neither an option nor an option's value: a script file, or -1.
function fileAt(args: Word[], values: RegExp): number {
  for (let i = 0; i < args.length; i++) {
    const t = args[i]?.text ?? ''
    if (!/^[-+]/.test(t)) return i
    if (values.test(t)) i++
  }
  return -1
}

// A shell reading its script from a here-doc or here-string (`bash <<'EOF'`, `sh -s <<< '...'`): nothing
// but flags on the line.
function stdinScript(st: Statement, args: Word[]): Script | undefined {
  const text = st.heredocs[0]
  if (text === undefined || st.heredocs.length > 1 || fileAt(args, SHELL_VALUES) !== -1) return undefined
  return { statements: parse(text, false), ps: false, dynamic: Boolean(st.hasDynamicBody), text, isBody: true }
}

/** The script the statement's program runs, when it is a shell given one. */
export function script(st: Statement, name: string, args: Word[]): Script | undefined {
  // The script: every word after the one at `i` (`-c`, `-Command`); `from` takes them from `i` itself.
  const of = (i: number, ps: boolean, from = false) => {
    const rest = args.slice(from ? i : i + 1)
    if (i === -1 || rest.length === 0) return undefined
    const text = rest.length === 1 ? (rest[0]?.text ?? '') : rest.map(a => a.text).join(' ')
    return { statements: parse(text, ps), ps, dynamic: rest.some(a => a.dynamic), text }
  }
  // A `-c` after the script file is that script's own argument (`bash gen.sh -c cfg`).
  const before = (i: number, end: number) => (end !== -1 && i > end ? -1 : i)
  if (SHELLS.test(name)) {
    const i = before(args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a.text)), fileAt(args, SHELL_VALUES))
    return i === -1 ? stdinScript(st, args) : of(i, false)
  }
  if (/^(pwsh|powershell)$/.test(name)) {
    const command = args.findIndex(a => /^-(c|command)$/i.test(a.text))
    const explicit = args.findIndex(a => /^-(f|file)$/i.test(a.text))
    const positional = fileAt(args, PS_VALUES)
    // A first plain word is pwsh's `-File` and powershell.exe's `-Command`: the rest of the line runs.
    if (positional !== -1 && (command === -1 || positional < command))
      return name === 'pwsh' ? undefined : of(positional, true, true)
    return of(before(command, explicit), true)
  }
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
