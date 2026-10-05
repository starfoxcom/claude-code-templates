import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { UsageCard } from '../types'
import type { Pause } from './plan'
import { EMPTY_ARM_NOTE } from './plan'
import type { Tone } from './texts'
import { cardTone } from './texts'

// `/usage-guard phone`: what the card above the prompt and the status line show at the PC, as plain
// text for a chat that draws neither (the phone app, the web). Colour becomes a square in the card's tone.
const armedWake = atom({ plugin: 'usage-guard', key: 'armed' } as const, null)
const SQUARES: Record<Tone, string> = { green: '🟩', blue: '🟦', yellow: '🟨' }

async function readShared<T>($: EngineInterface, name: string): Promise<T | undefined> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const dir = `${configured ?? `${home}/.claude`}/mods-data/usage-guard`.replace(/\\/g, '/')
  try {
    return JSON.parse(String(await $.fs.read(`${dir}/${name}`))) as T
  } catch {
    return undefined
  }
}

// The status is plain /usage-guard's own answer (`status`), so the two never disagree.
async function phoneText($: EngineInterface, status: string): Promise<string> {
  const pause = await readShared<Pause>($, 'pause.json')
  const isPaused = pause?.status === 'active' && pause.wakeAt > (await $.clock.now())
  const lines = [`${isPaused ? '🟨' : '🟩'} ${status}`]
  const card = await readShared<UsageCard>($, 'card.json')
  if (card && !card.dismissed) lines.push(`${SQUARES[cardTone(card.id)]} ${card.text}`)
  if ((await read($, armedWake))?.isQuestioned) lines.push(`🟨 ${EMPTY_ARM_NOTE}`)
  lines.push('/usage-guard help for more')
  return lines.join('\n')
}

export const register: Register = on => {
  // The plain command's answer is asked down the chain: the engine refuses a command run from inside one.
  on('command.run', { command: 'usage-guard' }, async ($, e, next) => {
    if (e.args.trim() !== 'phone') return next(e)
    const status = (await next({ ...e, args: '' })).text ?? ''
    return { text: await phoneText($, status) }
  })
}
