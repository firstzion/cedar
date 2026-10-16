import { describe, expect, it } from 'vitest'
import { iso } from '@ssl/haystack'
import { customKey, dateToMidnight, isKnownRange, parseCustom, resolveRange } from './ranges.ts'

const TZ = 'America/Los_Angeles'
const NOW = Date.parse('2026-10-16T20:30:00Z') // Friday 13:30 PDT
const at = (r: { startMs: number; endMs: number } | null) => r && [iso(r.startMs, TZ), iso(r.endMs, TZ)]

describe('resolveRange', () => {
  it('today and yesterday are whole local days', () => {
    expect(at(resolveRange('today', NOW, TZ))).toEqual(['2026-10-16T00:00:00-07:00', '2026-10-17T00:00:00-07:00'])
    expect(at(resolveRange('yesterday', NOW, TZ))).toEqual(['2026-10-15T00:00:00-07:00', '2026-10-16T00:00:00-07:00'])
  })

  it('this week starts on Monday', () => {
    expect(at(resolveRange('thisWeek', NOW, TZ))![0]).toBe('2026-10-12T00:00:00-07:00')
    // on a Sunday the week began six days earlier
    const sunday = Date.parse('2026-10-18T20:00:00Z')
    expect(at(resolveRange('thisWeek', sunday, TZ))![0]).toBe('2026-10-12T00:00:00-07:00')
  })

  it('rolling presets end now', () => {
    expect(resolveRange('last7', NOW, TZ)).toEqual({ startMs: NOW - 7 * 86400000, endMs: NOW })
    expect(resolveRange('last30', NOW, TZ)!.endMs).toBe(NOW)
    expect(resolveRange('last90', NOW, TZ)!.startMs).toBe(NOW - 90 * 86400000)
  })

  it('"all" needs the data extent', () => {
    expect(resolveRange('all', NOW, TZ)).toBeNull()
    expect(resolveRange('all', NOW, TZ, { startMs: 1000, endMs: 5000 })).toEqual({ startMs: 1000, endMs: 65000 })
  })

  it('custom ranges include both end days', () => {
    expect(at(resolveRange('2026-08-24_2026-08-27', NOW, TZ))).toEqual(['2026-08-24T00:00:00-07:00', '2026-08-28T00:00:00-07:00'])
    expect(resolveRange('2026-08-27_2026-08-24', NOW, TZ)).toBeNull()
    expect(resolveRange('garbage', NOW, TZ)).toBeNull()
  })

  it('handles daylight saving: the spring-forward day is 23 hours, the fall-back day 25', () => {
    const spring = resolveRange('2026-03-08_2026-03-08', NOW, TZ)!
    expect((spring.endMs - spring.startMs) / 3600000).toBe(23)
    expect(iso(spring.endMs, TZ)).toBe('2026-03-09T00:00:00-07:00')
    const fall = resolveRange('2026-11-01_2026-11-01', NOW, TZ)!
    expect((fall.endMs - fall.startMs) / 3600000).toBe(25)
    expect(iso(fall.startMs, TZ)).toBe('2026-11-01T00:00:00-07:00')
    expect(iso(fall.endMs, TZ)).toBe('2026-11-02T00:00:00-08:00')
  })

  it('"today" on a daylight saving day ends at the next local midnight', () => {
    const r = resolveRange('today', Date.parse('2026-11-01T20:00:00Z'), TZ)!
    expect((r.endMs - r.startMs) / 3600000).toBe(25)
  })
})

describe('helpers', () => {
  it('builds and parses custom keys', () => {
    expect(parseCustom(customKey('2026-01-02', '2026-01-05'))).toEqual({ from: '2026-01-02', to: '2026-01-05' })
    expect(parseCustom('last7')).toBeNull()
    expect(isKnownRange('today')).toBe(true)
    expect(isKnownRange('2026-01-02_2026-01-05')).toBe(true)
    expect(isKnownRange('nonsense')).toBe(false)
  })
  it('date to local midnight', () => {
    expect(iso(dateToMidnight('2026-10-16', TZ), TZ)).toBe('2026-10-16T00:00:00-07:00')
  })
})
