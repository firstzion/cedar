// Live tests of creating, editing, moving and deleting records (needs a running Haxall).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  HaystackClient, ConflictError, RuleError, REMOVE, rawNumber, refId, str, isRef,
  createSite, createEquipment, createPoint, updateRecord, moveRecord, moveProblem, planDelete, deleteRecord, findSubtree,
  isKnownUnit, canonicalUnit, listPointSpecs, listEquipSpecs, addRecords, rawMarker, rawRef, type HDict,
} from '../../packages/haystack/src/index.ts'

import { COMMON_UNITS } from '../../ui/src/apps/organization/edit/units.ts'
const origin = `http://localhost:${process.env.HAXALL_PORT ?? '8080'}`
const SITE_A = 'SSL CRUD Test Site A'
const SITE_B = 'SSL CRUD Test Site B'
let c: HaystackClient

const id = (r: HDict) => refId(r.id)!
const fresh = async (r: HDict) => (await c.readByIds([id(r)]))[0]
const problems = async (r: HDict) => (await c.validateRec(id(r))).filter((i) => i.level === 'err').map((i) => i.text)

async function cleanup() {
  for (const name of [SITE_A, SITE_B]) {
    for (const s of await c.read(`site and dis=="${name}"`)) await deleteRecord(c, s, { clearLinks: false })
  }
}

before(async () => {
  c = new HaystackClient(origin)
  await c.login(process.env.HAXALL_SU_USERNAME!, process.env.HAXALL_SU_PASSWORD!)
  await cleanup()
})
after(async () => { await cleanup() })

const newSite = (name: string) => createSite(c, { name, areaFt2: 12000, tz: 'Los_Angeles', geoAddr: '1 Test Way', geoCity: 'Seattle', geoState: 'WA' })

test('every unit offered as a suggestion is one Haxall knows, spelled the way Haxall spells it', async () => {
  for (const u of COMMON_UNITS) assert.equal(await canonicalUnit(c, u), u, u)
})

test('aliases are turned into Haxall\'s own spelling', async () => {
  assert.equal(await canonicalUnit(c, 'h'), 'hr')
  assert.equal(await canonicalUnit(c, 's'), 'sec')
  assert.equal(await canonicalUnit(c, 'nonsense'), null)
  assert.equal(await canonicalUnit(c, 'kW "x'), null)
})

test('units: known units pass, nonsense and injection attempts do not', async () => {
  for (const u of ['°F', 'kW', '%', 'cfm', 'inH₂O', 'kWh']) assert.equal(await isKnownUnit(c, u), true, u)
  for (const u of ['', 'notAUnit', '"°F"', '1°F)', 'kW"; commit(']) assert.equal(await isKnownUnit(c, u), false, u)
})

test('equipment types: the standard ones are offered', async () => {
  const specs = await listEquipSpecs(c)
  assert.ok(specs.length > 60)
  for (const n of ['Boiler', 'Chiller', 'Pump', 'Ahu', 'ElecMeter']) assert.ok(specs.some((s) => s.id === `ph::${n}`), n)
})

test('point types: Haxall offers hundreds, including the ones we use', async () => {
  const specs = await listPointSpecs(c)
  assert.ok(specs.length > 300, `only ${specs.length}`)
  assert.ok(specs.some((s) => s.id === 'ph.points.sugar::MixedAirTempSensor'))
  assert.ok(specs.some((s) => s.id === 'ats::AtsOccupiedSp'))
  assert.ok(specs.every((s) => s.id.includes('::')))
})

test('create a site: it fits ats::AtsSite', async () => {
  const s = await newSite(SITE_A)
  assert.equal(str(s.dis), SITE_A)
  assert.equal(refId(s.spec), 'ats::AtsSite')
  assert.deepEqual(await problems(s), [])
})

