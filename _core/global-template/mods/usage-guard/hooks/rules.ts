// Background work to stop when sessions wrap up for a usage limit, keyed by
// the project folder name (case-insensitive). Each entry is one command run
// on the host as an argv list; a failure is ignored. This is your list: edit
// it to match your projects, and a save reloads the mod.
//
// Example (a made-up project that keeps local containers running):
//
//   'my-game': [
//     ['docker', 'compose', 'stop'],
//   ],
export const STOP_COMMANDS: Record<string, readonly (readonly string[])[]> = {}

/** The stop commands for a project root, matched on its folder name, case-insensitively. */
export function stopCommandsFor(
  root: string,
  table: Record<string, readonly (readonly string[])[]> = STOP_COMMANDS,
): readonly (readonly string[])[] {
  const folder = (root.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? '').toLowerCase()
  const key = Object.keys(table).find(k => k.toLowerCase() === folder)
  return (key && table[key]) || []
}
