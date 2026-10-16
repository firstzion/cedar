import { describe, expect, it } from 'vitest'
import { MARKER, REMOVE, type HDict } from '@ssl/haystack'
import { diffTags, draftOf, emptyDraft, rawOf } from './tagdraft.ts'

const rec: HDict = {
  id: { type: 'ref', id: 'a' }, mod: { type: 'dateTime', ms: 0, iso: '2026-01-01T00:00:00Z', tz: 'UTC' },
  navName: 'AHU-1', note: 'hello', area: { type: 'number', val: 100, unit: 'ft²' }, flag: true,
  airRef: { type: 'ref', id: 'x1', dis: 'Other' }, ahu: MARKER, siteRef: { type: 'ref', id: 's' }, hisStart: { type: 'dateTime', ms: 1, iso: '2026-01-01T00:00:00Z', tz: 'UTC' },
}

describe('drafts', () => {
  it('classify values', () => {
    expect(draftOf(MARKER).kind).toBe('marker')
    expect(draftOf('x')).toMatchObject({ kind: 'text', text: 'x' })
    expect(draftOf(true)).toMatchObject({ kind: 'bool', bool: true })
    expect(draftOf({ type: 'number', val: 2.5, unit: 'kW' })).toMatchObject({ kind: 'number', text: '2.5', unit: 'kW' })
    expect(draftOf({ type: 'ref', id: 'r' })).toMatchObject({ kind: 'ref', text: 'r' })
    expect(draftOf({ type: 'dateTime', ms: 0, iso: '', tz: '' }).kind).toBe('fixed')
  })

  it('convert to wire values and reject bad input', () => {
    expect(rawOf({ ...emptyDraft('text'), text: 'a' })).toEqual({ ok: true, value: 'a' })
    expect(rawOf({ ...emptyDraft('bool'), bool: true })).toEqual({ ok: true, value: true })
    expect(rawOf({ ...emptyDraft('number'), text: '12.5', unit: 'kW' })).toEqual({ ok: true, value: { _kind: 'number', val: 12.5, unit: 'kW' } })
    expect(rawOf({ ...emptyDraft('number'), text: '7' })).toEqual({ ok: true, value: { _kind: 'number', val: 7 } })
    expect(rawOf({ ...emptyDraft('number'), text: '' }).ok).toBe(false)
    expect(rawOf({ ...emptyDraft('number'), text: 'abc' }).ok).toBe(false)
    expect(rawOf({ ...emptyDraft('ref'), text: '@abc-1' })).toEqual({ ok: true, value: { _kind: 'ref', val: 'abc-1' } })
    expect(rawOf({ ...emptyDraft('ref'), text: 'a b' }).ok).toBe(false)
    expect(rawOf(emptyDraft('fixed')).ok).toBe(false)
  })
})

describe('diffTags', () => {
  it('sends nothing when nothing changed', () => {
    const edits = { navName: draftOf(rec.navName), note: draftOf(rec.note), area: draftOf(rec.area), ahu: draftOf(rec.ahu) }
    expect(diffTags(rec, edits)).toEqual({ changes: {}, errors: {} })
  })

  it('sends only what changed, including new tags and removals', () => {
    const { changes, errors } = diffTags(rec, {
      navName: { ...draftOf(rec.navName), text: 'AHU-9' },
      note: null,
      area: { ...draftOf(rec.area), text: '250' },
      brandNew: { ...emptyDraft('marker') },
      fresh: { ...emptyDraft('text'), text: 'v' },
    })
    expect(errors).toEqual({})
    expect(changes).toEqual({
      navName: 'AHU-9', note: REMOVE, area: { _kind: 'number', val: 250, unit: 'ft²' },
      brandNew: { _kind: 'marker' }, fresh: 'v',
    })
  })

  it('removing a tag that does not exist does nothing', () => {
    expect(diffTags(rec, { nothingHere: null }).changes).toEqual({})
  })

  it('never touches locked tags (ids, links, runtime values)', () => {
    const { changes } = diffTags(rec, {
      id: { ...emptyDraft('text'), text: 'hijack' }, mod: null, siteRef: null, equipRef: { ...emptyDraft('ref'), text: 'z' }, hisStart: null,
    })
    expect(changes).toEqual({})
  })

  it('reports bad tag names and bad values per tag, without losing the good changes', () => {
    const { changes, errors } = diffTags(rec, {
      'Bad Name': { ...emptyDraft('text'), text: 'x' },
      area: { ...draftOf(rec.area), text: 'lots' },
      note: { ...draftOf(rec.note), text: 'ok' },
    })
    expect(Object.keys(errors).sort()).toEqual(['Bad Name', 'area'])
    expect(changes).toEqual({ note: 'ok' })
  })

  it('a link tag can be re-pointed or cleared', () => {
    expect(diffTags(rec, { airRef: { ...draftOf(rec.airRef), text: 'x2' } }).changes).toEqual({ airRef: { _kind: 'ref', val: 'x2' } })
    expect(diffTags(rec, { airRef: null }).changes).toEqual({ airRef: REMOVE })
  })

  it('an uneditable kind is left alone', () => {
    expect(diffTags(rec, { somethingFixed: emptyDraft('fixed') })).toEqual({ changes: {}, errors: {} })
  })
})
