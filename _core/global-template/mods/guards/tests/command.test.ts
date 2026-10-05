import type { ConfigRow, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { sumDays } from '../hooks/register'

// /guards over a faked stats file: the mode, where the product may be named, and the counts.
const NOW = Date.UTC(2026, 9, 3, 18, 0, 0)
const STATS = 'C:/Users/me/.claude/mods-data/guards/stats.json'
const DAY = (back: number) => new Date(NOW - back * 86_400_000).toISOString().slice(0, 10)

function world(on: On, stats?: Record<string, unknown>) {
  const registered: { name: string; argumentHint?: string }[] = []
  const opened: string[] = []
  mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:/Users/me', OS: 'Windows_NT' })
  on('fs.read', ($, e) => {
    if (e.path.replaceAll('\\', '/') !== STATS || !stats) throw new Error('ENOENT')
    return { value: JSON.stringify(stats) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    registered.push(e)
    return { value: { command: e.name } as never }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('config.list', () => ({ value: [] as ConfigRow[] }))
  return { registered, opened }
}

test('/guards shows its arguments in the menu and lists them on help', async ($, on) => {
  const { registered, opened } = world(on)
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
  expect(registered.find(command => command.name === 'guards')?.argumentHint).toBe('[help | settings]')
  const help = (await $.command.run({ command: 'guards', args: 'help' } as never)) as { text: string }
  for (const line of help.text.split('\n').slice(1)) expect(line).toMatch(/^ {2}\/guards( \w+)? +\S/)
  // An unknown word gets the same list.
  expect(await $.command.run({ command: 'guards', args: 'bogus' } as never)).toEqual(help)
  const answer = await $.command.run({ command: 'guards', args: 'settings' } as never)
  expect(opened).toEqual(['guards-settings'])
  expect(answer).toEqual(expect.objectContaining({ text: 'Opened the guards settings.' }))
})

test('/guards names the mode, where the product may appear, and the counts for today and the week', async ($, on) => {
  world(on, {
    [DAY(0)]: { checked: 12, mod: 1, scripts: 2, lastAt: NOW },
    [DAY(6)]: { checked: 5, mod: 0, scripts: 1, lastAt: NOW },
    [DAY(7)]: { checked: 99, mod: 9, scripts: 9, lastAt: NOW },
  })
  await $.session.start({ cwd: 'C:/Repos/x', surface: 'terminal', isInteractive: true })
  const { text } = (await $.command.run({ command: 'guards', args: '' } as never)) as { text: string }
  expect(text.split('\n')).toEqual([
    'Guards: shadow (never blocks; logs what it would block).',
    'The product name may appear in every repo; AI credit is blocked everywhere.',
    'Today: 12 writes checked, 1 it would block, 2 the guard scripts blocked.',
    'Last 7 days: 17 writes checked, 1 it would block, 3 the guard scripts blocked.',
  ])
})

test('the day totals count today and the days before it, and nothing older', () => {
  const stats = {
    [DAY(0)]: { checked: 1, mod: 1, scripts: 0 },
    [DAY(1)]: { checked: 2, mod: 0, scripts: 1 },
    [DAY(7)]: { checked: 50, mod: 5, scripts: 5 },
  }
  expect(sumDays(stats, NOW, 1)).toEqual({ checked: 1, mod: 1, scripts: 0 })
  expect(sumDays(stats, NOW, 7)).toEqual({ checked: 3, mod: 1, scripts: 1 })
  expect(sumDays(stats, NOW, 8)).toEqual({ checked: 53, mod: 6, scripts: 6 })
  expect(sumDays({}, NOW, 7)).toEqual({ checked: 0, mod: 0, scripts: 0 })
})
