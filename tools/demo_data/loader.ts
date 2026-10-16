// Loads the demo site into Haxall through the Haystack API (the same path a connector would use).
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HaystackClient } from '../../packages/haystack/src/client.ts'
import { enableLibs, libStatus, marker, ref } from '../validate/helpers.ts'
import { DAYS, DEMO_TAG, HIS_MAX_ITEMS, SITE, SAMPLES } from './config.ts'
import { EQUIPS, UNITS } from './plan.ts'
import { simulate, seriesKey } from './sim.ts'
import { iso, QUARTER } from '../../packages/haystack/src/timeutil.ts'

type Rec = Record<string, any>
export const FAULTS_PATH = fileURLToPath(new URL('./faults.json', import.meta.url))
const idOf = (r: Rec): string => (r.id as { val: string }).val

export async function removeDemoData(c: HaystackClient): Promise<number> {
  const g = await c.evalAxon(`readAll(${DEMO_TAG}).keepCols(["id"])`)
  if (g.rows.length) await c.evalAxon(`readAll(${DEMO_TAG}).each(r => commit(diff(r, null, {remove})))`)
  return g.rows.length
}

export async function demoDataState(c: HaystackClient): Promise<{ recs: number; pointsMissingHis: number }> {
  const g = await c.evalAxon(`readAll(${DEMO_TAG}).size`)
  const recs = Number((g.rows[0].val as any)?.val ?? g.rows[0].val)
  if (recs === 0) return { recs, pointsMissingHis: 0 }
  const h = await c.evalAxon(
    `readAll(${DEMO_TAG} and point).findAll(p => if (p.missing("hisSize")) true else p->hisSize < 100).size`,
  )
  return { recs, pointsMissingHis: Number((h.rows[0].val as any)?.val ?? h.rows[0].val) }
}

async function commitAdd(c: HaystackClient, recs: Rec[]) {
  const cols = Array.from(new Set(recs.flatMap((r) => Object.keys(r))))
  await c.op('commit', recs, { cols, meta: { commit: 'add' } })
}

export interface LoadOptions { seed: number; nowMs: number; log?: (s: string) => void }

