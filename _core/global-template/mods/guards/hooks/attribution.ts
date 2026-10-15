// The shipped attribution hook (`no-ai-attribution.py`), copied rule for rule: the same patterns, the same
// order of checks and the same reasons, so guards refuses exactly what the hook refuses and passes exactly
// what it passes. Python's regex flags are spelled out where JavaScript has none (`(?i:...)` as letter
// classes, `\Z` as the end of the text). Pure but for the file reads it is handed.

import { expandUser, isAbs, join, opened } from './hostpath'
import type { Host } from './hostpath'

/** Reads a file's text; throws when it cannot. */
export type ReadFile = (path: string) => Promise<string>

// A letter in either case: Python's `(?i:...)` group.
const ci = (s: string) => s.replace(/[a-z]/gi, c => `[${c.toLowerCase()}${c.toUpperCase()}]`)
const anyCase = (words: string[]) => words.map(ci).join('|')

// Obfuscation-tolerant: optional zero-width / separator chars between letters.
const Z = String.raw`[​‌‍⁠﻿\s\-_.*]*`
const fuzzy = (word: string) => [...word].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(Z)
// AI tool names that make a "made with / by" phrase a credit line.
const TOOLS = String.raw`ai|llm|assistant|copilot|codex|chat${Z}gpt|gpt|gemini`

const ATTRIBUTION = new RegExp(
  [
    String.raw`co${Z}-?${Z}authored${Z}-?${Z}by`,
    fuzzy('claude'),
    'c[l1|]a[uü]de',
    fuzzy('anthropic'),
    'noreply@',
    String.raw`generated${Z}(with|by)${Z}(an?${Z})?(claude|ai|llm|anthropic|copilot|cursor|codex|gpt)\b`,
    String.raw`claude\.(ai|com)`,
    String.raw`anthropic\.com`,
    String.raw`claude${Z}-?${Z}session`,
    'session_[0-9a-z]{20,}',
    '🤖',
    String.raw`ai${Z}-?${Z}(assisted|generated|written|authored)`,
    String.raw`\b(?:written|created|made|authored|produced|assisted|co-?written)${Z}(?:with|by|using|via)` +
      String.raw`${Z}(?:an?${Z})?(?:${TOOLS}|cursor${Z}(?:ai|ide|agent))\b`,
    String.raw`\b(?:generated|written|created|made|authored|produced|assisted|co-?written)${Z}` +
      String.raw`(?:with|by|using|via)${Z}:[ \t]*(?:an?${Z})?(?:${TOOLS}|cursor)\b`,
  ].join('|'),
  'i',
)

const HOOK_BYPASS = new RegExp(
  String.raw`--no-verify\b|core\.hooksPath|LEFTHOOK\s*=\s*0|lefthook\s+uninstall|` +
    String.raw`--no-hooks\b|hooks\.\w+\s*=|git\s+config[^|;&\n]*hooks`,
  'i',
)
// -n means --no-verify only on these; `git tag -n` / `cherry-pick -n` differ.
const NO_VERIFY_N = /\bgit\b[^|;&\n]*?\b(?:commit|merge|push)\b[^|;&\n]*?(?<=\s)-n(?=\s|$)/i
const TRAILER = /--trailer\b/i
const REUSE = /\bcommit\b[^|;&\n]*?(?:--reuse-message\b|--reedit-message\b|\s-[Cc]\s+\S)/i
const EVAL = /\beval\b/i

const GIT_WRITE =
  /\bgit\b[^|;&\n]*?\b(commit|merge|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace)\b/i
const GH_WRITE =
  /\bgh\b[^|;&\n]*?\b(pr|issue|release|gist|repo)\b[^|;&\n]*?\b(create|edit|comment|review|merge|close|reopen)\b/i
const GH_API_WRITE = new RegExp(
  String.raw`\bgh\b[^|;&\n]*?\bapi\b(?=[^|;&\n]*?(-X\s*(POST|PATCH|PUT)|--method\s*(POST|PATCH|PUT)|` +
    String.raw`(?<=\s)-[fF]\s|--field|--raw-field|--input))`,
  'i',
)
const CURL_GH = /\bcurl\b[^|;&\n]*api\.github\.com/i
const PS_GH = /Invoke-(RestMethod|WebRequest)\b[^|;&\n]*api\.github\.com/i
const FILTER_REPO = /\bgit\s+filter-repo\b|\bgit\s+filter-branch\b/i

