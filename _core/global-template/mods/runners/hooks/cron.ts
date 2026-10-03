// When a GitHub Actions `schedule` runs next: the five-field cron syntax GitHub accepts (minute, hour,
// day of month, month, day of week; `*`, numbers, ranges, steps and lists), always in UTC. Pure, so
// the band can call it on every check and the tests can pin it down.

const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
] as const
const DAY_MS = 86_400_000
// A schedule that never fires within a year (Feb 30th) has no next run.
const SEARCH_DAYS = 366

type Field = { values: Set<number>; isAny: boolean }

// Each list element is `*` or `n` or `n-m`, optionally with `/step`. Anything with a number missing
// (`/5`, `-5`, `0,,5`) is refused, as GitHub refuses it: such a workflow never runs.
const ELEMENT = /^(\*|\d+(-\d+)?)(\/\d+)?$/

function parseField(text: string, min: number, max: number): Field | null {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    if (!ELEMENT.test(part)) return null
    const [range = '', stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    let [lo, hi] = range === '*' ? [min, max] : range.split('-').map(Number)
    if (hi === undefined) hi = stepText === undefined ? lo : max
    if (![lo, hi, step].every(Number.isInteger) || step < 1 || lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) values.add(v)
  }
  return { values, isAny: text === '*' }
}

export type Cron = { minutes: Field; hours: Field; days: Field; months: Field; weekdays: Field }

export function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const fields = parts.map((text, i) => parseField(text, FIELDS[i].min, FIELDS[i].max))
  if (fields.some(field => field === null)) return null
  const [minutes, hours, days, months, weekdays] = fields as Field[]
  // Day of week 7 is Sunday, as 0 is.
  if (weekdays.values.has(7)) weekdays.values.add(0)
  return { minutes, hours, days, months, weekdays }
}

// A restricted day of month and day of week match either one, as cron has always done.
function isDayMatch(cron: Cron, day: Date): boolean {
  if (!cron.months.values.has(day.getUTCMonth() + 1)) return false
  const byDate = cron.days.values.has(day.getUTCDate())
  const byWeekday = cron.weekdays.values.has(day.getUTCDay())
  if (cron.days.isAny || cron.weekdays.isAny) return byDate && byWeekday
  return byDate || byWeekday
}

// The first time strictly after `after` (ms since the epoch) the schedule fires, or null.
export function nextRun(cron: Cron, after: number): number | null {
  const start = new Date(Math.floor(after / 60_000) * 60_000 + 60_000)
  const firstDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const hours = [...cron.hours.values].sort((a, b) => a - b)
  const minutes = [...cron.minutes.values].sort((a, b) => a - b)
  for (let d = 0; d <= SEARCH_DAYS; d++) {
    const dayStart = firstDay + d * DAY_MS
    if (!isDayMatch(cron, new Date(dayStart))) continue
    for (const hour of hours) {
      for (const minute of minutes) {
        const at = dayStart + hour * 3_600_000 + minute * 60_000
        if (at >= start.getTime()) return at
      }
    }
  }
  return null
}

// Every `cron:` value in a workflow file's text, quoted or not.
export function cronsIn(workflow: string): string[] {
  const line = /^\s*-?\s*cron:\s*(['"]?)([^'"\n#]+?)\1\s*(#.*)?$/gm
  return [...workflow.matchAll(line)].map(match => match[2].trim())
}

// The soonest run among several workflow files' schedules; invalid expressions are skipped.
export function soonestRun(workflows: readonly string[], after: number): number | null {
  let soonest: number | null = null
  for (const expr of workflows.flatMap(cronsIn)) {
    const cron = parseCron(expr)
    const at = cron && nextRun(cron, after)
    if (at !== null && at !== undefined && (soonest === null || at < soonest)) soonest = at
  }
  return soonest
}
