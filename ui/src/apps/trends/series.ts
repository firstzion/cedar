// Pure data logic for the Trend Viewer (no React, no chart library): gaps, decimation, merging, CSV.
import { iso, offsetMs } from '@ssl/haystack'

export type RawVal = number | boolean | string | null
export type Kind = 'number' | 'bool' | 'enum'

export interface SeriesInput {
  id: string
  name: string
  unit?: string
  kind: Kind
  ms: number[]
  val: RawVal[]
}

/** A series ready to plot: numeric y (NaN = no value), gaps found, enum levels mapped. */
export interface Prepared {
  id: string
  name: string
  unit?: string
  kind: Kind
  ms: number[]
  y: number[]
  levels: string[] // enum labels by level number (empty for numbers and booleans)
  gapMs: number // a jump larger than this between samples is a gap
  gaps: Gap[]
}
export interface Gap { startMs: number; endMs: number } // last sample before, first sample after

export const GAP_FACTOR = 2.5

export function medianInterval(ms: number[]): number {
  if (ms.length < 2) return 0
  const step = Math.max(1, Math.floor((ms.length - 1) / 2000)) // sample at most ~2000 intervals
  const d: number[] = []
  for (let i = step; i < ms.length; i += step) d.push(ms[i] - ms[i - step])
  d.sort((a, b) => a - b)
  return d[Math.floor(d.length / 2)] / step
}

export function findGaps(ms: number[], gapMs: number): Gap[] {
  const out: Gap[] = []
  if (gapMs <= 0) return out
  for (let i = 1; i < ms.length; i++) if (ms[i] - ms[i - 1] > gapMs) out.push({ startMs: ms[i - 1], endMs: ms[i] })
  return out
}

export function prepare(s: SeriesInput): Prepared {
  const levels: string[] = []
  const y = new Array<number>(s.val.length)
  for (let i = 0; i < s.val.length; i++) {
    const v = s.val[i]
    if (typeof v === 'number') y[i] = v
    else if (typeof v === 'boolean') y[i] = v ? 1 : 0
    else if (typeof v === 'string') {
      let k = levels.indexOf(v)
      if (k < 0) { levels.push(v); k = levels.length - 1 }
      y[i] = k
    } else y[i] = NaN
  }
  const gapMs = medianInterval(s.ms) * GAP_FACTOR
  return { id: s.id, name: s.name, unit: s.unit, kind: s.kind, ms: s.ms, y, levels, gapMs, gaps: findGaps(s.ms, gapMs) }
}

export const kindOfValues = (val: RawVal[]): Kind => {
  for (const v of val) {
    if (typeof v === 'boolean') return 'bool'
    if (typeof v === 'string') return 'enum'
    if (typeof v === 'number') return 'number'
  }
  return 'number'
}

// ---- decimation ------------------------------------------------------------------

export type Pt = [number, number | null] // [ms, value]; null value = break the line here

function lowerBound(a: number[], x: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m }
  return lo
}

/**
 * Points to draw for the window [fromMs, toMs]. When there are far more samples than pixels, each pixel
 * column keeps its first, lowest, highest and last sample, so spikes, flatlines and steps stay visible.
 * A null point is inserted wherever the data has a gap so the line breaks instead of joining across it.
 */
export function decimate(p: Prepared, fromMs: number, toMs: number, buckets: number): Pt[] {
  const { ms, y } = p
  const lo = Math.max(0, lowerBound(ms, fromMs) - 1)
  const hi = Math.min(ms.length, lowerBound(ms, toMs) + 1)
  const out: Pt[] = []
  const brk = (t: number) => { if (out.length && out[out.length - 1][1] !== null) out.push([t, null]) }
  const push = (i: number) => { if (Number.isNaN(y[i])) brk(ms[i]); else out.push([ms[i], y[i]]) }
  if (hi - lo <= buckets * 4) {
    for (let i = lo; i < hi; i++) {
      if (i > lo && p.gapMs > 0 && ms[i] - ms[i - 1] > p.gapMs) brk(ms[i - 1] + 1)
      push(i)
    }
    return out
  }
  const width = (toMs - fromMs) / buckets
  let cur = -1, first = -1, last = -1, min = -1, max = -1
  const flush = () => {
    if (first < 0) return
    const idx = [...new Set([first, min, max, last])].sort((a, b) => a - b)
    for (const i of idx) push(i)
    first = last = min = max = -1
  }
  for (let i = lo; i < hi; i++) {
    if (i > lo && p.gapMs > 0 && ms[i] - ms[i - 1] > p.gapMs) { flush(); brk(ms[i - 1] + 1) }
    if (Number.isNaN(y[i])) { flush(); brk(ms[i]); continue }
    const b = Math.floor((ms[i] - fromMs) / width)
    if (b !== cur) { flush(); cur = b }
    if (first < 0) { first = min = max = i }
    if (y[i] < y[min]) min = i
    if (y[i] > y[max]) max = i
    last = i
  }
  flush()
  return out
}

