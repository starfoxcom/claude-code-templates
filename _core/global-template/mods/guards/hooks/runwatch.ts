// The global `gh run watch` hook (`reference/block-gh-run-watch.py`), copied: `watch` must be the subcommand word
// itself, `gh run watch`, with only repo flags allowed around `run`. No repo scoping. Pure.

const REPO = String.raw`(?:\s+(?:-R|--repo)(?:\s+|=)\S+)*`
const RUN_WATCH = new RegExp(String.raw`(?:^|[\s;&|(])gh${REPO}\s+run${REPO}\s+watch(?=\s|$|[;&|)])`)

/** The hook's reason to deny, or undefined to pass. */
export const runWatchReason = (cmd: string) =>
  RUN_WATCH.test(cmd)
    ? '`gh run watch` streams logs into the tool call. Watch the checks with the ci-watch mod (it starts on ' +
      'its own after a push), or poll `gh pr checks` in the background.'
    : undefined
