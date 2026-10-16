// Turns Haystack JSON (Hayson) into plain JavaScript shapes the UI can use directly.
// The rest of the app never sees `_kind` wrappers.

export interface HMarker { type: 'marker' }
export interface HNumber { type: 'number'; val: number; unit?: string }
export interface HRef { type: 'ref'; id: string; dis?: string }
export interface HDateTime { type: 'dateTime'; ms: number; iso: string; tz: string }
/** date, time, coord, uri, symbol, xstr, na, remove, span etc. keep their raw fields */
export interface HOther { type: string; [k: string]: unknown }
export type HVal = null | boolean | string | HMarker | HNumber | HRef | HDateTime | HOther | HVal[] | HDict
export interface HDict { [tag: string]: HVal }
export interface HGrid { meta: HDict; cols: string[]; rows: HDict[] }

export const MARKER: HMarker = { type: 'marker' }

export function decode(raw: unknown): HVal {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return { type: 'number', val: raw }
  if (Array.isArray(raw)) return raw.map(decode)
  const o = raw as Record<string, unknown>
  switch (o._kind) {
    case undefined:
    case 'dict': {
      const d: HDict = {}
      for (const [k, v] of Object.entries(o)) if (k !== '_kind') d[k] = decode(v)
      return d
    }
    case 'marker': return MARKER
    case 'number': {
      const n: HNumber = { type: 'number', val: toNum(o.val) }
      if (typeof o.unit === 'string') n.unit = o.unit
      return n
    }
    case 'ref': return o.dis === undefined ? { type: 'ref', id: String(o.val) } : { type: 'ref', id: String(o.val), dis: String(o.dis) }
    case 'dateTime': return { type: 'dateTime', ms: Date.parse(String(o.val)), iso: String(o.val), tz: String(o.tz ?? 'UTC') }
    case 'list': return Array.isArray(o.vals) ? (o.vals as unknown[]).map(decode) : []
    case 'grid': return { type: 'grid', grid: decodeGrid(o) } as HOther
    default: {
      const { _kind, ...rest } = o
      return { type: String(_kind), ...rest }
    }
  }
}

// Hayson writes INF / NaN as strings
function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (v === 'INF') return Infinity
  if (v === '-INF') return -Infinity
  return NaN
}

export function decodeGrid(raw: unknown): HGrid {
  const g = raw as { meta?: unknown; cols?: { name: string }[]; rows?: unknown[] }
  return {
    meta: (decode(g.meta ?? {}) as HDict) ?? {},
    cols: (g.cols ?? []).map((c) => c.name),
    rows: (g.rows ?? []).map((r) => decode(r) as HDict),
  }
}

// ---- type guards and readers -------------------------------------------------

export const isMarker = (v: HVal | undefined): v is HMarker => typeof v === 'object' && v !== null && !Array.isArray(v) && (v as HOther).type === 'marker'
export const isNumber = (v: HVal | undefined): v is HNumber => typeof v === 'object' && v !== null && !Array.isArray(v) && (v as HOther).type === 'number'
export const isRef = (v: HVal | undefined): v is HRef => typeof v === 'object' && v !== null && !Array.isArray(v) && (v as HOther).type === 'ref'
export const isDateTime = (v: HVal | undefined): v is HDateTime => typeof v === 'object' && v !== null && !Array.isArray(v) && (v as HOther).type === 'dateTime'

export const has = (d: HDict, tag: string) => d[tag] !== undefined && d[tag] !== null
export const refId = (v: HVal | undefined): string | undefined => (isRef(v) ? v.id : undefined)
export const str = (v: HVal | undefined): string | undefined => (typeof v === 'string' ? v : undefined)

/** Human-readable name for a record: dis, else the display text Haxall puts on its id (from disMacro), else navName, else id. */
export function displayName(d: HDict): string {
  // Haxall fills a ref's display text with the id itself when a record has no name, which is no use to a person
  const idDis = isRef(d.id) && d.id.dis !== d.id.id ? d.id.dis : undefined
  return str(d.dis) ?? idDis ?? str(d.navName) ?? refId(d.id) ?? '(unnamed)'
}

/** Format any value for display in a table. */
export function formatVal(v: HVal | undefined, opts: { tz?: string } = {}): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => formatVal(x, opts)).join(', ')
  const o = v as HOther
  switch (o.type) {
    case 'marker': return '✓'
    case 'number': {
      const n = v as HNumber
      const s = Number.isInteger(n.val) ? String(n.val) : String(Math.round(n.val * 1000) / 1000)
      return n.unit ? `${s} ${n.unit}` : s
    }
    case 'ref': return (v as HRef).dis ?? `@${(v as HRef).id}`
    case 'dateTime': {
      const dt = v as HDateTime
      try {
        return new Intl.DateTimeFormat(undefined, {
          timeZone: opts.tz ?? ianaFromHaystack(dt.tz), dateStyle: 'medium', timeStyle: 'short',
        }).format(dt.ms)
      } catch {
        return dt.iso
      }
    }
    case 'coord': return `${o.lat}, ${o.lng}`
    case 'uri': return String(o.val)
    case 'date': case 'time': case 'symbol': return String(o.val)
    case 'na': return 'NA'
    default: return JSON.stringify(v)
  }
}

/** Haystack zone names are the last part of the IANA name (Los_Angeles). Map the ones we use. */
const IANA: Record<string, string> = {
  Los_Angeles: 'America/Los_Angeles', New_York: 'America/New_York', Chicago: 'America/Chicago', Denver: 'America/Denver',
  Phoenix: 'America/Phoenix', UTC: 'UTC', London: 'Europe/London', Paris: 'Europe/Paris', Berlin: 'Europe/Berlin',
  Tokyo: 'Asia/Tokyo', Sydney: 'Australia/Sydney',
}
export const ianaFromHaystack = (tz: string): string => IANA[tz] ?? tz

/** Time zones offered when creating a site (Haystack names). */
export const COMMON_TIMEZONES = Object.keys(IANA)

// ---- encoding for requests ---------------------------------------------------

export const ref = (id: string) => ({ _kind: 'ref', val: id })
export const marker = { _kind: 'marker' }
export const num = (val: number, unit?: string) => (unit ? { _kind: 'number', val, unit } : { _kind: 'number', val })
