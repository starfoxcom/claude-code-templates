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

// The skills of the Skill tool calls in flight, the main session's and its subagents' kept apart.
type InFlight = { main: string[]; agent: string[] }
const live: { run?: Run; inFlight: InFlight } = { inFlight: { main: [], agent: [] } }

// The engine's skill.prompt event does not say whose loop expands the prompt, so it is told apart by
// the skill named in the Skill calls in flight: a main-session call for it, or no call for it at all
// (a typed /name), starts a run; a subagent's call for it alone does not. Left out: a /name typed
// while a subagent's Skill call expands the very same skill; that one run is missed.
export function isMainSkill(inFlight: InFlight, skill: string): boolean {
  return inFlight.main.includes(skill) || !inFlight.agent.includes(skill)
}

export function skillName(input: unknown): string {
  return String((input as { skill?: unknown }).skill ?? '').replace(/^\//, '')
}

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
  // A run starts where a skill's prompt is expanded: `/name` and the Skill tool alike. Hooking
  // every command instead would put this mod's name on each command's reply.
  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    if (isMainSkill(live.inFlight, e.skill)) await startRun($, e.skill)
    return result
  })

  on('tool.call', async ($, e, next) => {
    // A Skill call expands its prompt inside this call: its skill is held while it runs (see isMainSkill).
    if (e.tool === 'Skill') {
      const names = live.inFlight[e.agentId ? 'agent' : 'main']
      const skill = skillName(e)
      names.push(skill)
      try {
        return await next(e)
      } finally {
        names.splice(names.indexOf(skill), 1)
      }
    }
    const result = await next(e)
    if (e.agentId || 'deny' in result || result.isError) return result
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
