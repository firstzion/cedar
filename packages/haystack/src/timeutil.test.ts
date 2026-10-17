import { describe, expect, it } from 'vitest'
import { iso, offsetMs } from './timeutil.ts'

describe('iso', () => {
  it('writes the zone offset, and Z when it is zero', () => {
    const t = Date.parse('2026-01-15T12:00:00Z')
    expect(iso(t, 'America/Los_Angeles')).toBe('2026-01-15T04:00:00-08:00')
    expect(iso(t, 'UTC')).toBe('2026-01-15T12:00:00Z')
    expect(iso(t, 'Europe/London')).toBe('2026-01-15T12:00:00Z') // London is on UTC in winter
    expect(iso(Date.parse('2026-07-15T12:00:00Z'), 'Europe/London')).toBe('2026-07-15T13:00:00+01:00')
  })

  it('offsetMs reads the same offsets back', () => {
    expect(offsetMs(Date.parse('2026-01-15T12:00:00Z'), 'UTC')).toBe(0)
    expect(offsetMs(Date.parse('2026-01-15T12:00:00Z'), 'America/Los_Angeles')).toBe(-8 * 3600000)
  })
})