// ---- grouping by unit -------------------------------------------------------------

export interface UnitGroup { key: string; label: string; kind: Kind; members: number[] }

/** One group per unit (booleans and enums get their own groups), in order of first appearance. */
export function groupByUnit(list: Prepared[]): UnitGroup[] {
  const groups: UnitGroup[] = []
  list.forEach((p, i) => {
    const key = p.kind === 'bool' ? '\u0000bool' : p.kind === 'enum' ? '\u0000enum' : p.unit ?? ''
    let g = groups.find((x) => x.key === key)
    if (!g) {
      g = { key, label: p.kind === 'bool' ? 'On / off' : p.kind === 'enum' ? 'State' : p.unit ?? 'Value', kind: p.kind, members: [] }
      groups.push(g)
    }
    g.members.push(i)
  })
  return groups
}

// ---- merged rows (table and CSV) ---------------------------------------------------

export interface Merged { ms: number[]; cols: (RawVal | undefined)[][] }

/** Line up all series on their timestamps within [fromMs, toMs). */
export function mergeRows(series: SeriesInput[], fromMs: number, toMs: number): Merged {
  const idx = series.map((s) => lowerBound(s.ms, fromMs))
  const ms: number[] = []
  const cols: (RawVal | undefined)[][] = series.map(() => [])
  for (;;) {
    let next = Infinity
    series.forEach((s, k) => { const i = idx[k]; if (i < s.ms.length && s.ms[i] < toMs && s.ms[i] < next) next = s.ms[i] })
    if (next === Infinity) break
    ms.push(next)
    series.forEach((s, k) => {
      const i = idx[k]
      if (i < s.ms.length && s.ms[i] === next) { cols[k].push(s.val[i]); idx[k]++ } else cols[k].push(undefined)
    })
  }
  return { ms, cols }
}

/**
 * Haxall stores history numbers as 32-bit floats, so 8.83 comes back as 8.829999923706055.
 * Seven significant digits is all a 32-bit float really holds; rounding to that hides the noise.
 */
export const cleanNumber = (v: number): number => (Number.isFinite(v) ? Number(v.toPrecision(7)) : v)

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const csvVal = (v: RawVal | undefined) => (v === undefined || v === null ? '' : csvCell(typeof v === 'number' ? String(cleanNumber(v)) : String(v)))

/** CSV of the merged rows: Timestamp (site time with UTC offset) then one column per series, "name (unit)". */
export function toCsv(series: SeriesInput[], fromMs: number, toMs: number, tz: string): string {
  const m = mergeRows(series, fromMs, toMs)
  const head = ['Timestamp', ...series.map((s) => csvCell(s.unit ? `${s.name} (${s.unit})` : s.name))]
  const lines = [head.join(',')]
  for (let r = 0; r < m.ms.length; r++) lines.push([iso(m.ms[r], tz), ...m.cols.map((c) => csvVal(c[r]))].join(','))
  return lines.join('\r\n') + '\r\n'
}

// ---- site-local clock for the chart axis ---------------------------------------------

/**
 * ECharts draws its time axis in UTC when told to. To show the *site's* clock we shift every timestamp by
 * the site's UTC offset at that moment ("wall clock milliseconds") and shift back for anything we read from the chart.
 */
export function wallClock(tz: string) {
  const cache = new Map<number, number>()
  const off = (ms: number) => {
    const k = Math.floor(ms / 3600000)
    let v = cache.get(k)
    if (v === undefined) { v = offsetMs(ms, tz); cache.set(k, v) }
    return v
  }
  return {
    toWall: (ms: number) => ms + off(ms),
    fromWall: (wall: number) => { const guess = wall - off(wall); return wall - off(guess) },
  }
}

// ---- colours ----------------------------------------------------------------------------

/**
 * Colour slot for each chosen point (0, 1, 2...). A point keeps its slot while others are added or removed;
 * a new point takes the lowest free one. Returns a new map; `prev` is not changed.
 */
export function assignSlots(prev: ReadonlyMap<string, number>, points: string[]): Map<string, number> {
  const next = new Map([...prev].filter(([id]) => points.includes(id)))
  for (const id of points) {
    if (next.has(id)) continue
    const used = new Set(next.values())
    let n = 0
    while (used.has(n)) n++
    next.set(id, n)
  }
  return next
}
