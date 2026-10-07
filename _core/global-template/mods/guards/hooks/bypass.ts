// The routes around the attribution check that the shipped attribution hook refuses outright
// (`_core/global-template/hooks/no-ai-attribution.py`), ported pattern for pattern so the mod can replace
// it: history rewrites, skipped git hooks, `--trailer`, a reused commit message, `eval`, and lefthook
// switched off. Like the hook, they are matched on the command's arguments only: quoted text, here-doc
// bodies and here-strings are blanked first, so a message that names a flag never trips them. Pure.

// Here-docs (`<<'EOF'` literal, `<<EOF` expanding) and PowerShell here-strings (`@'...'@`, `@"..."@`).
const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g
const HERESTRING = /@(['"])[ \t]*\n[\s\S]*?\n\1@/g

const HOOK_BYPASS = new RegExp(
  String.raw`--no-verify\b|core\.hooksPath|LEFTHOOK\s*=\s*0|lefthook\s+uninstall|` +
    String.raw`--no-hooks\b|hooks\.\w+\s*=|git\s+config[^|;&\n]*hooks`,
  'i',
)
// `-n` means `--no-verify` only on these; `git tag -n` and `cherry-pick -n` differ.
const NO_VERIFY_N = /\bgit\b[^|;&\n]*?\b(?:commit|merge|push)\b[^|;&\n]*?(?<=\s)-n(?=\s|$)/i
const TRAILER = /--trailer\b/i
const REUSE = /\bcommit\b[^|;&\n]*?(?:--reuse-message\b|--reedit-message\b|\s-[Cc]\s+\S)/i
const EVAL = /\beval\b/i
const LEFTHOOK_OFF = /lefthook\s+uninstall|LEFTHOOK\s*=\s*0/i
const FILTER_REPO = /\bgit\s+filter-repo\b|\bgit\s+filter-branch\b/i

const GIT_WRITE =
  /\bgit\b[^|;&\n]*?\b(commit|merge|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace)\b/i
const GH_WRITE = new RegExp(
  String.raw`\bgh\b[^|;&\n]*?\b(pr|issue|release|gist|repo)\b[^|;&\n]*?` +
    String.raw`\b(create|edit|comment|review|merge|close|reopen)\b`,
  'i',
)
const GH_API_WRITE = new RegExp(
  String.raw`\bgh\b[^|;&\n]*?\bapi\b(?=[^|;&\n]*?(-X\s*(POST|PATCH|PUT)|--method\s*(POST|PATCH|PUT)|` +
    String.raw`(?<=\s)-[fF]\s|--field|--raw-field|--input))`,
  'i',
)
const WEB_WRITE = /\bcurl\b[^|;&\n]*api\.github\.com|Invoke-(RestMethod|WebRequest)\b[^|;&\n]*api\.github\.com/i

/** The spans of quoted strings, here-doc bodies and here-strings; `esc` escapes inside double quotes. */
export function textSpans(command: string, esc: string): [number, number][] {
  const spans: [number, number][] = []
  for (const re of [HEREDOC, HERESTRING]) {
    for (const m of command.matchAll(re)) spans.push([m.index, m.index + m[0].length])
  }
  let i = 0
  while (i < command.length) {
    const inside = spans.find(([s, e]) => s <= i && i < e)
    if (inside) {
      i = inside[1]
      continue
    }
    const quote = command[i] as string
    if (quote !== "'" && quote !== '"') {
      i++
      continue
    }
    let j = i + 1
    while (j < command.length && command[j] !== quote) j += quote === '"' && command[j] === esc ? 2 : 1
    spans.push([i, j + 1])
    i = j + 1
  }
  return spans
}

/** The command with every quoted span blanked, line breaks kept: its arguments only. */
export function maskQuoted(command: string, powershell: boolean): string {
  const chars = [...command]
  for (const [s, e] of textSpans(command, powershell ? '`' : '\\'))
    for (let k = s; k < Math.min(e, chars.length); k++) if (chars[k] !== '\n') chars[k] = ' '
  return chars.join('')
}

/** The reason to refuse a route around the attribution check, or undefined. */
export function bypassReason(command: string, powershell: boolean): string | undefined {
  const args = maskQuoted(command, powershell)
  const isGit = GIT_WRITE.test(args)
  if (!isGit && !GH_WRITE.test(args) && !GH_API_WRITE.test(args) && !WEB_WRITE.test(args)) {
    // Weakening the git-side check is refused from any command.
    return LEFTHOOK_OFF.test(args) ? 'disabling lefthook removes the commit-msg attribution check.' : undefined
  }
  if (FILTER_REPO.test(args))
    return 'history rewriting tools (git filter-repo, git filter-branch) are not allowed from a session.'
  if (isGit && (HOOK_BYPASS.test(args) || NO_VERIFY_N.test(args)))
    return 'git hook bypass (--no-verify / -n / hooksPath) is not allowed.'
  if (isGit && TRAILER.test(args)) return '--trailer is not allowed; write the message body directly.'
  if (isGit && REUSE.test(args)) return "reusing another commit's message (-C / -c / --reuse-message) cannot be read."
  if (EVAL.test(args)) return 'eval builds the command at run time, so the message cannot be read.'
  return undefined
}
