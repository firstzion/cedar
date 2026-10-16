import { describe, expect, it } from 'vitest'
import type { HDict } from '@ssl/haystack'
import { ancestorEquipIds, buildEquipTree, organizationHref, countEquips, trendsHref, kindOf } from './tree.ts'

const eq = (id: string, navName: string, parent?: string): HDict => ({
  id: { type: 'ref', id }, navName, equip: { type: 'marker' },
  ...(parent ? { equipRef: { type: 'ref', id: parent } } : {}),
})

describe('buildEquipTree', () => {
  it('nests equips under their parent equip and sorts naturally', () => {
    const tree = buildEquipTree([eq('c', 'VAV-10', 'a'), eq('b', 'VAV-2', 'a'), eq('a', 'AHU-1'), eq('d', 'Main Meter')])
    expect(tree.map((n) => n.name)).toEqual(['AHU-1', 'Main Meter'])
    expect(tree[0].children.map((n) => n.name)).toEqual(['VAV-2', 'VAV-10'])
    expect(countEquips(tree)).toBe(4)
  })

  it('supports several levels of nesting', () => {
    const tree = buildEquipTree([eq('a', 'Plant'), eq('b', 'Chiller', 'a'), eq('c', 'Pump', 'b')])
    expect(tree[0].children[0].children[0].name).toBe('Pump')
  })

  it('an equip whose parent is not in the list becomes top level', () => {
    expect(buildEquipTree([eq('b', 'Orphan', 'missing')]).map((n) => n.name)).toEqual(['Orphan'])
  })

  it('survives reference loops and self references', () => {
    const tree = buildEquipTree([eq('a', 'A', 'b'), eq('b', 'B', 'a'), eq('s', 'Self', 's')])
    expect(countEquips(tree)).toBe(3)
  })
})

describe('helpers', () => {
  it('ancestorEquipIds walks up the equipRef chain', () => {
    const byId = new Map<string, HDict>([['a', eq('a', 'A')], ['b', eq('b', 'B', 'a')]])
    expect(ancestorEquipIds({ equipRef: { type: 'ref', id: 'b' } }, byId)).toEqual(['b', 'a'])
    expect(ancestorEquipIds({}, byId)).toEqual([])
  })

  it('classifies records', () => {
    expect(kindOf({ site: { type: 'marker' } })).toBe('site')
    expect(kindOf({ equip: { type: 'marker' } })).toBe('equip')
    expect(kindOf({ point: { type: 'marker' } })).toBe('point')
    expect(kindOf({})).toBe('record')
  })

  it('builds links', () => {
    expect(trendsHref(['a', 'b'])).toBe('/trend-viewer?points=a,b&range=last7')
    expect(organizationHref('x', 'point and his')).toBe('/site-organization?sel=x&filter=point+and+his')
    expect(organizationHref('x')).toBe('/site-organization?sel=x')
  })
})
