// The fix-round limit: once a PR has had ROUND_LIMIT pushed rounds in a row whose checks did not all pass
// (both reviews included), a further push to it is refused until the user resets the count. Counted from
// GitHub's own record of each commit's checks, so it holds across sessions and projects. Pure, no engine
// access.

export const ROUND_LIMIT = 6

/** A PR's latest commits, each with the overall state of its checks and each check's own result. */
export const ROUNDS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number)' +
  '{commits(last:100){nodes{commit{oid statusCheckRollup{state contexts(last:100){nodes{' +
  '... on CheckRun{conclusion} ... on StatusContext{state}}}}}}}}}}'

type Context = { conclusion?: string | null; state?: string | null }
export type RoundNode = {
  commit?: { oid?: string; statusCheckRollup?: { state?: string; contexts?: { nodes?: Context[] } } | null }
}

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

/** The pushed rounds in a row, newest first, where a check really failed, back to `resetAt` (the commit the
 * user reset the count on, itself not counted) or the last round that passed. A commit with no checks
 * (pushed together with later ones), with checks still running (the round in flight) or with no check that
 * failed (its runs cancelled by a newer push) is no round. */
export function redRounds(nodes: readonly RoundNode[], resetAt?: string): number {
  let red = 0
  for (const node of [...nodes].reverse()) {
    if (resetAt !== undefined && node.commit?.oid === resetAt) break
    const rollup = node.commit?.statusCheckRollup
    if (rollup?.state === 'SUCCESS') break
    if (hasFailed(rollup?.contexts?.nodes ?? [])) red++
  }
  return red
}

/** The count's file, `{ "<owner/name>#<number>": "<head commit at the reset>" }`: written only by the user's
 * own `/ci-watch rounds reset`, and spared by the sweep (it is named by no session). */
export const ROUNDS_FILE = 'rounds.json'

/** A tool call that would write the count's file: refused, so only the user resets it. */
export const TOUCHES_ROUNDS = /ci-watch[\\/]+rounds\.json/i

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
