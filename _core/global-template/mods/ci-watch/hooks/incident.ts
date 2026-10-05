// GitHub's own incidents: when a watch's checks sit pending long past a normal run, the cause can be an
// Actions outage (jobs queued with no runner, never started). Read from githubstatus.com, which needs no
// token. Pure, no engine access: register.ts runs the fetch and decides when to look.

/** Checks still pending this long after a watch started: worth asking GitHub whether Actions is down. */
export const STUCK_MS = 15 * 60_000
/** One status read serves every watch for this long. */
export const STATUS_EVERY_MS = 5 * 60_000

// Prints the unresolved incidents as JSON; any failure prints nothing.
export const STATUS_SCRIPT =
  'fetch("https://www.githubstatus.com/api/v2/incidents/unresolved.json")' +
  '.then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>{})'

type Incident = { name?: string; status?: string; components?: { name?: string }[] }

/** The name of an unresolved incident that touches Actions, or undefined. */
export function actionsIncident(statusJson: string): string | undefined {
  try {
    const incidents = (JSON.parse(statusJson) as { incidents?: Incident[] }).incidents ?? []
    const isActions = (i: Incident) =>
      i.status !== 'resolved' &&
      ((i.components ?? []).some(c => c.name === 'Actions') || /\bactions\b/i.test(i.name ?? ''))
    const found = incidents.find(isActions)
    return found ? (found.name ?? 'Incident with Actions') : undefined
  } catch {
    return undefined
  }
}

export function incidentText(pr: string, minutes: number, incident: string): string {
  return (
    `[ci-watch] ${pr}: checks still pending after ${minutes} min, and GitHub reports an open incident: ` +
    `"${incident}" (githubstatus.com). Jobs may sit queued until GitHub recovers; nothing to fix here. ` +
    'The watch goes on and wakes the session again when the checks settle.'
  )
}
