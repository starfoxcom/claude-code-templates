// The fix-round count: how many pushed rounds in a row a PR has had whose checks did not all pass (both
// reviews included). Every RESEARCH_EVERY of them (6, 12, 18, ...), the red wake asks for a step back:
// research how others solve the problem, simplify, then go on. Nothing is refused. A round is a watch of
// a pushed head that settled (the session's own push, or a PR it asked to watch; never a head someone
// else pushed, which ci-watch follows silently): what ci-watch itself saw, never rebuilt from the
// branch's history (a merge, amend or rebase reshapes that), so pushes from another machine are not
// counted. Pure, no engine access.

export const RESEARCH_EVERY = 6

/** One settled watch of a PR's pushed head: whether a check failed. */
export type Round = { sha: string; red: boolean }
/** A PR's rounds, oldest first. */
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

/** The count's file, `{ "<owner/name>#<number>": PrRounds }`, written by the mod as watches settle and
 * spared by the sweep (it is named by no session). */
export const ROUNDS_FILE = 'rounds.json'

/** Whether a red streak this long calls for the research step: at 6, 12, 18, ... */
export const isResearchDue = (red: number) => red > 0 && red % RESEARCH_EVERY === 0

export function researchText(pr: string, red: number): string {
  return (
    ` ${pr} has had ${red} fix rounds in a row without every check green, both reviews included. Before ` +
    'the next fix, step back: research how the community solves this problem and what options exist (web ' +
    'search), pick the simplest design that removes the whole class of findings rather than the next one, ' +
    'tell the user in plain words what changes and why, then apply it and keep going. The next step back ' +
    `comes after ${RESEARCH_EVERY} more red rounds.`
  )
}
