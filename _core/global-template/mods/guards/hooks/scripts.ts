// Shells that run a script given on their command line or fed to them: `bash -c '...'`, `bash <<'EOF'`,
// `powershell -Command "..."`, `cmd /c ...`. The script is read as commands of its own. Pure.

import { parse } from './shell'
import type { Statement, Word } from './shell'

/** A script a shell runs. `text`: the script as typed, when it is one command line; `isBody`: a here-doc
 * fed to the shell, filled in as one. */
export type Script = { statements: Statement[]; ps: boolean; dynamic: boolean; text?: string; isBody?: boolean }

const SHELLS = /^(bash|sh|zsh|dash|ksh)$/
// How many following words a shell option takes as values: one per `o`/`O` in a bundle (`-euo pipefail`,
// `+o history`), one for `--rcfile`/`--init-file`.
const shellValues = (t: string) =>
  /^--(rcfile|init-file)$/.test(t) ? 1 : /^[-+][A-Za-z]+$/.test(t) ? (t.match(/[oO]/g)?.length ?? 0) : 0

// The first word that is neither an option nor an option's value: a script file, or -1.
function fileAt(args: Word[]): number {
  for (let i = 0; i < args.length; i++) {
    const t = args[i]?.text ?? ''
    if (!/^[-+]/.test(t)) return i
    i += shellValues(t)
  }
  return -1
}

// PowerShell's own parameters, matched by any prefix from their shortest form up (`-exec`, `-win`, `-comm`).
const PS_PARAMS: [string, string[]][] = [
  ['command', ['c']], ['file', ['f']], ['encodedcommand', ['e', 'ec']], ['encodedarguments', ['ea']],
  ['executionpolicy', ['ex', 'ep']], ['windowstyle', ['w']], ['workingdirectory', ['wo', 'wd']],
  ['outputformat', ['o', 'of']], ['inputformat', ['inp', 'if']], ['configurationname', ['config']],
  ['configurationfile', ['configurationf']], ['custompipename', ['cus']], ['settingsfile', ['settings']],
  ['psconsolefile', ['psc']], ['version', ['v']],
]
function psParam(t: string): string | undefined {
  const p = t.replace(/^-/, '').toLowerCase()
  return PS_PARAMS.find(([n, short]) => short.includes(p) || (n.startsWith(p) && short.some(s => p.startsWith(s))))?.[0]
}

// A shell reading its script from a here-doc or here-string (`bash <<'EOF'`, `sh -s <<< '...'`): nothing
// but flags on the line.
function stdinScript(st: Statement, args: Word[]): Script | undefined {
  const text = st.heredocs[0]
  if (text === undefined || st.heredocs.length > 1 || fileAt(args) !== -1) return undefined
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
  if (SHELLS.test(name)) {
    // bash takes its `-c` script from the first word that is no option or option value (`-co pipefail 'x'`);
    // with no `-c` before that word, it is a script file (`bash gen.sh -c cfg`).
    const file = fileAt(args)
    const hasC = args.slice(0, file === -1 ? args.length : file).some(a => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a.text))
    if (!hasC) return stdinScript(st, args)
    return file === -1 ? undefined : of(file, false, true)
  }
  if (/^(pwsh|powershell)$/.test(name)) return psScript(name, args, of)
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

// PowerShell's script: what follows `-Command`, or a first plain word (pwsh's `-File`, powershell.exe's
// `-Command`). A script file or an encoded command is never read: the outer statement counts as a program.
function psScript(
  name: string,
  args: Word[],
  of: (i: number, ps: boolean, from?: boolean) => Script | undefined,
): Script | undefined {
  for (let i = 0; i < args.length; i++) {
    const t = args[i]?.text ?? ''
    if (!t.startsWith('-')) return name === 'pwsh' ? undefined : of(i, true, true)
    const p = psParam(t)
    if (p === 'command') return of(i, true)
    if (p === 'file' || p === 'encodedcommand' || p === 'encodedarguments') return undefined
    if (p !== undefined && p !== 'version') i++
    else if (p === 'version' && name === 'powershell') i++
  }
  return undefined
}
