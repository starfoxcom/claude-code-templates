// The fix-round limit: once a PR has had ROUND_LIMIT pushed rounds in a row whose checks did not all pass
// (both reviews included), a further push to it is refused until the user resets the count. Counted from
// GitHub's own record of each commit's checks, so it holds across sessions and projects. Pure, no engine
// access.

export const ROUND_LIMIT = 6

/** A PR's latest commits, each with the overall state of its checks and each check's own result and start. */
export const ROUNDS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number)' +
  '{commits(last:100){nodes{commit{oid statusCheckRollup{state contexts(last:100){nodes{' +
  '... on CheckRun{conclusion startedAt} ... on StatusContext{state createdAt}}}}}}}}}}'

type Context = {
  conclusion?: string | null
  state?: string | null
  startedAt?: string | null
  createdAt?: string | null
}
export type RoundNode = {
  commit?: { oid?: string; statusCheckRollup?: { state?: string; contexts?: { nodes?: Context[] } } | null }
}

/** The user's reset: the PR's head commit then, and when (ms since the epoch). */
export type Reset = { sha?: string; at?: number }

// When GitHub first ran a commit's checks (ms since the epoch), set by GitHub, not by the commit's author.
const firstRun = (contexts: readonly Context[]) =>
  Math.min(...contexts.map(c => Date.parse(c.startedAt ?? c.createdAt ?? '')).filter(t => !Number.isNaN(t)))

// A check that really failed. A run cancelled by a newer push (`concurrency: cancel-in-progress`), skipped or
// neutral is no failure, though GitHub's overall state turns red for it.
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'ERROR'])
const hasFailed = (contexts: readonly Context[]) =>
  contexts.some(c => FAILED.has(c.conclusion ?? '') || FAILED.has(c.state ?? ''))

/** The commits of a `ROUNDS_QUERY` answer, oldest first; none when it cannot be read. */
export function roundNodes(answer: string): RoundNode[] {
  try {
    const nodes = JSON.parse(answer)?.data?.repository?.pullRequest?.commits?.nodes
    return Array.isArray(nodes) ? (nodes as RoundNode[]) : []
  } catch {
    return []
  }
}

/** The pushed rounds in a row, newest first, where a check really failed, back to the user's reset or the last
 * round that passed. The reset ends the walk at its commit (itself not counted) or at the first commit whose
 * checks ran before it: a rewritten history (`reset --hard`, `--amend`) drops the reset's commit from the PR,
 * and the older rounds still on it are from before the reset. A commit with no check that failed is no
 * round: one with no checks (pushed together with later ones), one whose runs a newer push cancelled, or the
 * round in flight until one of its checks fails. */
export function redRounds(nodes: readonly RoundNode[], reset: Reset = {}): number {
  let red = 0
  for (const node of [...nodes].reverse()) {
    if (reset.sha !== undefined && node.commit?.oid === reset.sha) break
    const rollup = node.commit?.statusCheckRollup
    const contexts = rollup?.contexts?.nodes ?? []
    if (reset.at !== undefined && firstRun(contexts) < reset.at) break
    if (rollup?.state === 'SUCCESS') break
    if (hasFailed(contexts)) red++
  }
  return red
}

/** The count's file, `{ "<owner/name>#<number>": Reset }`: written only by the user's own
 * `/ci-watch rounds reset`, and spared by the sweep (it is named by no session). */
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
