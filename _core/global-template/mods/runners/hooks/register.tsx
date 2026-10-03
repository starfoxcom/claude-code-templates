import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { RunnerView } from '../types'
import { soonestRun } from './cron'
import { RUNNERS } from './rules'
import type { Runner } from './rules'

// The machine's local CI runners in one row above the prompt: on or off, how many are online and
// busy, queued runs and the next scheduled run, with Start and Stop. Every value is read in a timer,
// never while drawing; the row only shows the last reading.

const HOUR_MS = 60 * 60_000
// GitHub reports a freshly started runner offline for about a minute: no warning before this.
const START_GRACE_MS = 2 * 60_000
// The hooks run in a sandbox with no time zone of its own (its clock reads UTC), so the host's UTC
// offset is read through node at start and every hour, as shared-pc and usage-guard do.
const READ_ZONE = ['node', '-e', 'console.log(new Date().getTimezoneOffset())']
const view = atom({ plugin: 'runners', key: 'view' } as const, null)
const live = {
  checkMs: 60_000,
  isStarted: false,
  isWindows: false,
  /** Minutes behind UTC, as getTimezoneOffset gives it; null until read. */
  zoneOffset: null as number | null,
  schedules: new Map<string, { at: number; texts: string[] }>(),
  /** rules.ts, then the machine's own list file: read once at start. */
  runners: [...RUNNERS] as Runner[],
  isChecking: false,
  isRecheck: false,
}

