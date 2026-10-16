import { describe, expect, it } from 'vitest'
import { cleanNumber, decimate, findGaps, groupByUnit, kindOfValues, medianInterval, mergeRows, prepare, toCsv, wallClock, type SeriesInput } from './series.ts'

const Q = 15 * 60000
const T0 = Date.parse('2026-10-01T00:00:00Z')
const grid = (n: number, from = 0) => Array.from({ length: n }, (_, i) => T0 + (from + i) * Q)
const num = (id: string, ms: number[], f: (i: number) => number, unit = '°F'): SeriesInput => ({ id, name: id, unit, kind: 'number', ms, val: ms.map((_, i) => f(i)) })

describe('gaps', () => {
  it('median interval and gap detection', () => {
    const ms = [...grid(10), ...grid(10, 110)] // 100 samples (25 h) missing in the middle
    expect(medianInterval(ms)).toBe(Q)
    const gaps = findGaps(ms, Q * 2.5)
    expect(gaps).toEqual([{ startMs: T0 + 9 * Q, endMs: T0 + 110 * Q }])
  })
  it('a slightly late sample is not a gap', () => {
    expect(findGaps([T0, T0 + Q, T0 + 2 * Q + 5 * 60000, T0 + 3 * Q + 5 * 60000], Q * 2.5)).toEqual([])
  })
})

describe('prepare', () => {
  it('maps booleans to 0/1 and enums to levels, unknown to NaN', () => {
    const b = prepare({ id: 'b', name: 'b', kind: 'bool', ms: grid(3), val: [true, false, null] })
    expect(b.y.slice(0, 2)).toEqual([1, 0])
    expect(Number.isNaN(b.y[2])).toBe(true)
    const e = prepare({ id: 'e', name: 'e', kind: 'enum', ms: grid(3), val: ['auto', 'hand', 'auto'] })
    expect(e.levels).toEqual(['auto', 'hand'])
    expect(e.y).toEqual([0, 1, 0])
  })
  it('detects the kind from the values', () => {
    expect(kindOfValues([null, true])).toBe('bool')
    expect(kindOfValues(['a'])).toBe('enum')
    expect(kindOfValues([1])).toBe('number')
  })
})

describe('decimate', () => {
  const n = 8640
  const ms = grid(n)
  const flat = num('f', ms, () => 70)

  it('returns every sample when there are few', () => {
    const p = prepare(num('s', grid(100), (i) => i))
    expect(decimate(p, T0, T0 + 100 * Q, 200)).toHaveLength(100)
  })

  it('reduces many samples to a few thousand points', () => {
    const pts = decimate(prepare(flat), ms[0], ms[n - 1], 500)
    expect(pts.length).toBeLessThanOrEqual(500 * 4 + 4)
    expect(pts.length).toBeGreaterThan(100)
  })

  it('keeps a single-sample spike that averaging would hide', () => {
    const s = num('s', ms, (i) => (i === 4321 ? 400 : 70))
    const pts = decimate(prepare(s), ms[0], ms[n - 1], 300)
    expect(Math.max(...pts.map((p) => p[1] ?? -Infinity))).toBe(400)
  })

  it('keeps a flatline flat and a step as a step', () => {
    const pts = decimate(prepare(flat), ms[0], ms[n - 1], 300)
    expect(new Set(pts.map((p) => p[1]))).toEqual(new Set([70]))
    const step = num('t', ms, (i) => (i < 4000 ? 0 : 1))
    const sp = decimate(prepare(step), ms[0], ms[n - 1], 300)
    expect(new Set(sp.map((p) => p[1]))).toEqual(new Set([0, 1]))
  })

  it('output stays in time order', () => {
    const s = num('s', ms, (i) => Math.sin(i / 20) * 10)
    const pts = decimate(prepare(s), ms[0], ms[n - 1], 400)
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThanOrEqual(pts[i - 1][0])
  })

  it('breaks the line at a gap instead of joining across it (few and many samples)', () => {
    const all = [...grid(4000), ...grid(4000, 4096)] // 96 samples (24 h) missing
    const s = num('g', all, () => 50)
    const p = prepare(s)
    expect(p.gaps).toHaveLength(1)
    for (const buckets of [3000, 200]) {
      const pts = decimate(p, all[0], all[all.length - 1], buckets)
      const nulls = pts.filter((q) => q[1] === null)
      expect(nulls).toHaveLength(1)
      expect(nulls[0][0]).toBeGreaterThanOrEqual(T0 + 3999 * Q)
      expect(nulls[0][0]).toBeLessThan(T0 + 4096 * Q)
    }
  })

  it('zooming re-decimates from the full data: a narrow window shows every sample', () => {
    const s = num('s', ms, (i) => i % 7)
    const pts = decimate(prepare(s), ms[1000], ms[1099], 500)
    expect(pts.length).toBeGreaterThanOrEqual(100)
  })

  it('NaN values break the line', () => {
    const s: SeriesInput = { id: 'n', name: 'n', unit: '°F', kind: 'number', ms: grid(5), val: [1, 2, null, 4, 5] }
    const pts = decimate(prepare(s), T0, T0 + 5 * Q, 100)
    expect(pts.map((q) => q[1])).toEqual([1, 2, null, 4, 5])
  })
})

