// The global PR-body hook (`reference/pr-body-contract.py`), copied rule for rule: a `gh pr create` or `gh pr edit`
// on a listed repo must send its body from a file, and the body must carry `## What` with a bullet, `## Why`
// with text, no empty `## Notes`, and the repo's board-row line unless the title is exempt. The repos come
// from mods-data/guards/pr-body.json instead of the script's own table:
//
//   { "repos": { "<key>": { "row": "<line pattern>", "noRow": "<exempt title pattern>", "segment": true } },
//     "skip": ["<repo name part>"] }
//
// A key matches the `--repo` value or the session folder as a substring, or with `segment` as a whole path
// segment; a `--repo` naming a `skip` entry is out of scope. Pure but for the file read it is handed.

import { isAbs, join, opened } from './hostpath'
import type { Host } from './hostpath'
import type { ReadFile } from './attribution'

export type RepoRule = { row: string; noRow: string; segment?: boolean }
export type PrRules = { repos: Record<string, RepoRule>; skip?: string[] }

type Compiled = { rowLine: RegExp; exempt: RegExp }

// The rule of the repo the command works on, in the file's order, or undefined when it is out of scope. A
// rule whose patterns do not compile leaves its repo unjudged.
function inScope(cmd: string, cwd: string, rules: PrRules): Compiled | undefined {
  const m = /(?:--repo|-R)\s+([\w.-]+\/[\w.-]+)/.exec(cmd)
  const target = m ? (m[1] as string).toLowerCase() : cwd.toLowerCase()
  if (m && (rules.skip ?? []).some(s => target.includes(s.toLowerCase()))) return undefined
  for (const [name, rule] of Object.entries(rules.repos)) {
    const key = name.toLowerCase()
    const isSegment = new RegExp(String.raw`(^|[\\/])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\/]|$)`)
    if (!(rule.segment ? isSegment.test(target) : target.includes(key))) continue
    try {
      return { rowLine: new RegExp(rule.row, 'm'), exempt: new RegExp(rule.noRow) }
    } catch {
      return undefined
    }
  }
  return undefined
}

const valueAfter = (flags: string, cmd: string) => {
  const m = new RegExp(String.raw`(?:${flags})\s+(?:"([^"]+)"|'([^']+)'|(\S+))`).exec(cmd)
  return m ? m[1] || m[2] || m[3] : undefined
}

// A section's text: from its heading to the next heading, a board-row line (for Why and Notes) or the end.
function section(text: string, heading: string, isRowEnd: boolean): string | undefined {
  const end = isRowEnd ? '^## |^(?:Resolves|Part of) |$(?![\\s\\S])' : '^## |$(?![\\s\\S])'
  return new RegExp(`^## ${heading}\\s*\\n((?:.*\\n?)*?)(?=${end})`, 'm').exec(text)?.[1]
}

function bodyReason(text: string, title: string, rule: Compiled): string | undefined {
  const what = section(text, 'What', false)
  if (what === undefined || !/^\s*[-*] \S/m.test(what))
    return '`## What` is missing or has no bullet. The body must carry the full PR format.'
  const why = section(text, 'Why', true)
  if (why === undefined || !why.trim()) return '`## Why` is missing or empty.'
  const notes = section(text, 'Notes', true)
  if (notes !== undefined && !notes.trim()) return '`## Notes` is present but empty - drop the heading or fill it.'
  if (!rule.rowLine.test(text) && !rule.exempt.test(title))
    return (
      "no board-row line (the repo's `Resolves ...#N` / `Part of ...#N`). Every work PR names its board row; " +
      'only the PRs whose titles the repo exempts name none.'
    )
  return undefined
}

/** What the hook decides for one command: its reason to deny, or undefined to pass. */
export async function prReason(
  cmd: string,
  at: { cwd: string; host: Host; read: ReadFile; rules: PrRules | undefined },
): Promise<string | undefined> {
  const { cwd, host, read, rules } = at
  if (!cmd || !rules || !/\bgh\s+pr\s+(create|edit)\b/.test(cmd)) return undefined
  const rule = inScope(cmd, cwd, rules)
  if (!rule) return undefined
  if (/(?<=\s)(--body|-b)(?=\s|=)/.test(cmd))
    return (
      'inline `--body` is not allowed for a PR - write the body to a file and pass ' +
      '`--body-file <literal absolute path>` (inline bodies were silently truncated in the past).'
    )
  if (/--fill\b|--fill-first\b|--fill-verbose\b|--web\b/.test(cmd))
    return '`--fill*` / `--web` skip the PR format - write the body to a file and pass `--body-file`.'
  let path = valueAfter('--body-file|-F', cmd)
  if (path === undefined) {
    // An edit that touches no body (labels, title) is fine.
    if (/\bgh\s+pr\s+edit\b/.test(cmd) && !/(?<=\s)-F(?=\s|=)/.test(cmd)) return undefined
    return '`gh pr create` needs `--body-file <literal absolute path>` carrying the PR format.'
  }
  if (!isAbs(path, host)) path = join(cwd, path, host)
  let text: string
  try {
    // Python reads the file in text mode: a byte-order mark dropped, every line break made `\n`.
    text = (await read(opened(path, cwd, host))).replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  } catch (e) {
    return `could not read body file ${path}: ${String(e)}.`
  }
  return bodyReason(text, valueAfter('--title|-t', cmd) ?? '', rule)
}