test('create an AHU from its spec: required points come with it and everything fits', async () => {
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  const { equip, points } = await createEquipment(c, { name: 'Test AHU', siteId: id(site), spec: 'ats::AtsAhu', withPoints: true })
  assert.equal(points.length, 14)
  assert.equal(refId(equip.siteRef), id(site))
  assert.ok(equip.chilledWaterCooling && equip.hotWaterHeating && equip.vavZone, 'choice markers from the template')
  assert.ok(points.every((p) => p.his && str(p.tz) === 'Los_Angeles' && refId(p.equipRef) === id(equip) && refId(p.siteRef) === id(site)))
  assert.ok(points.filter((p) => str(p.kind) === 'Number').every((p) => typeof p.unit === 'string'))
  assert.deepEqual(await problems(equip), [])
  for (const p of points.slice(0, 3)) assert.deepEqual(await problems(p), [], str(p.navName))
})

test('VAV linked to an AHU; submeter needs its parent meter', async () => {
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  const [ahu] = await c.read(`ahu and siteRef==@${id(site)}`)
  const vav = await createEquipment(c, { name: 'Test VAV', siteId: id(site), spec: 'ats::AtsVav', withPoints: true, links: { airRef: id(ahu) } })
  assert.equal(vav.points.length, 9)
  assert.equal(refId(vav.equip.airRef), id(ahu))
  assert.deepEqual(await problems(vav.equip), [])

  const main = await createEquipment(c, { name: 'Test Main Meter', siteId: id(site), spec: 'ats::AtsElecMeter', withPoints: true })
  assert.deepEqual(await problems(main.equip), [])
  const noLink = await createEquipment(c, { name: 'Test Sub', siteId: id(site), spec: 'ats::AtsElecSubmeter', withPoints: true })
  assert.ok((await problems(noLink.equip)).some((p) => p.includes('submeterOf')))
  const sub = await updateRecord(c, noLink.equip, { submeterOf: rawRef(id(main.equip)) })
  assert.deepEqual(await problems(sub), [])
})

test('equipment without points shows exactly what is missing; other types come from ph; typeless equipment has no spec', async () => {
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  const bare = await createEquipment(c, { name: 'Bare AHU', siteId: id(site), spec: 'ats::AtsAhu', withPoints: false })
  assert.equal(bare.points.length, 0)
  assert.equal((await problems(bare.equip)).length, 14)
  const pump = await createEquipment(c, { name: 'Plain thing', siteId: id(site), spec: 'ph::Pump' })
  assert.equal(refId(pump.equip.spec), 'ph::Pump')
  assert.ok(pump.equip.pump && !pump.equip.equipRef)
  assert.deepEqual(await problems(pump.equip), [])
  const typeless = await createEquipment(c, { name: 'Typeless', siteId: id(site) })
  assert.equal(typeless.equip.spec, undefined)
  assert.ok(typeless.equip.equip)
})

test('nested equipment gets equipRef and the same site', async () => {
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  const [ahu] = await c.read(`ahu and navName=="Test AHU" and siteRef==@${id(site)}`)
  const inner = await createEquipment(c, { name: 'Inside AHU', siteId: id(site), parentEquipId: id(ahu) })
  assert.equal(refId(inner.equip.equipRef), id(ahu))
  assert.equal(refId(inner.equip.siteRef), id(site))
})

test('create points: from a spec (with unit override) and custom ones', async () => {
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  const [eq] = await c.read(`equip and navName=="Plain thing" and siteRef==@${id(site)}`)
  const mixed = await createPoint(c, { name: 'Mixed temp', equipId: id(eq), spec: 'ph.points.sugar::MixedAirTempSensor' })
  assert.equal(str(mixed.unit), '°F')
  assert.ok(mixed.his && mixed.hisMaxItems)
  assert.deepEqual(await problems(mixed), [])
  const celsius = await createPoint(c, { name: 'Mixed temp C', equipId: id(eq), spec: 'ph.points.sugar::MixedAirTempSensor', unit: '°C' })
  assert.equal(str(celsius.unit), '°C')

  const custom = await createPoint(c, { name: 'Custom number', equipId: id(eq), kind: 'Number', unit: 'kW' })
  assert.equal(str(custom.kind), 'Number')
  const flag = await createPoint(c, { name: 'Custom flag', equipId: id(eq), kind: 'Bool', his: false })
  assert.ok(!flag.his && !flag.unit)
  await assert.rejects(createPoint(c, { name: 'No unit', equipId: id(eq), kind: 'Number' }), RuleError)
  await assert.rejects(createPoint(c, { name: 'Bad unit', equipId: id(eq), kind: 'Number', unit: 'furlongs' }), RuleError)
  const hours = await createPoint(c, { name: 'Runtime', equipId: id(eq), kind: 'Number', unit: 'h' })
  assert.equal(str(hours.unit), 'hr')
  await assert.rejects(createPoint(c, { name: 'No kind', equipId: id(eq) }), RuleError)
})