describe('units', () => {
  it('one group per unit, booleans and enums separate, in first-seen order', () => {
    const list = [
      prepare(num('a', grid(3), () => 1, '°F')),
      prepare(num('b', grid(3), () => 1, '%')),
      prepare({ id: 'c', name: 'c', kind: 'bool', ms: grid(3), val: [true, true, false] }),
      prepare(num('d', grid(3), () => 1, '°F')),
    ]
    const g = groupByUnit(list)
    expect(g.map((x) => x.label)).toEqual(['°F', '%', 'On / off'])
    expect(g[0].members).toEqual([0, 3])
  })
})

describe('merge and CSV', () => {
  const a = num('Zone Temp', grid(3), (i) => 70 + i)
  const b: SeriesInput = { id: 'b', name: 'Fan, status', kind: 'bool', ms: [T0 + Q, T0 + 2 * Q, T0 + 3 * Q], val: [true, false, true] }

  it('aligns series on the union of timestamps and leaves blanks', () => {
    const m = mergeRows([a, b], T0, T0 + 10 * Q)
    expect(m.ms).toHaveLength(4)
    expect(m.cols[0]).toEqual([70, 71, 72, undefined])
    expect(m.cols[1]).toEqual([undefined, true, false, true])
  })

  it('only includes rows inside the window (end exclusive)', () => {
    expect(mergeRows([a], T0 + Q, T0 + 2 * Q).ms).toEqual([T0 + Q])
  })

  it('writes CSV with site-time timestamps, units, quoting and blanks', () => {
    const csv = toCsv([a, b], T0, T0 + 10 * Q, 'America/Los_Angeles').split('\r\n')
    expect(csv[0]).toBe('Timestamp,Zone Temp (°F),"Fan, status"')
    expect(csv[1]).toBe('2026-09-30T17:00:00-07:00,70,')
    expect(csv[2]).toBe('2026-09-30T17:15:00-07:00,71,true')
    expect(csv[4]).toBe('2026-09-30T17:45:00-07:00,,true')
    expect(csv[csv.length - 1]).toBe('')
  })
})

describe('wallClock', () => {
  const w = wallClock('America/Los_Angeles')
  it('shifts to the site clock and back, across a daylight saving change', () => {
    for (const t of [Date.parse('2026-10-16T20:00:00Z'), Date.parse('2026-11-01T08:30:00Z'), Date.parse('2026-11-01T12:00:00Z'), Date.parse('2026-03-08T11:00:00Z')]) {
      expect(w.fromWall(w.toWall(t))).toBe(t)
    }
    expect(new Date(w.toWall(Date.parse('2026-10-16T20:00:00Z'))).toISOString()).toBe('2026-10-16T13:00:00.000Z') // 13:00 on the site clock
  })
})

describe('cleanNumber', () => {
  it('hides 32-bit float noise but keeps real precision', () => {
    expect(cleanNumber(Math.fround(8.83))).toBe(8.83)
    expect(cleanNumber(Math.fround(182959.98))).toBe(182960)
    expect(cleanNumber(72.4)).toBe(72.4)
    expect(cleanNumber(-40)).toBe(-40)
    expect(cleanNumber(0)).toBe(0)
    expect(cleanNumber(Infinity)).toBe(Infinity)
  })
  it('CSV uses it', () => {
    const s: SeriesInput = { id: 'a', name: 'a', kind: 'number', ms: [T0], val: [Math.fround(8.83)] }
    expect(toCsv([s], T0, T0 + Q, 'UTC').split('\r\n')[1]).toBe('2026-10-01T00:00:00+00:00,8.83')
  })
})
