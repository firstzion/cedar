// The six planted faults. Windows are positioned relative to "now" so they always fall inside the
// 90-day history and on sensible weekdays. This is the ground truth Phase 2 rules are tested against.
import { SITE } from './config.ts'
import { addDays, nextWeekdayMidnight, HOUR, DAY } from '../../packages/haystack/src/timeutil.ts'

export interface FaultDef {
  id: number
  name: string
  kind: string // short machine-readable label
  description: string
  equipName: string
  pointNames: string[] // spec navNames of the affected points
  startMs: number
  endMs: number // exclusive
}

const MON = 1, WED = 3, SAT = 6

export function faultDefs(nowMs: number): FaultDef[] {
  const tz = SITE.tzIana
  const daysAgo = (n: number) => nowMs - n * DAY
  const mon56 = nextWeekdayMidnight(daysAgo(56), MON, tz)
  const mon35 = nextWeekdayMidnight(daysAgo(35), MON, tz)
  const any47 = addDays(nextWeekdayMidnight(daysAgo(48), MON, tz), 0, tz)
  const sat21 = nextWeekdayMidnight(daysAgo(21), SAT, tz)
  const wed27 = nextWeekdayMidnight(daysAgo(27), WED, tz)
  const tue14 = nextWeekdayMidnight(daysAgo(14), 2, tz)
  return [
    {
      id: 1, name: 'Simultaneous heating and cooling', kind: 'simultaneous-heat-cool', equipName: 'AHU-1',
      pointNames: ['ChilledWaterValveModulatingCmd', 'HotWaterValveModulatingCmd'],
      description: 'AHU-1 cooling and heating valves are both well open (35-70%) while the fan runs, Monday through Thursday.',
      startMs: mon56, endMs: addDays(mon56, 4, tz),
    },
    {
      id: 2, name: 'VAV damper stuck', kind: 'stuck-damper', equipName: 'VAV-1-3',
      pointNames: ['DischargeAirDamperModulatingCmd', 'DischargeAirFlowSp', 'DischargeAirFlowSensor'],
      description: 'VAV-1-3 damper command is frozen at 35% while the airflow setpoint keeps changing; measured airflow does not follow the setpoint.',
      startMs: mon35, endMs: addDays(mon35, 5, tz),
    },
    {
      id: 3, name: 'Zone temperature sensor flatline', kind: 'flatline', equipName: 'VAV-2-2',
      pointNames: ['ZoneAirTempSensor'],
      description: 'VAV-2-2 zone temperature sensor reports exactly the same value for 7 days.',
      startMs: any47, endMs: addDays(any47, 7, tz),
    },
    {
      id: 4, name: 'AHU running 24/7 over a weekend', kind: 'weekend-override', equipName: 'AHU-2',
      pointNames: ['DischargeFanRunCmd', 'DischargeFanRunSensor', 'AtsOccupiedSp'],
      description: 'AHU-2 stays in occupied mode with the fan running all day Saturday and Sunday (schedule override left on).',
      startMs: sat21, endMs: addDays(sat21, 2, tz),
    },
    {
      id: 5, name: 'Submeter data gap', kind: 'data-gap', equipName: 'Lighting & Plug Submeter',
      pointNames: ['ElecAcImportActiveDemandSensor', 'ElecAcImportActiveEnergySensor'],
      description: 'No samples at all are stored for the lighting/plug submeter for 24 hours (08:00 Wednesday to 08:00 Thursday).',
      startMs: wed27 + 8 * HOUR, endMs: wed27 + 32 * HOUR,
    },
    {
      id: 6, name: 'Outside air temperature sensor out of range', kind: 'implausible-value', equipName: 'AHU-1',
      pointNames: ['OutsideAirTempSensor'],
      description: 'AHU-1 outside air temperature sensor reads -40 F (typical open-circuit value) for 18 hours starting 02:00 Tuesday.',
      startMs: tue14 + 2 * HOUR, endMs: tue14 + 20 * HOUR,
    },
  ]
}

export const inWindow = (f: FaultDef, ms: number) => ms >= f.startMs && ms < f.endMs
