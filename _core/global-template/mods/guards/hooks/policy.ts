// What counts as attribution. Pure, no engine access.
//
// Two rules:
// - Credit: a line that credits an AI (Co-Authored-By naming one, "Generated with ...", a session link,
//   an Anthropic noreply address, the robot emoji). Blocked in every repo, in every message, title,
//   body, comment and body file, and in lines a commit adds to project files.
// - Name: the plain word "Claude" or "Anthropic". Blocked in messages by default; repos whose subject is
//   Claude Code itself (the `mentionRepos` setting) may name it. Repo identifiers that carry the word
//   (CLAUDE.md, .claude/, claude.yml, the review action and check names) are never a mention.

// Obfuscation-tolerant: optional zero-width or separator characters between letters.
const Z = '[\\u200b\\u200c\\u200d\\u2060\\ufeff\\s\\-_.*]*'
const fuzzy = (word: string) => [...word].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(Z)

const CLAUDE = fuzzy('claude')
const ANTHROPIC = fuzzy('anthropic')
// Tool names that make a phrase a credit. `cursor` alone is an ordinary UI word.
const AI = `(?:${CLAUDE}|${ANTHROPIC}|ai|llm|assistant|copilot|codex|chat${Z}gpt|gpt|gemini|cursor${Z}(?:ai|ide|agent))`
const AN = `(?:an?${Z})?`

const CREDIT = new RegExp(
  [
    // Co-Authored-By naming an AI; a human co-author passes.
    `co${Z}-?${Z}authored${Z}-?${Z}by\\s*:?[^\\n]*?\\b${AI}\\b`,
    `noreply@${ANTHROPIC}`,
    `\\b(?:generated|written|created|made|authored|produced|assisted|co-?written)` +
      `${Z}(?:with|by|using|via)${Z}\\[?${AN}${AI}\\b`,
    // A line or quoted message that ends "via Claude Code" / "by Claude"; "compatible with Claude Code" is a mention.
    `\\b(?:by|via)${Z}${CLAUDE}(?:${Z}code)?(?=[\\s.!)\\]]*(?:$|['"\`]))`,
    `claude\\.(?:ai|com)/(?:code|claude-code)\\b`,
    `\\b${CLAUDE}[-_]session\\s*:`,
    'session_[0-9a-z]{20,}',
    '\\u{1F916}',
    `\\bai${Z}-?${Z}(?:assisted|generated|written|authored)`,
  ].join('|'),
  'imu',
)

// The plain name is a whole word: no letter right before or after it ("philanthropic" passes), and only
// zero-width characters or the separators -_.* between its letters, never spaces or line breaks
// ("the critic lauded" passes). The credit rules keep the wider set, anchored by their own words.
const NZ = '[\\u200b\\u200c\\u200d\\u2060\\ufeff\\-_.*]*'
const wordOf = (word: string) => `(?<!\\p{L})${[...word].join(NZ)}(?!\\p{L})`
const NAME = new RegExp(`${wordOf('claude')}|${wordOf('anthropic')}`, 'iu')

// Repo identifiers and review-trigger words that carry the name without crediting anyone.
const IDENTIFIERS = new RegExp(
  [
    String.raw`\bCLAUDE\.md\b`,
    String.raw`\.claude(?:[\\/][\w.-]*)*`,
    String.raw`\`?claude(?:-code-review)?\*?\.yml\`?`,
    '`?Claude On-Demand`?',
    '`?claude-code-action`?',
    '`?Claude Code Review`?',
    String.raw`@claude\b`,
    String.raw`anthropics\/claude-code-action`,
  ].join('|'),
  'gi',
)
const PATHS = /(?<!:\/)(?<![\w])(?:[A-Za-z]:|~)?(?:[\\/][\w.-]+)+/g
const URLS = /\bhttps?:\/\/\S+/g

export type Verdict = { rule: 'credit' | 'name'; match: string } | undefined

/** Masks file paths, so a scratch folder named after a session cannot read as a credit line. */
export function stripPaths(text: string): string {
  return text.replace(PATHS, ' ')
}

/** Checks message text. `mayName`: this repo's subject is Claude Code, so the plain name passes. */
export function checkText(text: string, mayName: boolean): Verdict {
  const credit = CREDIT.exec(text)
  if (credit) return { rule: 'credit', match: credit[0] }
  if (mayName) return undefined
  // A URL is checked for credit above (session links); a repo URL naming the word is not a mention.
  const plain = text.replace(URLS, ' ').replace(PATHS, ' ').replace(IDENTIFIERS, ' ')
  const name = NAME.exec(plain)
  return name ? { rule: 'name', match: name[0] } : undefined
}

/** Checks a branch name being created: it lands in merge commit titles. */
export function checkBranch(name: string, mayName: boolean): Verdict {
  if (mayName) return undefined
  const plain = name.replace(IDENTIFIERS, ' ')
  const hit = NAME.exec(plain)
  return hit ? { rule: 'name', match: hit[0] } : undefined
}

// A credit line added to a project file: the line itself (after indentation and a comment marker)
// starts with the credit, so docs that quote a banned trailer in a list or in backticks pass.
const LINE_CREDIT = new RegExp(
  `^\\s*(?:#+|//+|/\\*+|\\*+|<!--|--|;+|%+|REM\\b)?\\s*(?:` +
    `co${Z}-?${Z}authored${Z}-?${Z}by\\s*:[^\\n]*\\b${AI}\\b|\\u{1F916}|` +
    `(?:generated|written|created)${Z}(?:with|by)${Z}\\[?${AN}${AI}\\b)|claude\\.ai/code/session_`,
  'imu',
)

/** Lines a commit adds (a `git diff -U0` text): the first credit line found, with its file. */
export function checkAddedLines(diff: string): { file: string; line: string } | undefined {
  let file = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '')
      continue
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    const added = line.slice(1)
    if (LINE_CREDIT.test(added)) return { file, line: added.trim().slice(0, 120) }
  }
  return undefined
}

export function describe(v: NonNullable<Verdict>, where: string): string {
  return v.rule === 'credit'
    ? `AI credit "${v.match.trim()}" in ${where}. Commits, PRs, issues, comments and releases carry no AI credit: ` +
        `no Co-Authored-By naming an AI, no "Generated with", no session link, no robot emoji.`
    : `"${v.match.trim()}" named in ${where}. This repo keeps the product name out of its history; reword, or add ` +
        `the repo to the guards mod's mentionRepos setting if Claude Code is its subject.`
}
