import type { EngineInterface, Register } from 'claude-code'

// A skill can declare the steps its run must show, in `~/.claude/skill-contracts.json`:
//   { "<project folder>" | "*": { "<skill>": [ { "step", "match", "tools"? } ] } }
// `match` is a regex tested against a successful tool call's input (as JSON); `tools`
// limits which tools count. When the turn that ran the skill ends with steps unseen,
// the session gets ONE follow-up turn naming them, to do them or say why they do
// not apply. Skills with no contract are left alone.

export type Step = { step: string; match: string; tools?: string[] }
export type Contracts = Record<string, Record<string, Step[]>>

type Run = { skill: string; steps: Step[]; seen: Set<number>; isFollowedUp: boolean }

const live: { run?: Run } = {}

export function missingSteps(run: Run): Step[] {
  return run.steps.filter((step, index) => !run.seen.has(index))
}

export function markSeen(run: Run, tool: string, input: string): void {
  run.steps.forEach((step, index) => {
    if (run.seen.has(index)) return
    if (step.tools && !step.tools.includes(tool)) return
    try {
      if (new RegExp(step.match, 'i').test(input)) run.seen.add(index)
    } catch {
      // A broken pattern never blocks; the step simply never shows as seen.
    }
  })
}

export function followUpText(run: Run): string {
  const steps = missingSteps(run).map(step => step.step)
  return (
    `[skill-check] /${run.skill} is not finished: no sign of ${steps.join('; ')}. Do these now, or say ` +
    `plainly why each one does not apply this time.`
  )
}

async function contractsFor($: EngineInterface, skill: string): Promise<Step[] | undefined> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  try {
    const path = `${configured ?? `${home}/.claude`}/skill-contracts.json`.replaceAll('\\', '/')
    const all = JSON.parse(String(await $.fs.read(path))) as Contracts
    const folder = (
      (await $.session.root()).replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? ''
    ).toLowerCase()
    return all[folder]?.[skill] ?? all['*']?.[skill]
  } catch {
    return undefined
  }
}

async function startRun($: EngineInterface, skill: string): Promise<void> {
  const steps = await contractsFor($, skill)
  live.run = steps && steps.length > 0 ? { skill, steps, seen: new Set(), isFollowedUp: false } : undefined
}

export const register: Register = on => {
  on('command.run', async ($, e, next) => {
    await startRun($, e.command)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || 'deny' in result || result.isError) return result
    if (e.tool === 'Skill') {
      const skill = String((e as unknown as { skill?: string }).skill ?? '').replace(/^\//, '')
      if (skill) await startRun($, skill)
      return result
    }
    if (live.run) {
      const { tool, tool_use_id, consent, agentId, ...input } = e as unknown as Record<string, unknown>
      markSeen(live.run, String(tool), JSON.stringify(input))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const run = live.run
    if (!run || e.isAborted) return result
    if (missingSteps(run).length === 0 || run.isFollowedUp) {
      live.run = undefined
      return result
    }
    run.isFollowedUp = true
    void $.prompt.submit({ text: followUpText(run) }).catch(() => undefined)
    return result
  })
}
