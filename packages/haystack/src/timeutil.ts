// Time zone helpers built on Intl (no extra dependency). All times are epoch milliseconds.
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const fmts = new Map<string, Intl.DateTimeFormat>()

export interface LocalParts {
  year: number; month: number; day: number; hour: number; minute: number; second: number
  dow: number // 0 = Sunday
  offset: string // like -07:00 (or Z)
}

export function parts(ms: number, tz: string): LocalParts {
  let f = fmts.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', timeZoneName: 'longOffset',
    })
    fmts.set(tz, f)
  }
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(ms)) o[p.type] = p.value
  // A zero offset is written "GMT" by some versions of the time zone data and "GMT+00:00" by others: always use Z
  const off = o.timeZoneName.replace('GMT', '')
  return {
    year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second,
    dow: DOW[o.weekday], offset: off === '' || off === '+00:00' || off === '-00:00' ? 'Z' : off,
  }
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** ISO 8601 with the zone's UTC offset, e.g. 2026-10-16T08:15:00-07:00 (Z when the offset is zero) */
export function iso(ms: number, tz: string): string {
  const p = parts(ms, tz)
  return `${p.year}-${p2(p.month)}-${p2(p.day)}T${p2(p.hour)}:${p2(p.minute)}:${p2(p.second)}${p.offset}`
}

const H = 3600000
const DAY = 86400000

/** UTC offset in milliseconds that applies to this instant in the zone (negative west of Greenwich). */
export function offsetMs(ms: number, tz: string): number {
  const o = parts(ms, tz).offset
  if (o === 'Z') return 0
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(o)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000
}

/** Midnight (start of local day) for the local day containing ms. Correct on daylight saving change days. */
export function localMidnight(ms: number, tz: string): number {
  const p = parts(ms, tz)
  const wall = Date.UTC(p.year, p.month - 1, p.day) // the date, read as if it were UTC
  // the offset at midnight can differ from the offset at the guess, so refine once
  return wall - offsetMs(wall - offsetMs(wall, tz), tz)
}

/** Local midnight n days after the given local midnight. */
export function addDays(midnight: number, n: number, tz: string): number {
  return localMidnight(midnight + n * DAY + 12 * H, tz)
}

/** First local midnight at or after fromMs that falls on the given weekday (0 = Sunday). */
export function nextWeekdayMidnight(fromMs: number, dow: number, tz: string): number {
  const base = localMidnight(fromMs, tz)
  for (let k = 0; k < 9; k++) {
    const c = addDays(base, k, tz)
    if (c >= fromMs && parts(c + 12 * H, tz).dow === dow) return c
  }
  throw new Error('no such weekday found')
}

export const QUARTER = 15 * 60000
export { H as HOUR, DAY }
