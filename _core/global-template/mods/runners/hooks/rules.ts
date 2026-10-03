// The machine's local CI runners, the one list this mod reads. It ships empty, so the band stays
// hidden until you add your own. Each entry:
//   label     what the band calls it
//   process   the process name that is running while the runner is up (tasklist on Windows, pgrep -f
//             elsewhere)
//   repo      'owner/name' whose queued runs are counted (needs `gh`); optional
//   workflows the folder of that repo's `.github/workflows` on this machine, read for `schedule:` crons
//             to show the next scheduled run; optional
//   start     the command (argv) the Start button runs; optional, no button without it
//   stop      the commands (argv each, run in order) the Stop button runs; optional
//
// Example, one GitHub Actions self-hosted runner on Windows:
//   {
//     label: 'runner',
//     process: 'Runner.Listener',
//     repo: 'me/my-game',
//     workflows: 'C:/Repos/my-game/.github/workflows',
//     start: ['wscript', 'C:/actions-runner/start-hidden.vbs'],
//     stop: [['C:/actions-runner/svc.cmd', 'stop']],
//   },

export type Runner = {
  label: string
  process: string
  repo?: string
  workflows?: string
  start?: string[]
  stop?: string[][]
}

export const RUNNERS: Runner[] = []
