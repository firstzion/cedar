// Integration tests for the ats Xeto lib. Needs a running Haxall (make up).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  clientFromEnv, enableLibs, libStatus, instantiateGraph, commitRecs, cleanup, validateGraph,
  marker, ref, type Rec,
} from './helpers.ts'
import type { HaystackClient } from '../../packages/haystack/src/client.ts'

let c: HaystackClient
let siteId: string

const SPECS = ['AtsSite', 'AtsAhu', 'AtsVav', 'AtsElecMeter', 'AtsElecSubmeter', 'AtsOccupiedSp']

before(async () => {
  c = await clientFromEnv()
  await enableLibs(c)
  await cleanup(c)
  siteId = 'sslTestSite'
  await commitRecs(c, [{
    id: ref(siteId), site: marker, dis: 'Test Site', spec: ref('ats::AtsSite'),
    area: { _kind: 'number', val: 50000, unit: 'ft²' }, tz: 'Los_Angeles', geoAddr: '1 Test St',
  }])
})
after(async () => { await cleanup(c) })

/** Fill in what a real deployment adds to template points: unit, tz, his. */
function finishPoints(recs: Rec[]): Rec[] {
  return recs.map((r) => (r.point ? { ...r, his: marker, tz: 'Los_Angeles', ...(r.kind === 'Number' ? { unit: '%' } : {}) } : r))
}

test('ats lib compiles', async () => {
  const s = await libStatus(c)
  assert.equal(s?.libStatus, 'ok', s?.err)
})

test('all ats specs exist', async () => {
  for (const name of SPECS) {
    const g = await c.evalAxon(`spec("ats::${name}")->name`)
    assert.ok(g.rows.length > 0, `missing spec ${name}`)
  }
})

test('site: complete record is valid, missing area is an error', async () => {
  assert.deepEqual(await validateGraph(c, siteId), [])
  await commitRecs(c, [{ id: ref('sslBadSite'), site: marker, dis: 'Bad', spec: ref('ats::AtsSite'), tz: 'Los_Angeles', geoAddr: 'x' }])
  const errs = await validateGraph(c, 'sslBadSite')
  assert.ok(errs.some((e) => e.includes('area')), `expected area error, got ${JSON.stringify(errs)}`)
})

for (const [spec, extra] of [
  ['ats::AtsAhu', {}],
  ['ats::AtsVav', {}],
  ['ats::AtsElecMeter', {}],
] as [string, Rec][]) {
  test(`${spec}: a full instantiated graph validates clean`, async () => {
    const recs = finishPoints(await instantiateGraph(c, spec, siteId))
    const equip = recs.find((r) => r.equip)!
    await commitRecs(c, recs.map((r) => (r === equip ? { ...r, ...extra } : r)))
    const errs = await validateGraph(c, (equip.id as { val: string }).val)
    assert.deepEqual(errs, [])
  })
}

test('ats::AtsVav: removing a point is reported by name', async () => {
  const recs = finishPoints(await instantiateGraph(c, 'ats::AtsVav', siteId))
  const equip = recs.find((r) => r.equip)!
  const drop = recs.find((r) => r.navName === 'DischargeAirFlowSensor')!
  await commitRecs(c, recs.filter((r) => r !== drop))
  const errs = await validateGraph(c, (equip.id as { val: string }).val)
  assert.equal(errs.length, 1, JSON.stringify(errs))
  assert.match(errs[0], /Missing required Point: .*DischargeAirFlowSensor/)
})

test('ats::AtsElecSubmeter: needs submeterOf', async () => {
  const recs = finishPoints(await instantiateGraph(c, 'ats::AtsElecSubmeter', siteId))
  const equip = recs.find((r) => r.equip)!
  await commitRecs(c, recs)
  const errs = await validateGraph(c, (equip.id as { val: string }).val)
  assert.ok(errs.some((e) => e.includes('submeterOf')), JSON.stringify(errs))
  // linking it to a parent meter makes it valid
  const mainRecs = finishPoints(await instantiateGraph(c, 'ats::AtsElecMeter', siteId))
  const main = mainRecs.find((r) => r.equip)!
  await commitRecs(c, mainRecs)
  await c.evalAxon(`readById(@${(equip.id as { val: string }).val}).diff({submeterOf: @${(main.id as { val: string }).val}}).commit`)
  assert.deepEqual(await validateGraph(c, (equip.id as { val: string }).val), [])
})

test('point with a wrong marker/kind is flagged', async () => {
  const recs = finishPoints(await instantiateGraph(c, 'ats::AtsVav', siteId))
  const bad = recs.find((r) => r.navName === 'ZoneAirTempSensor')!
  delete bad.sensor // breaks the sensor choice
  await commitRecs(c, recs)
  const errs = await validateGraph(c, (bad.id as { val: string }).val)
  assert.ok(errs.length > 0, 'expected errors for a point missing the sensor marker')
})
