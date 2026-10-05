import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { clockTime, isListed, mergeReading, pgrepPattern, rowText } from '../hooks/register'
import type { RunnerView } from '../types'

// The shipped rules.ts is empty, so the drawn row is tested through the machine's list file, which
// the tests fake.
const NOW = Date.UTC(2026, 9, 2, 17, 0, 0)
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const ON: RunnerView = { label: 'runners', isOn: true, online: 4, busy: 1, queued: 2, nextRun: NOW + 3_600_000 }

test('the row names state, online and busy runners, queued runs and the scheduled time', () => {
  expect(rowText(ON, NOW, hhmm)).toBe('runners on · 4 online · 1 busy · 2 queued · next 18:00 (scheduled)')
  expect(rowText({ label: 'runners', isOn: false, online: 0 }, NOW, hhmm)).toBe('runners off · 0 online')
  expect(rowText({ label: 'local', isOn: true }, NOW, hhmm)).toBe('local on')
})

test('a runner started under two minutes ago shows as starting, not offline', () => {
  const fresh: RunnerView = { label: 'runners', isOn: true, online: 0, startedAt: NOW - 119_999 }
  expect(rowText(fresh, NOW, hhmm)).toBe('runners on · starting')
  expect(rowText({ ...fresh, startedAt: NOW - 120_000 }, NOW, hhmm)).toBe('runners on · 0 online')
  expect(rowText({ ...fresh, online: 3 }, NOW, hhmm)).toBe('runners on · 3 online')
})

test('the scheduled time shows in the local zone, or says UTC when the zone is unknown', () => {
  const nightly = Date.UTC(2026, 9, 3, 2, 30)
  // getTimezoneOffset is minutes behind UTC: 360 is UTC-6.
  expect(clockTime(nightly, 360)).toBe('20:30')
  expect(clockTime(nightly, -330)).toBe('08:00')
  expect(clockTime(nightly, 0)).toBe('02:30')
  expect(clockTime(nightly, null)).toBe('02:30 UTC')
})

test('a reading keeps a Start or Stop pressed while it was being taken', () => {
  const reading: RunnerView[] = [{ label: 'runners', isOn: true, online: 0 }]
  const pressed: RunnerView[] = [{ label: 'runners', isOn: true, startedAt: NOW, isConfirming: true }]
  expect(mergeReading(reading, pressed)).toEqual([{ ...reading[0], startedAt: NOW, isConfirming: true }])
  // The confirm question ends once the runner is off; nothing pressed keeps nothing.
  const off: RunnerView[] = [{ label: 'runners', isOn: false }]
  expect(mergeReading(off, pressed)).toEqual([{ ...off[0], startedAt: NOW, isConfirming: false }])
  expect(mergeReading(reading, undefined)).toEqual([{ ...reading[0], startedAt: undefined, isConfirming: false }])
  // The job it asked about has ended: the next Stop asks again if a new one starts.
  const idle: RunnerView[] = [{ label: 'runners', isOn: true, online: 1, busy: 0 }]
  expect(mergeReading(idle, pressed)).toEqual([{ ...idle[0], startedAt: NOW, isConfirming: false }])
})

test('a process counts as running only under its own full name', () => {
  const tasklist = [
    '"vmmemWSL","4120","Services","0","1,024 K"',
    '"Runner.Listener.exe","8812","Console","1","90 K"',
  ].join('\r\n')
  expect(isListed(tasklist, 'vmmemWSL')).toBe(true)
  expect(isListed(tasklist, 'VMMEMWSL')).toBe(true)
  expect(isListed(tasklist, 'Runner.Listener')).toBe(true)
  expect(isListed(tasklist, 'Runner.Listener.exe')).toBe(true)
  expect(isListed(tasklist, 'vmmem')).toBe(false)
  expect(isListed(tasklist, 'Runner')).toBe(false)
  expect(isListed('', 'vmmemWSL')).toBe(false)
})

test('the pgrep pattern cannot match another pgrep looking for the same runner', () => {
  // The bracketed first letter still matches the runner, but not the pattern's own text.
  expect(pgrepPattern('Runner.Listener')).toBe('[R]unner.Listener')
  expect(new RegExp(pgrepPattern('Runner.Listener')).test('./bin/Runner.Listener run')).toBe(true)
  expect(new RegExp(pgrepPattern('Runner.Listener')).test('pgrep -f [R]unner.Listener')).toBe(false)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`with no runners listed the band draws nothing of its own on ${surface}`, async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } as never }))
    on('ui.render', () => ({ type: 'Box', props: { key: 'beneath' }, children: [] }) as never)
    await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
    const props = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
    const ui = await $.ui.mount({ plugin: 'runners', surface, component: 'AbovePrompt', props })
    expect(await ui.find({ key: 'beneath' })).toBeDefined()
    expect(await ui.find({ key: 'runner-0' })).toBeUndefined()
  })
}

