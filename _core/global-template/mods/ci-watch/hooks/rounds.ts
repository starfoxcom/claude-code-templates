// The fix-round limit: once a PR has had ROUND_LIMIT pushed rounds in a row whose checks did not all pass
// (both reviews included), a further push to it is refused until the user resets the count. Counted from
// GitHub's own record of each commit's checks, so it holds across sessions and projects. Pure, no engine
// access.

export const ROUND_LIMIT = 6

/** A PR's latest commits, each with the overall state of its checks. */
export const ROUNDS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number)' +
  '{commits(last:100){nodes{commit{oid statusCheckRollup{state}}}}}}}'

export type RoundNode = { commit?: { oid?: string; statusCheckRollup?: { state?: string } | null } }

/** The commits of a `ROUNDS_QUERY` answer, oldest first; none when it cannot be read. */
export function roundNodes(answer: string): RoundNode[] {
  try {
    const nodes = JSON.parse(answer)?.data?.repository?.pullRequest?.commits?.nodes
    return Array.isArray(nodes) ? (nodes as RoundNode[]) : []
  } catch {
    return []
  }
}

/** The pushed rounds in a row, newest first, whose checks did not all pass, back to `resetAt` (the commit
 * the user reset the count on, itself not counted) or the last round that passed. A commit with no checks
 * (pushed together with later ones) or with checks still running (the round in flight) is skipped. */
export function redRounds(nodes: readonly RoundNode[], resetAt?: string): number {
  let red = 0
  for (const node of [...nodes].reverse()) {
    if (resetAt !== undefined && node.commit?.oid === resetAt) break
    const state = node.commit?.statusCheckRollup?.state
    if (state === 'SUCCESS') break
    if (state === 'FAILURE' || state === 'ERROR') red++
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