// A per-machine list beside the shipped rules.ts, so a template update never overwrites it: a JSON
// array of the same entries in mods-data/runners/runners.json. A missing or unreadable file adds none.
async function listPath($: Engine): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${configured ?? `${home}/.claude`}/mods-data/runners/runners.json`.replace(/\\/g, '/')
}

async function readList($: Engine): Promise<Runner[]> {
  try {
    const listed: unknown = JSON.parse(String(await $.fs.read(await listPath($))))
    return Array.isArray(listed) ? listed.filter(isRunner) : []
  } catch {
    return []
  }
}

function isRunner(entry: unknown): entry is Runner {
  const r = entry as Runner
  return typeof r?.label === 'string' && Array.isArray(r.processes) && r.processes.every(n => typeof n === 'string')
}

async function run($: Engine, argv: string[]): Promise<string | null> {
  const r = await $.process.run(argv, { timeoutMs: 30_000 }).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout : null
}

// Whether `tasklist /NH /FO CSV` lists the process, by its whole image name with or without `.exe`:
// `vmmem` is not `vmmemWSL`.
export function isListed(tasklist: string, name: string): boolean {
  const wanted = name.toLowerCase()
  return tasklist.split(/\r?\n/).some(line => {
    const image = (line.split('","')[0] ?? '').replace(/^"/, '').toLowerCase()
    return image === wanted || image === `${wanted}.exe`
  })
}

// `pgrep -f` reads every command line, so a second check running at the same moment would match the
// first one's own pattern. A bracketed first letter still matches the runner but not the pattern.
export function pgrepPattern(name: string): string {
  return `[${name[0]}]${name.slice(1)}`
}

async function isUp($: Engine, runner: Runner): Promise<boolean> {
  if (live.isWindows) {
    const list = (await run($, ['tasklist', '/NH', '/FO', 'CSV'])) ?? ''
    return runner.processes.every(name => isListed(list, name))
  }
  for (const name of runner.processes) {
    if ((await run($, ['pgrep', '-f', pgrepPattern(name)])) === null) return false
  }
  return true
}

async function online($: Engine, repo: string): Promise<{ online: number; busy: number } | null> {
  const jq = '[.runners[] | select(.status == "online")] | "\\(length) \\([.[] | select(.busy)] | length)"'
  const out = await run($, ['gh', 'api', `repos/${repo}/actions/runners`, '--jq', jq])
  if (out === null) return null
  const [count, busy] = out.trim().split(' ').map(Number)
  return { online: count, busy }
}

// The count from the API's total, not a listing, which stops at 20.
async function queued($: Engine, repo: string): Promise<number | null> {
  const runs = `repos/${repo}/actions/runs?status=queued&per_page=1`
  const out = await run($, ['gh', 'api', runs, '--jq', '.total_count'])
  const count = out === null ? NaN : Number(out.trim())
  return Number.isInteger(count) ? count : null
}

// The default branch's workflow files, read once an hour: cron runs that branch's copies. A failed
// read is not kept, so a network or rate-limit hiccup is retried on the next check instead of hiding
// the schedule for an hour.
async function workflowTexts($: Engine, repo: string, now: number): Promise<string[]> {
  const cached = live.schedules.get(repo)
  if (cached && now - cached.at < HOUR_MS) return cached.texts
  const branchArgv = ['gh', 'repo', 'view', repo, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']
  const branch = (await run($, branchArgv))?.trim()
  if (!branch) return cached?.texts ?? []
  const folder = `repos/${repo}/contents/.github/workflows`
  const names = await run($, ['gh', 'api', `${folder}?ref=${branch}`, '--jq', '.[].name'])
  if (names === null) return cached?.texts ?? []
  const texts: string[] = []
  for (const name of names.split('\n').filter(n => /\.ya?ml$/.test(n))) {
    const raw = ['gh', 'api', '-H', 'Accept: application/vnd.github.raw']
    const text = await run($, [...raw, `${folder}/${name}?ref=${branch}`])
    if (text === null) return cached?.texts ?? []
    texts.push(text)
  }
  live.schedules.set(repo, { at: now, texts })
  return texts
}

async function readRunner($: Engine, runner: Runner, now: number): Promise<RunnerView> {
  const row: RunnerView = { label: runner.label, isOn: await isUp($, runner) }
  if (!runner.repo) return row
  const counts = await online($, runner.repo)
  if (counts) Object.assign(row, counts)
  row.queued = (await queued($, runner.repo)) ?? undefined
  row.nextRun = soonestRun(await workflowTexts($, runner.repo, now), now) ?? undefined
  return row
}

// A reading takes seconds of `gh` calls. What the buttons set meanwhile (Start's grace, Stop's
// question) comes from the row as it is now, not as it was when the reading began. Stop's question
// ends with the job it asked about (busy 0), so the next job is asked about again; a failed busy read
// (undefined) keeps it.
export function mergeReading(reading: RunnerView[], shown: RunnerView[] | undefined): RunnerView[] {
  return reading.map((row, i) => ({
    ...row,
    startedAt: shown?.[i]?.startedAt,
    isConfirming: Boolean(shown?.[i]?.isConfirming) && row.isOn && row.busy !== 0,
  }))
}

async function readAll($: Engine): Promise<void> {
  const now = await $.clock.now()
  const reading: RunnerView[] = []
  for (const runner of live.runners) reading.push(await readRunner($, runner, now))
  await update($, view, shown => ({ rows: mergeReading(reading, shown?.rows) }))
}

// One reading at a time: a check asked for while one runs (a slow `gh`, a button press) runs once
// after it, so readings never pile up and a press still sees a reading taken after it.
async function check($: Engine): Promise<void> {
  if (live.isChecking) {
    live.isRecheck = true
    return
  }
  live.isChecking = true
  try {
    do {
      live.isRecheck = false
      await readAll($)
    } while (live.isRecheck)
  } finally {
    live.isChecking = false
  }
}

async function readZone($: Engine): Promise<void> {
  const offset = Number((await run($, READ_ZONE))?.trim() ?? NaN)
  if (Number.isInteger(offset)) live.zoneOffset = offset
}

async function start($: Engine): Promise<void> {
  if (live.isStarted) return
  live.isStarted = true
  live.runners = [...RUNNERS, ...(await readList($))]
  if (live.runners.length === 0) return
  live.isWindows = (await $.env.get('OS')) === 'Windows_NT'
  await readZone($)
  $.clock.every(live.checkMs, () => void check($).catch(() => undefined))
  $.clock.every(HOUR_MS, () => void readZone($).catch(() => undefined))
  // The first reading can take many `gh` calls: session start and the first turn never wait for it.
  void check($).catch(() => undefined)
}

async function setRow($: Engine, index: number, change: Partial<RunnerView>): Promise<void> {
  await update($, view, shown => {
    const rows = [...(shown?.rows ?? [])]
    if (rows[index]) rows[index] = { ...rows[index], ...change }
    return { rows }
  })
}

async function pressStart($: Engine, index: number): Promise<void> {
  const argv = live.runners[index]?.start
  if (!argv) return
  await run($, argv)
  await setRow($, index, { startedAt: await $.clock.now() })
  await check($).catch(() => undefined)
}

// A busy runner is in the middle of a job (a nightly suite can run for hours): Stop asks once more.
// The busy count is read again at the press: the last check can be minutes old, and a job that started
// since must still get the question.
async function pressStop($: Engine, index: number): Promise<void> {
  const row = (await read($, view))?.rows[index]
  const repo = live.runners[index]?.repo
  const busy = row && !row.isConfirming && repo ? ((await online($, repo))?.busy ?? row.busy) : row?.busy
  if (row && (busy ?? 0) > 0 && !row.isConfirming) return setRow($, index, { busy, isConfirming: true })
  for (const argv of live.runners[index]?.stop ?? []) await run($, argv)
  await setRow($, index, { isConfirming: false, startedAt: undefined })
  await check($).catch(() => undefined)
}

export function rowText(row: RunnerView, now: number, zoneTime: (ms: number) => string): string {
  const parts = [`${row.label} ${row.isOn ? 'on' : 'off'}`]
  const isStarting = row.startedAt !== undefined && now - row.startedAt < START_GRACE_MS
  if (row.online !== undefined) parts.push(isStarting && row.online === 0 ? 'starting' : `${row.online} online`)
  if (row.busy) parts.push(`${row.busy} busy`)
  if (row.queued) parts.push(`${row.queued} queued`)
  if (row.nextRun !== undefined) parts.push(`next ${zoneTime(row.nextRun)} (scheduled)`)
  return parts.join(' · ')
}

// Hours and minutes in the host's zone; without a zone reading the time is UTC and says so.
export function clockTime(ms: number, offsetMinutes: number | null): string {
  const hhmm = new Date(ms - (offsetMinutes ?? 0) * 60_000).toISOString().slice(11, 16)
  return offsetMinutes === null ? `${hhmm} UTC` : hhmm
}

export const register: Register = (on, options) => {
  live.checkMs = Math.max(15, Number(options.checkSeconds ?? 60)) * 1000

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await start($)
    return result
  })
  // A Desktop session joins its surface after session.start, and a hot reload skips session.start.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    await start($)
    return result
  })
  on('turn.start', async ($, e, next) => {
    await start($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    const rows = (await read($, view))?.rows ?? []
    if (e.props.hasSurvey || rows.length === 0) return inner
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    return (
      <Box flexDirection="column">
        {inner}
        {rows.map((row, i) => (
          <Box key={`runner-${i}`}>
            <Text color={row.isOn ? 'green' : undefined} dimColor={!row.isOn} wrap="truncate-end">
              ⚙ {rowText(row, now, ms => clockTime(ms, live.zoneOffset))}{' '}
            </Text>
            {!row.isOn && live.runners[i]?.start ? (
              <Button key={`runner-start-${i}`} label="Start" onPress={() => void pressStart($, i)} />
            ) : null}
            {row.isOn && live.runners[i]?.stop ? (
              <Button
                key={`runner-stop-${i}`}
                label={row.isConfirming ? 'Stop anyway (a job is running)' : 'Stop'}
                onPress={() => void pressStop($, i)}
              />
            ) : null}
          </Box>
        ))}
      </Box>
    )
  })
}
