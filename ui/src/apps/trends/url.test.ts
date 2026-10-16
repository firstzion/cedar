import { describe, expect, it } from 'vitest'
import { MAX_POINTS, readState, writeState } from './url.ts'

const q = (s: string) => new URLSearchParams(s)

describe('Trend Viewer URL state', () => {
  it('reads defaults from an empty address', () => {
    expect(readState(q(''))).toEqual({ points: [], range: 'last7', view: 'chart', layout: 'panels' })
  })
  it('reads points (deduplicated, capped), range, view and layout', () => {
    const many = Array.from({ length: 15 }, (_, i) => `p${i}`).join(',')
    expect(readState(q(`points=${many}`)).points).toHaveLength(MAX_POINTS)
    expect(readState(q('points=a,b,a, ,c')).points).toEqual(['a', 'b', 'c'])
    const s = readState(q('range=2026-08-24_2026-08-28&view=table&layout=overlay'))
    expect(s).toMatchObject({ range: '2026-08-24_2026-08-28', view: 'table', layout: 'overlay' })
  })
  it('ignores a range it does not understand', () => {
    expect(readState(q('range=banana')).range).toBe('last7')
    expect(readState(q('view=3d&layout=weird'))).toMatchObject({ view: 'chart', layout: 'panels' })
  })
  it('writes only non-default values and keeps unrelated parameters', () => {
    const next = writeState(q('foo=1'), { points: ['a', 'b'], range: 'today' })
    expect(next.get('points')).toBe('a,b')
    expect(next.get('range')).toBe('today')
    expect(next.get('foo')).toBe('1')
    expect(next.has('view')).toBe(false)
    const back = writeState(next, { range: 'last7', points: [] })
    expect(back.has('range')).toBe(false)
    expect(back.has('points')).toBe(false)
  })
  it('round trips', () => {
    const s = { points: ['x', 'y'], range: 'last30', view: 'table' as const, layout: 'overlay' as const }
    expect(readState(writeState(q(''), s))).toEqual(s)
  })
  it('accepts the links Site Organization produces', () => {
    expect(readState(q('points=32655ebf-e5b1a371&range=last7')).points).toEqual(['32655ebf-e5b1a371'])
  })
})
