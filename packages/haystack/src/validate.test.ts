import { describe, expect, it } from 'vitest'
import { conformanceOf, errorCounts, friendlyMessage, humanize, missingPointSpec, parseValidation } from './validate.ts'
import { decodeGrid } from './values.ts'

const row = (o: Record<string, unknown>) => ({
  subject: { _kind: 'ref', val: 'r1' }, level: 'err', rule: { _kind: 'ref', val: 'sys::missingSlot' }, msg: 'x', ...o,
})
const items = (rows: Record<string, unknown>[]) =>
  parseValidation(decodeGrid({ _kind: 'grid', meta: {}, cols: [], rows }).rows)
const rec = (spec?: string) => ({ id: { type: 'ref', id: 'r1' } as const, ...(spec ? { spec: { type: 'ref', id: spec } as const } : {}) })

describe('friendlyMessage', () => {
  it('rewrites the common Haxall messages', () => {
    expect(friendlyMessage("Missing required slot 'siteRef'")).toBe('Missing required tag: siteRef')
    expect(friendlyMessage('Missing required Point: ph.points.sugar::MixedAirTempSensor')).toBe(
      'Missing required point: Mixed Air Temp Sensor (ph.points.sugar::MixedAirTempSensor)')
    expect(friendlyMessage("Missing required choice 'ph::Temp'")).toContain('ph::Temp')
    expect(friendlyMessage('Unresolved ref @abc')).toContain('does not exist')
    expect(friendlyMessage("Unknown 'spec' ref: ats::Nope")).toContain('ats::Nope')
    expect(friendlyMessage("Missing 'spec' ref tag", 'sys::missingSpecRef')).toContain('No spec')
    expect(friendlyMessage('Something else entirely')).toBe('Something else entirely')
  })
  it('humanizes camel case', () => expect(humanize('DischargeAirTempSp')).toBe('Discharge Air Temp Sp'))
})

describe('conformance', () => {
  it('fits when there are no errors, warnings are kept', () => {
    const c = conformanceOf(rec('ats::AtsVav'), items([row({ level: 'warn', msg: 'careful' })]))
    expect(c).toMatchObject({ status: 'fits', spec: 'ats::AtsVav' })
    expect(c.status === 'fits' && c.warnings).toHaveLength(1)
  })
  it('issues lists only errors with plain text', () => {
    const c = conformanceOf(rec('ats::AtsVav'), items([row({ msg: "Missing required slot 'tz'", slot: 'tz' }), row({ level: 'warn' })]))
    expect(c).toMatchObject({ status: 'issues', items: [{ text: 'Missing required tag: tz' }] })
    expect(c.status === 'issues' && c.items).toHaveLength(1)
  })
  it('no spec tag -> nospec', () => {
    expect(conformanceOf(rec(), []).status).toBe('nospec')
    const c = conformanceOf(rec('x::Y'), items([row({ rule: { _kind: 'ref', val: 'sys::missingSpecRef' }, msg: "Missing 'spec' ref tag" })]))
    expect(c.status).toBe('nospec')
  })
  it('counts errors per subject', () => {
    const m = errorCounts(items([row({}), row({}), row({ subject: { _kind: 'ref', val: 'r2' } }), row({ level: 'warn' })]))
    expect(m.get('r1')).toBe(2)
    expect(m.get('r2')).toBe(1)
  })
})

describe('missingPointSpec', () => {
  it('reads the point spec from Haxall\'s message, not from the wording shown to people', () => {
    expect(missingPointSpec({ msg: 'Missing required Point: ph.points.sugar::MixedAirTempSensor' })).toBe('ph.points.sugar::MixedAirTempSensor')
    expect(missingPointSpec({ msg: 'Missing required Point: ats::AtsOccupiedSp' })).toBe('ats::AtsOccupiedSp')
    expect(missingPointSpec({ msg: "Missing required slot 'tz'" })).toBeUndefined()
  })
})
