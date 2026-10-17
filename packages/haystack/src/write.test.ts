import { describe, expect, it, vi } from 'vitest'
import type { HaystackClient } from './client.ts'
import { MARKER, refId, type HDict } from './values.ts'
import { moveRecord, planDelete } from './write.ts'

const ref = (id: string) => ({ type: 'ref' as const, id })
const mod = { type: 'dateTime' as const, ms: 0, iso: '2026-10-16T10:00:00-07:00', tz: 'Los_Angeles' }

/**
 * A stand-in for Haxall holding a few records. `read` understands the filters write.ts sends
 * ("tag==@id", joined with "or"); `commit` is recorded and echoes the rows back.
 */
function fakeHaxall(recs: HDict[]) {
  const commits: { kind: unknown; rows: Record<string, unknown>[] }[] = []
  const matches = (r: HDict, filter: string) => filter.split(' or ').some((term) => {
    const [tag, id] = term.split('==@')
    return refId(r[tag]) === id
  })
  const c = {
    read: vi.fn(async (filter: string) => recs.filter((r) => matches(r, filter))),
    readByIds: vi.fn(async (ids: string[]) => recs.filter((r) => ids.includes(refId(r.id)!))),
    op: vi.fn(async (_name: string, rows: Record<string, unknown>[], opts: { meta?: Record<string, unknown> }) => {
      commits.push({ kind: opts.meta?.commit, rows })
      return { _kind: 'grid', meta: {}, cols: [], rows }
    }),
  }
  return { c: c as unknown as HaystackClient, commits }
}

const siteLA: HDict = { id: ref('sA'), site: MARKER, tz: 'Los_Angeles', mod }
const siteNY: HDict = { id: ref('sB'), site: MARKER, tz: 'New_York', mod }
const ahu: HDict = { id: ref('ahu'), equip: MARKER, siteRef: ref('sA'), mod }
const pt: HDict = { id: ref('p'), point: MARKER, his: MARKER, tz: 'Los_Angeles', equipRef: ref('ahu'), siteRef: ref('sA'), mod }

describe('moveRecord', () => {
  it('moving equipment to a site in another time zone gives its points that zone', async () => {
    const { c, commits } = fakeHaxall([siteLA, siteNY, ahu, pt])
    expect(await moveRecord(c, ahu, { siteId: 'sB' })).toBe(2)
    const rows = commits[0].rows
    const equipRow = rows.find((r) => (r.id as { val: string }).val === 'ahu')!
    const pointRow = rows.find((r) => (r.id as { val: string }).val === 'p')!
    expect(equipRow.siteRef).toEqual({ _kind: 'ref', val: 'sB' })
    expect(equipRow.tz).toBeUndefined() // equipment has no tz of its own
    expect(pointRow.siteRef).toEqual({ _kind: 'ref', val: 'sB' })
    expect(pointRow.tz).toBe('New_York')
  })

  it('a point moved to equipment in another site takes that site\'s zone', async () => {
    const vavNY: HDict = { id: ref('vav'), equip: MARKER, siteRef: ref('sB'), mod }
    const { c, commits } = fakeHaxall([siteLA, siteNY, ahu, pt, vavNY])
    await moveRecord(c, pt, { siteId: 'sB', equipId: 'vav' })
    expect(commits[0].rows[0]).toMatchObject({ tz: 'New_York', equipRef: { _kind: 'ref', val: 'vav' } })
  })

  it('moving inside the same site leaves the time zone alone', async () => {
    const other: HDict = { id: ref('other'), equip: MARKER, siteRef: ref('sA'), mod }
    const { c, commits } = fakeHaxall([siteLA, ahu, pt, other])
    await moveRecord(c, pt, { siteId: 'sA', equipId: 'other' })
    expect(commits[0].rows[0].tz).toBeUndefined()
  })
})

describe('planDelete', () => {
  it('deleting a site lists equipment in other sites that links into it', async () => {
    const vavNY: HDict = { id: ref('vav'), equip: MARKER, siteRef: ref('sB'), airRef: ref('ahu'), mod }
    const { c } = fakeHaxall([siteLA, siteNY, ahu, pt, vavNY])
    const plan = await planDelete(c, siteLA)
    expect(plan.records.map((r) => refId(r.id))).toEqual(['sA', 'ahu', 'p'])
    expect(plan.dependents.map((r) => refId(r.id))).toEqual(['vav'])
  })
})
