// How the shells pass quoted and escaped text on: a word's plain `$` and backticks, cut or joined with it,
// Bash's `$'...'` escapes, PowerShell's backtick escapes, and the PowerShell words that are expressions,
// casts or balanced brackets. Pure.

import type { Word } from './shell'

/** The word from `from` on (the value of `NAME=value`, `--opt=value`), its plain `$` kept where they are. */
export function sliceWord(w: Word, from: number): Word {
  const text = w.text.slice(from)
  const literals = w.literals?.map(at => at - from).filter(at => at >= 0 && at < text.length)
  return { ...w, text, literals }
}

/** Words joined by spaces (an `eval` line, a `bash -c` script given in several words), plain `$` kept. */
export function joinWords(words: Word[]): { text: string; literals: number[] } {
  const literals: number[] = []
  let text = ''
  for (const [k, w] of words.entries()) {
    if (k > 0) text += ' '
    literals.push(...(w.literals ?? []).map(at => at + text.length))
    text += w.text
  }
  return { text, literals }
}

// PowerShell's backtick escapes that stand for another character.
export const PS_ESCAPES: Record<string, string> = { n: '\n', t: '\t' }

// Bash's `$'...'` escapes that stand for one character; `\nnn`, `\xHH`, `\uHHHH` and `\UHHHHHHHH` give a code.
const ANSI_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'",
  '"': '"', '?': '?',
}
const ANSI_CODE = /^([0-7]{1,3})|^x([0-9a-fA-F]{1,2})|^u([0-9a-fA-F]{1,4})|^U([0-9a-fA-F]{1,8})|^c([\s\S])/

/** The text of a Bash `$'...'` body (the part after `$'`) up to its closing quote, escapes decoded, and how
 * many characters it took, closing quote included. */
export function ansiBody(rest: string): { text: string; length: number } {
  let text = ''
  let k = 0
  for (; k < rest.length && rest[k] !== "'"; k++) {
    if (rest[k] !== '\\' || k + 1 >= rest.length) {
      text += rest[k]
      continue
    }
    const code = ANSI_CODE.exec(rest.slice(k + 1))
    if (code) {
      const [whole, oct, hex, u, U, ctrl] = code
      const n = ctrl ? (ctrl.codePointAt(0) ?? 0) & 0x1f : parseInt(oct ?? hex ?? u ?? U ?? '0', oct ? 8 : 16)
      text += String.fromCodePoint(Math.min(n, 0x10ffff))
      k += whole.length
    } else text += ANSI_ESCAPES[rest[++k] ?? ''] ?? `\\${rest[k]}`
  }
  return { text, length: k + 1 }
}

// Adds text the shell passes on as typed, noting where a `$` or a backtick in it sits.
export function plain(w: Word, text: string) {
  for (let k = 0; k < text.length; k++) if (/[$`]/.test(text[k] ?? '')) (w.literals ??= []).push(w.text.length + k)
  w.text += text
}

// PowerShell computes an unquoted word that goes on past a quoted part (`'--x'.Trim()`, `'a'+'b'`) or past a
// variable (`$o.Trim()`, `${o}[0]`), or opens with a cast (`[string]'x'`). Inside double quotes it is text.
export function isExpression(w: Word, c: string): boolean {
  if (c === '[' && w.text === '' && !w.quoted) return true
  if (w.quoted && c !== "'" && c !== '"') return true
  return /[.[(+*]/.test(c) && /\$([A-Za-z_][\w:]*|\{[^}]*\})$/.test(w.text)
}

// One or more `[...]` casts and nothing else, brackets balanced: `[void]`, `[Dictionary[string,int]]`.
export function isCasts(text: string): boolean {
  let depth = 0
  for (const ch of text) {
    if (ch === '[') depth++
    else if (ch === ']') depth--
    else if (depth === 0) return false
    if (depth < 0) return false
  }
  return depth === 0 && text.startsWith('[')
}

// Every bracket, paren and brace opened in the text is closed again.
export function isBalanced(text: string): boolean {
  let depth = 0
  for (const ch of text) {
    if ('[({'.includes(ch)) depth++
    else if ('])}'.includes(ch) && --depth < 0) return false
  }
  return depth === 0
}
