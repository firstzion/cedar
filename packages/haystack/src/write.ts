// Create, change, move and delete records. Everything goes through Haxall's `commit` operation, the same
// path a connector would use. Plain TypeScript so Node can run it directly (tests, scripts) as well as the browser.
import { ApiError, ConflictError, RuleError } from './errors.ts'
import type { HaystackClient } from './client.ts'
import { decodeGrid, isDateTime, isRecordId, isRef, rawMarker, rawNumber, rawRef, refId, str, type HDict, type HVal } from './values.ts'
import { EQUIP_REF_TAGS, templateFor } from './templates.ts'

// ---- raw (wire) values used when writing ------------------------------------------------

export type RawTags = Record<string, unknown>
export const REMOVE = { _kind: 'remove' } as const

/** Record ids and spec names are put into Axon text, so only the characters Haxall really uses are allowed. */
export function safeId(id: string): string {
  if (!isRecordId(id)) throw new RuleError(`Not a valid record id: ${id}`)
  return id
}
export function safeSpec(spec: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_.]*::[A-Za-z][A-Za-z0-9_]*$/.test(spec)) throw new RuleError(`Not a valid spec name: ${spec}`)
  return spec
}
const TAG = /^[a-z][A-Za-z0-9_]*$/
export const isTagName = (s: string) => TAG.test(s)

const rawMod = (rec: HDict) => {
  if (!isDateTime(rec.mod)) throw new RuleError('This record has no modification time, so it cannot be changed safely.')
  return { _kind: 'dateTime', val: rec.mod.iso, tz: rec.mod.tz }
}

async function commit(c: HaystackClient, kind: 'add' | 'update' | 'remove', rows: Record<string, unknown>[]): Promise<HDict[]> {
  if (rows.length === 0) return []
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  try {
    return decodeGrid(await c.op('commit', rows, { cols, meta: { commit: kind } })).rows
  } catch (e) {
    if (e instanceof ApiError && /ConcurrentChangeErr/.test(e.message)) throw new ConflictError()
    throw e
  }
}

// ---- generic record operations ----------------------------------------------------------

/** Add records. Returns them as stored (with their new ids). */
export const addRecords = (c: HaystackClient, recs: RawTags[]) => commit(c, 'add', recs)

/** Change tags of one record. Use REMOVE as a value to delete a tag. Refused if the record changed since `rec` was read. */
export async function updateRecord(c: HaystackClient, rec: HDict, changes: RawTags): Promise<HDict> {
  const id = refId(rec.id)
  if (!id) throw new RuleError('Record has no id')
  if (Object.keys(changes).length === 0) return rec
  return (await commit(c, 'update', [{ id: rawRef(id), mod: rawMod(rec), ...changes }]))[0]
}

/** Change several records in one commit. */
export async function updateRecords(c: HaystackClient, updates: { rec: HDict; changes: RawTags }[]): Promise<HDict[]> {
  const rows = updates.filter((u) => Object.keys(u.changes).length > 0).map((u) => ({ id: rawRef(refId(u.rec.id)!), mod: rawMod(u.rec), ...u.changes }))
  return commit(c, 'update', rows)
}

/** Delete records (and their stored history). */
export async function removeRecords(c: HaystackClient, recs: HDict[]): Promise<void> {
  await commit(c, 'remove', recs.map((r) => ({ id: rawRef(refId(r.id)!), mod: rawMod(r) })))
}

async function readOne(c: HaystackClient, id: string): Promise<HDict> {
  const r = (await c.readByIds([safeId(id)]))[0]
  if (!r) throw new RuleError(`No record with id ${id}`)
  return r
}

// ---- unit check ---------------------------------------------------------------------------

/**
 * Haxall's own spelling of a unit ("h" is "hr", "s" is "sec"), or null if Haxall does not know it. Haxall does not check units when
 * a record is saved, only when history is written, so units are looked up here and the canonical name is what gets stored.
 */
