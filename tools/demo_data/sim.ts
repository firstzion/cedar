// Pure, seeded simulation of the demo building. No network access: same inputs -> same numbers.
import { makeRng } from './prng.ts'
import { SITE, SAMPLES } from './config.ts'
import { EQUIPS } from './plan.ts'
import { faultDefs, inWindow, type FaultDef } from './faults.ts'
import { parts, QUARTER } from '../../packages/haystack/src/timeutil.ts'

export type Val = number | boolean
export interface SimResult {
  tsMs: number[]
  /** key = `${equipName}|${pointNavName}` */
  series: Map<string, Val[]>
  /** samples to leave out entirely, per series key (indexes) */
  omit: Map<string, Set<number>>
  faults: FaultDef[]
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const rnd = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d
export const seriesKey = (equip: string, point: string) => `${equip}|${point}`

interface Zone { name: string; ahu: string; lf: number; maxFlow: number; t: number; ahuIdx: number }

export function simulate(seed: number, lastSampleMs: number, count = SAMPLES): SimResult {
  const rng = makeRng(seed)
  const tz = SITE.tzIana
  const N = count
  const first = lastSampleMs - (N - 1) * QUARTER
  const tsMs = Array.from({ length: N }, (_, i) => first + i * QUARTER)
  const faults = faultDefs(lastSampleMs)
  const F = (id: number) => faults.find((f) => f.id === id)!

  const series = new Map<string, Val[]>()
  const put = (equip: string, point: string, i: number, v: Val) => {
    const k = seriesKey(equip, point)
    let a = series.get(k)
    if (!a) { a = new Array(N); series.set(k, a) }
    a[i] = v
  }
  const omit = new Map<string, Set<number>>()

  const ahus = EQUIPS.filter((e) => e.spec === 'ats::AtsAhu').map((e) => e.name)
  const zones: Zone[] = EQUIPS.filter((e) => e.spec === 'ats::AtsVav').map((e) => ({
    name: e.name, ahu: e.ahu!, ahuIdx: ahus.indexOf(e.ahu!),
    lf: rng.range(0.5, 1.6), maxFlow: Math.round(rng.range(800, 1500) / 50) * 50, t: 72 + rng.range(-1, 1),
  }))

  // VAV-1-3 is a hot south-facing zone: its airflow setpoint swings a lot, so the stuck damper (fault 2) is obvious
  const hot = zones.find((z) => z.name === 'VAV-1-3')!
  hot.lf = 1.6
  hot.maxFlow = 1000

  // slow day-to-day weather swings
  const nDays = Math.ceil(N / 96) + 1
  const dayOff: number[] = []
  for (let d = 0; d < nDays; d++) dayOff.push(0.7 * (dayOff[d - 1] ?? 0) + 3 * rng.gauss())

  const energy = { MAIN: 480000, 'SUB-HVAC': 190000, 'SUB-LTG': 150000 }
  const frozen: { zone?: number } = {}

  for (let i = 0; i < N; i++) {
    const ms = tsMs[i]
    const lp = parts(ms, tz)
    const h = lp.hour + lp.minute / 60
    const weekday = lp.dow >= 1 && lp.dow <= 5
    const schedOcc = weekday && h >= 6 && h < 18

    // outside air (true value; sensors add noise below)
    const season = 77 - (11 * i) / N
    // diurnal: coldest ~03:00, warmest ~15:00
    const oaTrue = season + dayOff[Math.floor(i / 96)] + 9 * Math.sin((2 * Math.PI * (h - 9)) / 24) + rng.gauss() * 0.3
    const sun = Math.max(0, Math.sin((Math.PI * (h - 6)) / 12))

    // per-AHU occupancy (fault 4 forces AHU-2 occupied all weekend)
    const occ = ahus.map((a) => schedOcc || (a === 'AHU-2' && inWindow(F(4), ms)))

    // which AHUs need the fan: occupied, or a zone has drifted out of its unoccupied band
    const fanOn = ahus.map((_, a) => occ[a] || zones.some((z) => z.ahuIdx === a && (z.t > 82 || z.t < 62)))

    // zones
    const flowActual: number[] = []
    const reheatPct: number[] = []
    const zoneState: { cool: number; heat: number; flowSp: number; damper: number; dat: number }[] = []
    const satSpA = ahus.map(() => 55 + clamp((65 - oaTrue) / 10, 0, 1) * 3)
    zones.forEach((z, zi) => {
      const a = z.ahuIdx
      const coolSp = occ[a] ? 74 : 82
      const heatSp = occ[a] ? 70 : 62
      let flowSp = 0, damper = 0, reheat = 0
      if (fanOn[a]) {
        const coolDem = clamp((z.t - (coolSp - 2)) / 4, 0, 1) // proportional band centred on the setpoint
        const heatDem = clamp((heatSp - z.t) / 2, 0, 1)
        const minF = 0.2 * z.maxFlow
        flowSp = minF + coolDem * (z.maxFlow - minF)
        reheat = heatDem * 100
        damper = (flowSp / z.maxFlow) * 100
      }
      let actual = fanOn[a] ? flowSp * (1 + rng.gauss() * 0.01) : 0
      if (z.name === 'VAV-1-3' && inWindow(F(2), ms)) {
        damper = 35
        actual = fanOn[a] ? 0.35 * z.maxFlow * (1 + rng.gauss() * 0.01) : 0
      }
      const dat = fanOn[a] ? satSpA[a] + reheat * 0.2 + rng.gauss() * 0.3 : z.t + rng.gauss() * 0.2
      flowActual[zi] = actual
      reheatPct[zi] = reheat
      zoneState[zi] = { cool: coolSp, heat: heatSp, flowSp, damper, dat }
    })

    // AHUs
    const ahuOut = ahus.map((name, a) => {
      const mine = zones.map((z, zi) => ({ z, zi })).filter((x) => x.z.ahuIdx === a)
      const on = fanOn[a]
      const sumFlow = mine.reduce((s, x) => s + flowActual[x.zi], 0)
      const maxTotal = mine.reduce((s, x) => s + x.z.maxFlow, 0) * 0.75
      const speed = on ? clamp((sumFlow / maxTotal) * 100, 30, 100) : 0
      const ra = mine.reduce((s, x) => s + x.z.t, 0) / mine.length + 1
      let oaDamper = 0
      if (on) {
        oaDamper = 20
        if (oaTrue > 50 && oaTrue < 68) oaDamper = oaTrue <= 60 ? 100 : 100 - ((oaTrue - 60) / 8) * 80
      }
      const mat = ra + (oaTrue - ra) * (oaDamper / 100) * 0.85
      let cool = 0, heat = 0
      if (on) {
        cool = clamp((100 * (mat - satSpA[a])) / 25, 0, 100)
        heat = clamp((100 * (satSpA[a] - mat)) / 20, 0, 100)
        if (name === 'AHU-1' && inWindow(F(1), ms)) {
          heat = clamp(55 + rng.gauss() * 8, 35, 70)
          cool = clamp(50 + rng.gauss() * 8, 35, 70)
        }
      }
      const sat = on ? satSpA[a] + rng.gauss() * 0.4 : ra
      const fanKw = on ? 20 * (speed / 100) ** 3 + 1.5 : 0
      const kw = fanKw + (cool / 100) * 35 + (heat / 100) * 3
      return { name, on, speed, ra, oaDamper, mat, cool, heat, sat, kw, occ: occ[a] }
    })

    // write AHU points
    ahuOut.forEach((u, a) => {
      const n = u.name
      const staticSp = 1.5
      put(n, 'DischargeAirTempSensor', i, rnd(u.sat, 1))
      put(n, 'DischargeAirTempSp', i, rnd(satSpA[a], 1))
      put(n, 'ReturnAirTempSensor', i, rnd(u.ra + rng.gauss() * 0.15, 1))
      put(n, 'MixedAirTempSensor', i, rnd(u.mat + rng.gauss() * 0.3, 1))
      let oaSensor = oaTrue + (a === 0 ? 0.2 : -0.2) + rng.gauss() * 0.15
      if (n === 'AHU-1' && inWindow(F(6), ms)) oaSensor = -40
      put(n, 'OutsideAirTempSensor', i, rnd(oaSensor, 1))
      put(n, 'DischargeFanRunCmd', i, u.on)
      put(n, 'DischargeFanRunSensor', i, u.on)
      put(n, 'DischargeFanSpeedModulatingCmd', i, rnd(u.speed, 1))
      put(n, 'DischargeAirPressureSensor', i, rnd(u.on ? staticSp + rng.gauss() * 0.03 : 0, 3))
      put(n, 'DischargeAirPressureSp', i, staticSp)
      put(n, 'ChilledWaterValveModulatingCmd', i, rnd(u.cool, 1))
      put(n, 'HotWaterValveModulatingCmd', i, rnd(u.heat, 1))
      put(n, 'OutsideAirDamperModulatingCmd', i, rnd(u.oaDamper, 1))
      put(n, 'AtsOccupiedSp', i, u.occ)
    })

    // zone temperature update (after sensing) and VAV points
    zones.forEach((z, zi) => {
      const zs = zoneState[zi]
      const occGain = occ[z.ahuIdx] ? z.lf * 2.0 : 0
      const tFree = 0.35 * oaTrue + 0.65 * 71 + occGain + z.lf * 3.5 * sun
      let sensor = z.t + rng.gauss() * 0.05
      if (z.name === 'VAV-2-2' && inWindow(F(3), ms)) {
        if (frozen.zone === undefined) frozen.zone = rnd(sensor, 1)
        sensor = frozen.zone
      }
      put(z.name, 'ZoneAirTempSensor', i, rnd(sensor, 1))
      put(z.name, 'ZoneAirTempCoolingSp', i, zs.cool)
      put(z.name, 'ZoneAirTempHeatingSp', i, zs.heat)
      put(z.name, 'ZoneOccupiedSensor', i, occ[z.ahuIdx])
      put(z.name, 'DischargeAirFlowSensor', i, Math.round(flowActual[zi]))
      put(z.name, 'DischargeAirFlowSp', i, Math.round(zs.flowSp))
      put(z.name, 'DischargeAirDamperModulatingCmd', i, rnd(zs.damper, 1))
      put(z.name, 'HotWaterValveModulatingCmd', i, rnd(reheatPct[zi], 1))
      put(z.name, 'DischargeAirTempSensor', i, rnd(zs.dat, 1))
      z.t += 0.06 * (tFree - z.t) + (flowActual[zi] / z.maxFlow) * 0.07 * (zs.dat - z.t)
    })

    // meters
    const hvacKw = ahuOut.reduce((s, u) => s + u.kw, 0) + reheatPct.reduce((s, r) => s + r, 0) * 0.003 + 1.5 + rng.gauss() * 0.3
    const anyOcc = occ.some(Boolean)
    const ltgKw = (anyOcc ? 40 + 6 * Math.sin((Math.PI * (h - 6)) / 12) : weekday ? 10 : 9) + rng.gauss() * 0.8
    const mainKw = hvacKw + ltgKw + 14 * (1 + rng.gauss() * 0.02)
    const kws = { MAIN: mainKw, 'SUB-HVAC': hvacKw, 'SUB-LTG': ltgKw }
    const names = { MAIN: 'Main Meter', 'SUB-HVAC': 'HVAC Submeter', 'SUB-LTG': 'Lighting & Plug Submeter' }
    for (const k of Object.keys(kws) as (keyof typeof kws)[]) {
      energy[k] += kws[k] * 0.25
      put(names[k], 'ElecAcImportActiveDemandSensor', i, rnd(kws[k], 2))
      put(names[k], 'ElecAcImportActiveEnergySensor', i, rnd(energy[k], 2))
    }

    // fault 5: leave samples out entirely
    if (inWindow(F(5), ms)) {
      for (const p of F(5).pointNames) {
        const k = seriesKey(F(5).equipName, p)
        if (!omit.has(k)) omit.set(k, new Set())
        omit.get(k)!.add(i)
      }
    }
  }
  return { tsMs, series, omit, faults }
}
