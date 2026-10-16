import { describe, expect, it } from 'vitest'
import { decode, decodeGrid, displayName, formatVal, isRef, MARKER, type HDict, type HRef } from './values.ts'

describe('decode', () => {
  it('unwraps Hayson kinds into plain shapes', () => {
    const d = decode({
      id: { _kind: 'ref', val: 'abc', dis: 'Demo' }, site: { _kind: 'marker' },
      area: { _kind: 'number', val: 50000, unit: 'ft²' }, tz: 'Los_Angeles', ok: true,
      mod: { _kind: 'dateTime', val: '2026-10-16T08:00:00-07:00', tz: 'Los_Angeles' },
    }) as HDict
    expect(d.id).toEqual({ type: 'ref', id: 'abc', dis: 'Demo' })
    expect(d.site).toBe(MARKER)
    expect(d.area).toEqual({ type: 'number', val: 50000, unit: 'ft²' })
    expect(d.tz).toBe('Los_Angeles')
    expect(d.ok).toBe(true)
    expect(d.mod).toMatchObject({ type: 'dateTime', tz: 'Los_Angeles', ms: Date.parse('2026-10-16T08:00:00-07:00') })
  })

  it('handles null, bare numbers, lists, INF and unknown kinds', () => {
    expect(decode(null)).toBeNull()
    expect(decode(3)).toEqual({ type: 'number', val: 3 })
    expect(decode([{ _kind: 'ref', val: 'a' }, 'x'])).toEqual([{ type: 'ref', id: 'a' }, 'x'])
    expect(decode({ _kind: 'number', val: 'INF' })).toEqual({ type: 'number', val: Infinity })
    expect(decode({ _kind: 'coord', lat: 1, lng: 2 })).toEqual({ type: 'coord', lat: 1, lng: 2 })
  })

  it('decodes a grid', () => {
    const g = decodeGrid({ _kind: 'grid', meta: { ver: '3.0' }, cols: [{ name: 'a' }], rows: [{ a: 1 }, { a: { _kind: 'marker' } }] })
    expect(g.cols).toEqual(['a'])
    expect(g.rows).toHaveLength(2)
    expect(g.rows[1].a).toBe(MARKER)
  })
})

describe('formatting', () => {
  it('formats common values for display', () => {
    expect(formatVal({ type: 'number', val: 50000, unit: 'ft²' })).toBe('50000 ft²')
    expect(formatVal({ type: 'number', val: 1.23456 })).toBe('1.235')
    expect(formatVal(MARKER)).toBe('✓')
    expect(formatVal(true)).toBe('true')
    expect(formatVal(null)).toBe('')
    expect(formatVal({ type: 'ref', id: 'x', dis: 'AHU-1' })).toBe('AHU-1')
    expect(formatVal({ type: 'ref', id: 'x' })).toBe('@x')
  })

  it('formats date times in the point/site time zone, not the browser zone', () => {
    const v = decode({ _kind: 'dateTime', val: '2026-10-16T08:00:00-07:00', tz: 'Los_Angeles' })
    expect(formatVal(v)).toContain('8:00')
  })

  it('picks a display name', () => {
    expect(displayName({ dis: 'A', navName: 'B' })).toBe('A')
    expect(displayName({ navName: 'B' })).toBe('B')
    expect(displayName({ id: { type: 'ref', id: 'z', dis: 'Site AHU-1' } as HRef, navName: 'AHU-1' })).toBe('Site AHU-1')
    expect(displayName({ id: { type: 'ref', id: 'zz' } as HRef })).toBe('zz')
    expect(displayName({ id: { type: 'ref', id: 'zz', dis: 'zz' } as HRef, navName: 'AHU-3' })).toBe('AHU-3')
    expect(isRef({ type: 'ref', id: 'a' })).toBe(true)
  })
})