export async function canonicalUnit(c: HaystackClient, unit: string): Promise<string | null> {
  if (!unit || /["\\\s]/.test(unit) || unit.length > 24) return null
  try {
    const g = await c.evalGrid(`parseNumber("1${unit}").unit`)
    const v = g.rows[0]?.val
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

export async function isKnownUnit(c: HaystackClient, unit: string): Promise<boolean> {
  return (await canonicalUnit(c, unit)) !== null
}

// ---- point types ----------------------------------------------------------------------------

export interface PointSpecInfo { id: string; name: string; lib: string }

/** Every concrete point type Haxall knows in the libraries we use (about 400). */
export async function listPointSpecs(c: HaystackClient): Promise<PointSpecInfo[]> {
  const g = await c.evalGrid(
    '[specLib("ph.points"), specLib("ph.points.sugar"), specLib("ph.elec"), specLib("ats")].flatMap(l => specs(l))' +
      '.findAll(s => specIs(s, ph::Point) and not s.has("abstract")).map(s => {id: s->id, name: s->name})',
  )
  return g.rows.flatMap((r) => {
    const id = refId(r.id)
    return id ? [{ id, name: str(r.name) ?? id, lib: id.split('::')[0] }] : []
  })
}

export interface EquipSpecInfo { id: string; name: string }

/** The standard Haystack equipment types (Boiler, Chiller, Pump...), for equipment that has no `ats` template. */
export async function listEquipSpecs(c: HaystackClient): Promise<EquipSpecInfo[]> {
  const g = await c.evalGrid('specs(specLib("ph")).findAll(s => specIs(s, ph::Equip) and not s.has("abstract")).map(s => {id: s->id, name: s->name})')
  return g.rows.flatMap((r) => {
    const id = refId(r.id)
    return id ? [{ id, name: str(r.name) ?? id }] : []
  })
}

// ---- create ------------------------------------------------------------------------------------

export interface NewSite {
  name: string
  areaFt2: number
  tz: string // Haystack zone name such as Los_Angeles
  geoAddr: string
  geoCity?: string
  geoState?: string
  geoPostalCode?: string
  geoCountry?: string
}

export async function createSite(c: HaystackClient, s: NewSite): Promise<HDict> {
  const tags: RawTags = {
    site: rawMarker, dis: s.name, spec: rawRef('ats::AtsSite'), area: rawNumber(s.areaFt2, 'ft²'), tz: s.tz, geoAddr: s.geoAddr,
  }
  for (const k of ['geoCity', 'geoState', 'geoPostalCode', 'geoCountry'] as const) if (s[k]) tags[k] = s[k]
  return (await addRecords(c, [tags]))[0]
}

export interface NewEquipment {
  name: string
  siteId: string
  /** put it inside another piece of equipment (otherwise it sits directly under the site) */
  parentEquipId?: string
  /**
   * An `ats::` spec from EQUIP_TEMPLATES, or any standard type such as ph::Boiler. Leave out only for equipment with
   * no type at all: Haxall then reports a spec problem on every point inside it.
   */
  spec?: string
  /** also create the points the spec requires */
  withPoints?: boolean
  /** links such as airRef or submeterOf: tag name to record id */
  links?: Record<string, string>
  hisMaxItems?: number
}

export interface Created { equip: HDict; points: HDict[] }

export const DEFAULT_HIS_MAX_ITEMS = 20000

export async function createEquipment(c: HaystackClient, e: NewEquipment): Promise<Created> {
  const site = await readOne(c, e.siteId)
  const parent = e.parentEquipId ? await readOne(c, e.parentEquipId) : site
  const parentId = safeId(refId(parent.id)!)
  const tz = str(site.tz)
  let rows: Record<string, unknown>[]

  if (e.spec) {
    const spec = safeSpec(e.spec)
    const g = await c.evalAxon(`instantiate(spec("${spec}"), {graph, useSlotSpec, parent: readById(@${parentId})}).toGrid`)
    rows = g.rows as Record<string, unknown>[]
    const equipRow = rows.find((r) => r.equip)
    if (!equipRow) throw new RuleError(`${spec} does not describe equipment`)
    if (!e.withPoints) rows = [equipRow]
    for (const m of templateFor(spec)?.markers ?? []) equipRow[m] = rawMarker
  } else {
    rows = [{ equip: rawMarker, siteRef: rawRef(e.siteId), ...(e.parentEquipId ? { equipRef: rawRef(e.parentEquipId) } : {}) }]
  }

  const equipRow = rows.find((r) => r.equip)!
  equipRow.navName = e.name
  for (const [tag, id] of Object.entries(e.links ?? {})) equipRow[tag] = rawRef(safeId(id))
  for (const r of rows) {
    if (!r.point) continue
    r.his = rawMarker
    if (tz) r.tz = tz
    r.hisMaxItems = rawNumber(e.hisMaxItems ?? DEFAULT_HIS_MAX_ITEMS)
  }
  const stored = await addRecords(c, rows)
  return { equip: stored.find((r) => r.equip)!, points: stored.filter((r) => r.point) }
}

export interface NewPoint {
  name: string
  equipId: string
  /** a concrete point spec such as ph.points.sugar::MixedAirTempSensor; leave out for a custom point */
  spec?: string
  /** for a custom point, or to override the unit a spec suggests */
  unit?: string
  /** custom points only */
  kind?: 'Number' | 'Bool' | 'Str'
  his?: boolean
  hisMaxItems?: number
}

export async function createPoint(c: HaystackClient, p: NewPoint): Promise<HDict> {
  const equip = await readOne(c, p.equipId)
  const siteId = refId(equip.siteRef)
  if (!siteId) throw new RuleError('That equipment is not inside a site.')
  const site = await readOne(c, siteId)
  let tags: Record<string, unknown>
  if (p.spec) {
    const g = await c.evalAxon(`instantiate(spec("${safeSpec(p.spec)}")).toGrid`)
    tags = { ...(g.rows[0] as Record<string, unknown>) }
  } else {
    if (!p.kind) throw new RuleError('Choose what kind of value the point holds.')
    tags = { point: rawMarker, kind: p.kind }
  }
  if (tags.kind === 'Number') {
    const unit = p.unit ?? (typeof tags.unit === 'string' ? tags.unit : undefined)
    if (!unit) throw new RuleError('A number point needs a unit.')
    const canon = await canonicalUnit(c, unit)
    if (!canon) throw new RuleError(`Haxall does not know the unit “${unit}”.`)
    tags.unit = canon
  }
  tags.navName = p.name
  tags.equipRef = rawRef(p.equipId)
  tags.siteRef = rawRef(siteId)
  if (str(site.tz)) tags.tz = str(site.tz)
  if (p.his !== false) {
    tags.his = rawMarker
    tags.hisMaxItems = rawNumber(p.hisMaxItems ?? DEFAULT_HIS_MAX_ITEMS)
  }
  return (await addRecords(c, [tags]))[0]
}

// ---- what is inside a record (for moving and deleting) -------------------------------------------

export interface Subtree {
  /** the record itself */
  root: HDict
  /** everything below it (child equipment, points, and anything else that belongs to it) */
  below: HDict[]
  equips: HDict[]
  points: HDict[]
}

const kindOfRec = (r: HDict) => (r.site ? 'site' : r.equip ? 'equip' : r.point ? 'point' : 'record')

export async function findSubtree(c: HaystackClient, root: HDict): Promise<Subtree> {
  const id = safeId(refId(root.id)!)
  const below: HDict[] = []
  if (root.site) {
    below.push(...(await c.read(`siteRef==@${id}`)).filter((r) => refId(r.id) !== id))
  } else {
    const seen = new Set<string>([id])
    let frontier = [id]
    while (frontier.length) {
      const next: string[] = []
      for (const parent of frontier) {
        for (const r of await c.read(`equipRef==@${safeId(parent)}`)) {
          const rid = refId(r.id)
          if (!rid || seen.has(rid)) continue
          seen.add(rid)
          below.push(r)
          if (r.equip) next.push(rid)
        }
      }
      frontier = next
    }
  }
  return { root, below, equips: below.filter((r) => r.equip), points: below.filter((r) => r.point) }
}

/** Equipment elsewhere that links to these records (for example VAVs that point at an AHU through airRef). */
export async function findDependents(c: HaystackClient, ids: string[], exclude: Set<string>): Promise<HDict[]> {
  const found = new Map<string, HDict>()
  for (let i = 0; i < ids.length; i += 20) {
    const terms = ids.slice(i, i + 20).flatMap((id) => EQUIP_REF_TAGS.map((t) => `${t}==@${safeId(id)}`))
    for (const r of await c.read(terms.join(' or '))) {
      const rid = refId(r.id)
      if (rid && !exclude.has(rid)) found.set(rid, r)
    }
  }
  return [...found.values()]
}

export interface DeletePlan {
  subtree: Subtree
  /** everything that would be deleted, root first */
  records: HDict[]
  /** records outside the deletion that link to something being deleted */
  dependents: HDict[]
  /** history samples that would be lost (points only) */
  samples: number
}

export async function planDelete(c: HaystackClient, root: HDict): Promise<DeletePlan> {
  const subtree = await findSubtree(c, root)
  const records = [root, ...subtree.below]
  const ids = new Set(records.map((r) => refId(r.id)!))
  const equipIds = records.filter((r) => r.equip).map((r) => refId(r.id)!)
  // for a site too: equipment in other sites can link to equipment in this one (a VAV served by an AHU here, say)
  const dependents = await findDependents(c, equipIds, ids)
  const samples = records.reduce((n, r) => {
    const v = r.hisSize
    return n + (v && typeof v === 'object' && 'val' in v ? Number((v as { val: number }).val) : 0)
  }, 0)
  return { subtree, records, dependents, samples }
}

/** Tags of `rec` that point at any of `ids` (a tag may hold one ref or a list of refs). */
function linksTo(rec: HDict, ids: Set<string>): string[] {
  const out: string[] = []
  for (const [tag, v] of Object.entries(rec)) {
    if (tag === 'id') continue
    const refs: HVal[] = Array.isArray(v) ? v : [v]
    if (refs.some((x) => isRef(x) && ids.has(x.id))) out.push(tag)
  }
  return out
}

export interface DeleteResult { removed: number; cleared: number }

/**
 * Delete a record and everything inside it. With `clearLinks`, other records that point at something being
 * deleted get that link removed first, so they do not show "unresolved reference" problems afterwards.
 */
export async function deleteRecord(c: HaystackClient, root: HDict, opts: { clearLinks: boolean }): Promise<DeleteResult> {
  const plan = await planDelete(c, root)
  const ids = new Set(plan.records.map((r) => refId(r.id)!))
  let cleared = 0
  if (opts.clearLinks && plan.dependents.length) {
    const updates = plan.dependents.map((d) => ({ rec: d, changes: Object.fromEntries(linksTo(d, ids).map((t) => [t, REMOVE])) }))
    cleared = (await updateRecords(c, updates)).length
  }
  // children first, so nothing is briefly left pointing at a parent that no longer exists
  await removeRecords(c, [...plan.records].reverse())
  return { removed: plan.records.length, cleared }
}

// ---- move ----------------------------------------------------------------------------------------------

export interface MoveTarget {
  siteId: string
  /** the equipment to move inside; omit to sit directly under the site (equipment only) */
  equipId?: string
}

/** Where a record may be moved to, as a plain-language problem or null if it is allowed. */
export function moveProblem(rec: HDict, below: HDict[], target: MoveTarget): string | null {
  const id = refId(rec.id)
  if (rec.site) return 'A site cannot be moved.'
  if (rec.point && !target.equipId) return 'A point must be inside a piece of equipment.'
  if (target.equipId) {
    if (target.equipId === id) return 'Something cannot be moved inside itself.'
    if (below.some((r) => refId(r.id) === target.equipId)) return 'Equipment cannot be moved inside something that is inside it.'
  }
  if (!rec.equip && !rec.point) return 'Only equipment and points can be moved.'
  return null
}

/** Move equipment (with everything inside it) or a point. When the site changes, everything moved takes the new siteRef. */
export async function moveRecord(c: HaystackClient, rec: HDict, target: MoveTarget): Promise<number> {
  const below = rec.equip ? (await findSubtree(c, rec)).below : []
  const problem = moveProblem(rec, below, target)
  if (problem) throw new RuleError(problem)
  if (target.equipId) {
    const parent = await readOne(c, target.equipId)
    if (refId(parent.siteRef) !== target.siteId) throw new RuleError('That equipment is in a different site.')
  }
  const siteChanged = refId(rec.siteRef) !== target.siteId
  // points keep their site's time zone (it decides how their history times are shown), so a new site may bring a new one
  const newTz = siteChanged ? str((await readOne(c, target.siteId)).tz) : undefined
  const siteTags = (r: HDict): RawTags => {
    const t: RawTags = { siteRef: rawRef(target.siteId) }
    if (newTz && r.point && str(r.tz) !== newTz) t.tz = newTz
    return t
  }
  const rootChanges: RawTags = siteTags(rec)
  if (target.equipId) rootChanges.equipRef = rawRef(target.equipId)
  else if (rec.equipRef) rootChanges.equipRef = REMOVE
  const updates = [{ rec, changes: rootChanges }]
  if (siteChanged) for (const r of below) updates.push({ rec: r, changes: siteTags(r) })
  return (await updateRecords(c, updates)).length
}

export { kindOfRec }