export async function loadDemoData(c: HaystackClient, opts: LoadOptions) {
  const log = opts.log ?? (() => {})
  await enableLibs(c)
  const ls = await libStatus(c)
  if (ls?.libStatus !== 'ok') throw new Error(`ats lib is not ok: ${ls?.err ?? 'not found'} (run: make specs)`)

  const last = Math.floor(opts.nowMs / QUARTER) * QUARTER

  // 1. site
  const siteId = 'demoSite'
  const site: Rec = {
    id: ref(siteId), site: marker, dis: SITE.dis, spec: ref('ats::AtsSite'), [DEMO_TAG]: marker,
    area: { _kind: 'number', val: SITE.areaFt2, unit: 'ft²' }, tz: SITE.tzHaystack,
    geoAddr: SITE.geoAddr, geoCity: SITE.geoCity, geoState: SITE.geoState, geoPostalCode: SITE.geoPostalCode,
    geoCountry: SITE.geoCountry, geoCoord: { _kind: 'coord', lat: SITE.lat, lng: SITE.lng },
    yearBuilt: { _kind: 'number', val: SITE.yearBuilt },
  }
  await commitAdd(c, [site])

  // 2. equipment + points: spec templates from Haxall (instantiate), then fill in what a template cannot know
  const all: Rec[] = []
  const equipIds = new Map<string, string>() // key -> id
  const pointIds = new Map<string, { id: string; unit?: string; kind: string }>() // series key -> info
  for (const e of EQUIPS) {
    const g = await c.evalAxon(`instantiate(spec("${e.spec}"), {graph, useSlotSpec, parent: readById(@${siteId})}).toGrid`)
    const recs = g.rows as Rec[]
    const equip = recs.find((r) => r.equip)!
    equipIds.set(e.key, idOf(equip))
    equip.navName = e.name
    for (const t of Object.keys(e.tags)) equip[t] = marker
    if (e.ahu) equip.airRef = ref(equipIds.get(e.ahu)!)
    if (e.submeterOf) equip.submeterOf = ref(equipIds.get(e.submeterOf)!)
    for (const r of recs) {
      r[DEMO_TAG] = marker
      if (!r.point) continue
      const nav = String(r.navName)
      r.his = marker
      r.tz = SITE.tzHaystack
      r.hisMaxItems = { _kind: 'number', val: HIS_MAX_ITEMS }
      if (r.kind === 'Number') {
        const unit = typeof r.unit === 'string' ? r.unit : UNITS[nav]
        if (!unit) throw new Error(`No unit defined for point "${nav}" (equip ${e.name}). Add it to UNITS in tools/demo_data/plan.ts and give it data in sim.ts.`)
        r.unit = unit
      }
      pointIds.set(seriesKey(e.name, nav), { id: idOf(r), unit: r.unit, kind: r.kind })
    }
    all.push(...recs)
  }
  await commitAdd(c, all)
  log(`committed ${1 + all.length} records (${EQUIPS.length} equips, ${pointIds.size} points)`)

  // 3. validate everything against its spec (including required points); fail loudly
  const v = await c.evalAxon(`readAll(${DEMO_TAG}).validate(null, {graph})`)
  const errs = v.rows.filter((r) => r.level === 'err')
  if (errs.length) {
    await removeDemoData(c)
    const lines = errs.slice(0, 30).map((r) => `  ${(r.subject as any)?.dis ?? (r.subject as any)?.val}: ${r.slot ?? ''} ${r.msg}`)
    throw new Error(`Spec validation failed with ${errs.length} error(s); demo data removed.\n${lines.join('\n')}`)
  }
  log(`spec validation clean (${v.rows.length - errs.length} warnings)`)

  // 4. simulate and write histories
  const sim = simulate(opts.seed, last, SAMPLES)
  const missing = [...pointIds.keys()].filter((k) => !sim.series.has(k))
  if (missing.length) throw new Error(`No simulated data for: ${missing.join(', ')}. Add them to tools/demo_data/sim.ts.`)
  const tzH = SITE.tzHaystack
  const tzI = SITE.tzIana
  const tsCells = sim.tsMs.map((ms) => ({ _kind: 'dateTime', val: iso(ms, tzI), tz: tzH }))
  const keys = [...pointIds.keys()]
  let written = 0
  const writeOne = async (k: string) => {
    const info = pointIds.get(k)!
    const vals = sim.series.get(k)!
    const omit = sim.omit.get(k)
    const rows: Rec[] = []
    for (let i = 0; i < vals.length; i++) {
      if (omit?.has(i)) continue
      const v = vals[i]
      rows.push({ ts: tsCells[i], val: info.kind === 'Number' ? { _kind: 'number', val: v, unit: info.unit } : v })
    }
    await c.op('hisWrite', rows, { cols: ['ts', 'val'], meta: { id: ref(info.id) } })
    written += rows.length
  }
  for (let i = 0; i < keys.length; i += 6) await Promise.all(keys.slice(i, i + 6).map(writeOne))
  log(`wrote ${written} history samples to ${keys.length} points`)

  // 5. fault manifest (ground truth for Phase 2 rules)
  const equipByName = new Map(EQUIPS.map((e) => [e.name, e.key]))
  const manifest = {
    generatedAt: new Date().toISOString(),
    seed: opts.seed,
    tz: tzH,
    intervalMinutes: 15,
    days: DAYS,
    firstSample: iso(sim.tsMs[0], tzI),
    lastSample: iso(sim.tsMs[sim.tsMs.length - 1], tzI),
    sampleCount: SAMPLES,
    faults: sim.faults.map((f) => ({
      id: f.id, name: f.name, kind: f.kind, description: f.description,
      equipRef: equipIds.get(equipByName.get(f.equipName)!),
      equipName: f.equipName,
      points: f.pointNames.map((p) => ({ id: pointIds.get(seriesKey(f.equipName, p))?.id, name: p })),
      start: iso(f.startMs, tzI), end: iso(f.endMs, tzI),
    })),
  }
  writeFileSync(FAULTS_PATH, JSON.stringify(manifest, null, 2) + '\n')
  log(`wrote ${FAULTS_PATH}`)
  return { siteId, equipIds, pointIds, manifest, last }
}
