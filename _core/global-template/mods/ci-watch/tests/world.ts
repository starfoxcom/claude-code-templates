import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

import { STATUS_SCRIPT } from '../hooks/incident'
import { MKDIR_SCRIPT, SWEEP_SCRIPT } from '../hooks/register'

// The engine beneath ci-watch in its tests: gh, the state files, the clock and the session's prompts.
export type Seen = {
  prompts: string[]
  files: Map<string, string>
  bucket: string
  /** Extra check rows beside `build`. */
  rows: { name: string; bucket: string }[]
  /** Reads see the written files (default: no file can be read). */
  isReadable: boolean
  /** Runs inside each `gh pr checks` call: another instance acting while this one waits on gh. */
  duringChecks?: () => unknown
  /** Runs inside a read of the state file, after the text was read. */
  duringStateRead?: () => unknown
  /** `gh pr checks` fails (network, auth) with nothing on stdout. */
  isChecksDown?: boolean
  /** Folder makes and file writes, in order. */
  order: string[]
  /** Every write fails (a folder that cannot be made). */
  isWriteDown?: boolean
  /** What `gh pr view --json state` reports. */
  prState: string
  /** The head commit `gh pr view` reports (default `a1`). */
  head?: string
  /** The mod's manifest, read as any plugin.json (default: none). */
  manifest?: string
  /** `gh pr checks` calls so far: one per watch per poll. */
  checksRead: number
  /** What githubstatus.com answers (default: nothing), and how often it was read. */
  status?: string
  statusReads: number
  /** How many prompts a hook drops before one enters. */
  refusals?: number
  /** Each slash command registered, with its argument hint. */
  commands: { name: string; argumentHint?: string }[]
}

export function world(on: On) {
  const seen: Seen = {
    prompts: [],
    files: new Map(),
    bucket: 'pending',
    rows: [],
    isReadable: false,
    order: [],
    prState: 'OPEN',
    commands: [],
    checksRead: 0,
    statusReads: 0,
  }
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  on('session.id', () => ({ value: 's1' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ci-watch__${e.name}` } }))
  on('command.register', ($, e) => {
    seen.commands.push({ name: e.name, argumentHint: e.argumentHint })
    return { value: { command: e.name } as never }
  })
  on('fs.write', ($, e) => {
    if (seen.isWriteDown) throw new Error('ENOENT')
    seen.files.set(e.path.replaceAll('\\', '/'), e.text)
    seen.order.push(`write ${e.path.replaceAll('\\', '/')}`)
    return { value: undefined }
  })
  on('fs.read', async ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    if (path.endsWith('/plugin.json') && seen.manifest !== undefined) return { value: seen.manifest }
    const text = seen.isReadable ? seen.files.get(path) : undefined
    if (text === undefined) throw new Error('ENOENT')
    // The read already holds the old text when the change lands.
    if (path.endsWith('.json')) await seen.duringStateRead?.()
    return { value: text }
  })
  on('process.run', async ($, e) => {
    const args = e.argv.join(' ')
    if (e.argv[2] === MKDIR_SCRIPT) seen.order.push(`mkdir ${e.argv[3]}`)
    if (e.argv[2] === SWEEP_SCRIPT) seen.order.push(`sweep ${e.argv.slice(3).join(' ')}`)
    if (e.argv[2] === STATUS_SCRIPT) {
      seen.statusReads++
      const stdout = seen.status ?? ''
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (args.includes('pr checks')) seen.checksRead++
    if (args.includes('pr checks')) await seen.duringChecks?.()
    if (args.includes('pr checks') && seen.isChecksDown) {
      return {
        value: {
          exitCode: 1,
          stdout: '',
          stderr: 'error connecting to api.github.com',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    const stdout = args.includes('pr checks')
      ? JSON.stringify([{ name: 'build', bucket: seen.bucket }, ...seen.rows])
      : JSON.stringify({
          number: 7,
          url: 'https://github.com/o/r/pull/7',
          headRefOid: seen.head ?? 'a1',
          state: seen.prState,
        })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', ($, e) => {
    if (seen.refusals) {
      seen.refusals--
      return { drop: 'refused' }
    }
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  // The engine's own band beneath the plugins: empty.
  on('ui.render', () => ({ type: 'Box', children: [] }) as never)
  return { seen, clock }
}
