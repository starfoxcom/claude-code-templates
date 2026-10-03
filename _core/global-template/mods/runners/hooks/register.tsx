import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { RunnerView } from '../types'
import { soonestRun } from './cron'
import { RUNNERS } from './rules'
import type { Runner } from './rules'

// The machine's local CI runners in one row above the prompt: on or off, how many are online and
// busy, queued runs and the next scheduled run, with Start and Stop. Every value is read in a timer,
// never while drawing; the row only shows the last reading.

const SCHEDULE_TTL_MS = 60 * 60_000
// GitHub reports a freshly started runner offline for about a minute: no warning before this.
const START_GRACE_MS = 2 * 60_000
const view = atom({ plugin: 'runners', key: 'view' } as const, null)
const live = {
  checkMs: 60_000,
  isStarted: false,
  isWindows: false,
  schedules: new Map<string, { at: number; texts: string[] }>(),
}

async function run($: Engine, argv: string[]): Promise<string | null> {
  const r = await $.process.run(argv, { timeoutMs: 30_000 }).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout : null
}

async function isUp($: Engine, runner: Runner): Promise<boolean> {
  if (live.isWindows) {
    const list = ((await run($, ['tasklist', '/NH', '/FO', 'CSV'])) ?? '').toLowerCase()
    return runner.processes.every(name => list.includes(`"${name.toLowerCase()}`))
  }
  for (const name of runner.processes) if ((await run($, ['pgrep', '-f', name])) === null) return false
  return true
}

async function online($: Engine, repo: string): Promise<{ online: number; busy: number } | null> {
  const jq = '[.runners[] | select(.status == "online")] | "\\(length) \\([.[] | select(.busy)] | length)"'
  const out = await run($, ['gh', 'api', `repos/${repo}/actions/runners`, '--jq', jq])
  if (out === null) return null
  const [count, busy] = out.trim().split(' ').map(Number)
  return { online: count, busy }
}

async function queued($: Engine, repo: string): Promise<number | null> {
  const argv = ['gh', 'run', 'list', '-R', repo, '--status', 'queued', '--json', 'databaseId', '--jq', 'length']
  const out = await run($, argv)
  return out === null ? null : Number(out.trim())
}

// The default branch's workflow files, read once an hour: cron runs that branch's copies.
async function workflowTexts($: Engine, repo: string, now: number): Promise<string[]> {
  const cached = live.schedules.get(repo)
  if (cached && now - cached.at < SCHEDULE_TTL_MS) return cached.texts
  const branchArgv = ['gh', 'repo', 'view', repo, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']
  const branch = (await run($, branchArgv))?.trim()
  if (!branch) return cached?.texts ?? []
  const folder = `repos/${repo}/contents/.github/workflows`
  const names = await run($, ['gh', 'api', `${folder}?ref=${branch}`, '--jq', '.[].name'])
  const texts: string[] = []
  for (const name of (names ?? '').split('\n').filter(n => /\.ya?ml$/.test(n))) {
    const raw = ['gh', 'api', '-H', 'Accept: application/vnd.github.raw']
    const text = await run($, [...raw, `${folder}/${name}?ref=${branch}`])
    if (text !== null) texts.push(text)
  }
  live.schedules.set(repo, { at: now, texts })
  return texts
}

async function readRunner($: Engine, runner: Runner, now: number, before?: RunnerView): Promise<RunnerView> {
  const row: RunnerView = { label: runner.label, isOn: await isUp($, runner), startedAt: before?.startedAt }
  row.isConfirming = before?.isConfirming && row.isOn
  if (!runner.repo) return row
  const counts = await online($, runner.repo)
  if (counts) Object.assign(row, counts)
  row.queued = (await queued($, runner.repo)) ?? undefined
  row.nextRun = soonestRun(await workflowTexts($, runner.repo, now), now) ?? undefined
  return row
}

async function check($: Engine): Promise<void> {
  const now = await $.clock.now()
  const before = (await read($, view))?.rows ?? []
  const rows: RunnerView[] = []
  for (const [i, runner] of RUNNERS.entries()) rows.push(await readRunner($, runner, now, before[i]))
  await update($, view, () => ({ rows }))
}

async function start($: Engine): Promise<void> {
  if (live.isStarted) return
  live.isStarted = true
  live.isWindows = (await $.env.get('OS')) === 'Windows_NT'
  await check($).catch(() => undefined)
  $.clock.every(live.checkMs, () => void check($).catch(() => undefined))
}

async function setRow($: Engine, index: number, change: Partial<RunnerView>): Promise<void> {
  await update($, view, shown => {
    const rows = [...(shown?.rows ?? [])]
    if (rows[index]) rows[index] = { ...rows[index], ...change }
    return { rows }
  })
}

async function pressStart($: Engine, index: number): Promise<void> {
  const argv = RUNNERS[index]?.start
  if (!argv) return
  await run($, argv)
  await setRow($, index, { startedAt: await $.clock.now() })
  await check($).catch(() => undefined)
}

// A busy runner is in the middle of a job (a nightly suite can run for hours): Stop asks once more.
async function pressStop($: Engine, index: number): Promise<void> {
  const row = (await read($, view))?.rows[index]
  if (row && (row.busy ?? 0) > 0 && !row.isConfirming) return setRow($, index, { isConfirming: true })
  for (const argv of RUNNERS[index]?.stop ?? []) await run($, argv)
  await setRow($, index, { isConfirming: false, startedAt: undefined })
  await check($).catch(() => undefined)
}

export function rowText(row: RunnerView, now: number, zoneTime: (ms: number) => string): string {
  const parts = [`${row.label} ${row.isOn ? 'on' : 'off'}`]
  const isStarting = row.startedAt !== undefined && now - row.startedAt < START_GRACE_MS
  if (row.online !== undefined) parts.push(isStarting && row.online === 0 ? 'starting' : `${row.online} online`)
  if (row.busy) parts.push(`${row.busy} busy`)
  if (row.queued) parts.push(`${row.queued} queued`)
  if (row.nextRun !== undefined) parts.push(`scheduled ${zoneTime(row.nextRun)}`)
  return parts.join(' · ')
}

function localTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const register: Register = (on, options) => {
  live.checkMs = Math.max(15, Number(options.checkSeconds ?? 60)) * 1000
  if (RUNNERS.length === 0) return

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
              ⚙ {rowText(row, now, localTime)}{' '}
            </Text>
            {!row.isOn && RUNNERS[i]?.start ? (
              <Button key={`runner-start-${i}`} label="Start" onPress={() => void pressStart($, i)} />
            ) : null}
            {row.isOn && RUNNERS[i]?.stop ? (
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