test('history can be written to a new point (unit and tz are right)', async () => {
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  const [eq] = await c.read(`equip and navName=="Plain thing" and siteRef==@${id(site)}`)
  const p = await createPoint(c, { name: 'History test', equipId: id(eq), spec: 'ph.points.sugar::MixedAirTempSensor' })
  const t0 = Date.now() - 3600000
  const rows = [0, 1, 2].map((i) => ({ ts: { _kind: 'dateTime', val: new Date(t0 + i * 900000).toISOString().replace('.000Z', 'Z'), tz: 'Los_Angeles' }, val: rawNumber(70 + i, '°F') }))
  await c.op('hisWrite', rows, { cols: ['ts', 'val'], meta: { id: rawRef(id(p)) } })
  assert.equal((await c.hisSeries(id(p), t0 - 1000, Date.now())).ms.length, 3)
})

test('rename, change and remove tags; a stale edit is refused', async () => {
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  const [eq] = await c.read(`equip and navName=="Plain thing" and siteRef==@${id(site)}`)
  const renamed = await updateRecord(c, eq, { navName: 'Renamed thing', note: 'hello', flag: rawMarker })
  assert.equal(str(renamed.navName), 'Renamed thing')
  assert.equal(str(renamed.note), 'hello')
  // editing from the old copy must fail, not overwrite
  await assert.rejects(updateRecord(c, eq, { navName: 'Stale write' }), ConflictError)
  assert.equal(str((await fresh(eq)).navName), 'Renamed thing')
  const cleaned = await updateRecord(c, renamed, { note: REMOVE, flag: REMOVE })
  assert.ok(!cleaned.note && !cleaned.flag)
  assert.equal((await updateRecord(c, cleaned, {})).mod, cleaned.mod, 'no changes means no write')
})

test('move: rules, equipment into equipment, a point to another equipment', async () => {
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  const sid = id(site)
  const [ahu] = await c.read(`ahu and navName=="Test AHU" and siteRef==@${sid}`)
  const [vav] = await c.read(`vav and navName=="Test VAV" and siteRef==@${sid}`)
  const [inner] = await c.read(`equip and navName=="Inside AHU" and siteRef==@${sid}`)
  // rules
  assert.match(moveProblem(site, [], { siteId: sid }) ?? '', /site cannot be moved/)
  const sub = await findSubtree(c, ahu)
  assert.match(moveProblem(ahu, sub.below, { siteId: sid, equipId: id(ahu) }) ?? '', /inside itself/)
  assert.match(moveProblem(ahu, sub.below, { siteId: sid, equipId: id(inner) }) ?? '', /inside it/)
  await assert.rejects(moveRecord(c, ahu, { siteId: sid, equipId: id(inner) }), RuleError)
  // VAV goes inside the AHU
  await moveRecord(c, vav, { siteId: sid, equipId: id(ahu) })
  const moved = await fresh(vav)
  assert.equal(refId(moved.equipRef), id(ahu))
  // and back to the top level of the site
  await moveRecord(c, moved, { siteId: sid })
  assert.ok(!(await fresh(vav)).equipRef)
  // a point to another equipment
  const [pt] = await c.read(`point and equipRef==@${id(vav)} and navName=="ZoneAirTempSensor"`)
  await moveRecord(c, pt, { siteId: sid, equipId: id(inner) })
  assert.equal(refId((await fresh(pt)).equipRef), id(inner))
  await assert.rejects(moveRecord(c, await fresh(pt), { siteId: sid }), RuleError)
})