// Flags whose next token is a file the hook must read. `-F` is case-sensitive: a lowercase `-f` is `git tag
// -f` (force) or `gh pr create -f` (fill). Long flags match whole (`--filename` is not `--file`). The value
// may follow a space or the long-option `=` (`--body-file=body.md`).
const FILE_FLAGS = new RegExp(
  String.raw`(?:(?<=\s)-F` +
    String.raw`|(?<long>${anyCase(['--file', '--body-file', '--notes-file', '--template', '--input'])}` +
    String.raw`|${anyCase(['--message-file', '-InFile'])})(?![\w-])` +
    String.raw`|${ci('Get-Content')}(?:\s+(?:${anyCase(['-Raw', '-Path', '-LiteralPath'])})(?![\w-]))*` +
    String.raw`|(?<=\s)-d\s*@|${ci('--data')}(?:${ci('-binary')}|${ci('-raw')})?\s*@)` +
    String.raw`\s*=?\s*(?:"(?<dq>[^"]+)"|'(?<sq>[^']+)'|(?<bare>\S+))`,
  'g',
)
// Python's `$` without MULTILINE also matches before a final line break.
const SEGMENT_START = /[;&|\n][^;&|\n]*(?=\n?$)/

// Message flags and their value: a double-quoted string, a single-quoted string (literal, never expands) or
// a bare token, optionally behind a gh field name (`-f body="..."`). Long forms first so `-b` never claims the
// front of `-Body`. Inside double quotes the escape character is `\` in bash and a backtick in PowerShell.
function msgValue(esc: '\\' | '`'): RegExp {
  const e = esc === '\\' ? '\\\\' : '`'
  return new RegExp(
    String.raw`(?<=\s)(?:--message|--body|--title|--notes|--field|--raw-field|-Body|-m|-b|-t|-f|-F)(?=[\s="'])` +
      String.raw`\s*=?\s*(?:[A-Za-z_][\w\[\].-]*=)?` +
      `(?:"(?<dq>(?:[^"${e}]|${e}.)*)"|'[^']*'|(?<bare>[^\\s'"]+))`,
    'gis',
  )
}
const MSG_VALUE = { '\\': msgValue('\\'), '`': msgValue('`') }
const BASH_SUBST = /\$\(|`[^`]+`|<\(|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/
const PS_SUBST = /\$\(|\$\{?[A-Za-z_][A-Za-z0-9_:]*\}?/

// Here-docs: quoted ones (<<'EOF') are literal, unquoted ones expand.
const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g
// PowerShell here-strings: @'...'@ is literal, @"..."@ expands.
const HERESTRING = /@(['"])[ \t]*\n([\s\S]*?)\n\1@/g

const PATH_TOKEN = /(?<!:\/)(?<![\w])(?:[A-Za-z]:|~)?(?:[\\/][\w.-]+)+/g
// Repo identifiers that legitimately carry the word: the instructions file, the config directory, the two
// review workflow files, their check name, the action they run and the templates repo's own name. Exact
// tokens only; anything else stays denied.
const ALLOWED_NAMES = new RegExp(
  String.raw`\bCLAUDE\.md\b|\.claude(?:[\\/][\w.\-]*)*|` +
    '`?claude(?:-code-review)?\\*?\\.yml`?|`?Claude On-Demand`?|`?claude-code-action`?|`?Claude Code Review`?|' +
    String.raw`\bclaude-code-templates\b`,
  'g',
)

/** Mask file-system paths and the repo's own CLAUDE.md / .claude references. URLs survive (the lookbehind
 * skips the `//` after a scheme), so session links are still caught. */
export function stripPaths(cmd: string): string {
  return cmd.replace(PATH_TOKEN, '<path>').replace(ALLOWED_NAMES, '<repo-file>')
}

type Span = [number, number]
const isIn = (spans: Span[], at: number) => spans.some(([s, e]) => s <= at && at < e)
const spansOf = (re: RegExp, text: string): Span[] =>
  [...text.matchAll(re)].map(m => [m.index ?? 0, (m.index ?? 0) + m[0].length])

// Spans of quoted strings, here-doc bodies and here-strings: text a message carries, where a flag name is a
// mention, not an argument. `esc` is the shell's escape character inside double quotes.
function textSpans(cmd: string, esc: string): Span[] {
  const spans = [...spansOf(HEREDOC, cmd), ...spansOf(HERESTRING, cmd)]
  const n = cmd.length
  for (let i = 0; i < n; ) {
    const inside = spans.find(([s, e]) => s <= i && i < e)
    if (inside) {
      i = inside[1]
      continue
    }
    const q = cmd[i] as string
    if (q !== "'" && q !== '"') {
      i++
      continue
    }
    let j = i + 1
    while (j < n && cmd[j] !== q) j += q === '"' && cmd[j] === esc ? 2 : 1
    spans.push([i, j + 1])
    i = j + 1
  }
  return spans
}

// The command with every quoted span blanked, same length: arguments only.
function mask(cmd: string, spans: Span[]): string {
  const chars = [...cmd.split('')]
  for (const [s, e] of spans) for (let k = s; k < Math.min(e, chars.length); k++) if (chars[k] !== '\n') chars[k] = ' '
  return chars.join('')
}

