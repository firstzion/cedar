// Date range presets for the Trend Viewer, worked out in the site's time zone.
import { addDays, DAY, localMidnight, parts } from '@ssl/haystack'

export interface Preset { key: string; label: string }
export const PRESETS: Preset[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'all', label: 'All data' },
]

export interface ResolvedRange { startMs: number; endMs: number }
export const DEFAULT_RANGE = 'last7'

const CUSTOM = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/

/** Custom ranges are written as two local dates joined by an underscore: 2026-08-24_2026-08-28 (both days included). */
export const customKey = (from: string, to: string) => `${from}_${to}`
export const parseCustom = (key: string): { from: string; to: string } | null => {
  const m = CUSTOM.exec(key)
  return m ? { from: m[1], to: m[2] } : null
}
export const isKnownRange = (key: string) => PRESETS.some((p) => p.key === key) || parseCustom(key) !== null

/** Local midnight of a YYYY-MM-DD date in the given zone. */
export function dateToMidnight(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return localMidnight(Date.UTC(y, m - 1, d, 12), tz) // noon avoids the DST edge
}

export function msToDate(ms: number, tz: string): string {
  const p = parts(ms, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/**
 * Turn a range key into start/end times. `extent` (earliest/latest stored sample of the chosen points)
 * is only needed for "all". Returns null if the key is unusable.
 */
export function resolveRange(key: string, nowMs: number, tz: string, extent?: ResolvedRange | null): ResolvedRange | null {
  const midnight = localMidnight(nowMs, tz)
  switch (key) {
    case 'today': return { startMs: midnight, endMs: addDays(midnight, 1, tz) }
    case 'yesterday': return { startMs: addDays(midnight, -1, tz), endMs: midnight }
    case 'thisWeek': {
      const dow = parts(midnight + 12 * 3600000, tz).dow
      const back = dow === 0 ? 6 : dow - 1 // weeks start on Monday
      return { startMs: addDays(midnight, -back, tz), endMs: nowMs }
    }
    case 'last7': return { startMs: nowMs - 7 * DAY, endMs: nowMs }
    case 'last30': return { startMs: nowMs - 30 * DAY, endMs: nowMs }
    case 'last90': return { startMs: nowMs - 90 * DAY, endMs: nowMs }
    case 'all': return extent ? { startMs: extent.startMs, endMs: extent.endMs + 60000 } : null
  }
  const c = parseCustom(key)
  if (!c) return null
  const startMs = dateToMidnight(c.from, tz)
  const endMs = addDays(dateToMidnight(c.to, tz), 1, tz)
  return endMs > startMs ? { startMs, endMs } : null
}
