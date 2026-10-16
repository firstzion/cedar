// The kinds of equipment the app knows how to create, in one place so the demo-data loader and the editor agree.
// Each is a Xeto spec from the `ats` library; Haxall's `instantiate()` supplies the required points.

export interface EquipLink {
  tag: 'airRef' | 'submeterOf'
  label: string
  /** Haystack filter for the records that can be linked to */
  filter: string
  required: boolean
}

export interface EquipTemplate {
  spec: string
  label: string
  description: string
  /** marker tags that choose between alternatives in the Haystack model (heating process, meter scope...) */
  markers: string[]
  link?: EquipLink
}

export const EQUIP_TEMPLATES: EquipTemplate[] = [
  {
    spec: 'ats::AtsAhu', label: 'Air handling unit (AHU)',
    description: 'VAV-serving air handler with 14 required points.',
    markers: ['chilledWaterCooling', 'hotWaterHeating', 'singleDuct', 'variableAirVolume', 'vavZone'],
  },
  {
    spec: 'ats::AtsVav', label: 'VAV terminal unit',
    description: 'Reheat VAV box with 9 required points.',
    markers: ['hotWaterHeating', 'singleDuct', 'pressureIndependent'],
    link: { tag: 'airRef', label: 'Served by AHU', filter: 'ahu', required: false },
  },
  {
    spec: 'ats::AtsElecMeter', label: 'Main electric meter',
    description: 'Whole-site meter with energy and demand points.',
    markers: ['siteMeter'],
  },
  {
    spec: 'ats::AtsElecSubmeter', label: 'Electric submeter',
    description: 'Meters one system or area; must point at its parent meter.',
    markers: ['submeter'],
    link: { tag: 'submeterOf', label: 'Submeter of', filter: 'meter and elec', required: true },
  },
]

export const templateFor = (spec: string | undefined) => EQUIP_TEMPLATES.find((t) => t.spec === spec)

/** Reference tags that point at another piece of equipment. Used to find what a deletion would leave dangling. */
export const EQUIP_REF_TAGS = ['airRef', 'submeterOf', 'systemRef', 'hotWaterRef', 'chilledWaterRef', 'spaceRef']

/** Tags Haxall or the app manages; they are shown but never edited by hand. */
export const PROTECTED_TAGS = ['id', 'mod', 'hisSize', 'hisStart', 'hisEnd', 'curVal', 'curStatus', 'curErr', 'hisStatus', 'hisErr', 'writeVal', 'writeStatus']
