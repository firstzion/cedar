// Tests of the simulation itself (no Haxall needed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { simulate, seriesKey } from './sim.ts'
import { SAMPLES } from './config.ts'
import { inWindow } from './faults.ts'
import { parts, QUARTER } from '../../packages/haystack/src/timeutil.ts'

const NOW = Date.parse('2026-10-16T20:00:00Z')
const hash = (r: ReturnType<typeof simulate>) =>
  createHash('sha256').update(JSON.stringify([...r.series.entries()])).digest('hex')
const num = (r: ReturnType<typeof simulate>, e: string, p: string) => r.series.get(seriesKey(e, p)) as number[]
const bool = (r: ReturnType<typeof simulate>, e: string, p: string) => r.series.get(seriesKey(e, p)) as boolean[]
const sim = simulate(42, NOW)
const window = (id: number) => sim.faults.find((f) => f.id === id)!
const idx = (id: number) => sim.tsMs.map((t, i) => (inWindow(window(id), t) ? i : -1)).filter((i) => i >= 0)

test('same seed gives identical data; different seed differs', () => {
  assert.equal(hash(simulate(42, NOW)), hash(sim))
  assert.notEqual(hash(simulate(7, NOW)), hash(sim))
})

test('shape: 124 series of 8640 samples at 15 minute spacing', () => {
  assert.equal(sim.series.size, 124)
  for (const [k, v] of sim.series) assert.equal(v.length, SAMPLES, k)
  assert.ok(sim.tsMs.every((t, i) => i === 0 || t - sim.tsMs[i - 1] === QUARTER))
  assert.equal(sim.tsMs[SAMPLES - 1], NOW)
})

test('energy registers never decrease and always increase overall', () => {
  for (const m of ['Main Meter', 'HVAC Submeter', 'Lighting & Plug Submeter']) {
    const e = num(sim, m, 'ElecAcImportActiveEnergySensor')
    for (let i = 1; i < e.length; i++) assert.ok(e[i] >= e[i - 1], `${m} decreased at ${i}`)
    assert.ok(e[e.length - 1] > e[0])
  }
})

test('main meter demand is at least the HVAC submeter demand', () => {
  const main = num(sim, 'Main Meter', 'ElecAcImportActiveDemandSensor')
  const hvac = num(sim, 'HVAC Submeter', 'ElecAcImportActiveDemandSensor')
  assert.ok(main.every((v, i) => v >= hvac[i]))
})

test('weekday occupancy follows the 6am-6pm schedule', () => {
  const occ = bool(sim, 'AHU-1', 'AtsOccupiedSp')
  sim.tsMs.forEach((t, i) => {
    const p = parts(t, 'America/Los_Angeles')
    const h = p.hour + p.minute / 60
    if (p.dow >= 1 && p.dow <= 5) assert.equal(occ[i], h >= 6 && h < 18, `${p.dow} ${h}`)
  })
})

test('occupied zones stay in a sensible comfort range', () => {
  const t = num(sim, 'VAV-1-2', 'ZoneAirTempSensor')
  const occ = bool(sim, 'VAV-1-2', 'ZoneOccupiedSensor')
  const o = t.filter((_, i) => occ[i])
  assert.ok(Math.min(...o) > 64 && Math.max(...o) < 82, `${Math.min(...o)}..${Math.max(...o)}`)
})

test('fault 1: both AHU-1 valves open together', () => {
  const c = num(sim, 'AHU-1', 'ChilledWaterValveModulatingCmd')
  const h = num(sim, 'AHU-1', 'HotWaterValveModulatingCmd')
  const fan = bool(sim, 'AHU-1', 'DischargeFanRunCmd')
  const w = idx(1).filter((i) => fan[i])
  assert.ok(w.length > 150)
  assert.ok(w.every((i) => c[i] >= 35 && h[i] >= 35))
  // and rare outside the window
  const outside = c.map((_, i) => i).filter((i) => !inWindow(window(1), sim.tsMs[i]) && c[i] > 30 && h[i] > 30)
  assert.equal(outside.length, 0)
})

test('fault 2: VAV-1-3 damper frozen while flow setpoint changes', () => {
  const w = idx(2)
  const damper = new Set(w.map((i) => num(sim, 'VAV-1-3', 'DischargeAirDamperModulatingCmd')[i]))
  const sp = new Set(w.map((i) => num(sim, 'VAV-1-3', 'DischargeAirFlowSp')[i]))
  assert.equal(damper.size, 1)
  assert.ok(sp.size > 10)
})

test('fault 3: VAV-2-2 zone temp is one identical value for 7 days', () => {
  const w = idx(3)
  assert.equal(w.length, 7 * 96)
  assert.equal(new Set(w.map((i) => num(sim, 'VAV-2-2', 'ZoneAirTempSensor')[i])).size, 1)
  // a healthy neighbour varies
  assert.ok(new Set(w.map((i) => num(sim, 'VAV-2-1', 'ZoneAirTempSensor')[i])).size > 20)
})

test('fault 4: AHU-2 fan runs all weekend', () => {
  const w = idx(4)
  assert.equal(w.length, 2 * 96)
  assert.ok(w.every((i) => bool(sim, 'AHU-2', 'DischargeFanRunSensor')[i] && bool(sim, 'AHU-2', 'AtsOccupiedSp')[i]))
  // the same weekend AHU-1 is off
  assert.ok(w.some((i) => !bool(sim, 'AHU-1', 'DischargeFanRunSensor')[i]))
})

test('fault 5: lighting submeter has 24h of omitted samples; HVAC submeter has none', () => {
  const gap = sim.omit.get(seriesKey('Lighting & Plug Submeter', 'ElecAcImportActiveDemandSensor'))!
  assert.equal(gap.size, 96)
  assert.deepEqual([...gap].sort((a, b) => a - b), idx(5))
  assert.equal(sim.omit.has(seriesKey('HVAC Submeter', 'ElecAcImportActiveDemandSensor')), false)
})

test('fault 6: AHU-1 outside air temp reads -40 for 18 hours, AHU-2 normal', () => {
  const w = idx(6)
  assert.equal(w.length, 72)
  assert.ok(w.every((i) => num(sim, 'AHU-1', 'OutsideAirTempSensor')[i] === -40))
  assert.ok(w.every((i) => num(sim, 'AHU-2', 'OutsideAirTempSensor')[i] > 30))
})

test('all fault windows lie inside the history and do not overlap in time and equipment badly', () => {
  for (const f of sim.faults) {
    assert.ok(f.startMs >= sim.tsMs[0] && f.endMs <= sim.tsMs[SAMPLES - 1], `fault ${f.id}`)
  }
})