// A runner from the machine's own list file draws its row and buttons on both surfaces.
const LISTED = [{ label: 'local', processes: ['Runner.Listener'], start: ['start-runners'], stop: [['stop-runners']] }]
const LIST_FILE = 'C:/Users/me/.claude/mods-data/runners/runners.json'
const registered: { name: string; argumentHint?: string }[] = []

// `files`: more readable files, by full path or, for the manifest, `plugin.json`.
function machine(on: On, isUp: () => boolean, files: Record<string, string> = {}) {
  const runs: string[][] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:/Users/me', OS: 'Windows_NT' })
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    const extra = files[path] ?? (path.endsWith('/plugin.json') ? files['plugin.json'] : undefined)
    if (extra !== undefined) return { value: extra }
    if (path !== LIST_FILE) throw new Error('ENOENT')
    return { value: JSON.stringify(LISTED) }
  })
  on('fs.write', ($, e) => {
    files[e.path.replaceAll('\\', '/')] = e.text
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const listed = isUp() ? '"Runner.Listener.exe","1"\r\n' : ''
    const out = e.argv[0] === 'node' ? '360\n' : e.argv[0] === 'tasklist' ? listed : ''
    return { value: { exitCode: 0, stdout: out, stderr: '' } } as never
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    registered.push(e)
    return { value: { command: e.name } as never }
  })
  on('ui.render', () => ({ type: 'Box', props: { key: 'beneath' }, children: [] }) as never)
  return { runs, clock }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a listed runner draws its row and Start, then Stop once up, on ${surface}`, async ($, on) => {
    let isRunning = false
    const { runs, clock } = machine(on, () => isRunning)
    await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
    // Session start does not wait for the first reading; it lands moments later.
    await clock.advance(1_000)
    const props = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never
    const ui = await $.ui.mount({ plugin: 'runners', surface, component: 'AbovePrompt', props })
    expect(await ui.find({ key: 'runner-0' })).toBeDefined()
    expect(await ui.find({ key: 'runner-stop-0' })).toBeUndefined()

    isRunning = true
    await ui.press({ key: 'runner-start-0' })
    expect(runs).toContainEqual(['start-runners'])
    await clock.advance(1_000)
    await ui.redraw()
    expect(await ui.find({ key: 'runner-start-0' })).toBeUndefined()
    expect(await ui.find({ key: 'runner-stop-0' })).toBeDefined()
  })
}

test('/runners shows its arguments in the menu, lists them on help and names each runner', async ($, on) => {
  const { clock } = machine(on, () => true)
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
  expect(registered.find(command => command.name === 'runners')?.argumentHint).toBe('[help | settings | set | phone]')
  const help = (await $.command.run({ command: 'runners', args: 'help' } as never)) as { text: string }
  for (const line of help.text.split('\n').slice(1)) expect(line).toMatch(/^ {2}\/runners( \w+)? +\S/)
  // An unknown word gets the same list.
  expect(await $.command.run({ command: 'runners', args: 'bogus' } as never)).toEqual(help)
  await clock.advance(1_000)
  expect(await $.command.run({ command: 'runners', args: '' } as never)).toEqual({ text: '⚙ local on' })
  const phone = { text: '🟩 ⚙ local on\n/runners help for more' }
  expect(await $.command.run({ command: 'runners', args: 'phone' } as never)).toEqual(phone)
  // Typed bare over Remote Control, where no row draws, it answers with the phone text.
  const bridge = { command: 'runners', args: '', origin: { kind: 'bridge' } }
  expect(await $.command.run(bridge as never)).toEqual(phone)
})

test('/runners with no runners listed says how to add one', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
  const answer = (await $.command.run({ command: 'runners', args: '' } as never)) as { text: string }
  expect(answer.text).toContain('No runners listed. Add one to ~/.claude/mods-data/runners/runners.json')
})

test('the check interval in the settings file applies from the start, and a new one takes over', async ($, on) => {
  const manifest = JSON.stringify({ userConfig: { checkSeconds: { type: 'number' } } })
  const file = 'C:/Users/me/.claude/mods-data/runners/settings.json'
  const saved = { 'plugin.json': manifest, [file]: '{"checkSeconds":120}' }
  const { runs, clock } = machine(on, () => true, saved)
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
  const checks = () => runs.filter(argv => argv[0] === 'tasklist').length
  // The first reading runs at once; the next ones every two minutes.
  await clock.advance(60_000)
  expect(checks()).toBe(1)
  await clock.advance(60_000)
  expect(checks()).toBe(2)
  // A new interval: the old timer ticks once more, then the new one runs.
  await $.command.run({ command: 'runners', args: 'set checkSeconds 60' } as never)
  await clock.advance(120_000)
  expect(checks()).toBe(3)
  await clock.advance(60_000)
  expect(checks()).toBe(4)
})
