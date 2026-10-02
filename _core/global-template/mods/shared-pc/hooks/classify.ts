// What counts as heavy work. Pure functions, no engine access, so tests import them directly.

export const MARKER = /#\s*shared-pc:\s*(heavy|light)\b/i

// Splits a shell command on && || ; | and newlines outside quotes. Quoted text stays in its segment:
// executables with spaces in their path are quoted, and stripping them would hide the command word.
export function segments(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      current += c
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      out.push(current)
      current = ''
      i++
      continue
    }
    if (c === ';' || c === '|' || c === '\n') {
      out.push(current)
      current = ''
      continue
    }
    current += c
  }
  out.push(current)
  return out.map(tidy).filter(Boolean)
}

// Drops leading VAR=x assignments, PowerShell's call operator and trailing output redirects (`2>&1`,
// `> out.txt`, so a scoped test stays light with its output captured), and unquotes the command word, so
// `& "C:\Program Files\godot.exe" --headless` reads `C:\Program Files\godot.exe --headless`.
function tidy(segment: string): string {
  let s = segment
    .trim()
    .replace(/^(\w+=\S*\s+)+/, '')
    .replace(/^[&.]\s+/, '')
    .replace(/(\s+\d*>{1,2}\s*&?\S+)+$/, '')
  const quoted = /^(["'])(.*?)\1/.exec(s)
  if (quoted) s = quoted[2] + s.slice(quoted[0].length)
  return s.trim()
}

// Light wins over heavy for the same segment; the command is heavy when any segment is.
export function classify(command: string, light: RegExp[], heavy: RegExp[]): 'heavy' | 'light' {
  const marked = MARKER.exec(command)
  if (marked) return (marked[1] ?? '').toLowerCase() === 'heavy' ? 'heavy' : 'light'
  return segments(command).some(seg => !light.some(r => r.test(seg)) && heavy.some(r => r.test(seg)))
    ? 'heavy'
    : 'light'
}

// A short name for the bar: the first heavy segment (or the first one, for a marked command), its
// executable path cut to the file name, at most 32 characters.
export function labelFor(command: string, light: RegExp[], heavy: RegExp[]): string {
  const parts = segments(command.replace(MARKER, ''))
  const pick =
    parts.find(seg => !light.some(r => r.test(seg)) && heavy.some(r => r.test(seg))) ?? parts[0] ?? command
  const [word = '', ...rest] = pick.split(/\s+(?=-|[^\\/:]*$)/)
  const short = [word.split(/[\\/]/).pop() ?? word, ...rest].join(' ')
  return short.length > 32 ? `${short.slice(0, 31)}…` : short
}

export function compile(list: readonly string[]): RegExp[] {
  return list.flatMap(src => {
    try {
      return [new RegExp(src, 'i')]
    } catch {
      return []
    }
  })
}
