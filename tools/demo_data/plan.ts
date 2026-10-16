// What the demo site contains: which equipment, which spec each uses, and how points are labelled.

export interface EquipPlan {
  key: string // stable internal key
  name: string // navName shown in the UI
  spec: string // ats spec qname
  tags: Record<string, 'marker'> // extra marker tags (choices etc.)
  ahu?: string // key of the serving AHU (becomes airRef)
  submeterOf?: string // key of the parent meter
}

import { templateFor } from '../../packages/haystack/src/templates.ts'

const M = 'marker' as const
/** The choice markers for a spec come from the shared equipment templates, so the editor and the loader agree. */
const markersOf = (spec: string): Record<string, 'marker'> =>
  Object.fromEntries((templateFor(spec)?.markers ?? []).map((m) => [m, M]))

export const EQUIPS: EquipPlan[] = [
  ...['AHU-1', 'AHU-2'].map((name) => ({
    key: name, name, spec: 'ats::AtsAhu',
    tags: markersOf('ats::AtsAhu'),
  })),
  ...[1, 2, 3, 4, 5, 6].map((i) => vav(`VAV-1-${i}`, 'AHU-1')),
  ...[1, 2, 3, 4].map((i) => vav(`VAV-2-${i}`, 'AHU-2')),
  { key: 'MAIN', name: 'Main Meter', spec: 'ats::AtsElecMeter', tags: markersOf('ats::AtsElecMeter') },
  { key: 'SUB-HVAC', name: 'HVAC Submeter', spec: 'ats::AtsElecSubmeter', tags: markersOf('ats::AtsElecSubmeter'), submeterOf: 'MAIN' },
  { key: 'SUB-LTG', name: 'Lighting & Plug Submeter', spec: 'ats::AtsElecSubmeter', tags: markersOf('ats::AtsElecSubmeter'), submeterOf: 'MAIN' },
]

function vav(name: string, ahu: string): EquipPlan {
  return { key: name, name, spec: 'ats::AtsVav', tags: markersOf('ats::AtsVav'), ahu }
}

/** Unit for each Number point (by spec navName), used when a template does not carry one. Bool points have no unit. */
export const UNITS: Record<string, string> = {
  // temperatures and temperature setpoints
  DischargeAirTempSensor: '°F', DischargeAirTempSp: '°F', ReturnAirTempSensor: '°F', MixedAirTempSensor: '°F',
  OutsideAirTempSensor: '°F', ZoneAirTempSensor: '°F', ZoneAirTempCoolingSp: '°F', ZoneAirTempHeatingSp: '°F',
  // commands (0-100 %)
  DischargeFanSpeedModulatingCmd: '%', ChilledWaterValveModulatingCmd: '%', HotWaterValveModulatingCmd: '%',
  OutsideAirDamperModulatingCmd: '%', DischargeAirDamperModulatingCmd: '%',
  // air pressure and flow
  DischargeAirPressureSensor: 'inH₂O', DischargeAirPressureSp: 'inH₂O',
  DischargeAirFlowSensor: 'cfm', DischargeAirFlowSp: 'cfm',
  // electric
  ElecAcImportActiveEnergySensor: 'kWh', ElecAcImportActiveDemandSensor: 'kW',
}
