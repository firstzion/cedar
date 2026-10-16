// The logic behind the tag editor: turn tag values into editable drafts and back, and work out what really changed.
import { isMarker, isNumber, isRef, PROTECTED_TAGS, REMOVE, isTagName, type HDict, type HVal, type RawTags } from '@ssl/haystack'
import { rawMarker, rawNumber, rawRef } from '@ssl/haystack'

export type DraftKind = 'marker' | 'text' | 'number' | 'bool' | 'ref' | 'fixed'

export interface Draft {
  kind: DraftKind
  text: string // text, number (as typed) and ref id
  unit: string // numbers only
  bool: boolean
}

/** Tags that are managed elsewhere: shown, but not edited here (use Move for the links, Delete for removal). */
export const LOCKED_TAGS = [...PROTECTED_TAGS, 'siteRef', 'equipRef']

export function draftOf(v: HVal): Draft {
  if (isMarker(v)) return { kind: 'marker', text: '', unit: '', bool: false }
  if (typeof v === 'string') return { kind: 'text', text: v, unit: '', bool: false }
  if (typeof v === 'boolean') return { kind: 'bool', text: '', unit: '', bool: v }
  if (isNumber(v)) return { kind: 'number', text: String(v.val), unit: v.unit ?? '', bool: false }
  if (isRef(v)) return { kind: 'ref', text: v.id, unit: '', bool: false }
  return { kind: 'fixed', text: '', unit: '', bool: false } // dates, lists, coordinates...: can be removed but not typed
}

export const emptyDraft = (kind: DraftKind): Draft => ({ kind, text: '', unit: '', bool: false })

export type RawResult = { ok: true; value: unknown } | { ok: false; error: string }

export function rawOf(d: Draft): RawResult {
  switch (d.kind) {
    case 'marker': return { ok: true, value: rawMarker }
    case 'bool': return { ok: true, value: d.bool }
    case 'text': return { ok: true, value: d.text }
    case 'number': {
      const n = Number(d.text.trim())
      if (d.text.trim() === '' || !Number.isFinite(n)) return { ok: false, error: 'Enter a number' }
      return { ok: true, value: rawNumber(n, d.unit.trim() || undefined) }
    }
    case 'ref': {
      const id = d.text.trim().replace(/^@/, '')
      if (!/^[A-Za-z0-9_.:~-]+$/.test(id)) return { ok: false, error: 'Enter a record id' }
      return { ok: true, value: rawRef(id) }
    }
    case 'fixed': return { ok: false, error: 'This kind of value cannot be edited here' }
  }
}

const same = (a: Draft, b: Draft) => a.kind === b.kind && a.text === b.text && a.unit === b.unit && a.bool === b.bool

export interface TagEdits {
  /** tag -> new draft, or null to remove the tag */
  edits: Record<string, Draft | null>
}

export interface DiffResult { changes: RawTags; errors: Record<string, string> }

/** What to send to Haxall: only tags that actually changed. Problems are reported per tag. */
export function diffTags(rec: HDict, edits: Record<string, Draft | null>): DiffResult {
  const changes: RawTags = {}
  const errors: Record<string, string> = {}
  for (const [tag, d] of Object.entries(edits)) {
    if (LOCKED_TAGS.includes(tag)) continue
    if (!isTagName(tag)) { errors[tag] = 'Tag names start with a lowercase letter and use letters and digits only'; continue }
    const existed = rec[tag] !== undefined && rec[tag] !== null
    if (d === null) { if (existed) changes[tag] = REMOVE; continue }
    if (existed && same(d, draftOf(rec[tag]))) continue
    if (d.kind === 'fixed') continue
    const r = rawOf(d)
    if (r.ok) changes[tag] = r.value
    else errors[tag] = r.error
  }
  return { changes, errors }
}
