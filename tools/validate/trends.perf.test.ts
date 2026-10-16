// Performance target from the plan: 90 days of 15-minute history for 10 points (about 86k samples) in under 2 seconds.
// Measures what the Trend Viewer does before drawing: fetch, parse, prepare, decimate. (Drawing is measured in the browser.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HaystackClient, refId } from '../../packages/haystack/src/index.ts'
import { decimate, prepare, kindOfValues } from '../../ui/src/apps/trends/series.ts'

const origin = `http://localhost:${process.env.HAXALL_PORT ?? '8080'}`

test('10 points x 90 days: fetch, parse and decimate in under 2 s', async () => {
  const c = new HaystackClient(origin)
  await c.login(process.env.HAXALL_SU_USERNAME!, process.env.HAXALL_SU_PASSWORD!)
  const pts = await c.read('point and his and siteRef', 10)
  assert.equal(pts.length, 10)
  const end = Date.now()
  const start = end - 90 * 86400000

  const t0 = performance.now()
  const data = await Promise.all(pts.map((p) => c.hisSeries(refId(p.id)!, start, end)))
  const tFetch = performance.now() - t0
  const samples = data.reduce((n, d) => n + d.ms.length, 0)

  const t1 = performance.now()
  const prepared = data.map((d, i) => prepare({ id: String(i), name: String(i), unit: d.unit, kind: kindOfValues(d.val), ms: d.ms, val: d.val }))
  const drawn = prepared.map((p) => decimate(p, start, end, 800))
  const tPrep = performance.now() - t1

  console.log(`  ${samples} samples: fetch+parse ${Math.round(tFetch)} ms, prepare+decimate ${Math.round(tPrep)} ms, drawn points ${drawn.reduce((n, d) => n + d.length, 0)}`)
  assert.ok(samples > 80000, `only ${samples} samples`)
  assert.ok(tFetch + tPrep < 2000, `took ${Math.round(tFetch + tPrep)} ms`)
  assert.ok(drawn.every((d) => d.length < 800 * 4 + 50))
})

test('zooming to a window re-decimates from the same data in a few milliseconds', async () => {
  const c = new HaystackClient(origin)
  await c.login(process.env.HAXALL_SU_USERNAME!, process.env.HAXALL_SU_PASSWORD!)
  const [p] = await c.read('point and his and navName=="OutsideAirTempSensor"', 1)
  const end = Date.now()
  const d = await c.hisSeries(refId(p.id)!, end - 90 * 86400000, end)
  const prep = prepare({ id: 'a', name: 'a', unit: d.unit, kind: 'number', ms: d.ms, val: d.val })
  const t = performance.now()
  for (let i = 0; i < 20; i++) decimate(prep, end - 30 * 86400000, end - 20 * 86400000, 800)
  const per = (performance.now() - t) / 20
  assert.ok(per < 25, `${per} ms per zoom`)
})