test('move equipment to another site: everything inside takes the new site', async () => {
  const a = (await c.read(`site and dis=="${SITE_A}"`))[0]
  const b = await newSite(SITE_B)
  const [ahu] = await c.read(`ahu and navName=="Test AHU" and siteRef==@${id(a)}`)
  const before = await findSubtree(c, ahu)
  assert.ok(before.points.length >= 14)
  const n = await moveRecord(c, ahu, { siteId: id(b) })
  assert.equal(n, 1 + before.below.length)
  const after = await findSubtree(c, await fresh(ahu))
  assert.equal(after.below.length, before.below.length)
  assert.ok([after.root, ...after.below].every((r) => refId(r.siteRef) === id(b)))
  assert.equal((await c.read(`siteRef==@${id(a)} and navName=="Test AHU"`)).length, 0)
})

test('delete a point; delete equipment with its points and clean the links that pointed at it', async () => {
  const b = (await c.read(`site and dis=="${SITE_B}"`))[0]
  const a = (await c.read(`site and dis=="${SITE_A}"`))[0]
  const [ahu] = await c.read(`ahu and siteRef==@${id(b)}`)
  // a VAV in site A that points at that AHU
  const vav = await createEquipment(c, { name: 'Linked VAV', siteId: id(a), spec: 'ats::AtsVav', withPoints: false, links: { airRef: id(ahu) } })
  const plan = await planDelete(c, ahu)
  assert.ok(plan.records.length >= 15)
  // 'Test VAV' (made earlier and left in site A when its AHU moved away) also links to this AHU
  assert.deepEqual(plan.dependents.map((d) => str(d.navName)).sort(), ['Linked VAV', 'Test VAV'])
  assert.ok(plan.samples >= 0)

  const res = await deleteRecord(c, ahu, { clearLinks: true })
  assert.equal(res.removed, plan.records.length)
  assert.equal(res.cleared, 2)
  assert.equal((await c.readByIds([id(ahu)])).length, 0)
  assert.equal((await c.read(`equipRef==@${id(ahu)}`)).length, 0, 'its points are gone too')
  assert.ok(!(await fresh(vav.equip)).airRef, 'the dangling link was removed')

  // a single point
  const [eq] = await c.read(`equip and navName=="Renamed thing" and siteRef==@${id(a)}`)
  const [one] = await c.read(`point and navName=="Custom flag" and equipRef==@${id(eq)}`)
  assert.equal((await deleteRecord(c, one, { clearLinks: true })).removed, 1)
})

test('without clearing links, the dependent shows a spec problem (honest, not hidden)', async () => {
  const a = (await c.read(`site and dis=="${SITE_A}"`))[0]
  const host = await createEquipment(c, { name: 'Temp AHU', siteId: id(a), spec: 'ats::AtsAhu', withPoints: false })
  const vav = await createEquipment(c, { name: 'Temp VAV', siteId: id(a), spec: 'ats::AtsVav', withPoints: false, links: { airRef: id(host.equip) } })
  await deleteRecord(c, host.equip, { clearLinks: false })
  const now = await fresh(vav.equip)
  assert.ok(isRef(now.airRef))
  assert.ok((await problems(now)).some((t) => t.includes('does not exist')))
})

test('deleting a site removes everything in it', async () => {
  const b = (await c.read(`site and dis=="${SITE_B}"`))[0]
  const n = (await c.read(`siteRef==@${id(b)}`)).length
  const res = await deleteRecord(c, b, { clearLinks: false })
  assert.equal(res.removed, n + 1)
  assert.equal((await c.read(`siteRef==@${id(b)}`)).length, 0)
})

test('ids and spec names that are not plain names are refused before anything is sent', async () => {
  await assert.rejects(createPoint(c, { name: 'x', equipId: 'a) + commit(', kind: 'Bool' }), RuleError)
  const [site] = await c.read(`site and dis=="${SITE_A}"`)
  await assert.rejects(createEquipment(c, { name: 'x', siteId: id(site), spec: 'ats::AtsAhu"); commit(' }), RuleError)
  await assert.rejects(createPoint(c, { name: 'x', equipId: id(site), spec: 'not a spec' }), RuleError)
  void addRecords
})
