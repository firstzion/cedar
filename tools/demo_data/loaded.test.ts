// Checks the data actually loaded in Haxall against faults.json. Loads the demo data first if needed.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clientFromEnv } from '../../packages/haystack/src/node.ts'
import type { HaystackClient } from '../../packages/haystack/src/client.ts'
import { demoDataState, loadDemoData, removeDemoData, FAULTS_PATH } from './loader.ts'
import { DEFAULT_SEED, SAMPLES, DEMO_TAG } from './config.ts'

let c: HaystackClient
let manifest: any

async function hisRead(id: string, start: string, end: string) {
  const range = `${start} Los_Angeles,${end} Los_Angeles`
  const g = await c.op('hisRead', [{ id: { _kind: 'ref', val: id }, range }], { cols: ['id', 'range'] })
  return g.rows.map((r: any) => ({ ms: Date.parse(r.ts.val), v: r.val?.val ?? r.val }))
}
const pt = (f: any, name: string) => f.points.find((p: any) => p.name === name).id as string

before(async () => {
  c = await clientFromEnv()
  const st = await demoDataState(c)
  if (st.recs === 0 || st.pointsMissingHis > 0) {
    await removeDemoData(c)
    await loadDemoData(c, { seed: DEFAULT_SEED, nowMs: Date.now() })
  }
  manifest = JSON.parse(readFileSync(FAULTS_PATH, 'utf8'))
})

test('every record validates against its spec (with required points)', async () => {
  const v = await c.evalAxon(`readAll(${DEMO_TAG}).validate(null, {graph})`)
  assert.deepEqual(v.rows.filter((r) => r.level === 'err').map((r) => r.msg), [])
})

test('record counts', async () => {
  const n = async (f: string) => Number(((await c.evalAxon(`readAll(${DEMO_TAG} and ${f}).size`)).rows[0].val as any).val ?? (await c.evalAxon(`readAll(${DEMO_TAG} and ${f}).size`)).rows[0].val)
  assert.equal(await n('site'), 1)
  assert.equal(await n('ahu'), 2)
  assert.equal(await n('vav'), 10)
  assert.equal(await n('meter'), 3)
  assert.equal(await n('point'), 124)
})

test('VAVs link to the right AHU and submeters to the main meter', async () => {
  const g = await c.evalAxon(`readAll(vav and ${DEMO_TAG}).map(r => {n: r->navName, ahu: readById(r->airRef)->navName})`)
  const by: Record<string, number> = {}
  for (const r of g.rows) by[r.ahu as string] = (by[r.ahu as string] ?? 0) + 1
  assert.deepEqual(by, { 'AHU-1': 6, 'AHU-2': 4 })
  const s = await c.evalAxon(`readAll(submeter and ${DEMO_TAG}).map(r => {main: readById(r->submeterOf)->navName})`)
  assert.deepEqual(s.rows.map((r) => r.main), ['Main Meter', 'Main Meter'])
})

test('every point carries his, tz, kind, hisMaxItems and no cur/connector tags', async () => {
  const g = await c.evalAxon(`readAll(point and ${DEMO_TAG}).findAll(p => p.missing("his") or p.missing("tz") or p.missing("kind") or p.missing("hisMaxItems") or p.has("cur") or p.has("curVal")).size`)
  assert.equal(Number((g.rows[0].val as any).val ?? g.rows[0].val), 0)
})

test('history sample counts: 8640 per point, 8544 for the two gapped submeter points', async () => {
  const f5 = manifest.faults.find((f: any) => f.id === 5)
  const gapped = new Set(f5.points.map((p: any) => p.id))
  const pts = await c.evalAxon(`readAll(point and ${DEMO_TAG}).keepCols(["id","hisSize"])`)
  assert.equal(pts.rows.length, 124)
  for (const r of pts.rows) {
    const id = (r.id as any).val
    const size = Number((r.hisSize as any).val ?? r.hisSize)
    assert.equal(size, gapped.has(id) ? SAMPLES - 96 : SAMPLES, id)
  }
})

test('energy history from Haxall is monotonic', async () => {
  const f5 = manifest.faults.find((f: any) => f.id === 5)
  const rows = await hisRead(pt(f5, 'ElecAcImportActiveEnergySensor'), manifest.firstSample, manifest.lastSample)
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].v >= rows[i - 1].v)
})

test('faults.json matches the loaded data: fault 1', async () => {
  const f = manifest.faults.find((x: any) => x.id === 1)
  const cool = await hisRead(pt(f, 'ChilledWaterValveModulatingCmd'), f.start, f.end)
  const heat = await hisRead(pt(f, 'HotWaterValveModulatingCmd'), f.start, f.end)
  const both = cool.filter((r, i) => r.v >= 35 && heat[i].v >= 35).length
  assert.ok(both > 150, `only ${both} samples with both valves open`)
})

test('fault 2', async () => {
  const f = manifest.faults.find((x: any) => x.id === 2)
  const d = await hisRead(pt(f, 'DischargeAirDamperModulatingCmd'), f.start, f.end)
  const sp = await hisRead(pt(f, 'DischargeAirFlowSp'), f.start, f.end)
  assert.equal(new Set(d.map((r) => r.v)).size, 1)
  assert.ok(new Set(sp.map((r) => r.v)).size > 10)
})

test('fault 3', async () => {
  const f = manifest.faults.find((x: any) => x.id === 3)
  const t = await hisRead(pt(f, 'ZoneAirTempSensor'), f.start, f.end)
  assert.equal(t.length, 7 * 96)
  assert.equal(new Set(t.map((r) => r.v)).size, 1)
})

test('fault 4', async () => {
  const f = manifest.faults.find((x: any) => x.id === 4)
  const run = await hisRead(pt(f, 'DischargeFanRunSensor'), f.start, f.end)
  assert.equal(run.length, 192)
  assert.ok(run.every((r) => r.v === true))
})

test('fault 5: no samples at all inside the gap, normal either side', async () => {
  const f = manifest.faults.find((x: any) => x.id === 5)
  for (const name of ['ElecAcImportActiveDemandSensor', 'ElecAcImportActiveEnergySensor']) {
    assert.equal((await hisRead(pt(f, name), f.start, f.end)).length, 0, name)
  }
  const before = Date.parse(f.start) - 15 * 60000
  const rows = await hisRead(pt(f, 'ElecAcImportActiveDemandSensor'), new Date(before - 3600000).toISOString().replace('.000Z', 'Z').replace('Z', '+00:00'), f.start)
  assert.ok(rows.length > 0)
})

test('fault 6', async () => {
  const f = manifest.faults.find((x: any) => x.id === 6)
  const t = await hisRead(pt(f, 'OutsideAirTempSensor'), f.start, f.end)
  assert.equal(t.length, 72)
  assert.ok(t.every((r) => r.v === -40))
})
