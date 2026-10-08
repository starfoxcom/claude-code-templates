// Shells that run a script given on their command line or fed to them: `bash -c '...'`, `bash <<'EOF'`,
// `powershell -Command "..."`, `cmd /c ...`. The script is read as commands of its own. Pure.

import { joinWords, sliceWord } from './quoting'
import { parse } from './shell'
import type { Statement, Word } from './shell'

/** A script a shell runs. `text`: the script as typed, when it is one command line, with `literals` where
 * a `$` in it was typed as plain text (`Word.literals`); `isBody`: a here-doc fed to the shell, filled in as
 * one. */
export type Script = {
  statements: Statement[]
  ps: boolean
  dynamic: boolean
  text?: string
  literals?: number[]
  isBody?: boolean
}

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
  ['command', ['c']], ['commandwithargs', ['cwa', 'commandw']], ['file', ['f']], ['encodedcommand', ['e', 'ec']],
  ['encodedarguments', ['ea', 'encodeda']],
  ['executionpolicy', ['ex', 'ep']], ['windowstyle', ['w']], ['workingdirectory', ['wo', 'wd']],
  ['outputformat', ['o', 'of']], ['inputformat', ['inp', 'if']], ['configurationname', ['config']],
  ['configurationfile', ['configurationf']], ['custompipename', ['cus']], ['settingsfile', ['settings']],
  ['psconsolefile', ['psc']], ['version', ['v']],
]
function psParam(t: string): string | undefined {
  // pwsh takes `-name` and `--name` alike.
  const p = t.replace(/^--?/, '').toLowerCase()
  return PS_PARAMS.find(([n, short]) => short.includes(p) || (n.startsWith(p) && short.some(s => p.startsWith(s))))?.[0]
}

// A shell reading its script from a here-doc or here-string (`bash <<'EOF'`, `sh -s <<< '...'`): nothing
// but flags on the line.
function stdinScript(st: Statement, args: Word[]): Script | undefined {
  const text = st.heredocs[0]
  // With `-s` the words after the options are the script's own arguments (`bash -s -- "$x" <<'EOF'`).
  const file = fileAt(args)
  const isStdin = args.slice(0, file === -1 ? args.length : file).some(a => /^-[a-zA-Z]*s/.test(a.text))
  if (text === undefined || st.heredocs.length > 1 || (file !== -1 && !isStdin)) return undefined
  return { statements: parse(text, false), ps: false, dynamic: Boolean(st.hasDynamicBody), text, isBody: true }
}

/** The script the statement's program runs, when it is a shell given one. */
export function script(st: Statement, name: string, args: Word[]): Script | undefined {
  // The script: every word after the one at `i` (`-c`, `-Command`); `from` takes them from `i` itself.
  const of = (i: number, ps: boolean, from = false) => {
    const rest = args.slice(from ? i : i + 1)
    if (i === -1 || rest.length === 0) return undefined
    const { text, literals } = joinWords(rest)
    return { statements: parse(text, ps), ps, dynamic: rest.some(a => a.dynamic), text, literals }
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
      const literals = words[0]?.literals
      return { statements: parse(text, false), ps: false, dynamic: words[0]?.dynamic ?? false, text, literals }
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
    if (p === 'command' || p === 'commandwithargs') return of(i, true)
    // `-EncodedArguments` only carries a value: a `-Command` after it still runs.
    if (p === 'file' || p === 'encodedcommand') return undefined
    if (p !== undefined && p !== 'version') i++
    else if (p === 'version' && name === 'powershell') i++
  }
  return undefined
}

// The text `Invoke-Expression` runs: past its `-Command` (any prefix, or `-Command:'...'`), or, with none,
// what comes down the pipe: the statement before, read whole when it is one value.
export function psEvalWords(st: Statement, args: Word[], prev?: Statement): Word[] | undefined {
  const [first] = args
  const command = /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?(?::(.+))?$/i.exec(first?.text ?? '')
  const value = command?.[1]
  if (first && value) return [sliceWord(first, first.text.length - value.length), ...args.slice(1)]
  if (command) return args.slice(1)
  if (args.length > 0 || !st.pipeIn || !prev) return args
  // A value (`'...' | iex`, `$c | iex`), or `echo`/`Write-Output` of values; any other program's output is
  // text the reading cannot know (undefined).
  const isValue = (w: Word) => Boolean(w.quotedStart) || (w.dynamic && /^\$\w+$/.test(w.text))
  const [head, ...rest] = prev.words
  if (head && prev.words.length === 1 && isValue(head)) return prev.words
  const isPrint = /^(echo|write-output|write)$/i.test(head?.text ?? '') && !head?.quotedStart
  return isPrint && rest.length > 0 && rest.every(isValue) ? rest : undefined
}
