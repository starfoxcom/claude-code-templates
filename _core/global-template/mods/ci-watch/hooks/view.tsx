import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Watch } from '../types'

// The watches as the band draws them, written by register.ts on every save and load. Each file names
// the state with its own literal reference: the engine reads a module's state keys off its source.
const shown = atom({ plugin: 'ci-watch', key: 'watches' } as const, [])
// Keys of the watches whose checks are listed one by one.
const expanded = atom({ plugin: 'ci-watch', key: 'expanded' } as const, [])

const PENDING = 'pending'
const FAILED = new Set(['fail', 'cancel'])

type Tone = 'green' | 'red' | 'yellow' | 'gray'

/** Each check state's icon and color, the tasks list's grammar: green done, red act, yellow wait. */
export const LOOKS: Record<string, { icon: string; color: Tone }> = {
  pass: { icon: '✅', color: 'green' },
  fail: { icon: '❌', color: 'red' },
  cancel: { icon: '🚫', color: 'red' },
  pending: { icon: '⏳', color: 'yellow' },
  skipping: { icon: '➖', color: 'gray' },
}
const UNKNOWN = { icon: '❔', color: 'gray' as Tone }

/** A stop button's key; register.ts takes its press (`ui.press`), since $ never crosses a callback. */
export const STOP_PREFIX = 'ci-watch-stop-'

export function keyOf(watch: Pick<Watch, 'repo' | 'number'>): string {
  return `${watch.repo}#${watch.number}`
}

/** What one watch's row says, and in which color. */
export function summary(watch: Watch): { text: string; color: 'green' | 'red' | 'yellow' } {
  const states = Object.entries(watch.checks)
  const failed = states.filter(([, bucket]) => FAILED.has(bucket)).map(([name]) => name)
  const done = states.filter(([, bucket]) => bucket !== PENDING).length
  const pr = `PR ${watch.number}`
  if (watch.outcome === 'passed') return { text: `✅ ${pr} · all ${states.length} passed`, color: 'green' }
  // A check failed while others still run: red for the failure, the hourglass and count for the rest.
  if (failed.length > 0 && !watch.outcome && done < states.length) {
    return { text: `⏳ ${pr} · ${done}/${states.length} done · failed so far: ${failed.join(', ')}`, color: 'red' }
  }
  if (failed.length > 0) return { text: `❌ ${pr} · failed: ${failed.join(', ')}`, color: 'red' }
  if (watch.outcome === 'timeout') return { text: `⏰ ${pr} · stuck pending`, color: 'yellow' }
  // Every check passed, and the watch waits out its quiet polls (a late workflow can still show up)
  // before it wakes the session: green for the checks, the hourglass for the wake still to come.
  if (states.length > 0 && done === states.length)
    return { text: `⏳ ${pr} · all ${states.length} passed, confirming`, color: 'green' }
  // Still waiting while GitHub reports an Actions incident: the likely cause, named on the row.
  if (!watch.outcome && watch.incident) {
    const text = `⚠️ ${pr} · ${done}/${states.length} done · GitHub incident: ${watch.incident}`
    return { text, color: 'yellow' }
  }
  return { text: `⏳ ${pr} · ${done}/${states.length} done`, color: 'yellow' }
}

/** One watch as plain text for a phone chat: the row's summary, every check with its icon, the PR link. */
export function phoneText(watch: Watch): string {
  const checks = Object.entries(watch.checks).map(([name, bucket]) => `   ${(LOOKS[bucket] ?? UNKNOWN).icon} ${name}`)
  const link = `   https://github.com/${watch.repo}/pull/${watch.number}`
  return [summary(watch).text, ...checks, link].join('\n')
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

function watchRow(ui: Ui, $: EngineInterface, watch: Watch, isOpen: boolean) {
  const { Box, Button, Link, Text } = ui
  const key = keyOf(watch)
  const { text, color } = summary(watch)
  return (
    <Box key={`ci-watch-${key}`} flexDirection="column">
      <Box>
        <Text color={color}>{text} </Text>
        <Link href={`https://github.com/${watch.repo}/pull/${watch.number}`} label="open" />
        <Text> </Text>
        <Button
          key={`ci-watch-checks-${key}`}
          label={isOpen ? 'hide checks' : 'checks'}
          onPress={() => update($, expanded, keys => (isOpen ? keys.filter(k => k !== key) : [...keys, key]))}
        />
        {/* register.ts answers this press in its ui.press hook, before this handler would run. */}
        <Button key={`${STOP_PREFIX}${key}`} label="stop" onPress={() => undefined} />
      </Box>
      {isOpen ? checkList(ui, watch) : null}
    </Box>
  )
}

function checkList(ui: Ui, watch: Watch) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {Object.entries(watch.checks).map(([name, bucket]) => {
        const look = LOOKS[bucket] ?? UNKNOWN
        return (
          <Box key={`ci-watch-check-${name}`}>
            <Text color={look.color}>
              {look.icon} {name}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export function registerView(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    const watches = await read($, shown)
    if (e.props.hasSurvey || watches.length === 0) return inner
    const open = await read($, expanded)
    const ui = $.ui.resolve(e)
    return (
      <ui.Box flexDirection="column">
        {inner}
        {watches.map(watch => watchRow(ui, $, watch, open.includes(keyOf(watch))))}
      </ui.Box>
    )
  })
}
