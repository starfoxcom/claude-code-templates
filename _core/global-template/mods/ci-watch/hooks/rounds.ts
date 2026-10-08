// The fix-round limit: once a PR has had ROUND_LIMIT pushed rounds in a row whose checks did not all pass
// (both reviews included), a further push to it is refused until the user resets the count. A round is a
// watch of a pushed head that settled: what ci-watch itself saw, never rebuilt from the branch's history (a
// merge, amend or rebase reshapes that), so pushes from another machine are not counted. Pure, no engine
// access.

export const ROUND_LIMIT = 6

/** One settled watch of a PR's pushed head: whether a check failed. */
export type Round = { sha: string; red: boolean }
/** A PR's rounds, oldest first; the user's reset empties the list. */
export type PrRounds = { rounds: Round[] }

const KEPT = 50

/** The PR's rounds with one more settled watch. A watch of a head already on the list (a re-run) replaces
 * that round. */
export function recordRound(pr: PrRounds | undefined, sha: string, red: boolean): PrRounds {
  const rounds = (Array.isArray(pr?.rounds) ? pr.rounds : []).filter(r => r.sha !== sha)
  return { rounds: [...rounds, { sha, red }].slice(-KEPT) }
}

/** The rounds in a row, newest first, that had a failed check, back to the last one that passed. */
export function redStreak(pr: PrRounds | undefined): number {
  const rounds = Array.isArray(pr?.rounds) ? pr.rounds : []
  let red = 0
  for (let i = rounds.length - 1; i >= 0 && rounds[i]?.red; i--) red++
  return red
}

/** The count's file, `{ "<owner/name>#<number>": PrRounds }`: written by the mod as watches settle and by
 * the user's own `/ci-watch rounds reset`, and spared by the sweep (it is named by no session). */
export const ROUNDS_FILE = 'rounds.json'

/** A path naming the count's file. An Edit, Write or NotebookEdit of it is refused, so only the
 * user resets it: a speed bump against a casual edit (the mod's own source is no harder to change). */
export const TOUCHES_ROUNDS = /ci-watch[\\/]+rounds\.json/i

export const ROUNDS_OWN =
  "BLOCKED (ci-watch): this names the fix-round count's file, and only `/ci-watch rounds reset` writes it " +
  '(the user types it). A plain read (cat, Get-Content) of the file passes; in a message, name it another way.'

/** The tools that write a file by its path. */
export const FILE_WRITERS = ['Edit', 'Write', 'NotebookEdit'] as const

/** A file tool's call that writes the count's file. */
export function writesRounds(call: { tool?: unknown; file_path?: unknown; notebook_path?: unknown }): boolean {
  const isWriter = (FILE_WRITERS as readonly unknown[]).includes(call.tool)
  return isWriter && TOUCHES_ROUNDS.test(String(call.file_path ?? call.notebook_path ?? ''))
}

// A command that only reads a file: one program from this list, its words typed out, no redirect or chain.
const READERS = new Set(['cat', 'head', 'tail', 'type', 'get-content', 'gc', 'test-path', 'ls', 'dir', 'get-item'])
const PLAIN_READ = /^[ \t]*([A-Za-z-]+)(?:[ \t]+(?:'[^']*'|"[^"$`]*"|[^\s'"$`;&|<>()]+))*[ \t]*$/

/** A shell command that names the count's file: refused unless it only reads it, so only the user's typed
 * reset writes it. A message naming the file is refused as well; name it another way there. */
export function namesRounds(command: string): boolean {
  if (!TOUCHES_ROUNDS.test(command)) return false
  const read = PLAIN_READ.exec(command)
  return !(read && READERS.has((read[1] ?? '').toLowerCase()))
}

export function refusalText(pr: string, red: number): string {
  return (
    `${pr} has had ${red} fix rounds in a row without every check green, both reviews included ` +
    `(the limit is ${ROUND_LIMIT}). Stop patching finding by finding: this looks like an endless round hunt, ` +
    'where each fix exposes the next finding and it never converges. Step back and look for another direction: ' +
    'a design that removes the whole class of findings (an allow-list, refusing whatever cannot be read for ' +
    'sure, a smaller scope), or ask the user. Explain the new direction to the user; once they agree, they ' +
    `reset the count by typing \`/ci-watch rounds reset ${pr.split('#')[1]}\` (only they can).`
  )
}
