import type { Runner } from './rules'

// `/runners add`: a runner set listed from the command instead of by editing the list file by hand. Pure,
// no engine access: register.tsx reads and writes the file.

export const ADD_USAGE = [
  'Usage: /runners add <name> <program>[,<program>...] [owner/repo]',
  '  name     what the row calls it, one word',
  '  program  the process names that all run while the runners are up, comma-separated',
  "  repo     optional: the GitHub repo whose runners, queued runs and schedules are shown (needs gh)",
  'Example: /runners add ci Runner.Listener me/my-game',
].join('\n')

const REPO = /^[\w.-]+\/[\w.-]+$/

/** The runner the words after `add` describe, or what is wrong with them. */
export function parseAdd(words: string[]): Runner | { error: string } {
  const [label, programs, repo, ...rest] = words
  if (!label || !programs || rest.length > 0) return { error: ADD_USAGE }
  const processes = programs.split(',').map(p => p.trim()).filter(Boolean)
  if (processes.length === 0) return { error: ADD_USAGE }
  if (repo !== undefined && !REPO.test(repo)) return { error: `"${repo}" is not an owner/repo name.\n${ADD_USAGE}` }
  return repo === undefined ? { label, processes } : { label, processes, repo }
}

/** The list file's new text with the runner added, or why the file is left as it is. `fileText` undefined:
 * there is no file yet. Entries the mod does not read are kept as they are. */
export function withRunner(fileText: string | undefined, runner: Runner): { text: string } | { error: string } {
  let list: unknown = []
  if (fileText !== undefined && fileText.trim() !== '') {
    try {
      list = JSON.parse(fileText)
    } catch {
      return { error: 'The runners list file is not valid JSON; fix it by hand first.' }
    }
  }
  if (!Array.isArray(list)) return { error: 'The runners list file does not hold a JSON list; fix it by hand first.' }
  const name = runner.label.toLowerCase()
  if (list.some(entry => String((entry as Runner | null)?.label ?? '').toLowerCase() === name))
    return { error: `A runner named "${runner.label}" is already listed.` }
  return { text: `${JSON.stringify([...list, runner], null, 2)}\n` }
}
