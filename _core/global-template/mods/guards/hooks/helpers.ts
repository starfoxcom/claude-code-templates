// Helper agents: the Agent and Workflow tools, which start subagents, forks, teammates and workflow runs.
// With the `helpers` setting at `block`, guards refuses them (shadow: logs them) unless the person typed
// `/guards helpers allow` in this session. A plugin's own agents start through `$.agent.spawn`, not
// these tools, so they are never touched. register.ts matches the two tools by name.

export const HELPER_BLOCK =
  'helper agents are off in this setup (the Agent and Workflow tools). Do the work in the main session. ' +
  'If the maintainer asked for a helper in this conversation, ask them to type /guards helpers allow.'

export type HelperState = { setting: 'allow' | 'block'; isAllowedHere: boolean }

/** Whether a helper call is checked: the setting blocks it and this session has no allow. */
export function isHelperChecked(state: HelperState): boolean {
  return state.setting === 'block' && !state.isAllowedHere
}

/** `/guards helpers [allow | block]`: the answer and the session's allow after it. */
export function helpersCommand(word: string, state: HelperState): { text: string; isAllowedHere: boolean } {
  if (state.setting === 'allow') {
    return {
      text:
        'Helper agents are allowed in every session (setting helpers = allow). ' +
        '/guards set helpers block turns the block on.',
      isAllowedHere: state.isAllowedHere,
    }
  }
  if (word === 'allow') return { text: 'Helper agents are allowed for the rest of this session.', isAllowedHere: true }
  if (word === 'block') return { text: 'Helper agents are blocked again in this session.', isAllowedHere: false }
  return {
    text: state.isAllowedHere
      ? 'Helper agents: allowed in this session (/guards helpers block to stop).'
      : 'Helper agents: blocked (/guards helpers allow allows them for this session).',
    isAllowedHere: state.isAllowedHere,
  }
}

/** The status line for `/guards`. */
export function helpersLine(state: HelperState, isEnforced: boolean): string {
  if (state.setting === 'allow') return 'Helper agents are allowed (setting helpers = allow).'
  if (state.isAllowedHere) return 'Helper agents are blocked, but allowed in this session.'
  return isEnforced ? 'Helper agents are blocked.' : 'Helper agents would be blocked (shadow logs them).'
}