// The files the command hands to git or gh, as the hook's `open()` would read them.
function filesOf(cmd: string, cwd: string, spans: Span[], host: Host): string[] {
  const out: string[] = []
  for (const m of cmd.matchAll(FILE_FLAGS)) {
    if (isIn(spans, m.index ?? 0)) continue
    const g = m.groups ?? {}
    let path = g.dq || g.sq || g.bare
    if (!path || path === '-') continue
    if ((g.long ?? '').toLowerCase() === '--template') {
      // A file for `git commit`; a template name or repository for gh.
      const before = cmd.slice(0, m.index)
      const seg = SEGMENT_START.exec(before)
      if (!/\bgit\b/i.test(seg ? before.slice(seg.index) : before)) continue
    }
    if (path.includes('=')) {
      // gh -F key=value / key=@file; key=@- reads stdin.
      if (!path.includes('=@')) continue
      path = path.slice(path.indexOf('=@') + 2)
      if (path === '-') continue
    }
    path = expandUser(path.replace(/^["']+|["']+$/g, ''), host)
    if (!isAbs(path, host)) {
      const cd = /(?:^|&&|;)\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(cmd)
      const base = cd ? (cd[1] || cd[2] || cd[3] || cwd) : cwd
      path = join(base.replace(/^["']+|["']+$/g, ''), path, host)
    }
    out.push(path)
  }
  return out
}

// Message text the shell expands before git or gh sees it: double-quoted or bare message values, unquoted
// here-doc bodies, @"..."@ here-strings.
function expandedValues(cmd: string, spans: Span[], powershell: boolean): string[] {
  const out: string[] = []
  for (const m of cmd.matchAll(MSG_VALUE[powershell ? '`' : '\\'])) {
    if (isIn(spans, m.index ?? 0)) continue
    const { dq, bare } = m.groups ?? {}
    if (dq !== undefined) out.push(dq)
    else if (bare && !bare.startsWith('@')) out.push(bare)
  }
  for (const m of cmd.matchAll(HEREDOC)) if (!m[1]) out.push(m[3] ?? '')
  if (powershell) for (const m of cmd.matchAll(HERESTRING)) if (m[1] === '"') out.push(m[2] ?? '')
  return out
}

const creditIn = (text: string, where: string) => {
  const hit = ATTRIBUTION.exec(stripPaths(text))
  return hit ? `attribution marker '${hit[0]}' found in ${where}.` : undefined
}

/** What the hook decides for one command: its reason to deny, or undefined to pass. With `isCredit` false
 * (the `attribution` setting off) the AI-credit scan and what only serves it (reading message files,
 * refusing text the scan cannot read) are left out; every route around the commit gates stays. */
export async function attributionReason(
  cmd: string,
  at: { cwd: string; powershell: boolean; host: Host; read: ReadFile; isCredit: boolean },
): Promise<string | undefined> {
  const { cwd, powershell, host, read, isCredit } = at
  if (!cmd) return undefined
  const spans = textSpans(cmd, powershell ? '`' : '\\')
  const args = mask(cmd, spans)
  const isGit = GIT_WRITE.test(args)
  const isGh = GH_WRITE.test(args) || GH_API_WRITE.test(args)
  const isHttp = CURL_GH.test(args) || PS_GH.test(args)
  if (!(isGit || isGh || isHttp)) {
    // Still refuse to weaken the git-side guard from any command.
    return /lefthook\s+uninstall|LEFTHOOK\s*=\s*0/i.test(args)
      ? 'disabling lefthook removes the commit-msg attribution check.'
      : undefined
  }
  if (FILTER_REPO.test(args)) return 'history rewriting tools are not allowed from a session.'
  if (isGit && (HOOK_BYPASS.test(args) || NO_VERIFY_N.test(args)))
    return 'git hook bypass (--no-verify / -n / hooksPath) is not allowed.'
  if (isGit && TRAILER.test(args)) return '--trailer is not allowed; write the message body directly.'
  if (isGit && REUSE.test(args))
    return "reusing another commit's message (-C / -c / --reuse-message) cannot be scanned."
  if (EVAL.test(args)) return 'eval builds the command at run time, so the hook cannot read the message.'
  if (isCredit) {
    const hit = creditIn(cmd, 'the command text')
    if (hit) return hit
    // Message text must be literal. Any expansion hides content from the hook.
    const subst = powershell ? PS_SUBST : BASH_SUBST
    for (const value of expandedValues(cmd, spans, powershell)) {
      if (subst.test(value.replace(powershell ? /`./g : /\\./g, '')))
        return (
          'message/body text uses shell expansion ($VAR, $(...), backticks, <(...)) that the hook cannot read. ' +
          'Use a literal string, a here-doc, or --body-file <literal absolute path>.'
        )
    }
    for (const path of filesOf(cmd, cwd, spans, host)) {
      let text: string
      try {
        text = await read(opened(path, cwd, host))
      } catch (e) {
        return `could not read message/body file ${path}: ${String(e)}. Use a literal absolute path.`
      }
      const fileHit = creditIn(text, `file ${path}`)
      if (fileHit) return fileHit
    }
  }
  if (isGit && /(?<=\s)-F\s+-(?=\s|$)|--file[= ]-(?=\s|$)/.test(args) && !cmd.includes('<<'))
    return '`-F -` reads the message from a pipe the hook cannot see. Use a here-doc in the same command.'
  return undefined
}
