import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, ConflictError, MARKER, RuleError, type HDict } from '@ssl/haystack'

const w = vi.hoisted(() => ({
  createSite: vi.fn(), createEquipment: vi.fn(), createPoint: vi.fn(), updateRecord: vi.fn(), moveRecord: vi.fn(),
  planDelete: vi.fn(), deleteRecord: vi.fn(), canonicalUnit: vi.fn(), findSubtree: vi.fn(), listPointSpecs: vi.fn(), listEquipSpecs: vi.fn(),
  client: { read: vi.fn(), readByIds: vi.fn(), validateRec: vi.fn() },
}))
vi.mock('@ssl/haystack', async (orig) => ({ ...(await orig<typeof import('@ssl/haystack')>()),
  createSite: w.createSite, createEquipment: w.createEquipment, createPoint: w.createPoint, updateRecord: w.updateRecord, moveRecord: w.moveRecord,
  planDelete: w.planDelete, deleteRecord: w.deleteRecord, canonicalUnit: w.canonicalUnit, findSubtree: w.findSubtree,
  listPointSpecs: w.listPointSpecs, listEquipSpecs: w.listEquipSpecs }))
vi.mock('../../../lib/client.ts', () => ({ client: w.client }))

import { AddEquipDialog } from './AddEquipDialog.tsx'
import { AddPointDialog, missingSpecs } from './AddPointDialog.tsx'
import { AddSiteDialog } from './AddSiteDialog.tsx'
import { AddBar } from './AddBar.tsx'
import { DeleteDialog } from './DeleteDialog.tsx'
import { EditDialog } from './EditDialog.tsx'
import { destinationsFor, MoveDialog } from './MoveDialog.tsx'

const ref = (id: string, dis?: string) => ({ type: 'ref' as const, id, ...(dis ? { dis } : {}) })
const dt = (iso: string) => ({ type: 'dateTime' as const, ms: Date.parse(iso), iso, tz: 'UTC' })
const rec = (o: HDict): HDict => ({ mod: dt('2026-10-16T10:00:00Z'), ...o })
const siteRec = rec({ id: ref('s1', 'Demo Office'), dis: 'Demo Office', site: MARKER, spec: ref('ats::AtsSite') })
const ahu = rec({ id: ref('ahu1', 'Demo Office AHU-1'), navName: 'AHU-1', equip: MARKER, ahu: MARKER, siteRef: ref('s1'), spec: ref('ats::AtsAhu') })
const vav = rec({ id: ref('vav1', 'Demo Office VAV-1'), navName: 'VAV-1', equip: MARKER, vav: MARKER, siteRef: ref('s1'), equipRef: ref('ahu1'), airRef: ref('ahu1') })
const pt = rec({ id: ref('p1', 'Demo Office AHU-1 Temp'), navName: 'Temp', point: MARKER, his: MARKER, equipRef: ref('ahu1'), siteRef: ref('s1'), kind: 'Number', unit: '°F' })

function ui(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}
const type = (label: string | RegExp, text: string) => userEvent.type(screen.getByLabelText(label), text)

beforeEach(() => {
  vi.clearAllMocks()
  w.canonicalUnit.mockImplementation(async (_c: unknown, u: string) => ({ h: 'hr' } as Record<string, string>)[u] ?? u)
  w.listEquipSpecs.mockResolvedValue([{ id: 'ph::Boiler', name: 'Boiler' }, { id: 'ph::Ahu', name: 'Ahu' }, { id: 'ph::Pump', name: 'Pump' }])
  w.listPointSpecs.mockResolvedValue([
    { id: 'ph.points.sugar::MixedAirTempSensor', name: 'MixedAirTempSensor', lib: 'ph.points.sugar' },
    { id: 'ph.points.sugar::ReturnAirTempSensor', name: 'ReturnAirTempSensor', lib: 'ph.points.sugar' },
    { id: 'ph.elec::ElecAcImportActivePowerSensor', name: 'ElecAcImportActivePowerSensor', lib: 'ph.elec' },
  ])
  w.client.read.mockResolvedValue([])
  w.client.validateRec.mockResolvedValue([])
})

describe('AddSiteDialog', () => {
  it('checks the form before sending anything', async () => {
    ui(<AddSiteDialog onClose={() => {}} onDone={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add site' }))
    expect(await screen.findByText('Give the site a name')).toBeInTheDocument()
    expect(screen.getByText(/floor area as a number/)).toBeInTheDocument()
    expect(screen.getByText('Enter a street address')).toBeInTheDocument()
    expect(w.createSite).not.toHaveBeenCalled()
  })

  it('creates the site with what was typed and reports it', async () => {
    w.createSite.mockResolvedValue({ id: ref('new'), dis: 'Warehouse' })
    const onDone = vi.fn()
    ui(<AddSiteDialog onClose={() => {}} onDone={onDone} />)
    await type('Site name', 'Warehouse')
    await type(/Floor area/, '8000')
    await type('Street address', '5 Dock St')
    await type('City', 'Tacoma')
    await userEvent.selectOptions(screen.getByLabelText('Time zone'), 'Denver')
    await userEvent.click(screen.getByRole('button', { name: 'Add site' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createSite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Warehouse', areaFt2: 8000, tz: 'Denver', geoAddr: '5 Dock St', geoCity: 'Tacoma' }))
    expect(onDone.mock.calls[0][1]).toBe('Created site Warehouse.')
  })

  it('keeps the dialog open and shows the problem when Haxall refuses', async () => {
    w.createSite.mockRejectedValue(new ApiError('commit', 'Permission denied'))
    const onDone = vi.fn()
    ui(<AddSiteDialog onClose={() => {}} onDone={onDone} />)
    await type('Site name', 'X'); await type(/Floor area/, '10'); await type('Street address', 'y')
    await userEvent.click(screen.getByRole('button', { name: 'Add site' }))
    expect(await screen.findByText('Permission denied')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add site' })).toBeEnabled()
  })
})

describe('AddEquipDialog', () => {
  const open = (props: Partial<React.ComponentProps<typeof AddEquipDialog>> = {}) => {
    const onDone = vi.fn()
    ui(<AddEquipDialog siteId="s1" where="Demo Office" onClose={() => {}} onDone={onDone} {...props} />)
    return onDone
  }
  const created = { equip: { id: ref('e9'), navName: 'AHU-9' }, points: new Array(14).fill({}) }

  it('needs a name', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Add equipment' }))
    expect(await screen.findByText('Give the equipment a name')).toBeInTheDocument()
    expect(w.createEquipment).not.toHaveBeenCalled()
  })

  it('creates an AHU with its required points by default', async () => {
    w.createEquipment.mockResolvedValue(created)
    const onDone = open()
    await type('Name', 'AHU-9')
    await userEvent.click(screen.getByRole('button', { name: 'Add equipment' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createEquipment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'AHU-9', siteId: 's1', spec: 'ats::AtsAhu', withPoints: true }))
    expect(onDone.mock.calls[0][1]).toBe('Created AHU-9 with 14 points.')
  })

  it('can skip the points, and sends the parent when nested', async () => {
    w.createEquipment.mockResolvedValue({ equip: { id: ref('e9') }, points: [] })
    const onDone = open({ parentEquip: ahu, where: 'AHU-1' })
    await type('Name', 'Inner')
    await userEvent.click(screen.getByLabelText(/Also create the points/))
    await userEvent.click(screen.getByRole('button', { name: 'Add equipment' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createEquipment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ withPoints: false, parentEquipId: 'ahu1' }))
    expect(onDone.mock.calls[0][1]).toBe('Created Inner.')
  })

  it('a VAV can be linked to an AHU (optional)', async () => {
    w.client.read.mockResolvedValue([ahu])
    w.createEquipment.mockResolvedValue(created)
    const onDone = open()
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'ats::AtsVav')
    const link = await screen.findByLabelText('Served by AHU (optional)')
    await waitFor(() => expect(within(link).getByRole('option', { name: 'Demo Office AHU-1' })).toBeInTheDocument())
    expect(w.client.read).toHaveBeenCalledWith('(ahu) and siteRef==@s1')
    await userEvent.selectOptions(link, 'ahu1')
    await type('Name', 'VAV-9')
    await userEvent.click(screen.getByRole('button', { name: 'Add equipment' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createEquipment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ spec: 'ats::AtsVav', links: { airRef: 'ahu1' } }))
  })

  it('a submeter needs its meter: blocked when there is none, required when there is', async () => {
    w.client.read.mockResolvedValue([])
    open()
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'ats::AtsElecSubmeter')
    expect(await screen.findByText(/nothing to link to yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add equipment' })).toBeDisabled()
  })

  it('a submeter cannot be created without choosing its meter', async () => {
    w.client.read.mockResolvedValue([rec({ id: ref('m1', 'Demo Office Main Meter'), navName: 'Main Meter', equip: MARKER })])
    open()
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'ats::AtsElecSubmeter')
    await type('Name', 'Sub A')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Demo Office Main Meter' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Add equipment' }))
    expect(await screen.findByText(/Choose what this is submeter of/i)).toBeInTheDocument()
    expect(w.createEquipment).not.toHaveBeenCalled()
  })

  it('offers the standard Haystack types after the templates (the template specs are never listed twice)', async () => {
    open()
    const type_ = screen.getByLabelText('Type')
    await waitFor(() => expect(within(type_).getByRole('option', { name: 'Boiler' })).toBeInTheDocument())
    expect(within(type_).getByRole('option', { name: 'Air handling unit (AHU)' })).toBeInTheDocument()
    expect(within(type_).getAllByRole('option', { name: /AHU|Ahu/i }).length).toBe(2) // the template and the plain standard type
    const groups = [...type_.querySelectorAll('optgroup')].map((g) => g.label)
    expect(groups).toEqual(['Templates (come with their required points)', 'Other standard types'])
  })

  it('shows what went wrong and stays open', async () => {
    w.createEquipment.mockRejectedValue(new RuleError('That equipment is in a different site.'))
    open()
    await type('Name', 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Add equipment' }))
    expect(await screen.findByText('That equipment is in a different site.')).toBeInTheDocument()
  })
})

describe('AddPointDialog', () => {
  const item = (text: string) => ({ subject: 'ahu1', slot: 'points._0', level: 'err' as const, rule: 'sys::missingSlot', msg: text, text })
  const open = () => {
    const onDone = vi.fn()
    ui(<AddPointDialog equip={ahu} onClose={() => {}} onDone={onDone} />)
    return onDone
  }

  it('finds the spec names in "Missing required point" messages', () => {
    expect(missingSpecs([
      'Missing required point: Mixed Air Temp Sensor (ph.points.sugar::MixedAirTempSensor)',
      'Missing required point: Ats Occupied Sp (ats::AtsOccupiedSp)', 'Missing required tag: tz',
    ])).toEqual(['ph.points.sugar::MixedAirTempSensor', 'ats::AtsOccupiedSp'])
  })

  it('offers to add every missing required point at once', async () => {
    w.client.validateRec.mockResolvedValue([
      item('Missing required point: Mixed Air Temp Sensor (ph.points.sugar::MixedAirTempSensor)'),
      item('Missing required point: Return Air Temp Sensor (ph.points.sugar::ReturnAirTempSensor)'),
    ])
    w.createPoint.mockResolvedValue({ id: ref('np') })
    const onDone = open()
    await userEvent.click(await screen.findByRole('button', { name: 'Add all 2' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createPoint).toHaveBeenCalledTimes(2)
    expect(w.createPoint).toHaveBeenCalledWith(expect.anything(), { name: 'MixedAirTempSensor', equipId: 'ahu1', spec: 'ph.points.sugar::MixedAirTempSensor' })
    expect(onDone.mock.calls[0][1]).toBe('Added 2 required points to Demo Office AHU-1.')
  })

  it('adds one missing point with its own button', async () => {
    w.client.validateRec.mockResolvedValue([item('Missing required point: Return Air Temp Sensor (ph.points.sugar::ReturnAirTempSensor)')])
    w.createPoint.mockResolvedValue({ id: ref('np') })
    const onDone = open()
    await userEvent.click(await screen.findByRole('button', { name: 'add' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createPoint).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0][0]).toEqual({ id: ref('np') })
  })

  it('search narrows the list of types; choosing one fills in the name', async () => {
    open()
    expect(await screen.findByText('Mixed Air Temp Sensor')).toBeInTheDocument()
    expect(screen.getByText('Elec Ac Import Active Power Sensor')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/Search/), 'mixed')
    expect(screen.queryByText('Elec Ac Import Active Power Sensor')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Mixed Air Temp Sensor/ }))
    expect(screen.getByLabelText('Name')).toHaveValue('MixedAirTempSensor')
  })

  it('adds a point from a type, with an optional unit override', async () => {
    w.createPoint.mockResolvedValue({ id: ref('np') })
    const onDone = open()
    await userEvent.click(await screen.findByRole('button', { name: /Mixed Air Temp Sensor/ }))
    await userEvent.type(screen.getByLabelText(/Unit \(optional\)/), '°C')
    await userEvent.click(screen.getByRole('button', { name: 'Add point' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createPoint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ spec: 'ph.points.sugar::MixedAirTempSensor', unit: '°C', his: true }))
  })

  it('stores Haxall\'s own spelling of a unit', async () => {
    w.createPoint.mockResolvedValue({ id: ref('np') })
    const onDone = open()
    await userEvent.click(await screen.findByLabelText(/Custom point/))
    await type('Name', 'Runtime')
    await userEvent.type(screen.getByLabelText('Unit'), 'h')
    await userEvent.click(screen.getByRole('button', { name: 'Add point' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createPoint.mock.calls[0][1].unit).toBe('hr')
  })

  it('needs a type or custom point, and a name', async () => {
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Add point' }))
    expect(await screen.findByText('Choose a point type from the list')).toBeInTheDocument()
    expect(screen.getByText('Give the point a name')).toBeInTheDocument()
    expect(w.createPoint).not.toHaveBeenCalled()
  })

  it('a custom number point needs a unit that Haxall knows', async () => {
    open()
    await userEvent.click(await screen.findByLabelText(/Custom point/))
    await type('Name', 'Custom')
    await userEvent.click(screen.getByRole('button', { name: 'Add point' }))
    expect(await screen.findByText('A number point needs a unit')).toBeInTheDocument()
    w.canonicalUnit.mockResolvedValue(null)
    await userEvent.type(screen.getByLabelText('Unit'), 'furlongs')
    await userEvent.click(screen.getByRole('button', { name: 'Add point' }))
    expect(await screen.findByText(/does not know the unit .furlongs./)).toBeInTheDocument()
    expect(w.createPoint).not.toHaveBeenCalled()
  })

  it('a custom on/off point needs no unit', async () => {
    w.createPoint.mockResolvedValue({ id: ref('np') })
    const onDone = open()
    await userEvent.click(await screen.findByLabelText(/Custom point/))
    await userEvent.selectOptions(screen.getByLabelText('Holds'), 'Bool')
    expect(screen.queryByLabelText('Unit')).toBeNull()
    await type('Name', 'Fan override')
    await userEvent.click(screen.getByRole('button', { name: 'Add point' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.createPoint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'Bool', spec: undefined, name: 'Fan override' }))
  })
})

describe('EditDialog', () => {
  const full = rec({ ...ahu, note: 'old', area: { type: 'number', val: 100, unit: 'ft²' }, ownerRef: ref('o1', 'Owner') })
  const open = (r: HDict = full) => {
    const onDone = vi.fn(); const onClose = vi.fn()
    ui(<EditDialog rec={r} onClose={onClose} onDone={onDone} />)
    return { onDone, onClose }
  }

  it('shows the name and every editable tag, but not ids or links to the site', () => {
    open()
    expect(screen.getByLabelText('Name')).toHaveValue('AHU-1')
    expect(screen.getByLabelText('note value')).toHaveValue('old')
    expect(screen.getByLabelText('area value')).toHaveValue('100')
    expect(screen.getByLabelText('area unit')).toHaveValue('ft²')
    expect(screen.queryByText('siteRef')).toBeNull()
    expect(screen.queryByText('mod')).toBeNull()
    expect(screen.queryByLabelText('id value')).toBeNull()
  })

  it('closes without writing when nothing changed', async () => {
    const { onClose } = open()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onClose).toHaveBeenCalled()
    expect(w.updateRecord).not.toHaveBeenCalled()
  })

  it('sends only what changed: rename, edit, remove and add', async () => {
    w.updateRecord.mockResolvedValue(full)
    const { onDone } = open()
    await userEvent.clear(screen.getByLabelText('Name')); await type('Name', 'AHU-7')
    await userEvent.clear(screen.getByLabelText('note value')); await type('note value', 'new')
    await userEvent.click(screen.getByRole('button', { name: 'Remove ahu' }))
    await type('New tag name', 'rooftop')
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const [, sent, changes] = [w.updateRecord.mock.calls[0][0], w.updateRecord.mock.calls[0][1], w.updateRecord.mock.calls[0][2]]
    expect(sent).toBe(full)
    expect(changes).toEqual({ navName: 'AHU-7', note: 'new', ahu: { _kind: 'remove' }, rooftop: { _kind: 'marker' } })
    expect(onDone.mock.calls[0][0]).toBe('Saved changes to AHU-7.')
  })

  it('a removed tag can be restored before saving', async () => {
    const { onClose } = open()
    await userEvent.click(screen.getByRole('button', { name: 'Remove note' }))
    expect(screen.getByText('Will be removed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'undo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onClose).toHaveBeenCalled()
    expect(w.updateRecord).not.toHaveBeenCalled()
  })

  it('catches an empty name, a bad number and a unit Haxall does not know', async () => {
    open()
    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.clear(screen.getByLabelText('area value')); await type('area value', 'lots')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('The name cannot be empty')).toBeInTheDocument()
    expect(screen.getByText('Enter a number')).toBeInTheDocument()
    expect(w.updateRecord).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('Name'), 'ok')
    await userEvent.clear(screen.getByLabelText('area value')); await type('area value', '5')
    await userEvent.clear(screen.getByLabelText('area unit')); await type('area unit', 'zzz')
    w.canonicalUnit.mockResolvedValue(null)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/does not know the unit .zzz./)).toBeInTheDocument()
    expect(w.updateRecord).not.toHaveBeenCalled()
  })

  it('a changed number is saved with the canonical unit', async () => {
    w.updateRecord.mockResolvedValue(full)
    const { onDone } = open()
    await userEvent.clear(screen.getByLabelText('area value')); await type('area value', '3')
    await userEvent.clear(screen.getByLabelText('area unit')); await type('area unit', 'h')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.updateRecord.mock.calls[0][2]).toEqual({ area: { _kind: 'number', val: 3, unit: 'hr' } })
  })

  it('rejects a bad new tag name and one that is managed by the system', async () => {
    open()
    await type('New tag name', 'Bad Name')
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(await screen.findByText(/start with a lowercase letter/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('New tag name')); await type('New tag name', 'siteRef')
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(await screen.findByText('That tag is managed by the system')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('New tag name')); await type('New tag name', 'note')
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(await screen.findByText('That tag already exists')).toBeInTheDocument()
  })

  it('tells you when someone else changed the record, and keeps your edits', async () => {
    w.updateRecord.mockRejectedValue(new ConflictError())
    const { onDone } = open()
    await userEvent.clear(screen.getByLabelText('note value')); await type('note value', 'mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/since you opened it/i)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByLabelText('note value')).toHaveValue('mine')
  })

  it('edits the dis of a site (sites have no navName)', async () => {
    w.updateRecord.mockResolvedValue(siteRec)
    open(siteRec)
    await userEvent.clear(screen.getByLabelText('Name (dis)')); await type('Name (dis)', 'HQ')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(w.updateRecord).toHaveBeenCalled())
    expect(w.updateRecord.mock.calls[0][2]).toEqual({ dis: 'HQ' })
  })
})

describe('MoveDialog', () => {
  const sites = [siteRec, rec({ id: ref('s2', 'Annex'), dis: 'Annex', site: MARKER })]
  const equips = [ahu, vav, rec({ id: ref('ahu2', 'x'), navName: 'AHU-2', equip: MARKER, siteRef: ref('s2') })]

  it('lists the top of each site and every other equipment, never the thing itself or what is inside it', () => {
    const d = destinationsFor(ahu, sites, equips, new Set(['ahu1', 'vav1']))
    expect(d.map((x) => x.label)).toEqual(['Annex (top level)', 'Annex › AHU-2', 'Demo Office (top level)'])
  })

  it('a point can only go inside equipment', () => {
    const d = destinationsFor(pt, sites, equips, new Set())
    expect(d.every((x) => x.equipId)).toBe(true)
    expect(d.map((x) => x.label)).toEqual(['Annex › AHU-2', 'Demo Office › AHU-1', 'Demo Office › AHU-1 › VAV-1'])
  })

  it('moves the record to the chosen place', async () => {
    w.client.read.mockImplementation(async (f: string) => (f === 'site' ? sites : equips))
    w.findSubtree.mockResolvedValue({ root: vav, below: [], equips: [], points: [] })
    w.moveRecord.mockResolvedValue(1)
    const onDone = vi.fn()
    ui(<MoveDialog rec={vav} onClose={() => {}} onDone={onDone} />)
    const select = await screen.findByLabelText('Move to')
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled() // still where it is
    await userEvent.selectOptions(select, 's2|ahu2')
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.moveRecord).toHaveBeenCalledWith(expect.anything(), vav, { siteId: 's2', equipId: 'ahu2' })
    expect(onDone.mock.calls[0][0]).toContain('Annex › AHU-2')
  })

  it('shows the rule when a move is refused', async () => {
    w.client.read.mockImplementation(async (f: string) => (f === 'site' ? sites : equips))
    w.findSubtree.mockResolvedValue({ root: vav, below: [], equips: [], points: [] })
    w.moveRecord.mockRejectedValue(new RuleError('Something cannot be moved inside itself.'))
    ui(<MoveDialog rec={vav} onClose={() => {}} onDone={() => {}} />)
    await userEvent.selectOptions(await screen.findByLabelText('Move to'), 's1|')
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(await screen.findByText('Something cannot be moved inside itself.')).toBeInTheDocument()
  })
})

describe('DeleteDialog', () => {
  const plan = (over: object = {}) => ({
    subtree: { root: ahu, below: [vav, pt], equips: [vav], points: [pt] }, records: [ahu, vav, pt], dependents: [], samples: 0, ...over,
  })

  it('says exactly what will go, and deletes on confirmation', async () => {
    w.planDelete.mockResolvedValue(plan({ samples: 17280 }))
    w.deleteRecord.mockResolvedValue({ removed: 3, cleared: 0 })
    const onDone = vi.fn()
    ui(<DeleteDialog rec={ahu} onClose={() => {}} onDone={onDone} />)
    expect(await screen.findByText(/1 piece of equipment, 1 point/)).toBeInTheDocument()
    expect(screen.getByText(/17,280 stored history samples/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete 3 records' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(w.deleteRecord).toHaveBeenCalledWith(expect.anything(), ahu, { clearLinks: true })
    expect(onDone.mock.calls[0]).toEqual(['Deleted Demo Office AHU-1 and 2 items inside it.', 's1'])
  })

  it('lists the records that link to it, and the link clean-up can be turned off', async () => {
    w.planDelete.mockResolvedValue(plan({ dependents: [vav] }))
    w.deleteRecord.mockResolvedValue({ removed: 3, cleared: 0 })
    ui(<DeleteDialog rec={ahu} onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByText(/1 other record links to something being deleted/)).toBeInTheDocument()
    expect(screen.getByText('Demo Office VAV-1')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/Remove those links/))
    await userEvent.click(screen.getByRole('button', { name: 'Delete 3 records' }))
    await waitFor(() => expect(w.deleteRecord).toHaveBeenCalled())
    expect(w.deleteRecord.mock.calls[0][2]).toEqual({ clearLinks: false })
  })

  it('a single point just says Delete and goes back to its equipment', async () => {
    w.planDelete.mockResolvedValue({ subtree: { root: pt, below: [], equips: [], points: [] }, records: [pt], dependents: [], samples: 0 })
    w.deleteRecord.mockResolvedValue({ removed: 1, cleared: 0 })
    const onDone = vi.fn()
    ui(<DeleteDialog rec={pt} onClose={() => {}} onDone={onDone} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone.mock.calls[0]).toEqual(['Deleted Demo Office AHU-1 Temp.', 'ahu1'])
  })

  it('a site cannot be deleted until its name is typed', async () => {
    w.planDelete.mockResolvedValue({ subtree: { root: siteRec, below: [ahu], equips: [ahu], points: [] }, records: [siteRec, ahu], dependents: [], samples: 0 })
    ui(<DeleteDialog rec={siteRec} onClose={() => {}} onDone={() => {}} />)
    const go = await screen.findByRole('button', { name: 'Delete 2 records' })
    expect(go).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Type the site name/), 'demo office')
    expect(go).toBeDisabled() // names must match exactly
    await userEvent.clear(screen.getByLabelText(/Type the site name/))
    await userEvent.type(screen.getByLabelText(/Type the site name/), 'Demo Office')
    expect(go).toBeEnabled()
  })

  it('cancel does nothing', async () => {
    w.planDelete.mockResolvedValue(plan())
    const onClose = vi.fn()
    ui(<DeleteDialog rec={ahu} onClose={onClose} onDone={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(w.deleteRecord).not.toHaveBeenCalled()
  })
})

describe('AddBar', () => {
  const bar = (selected: HDict | null) => ui(<AddBar selected={selected} siteId="s1" notify={() => {}} goTo={() => {}} onSiteCreated={() => {}} />)

  it('sites can always be added; equipment needs a site or equipment; points need equipment', () => {
    bar(siteRec)
    expect(screen.getByRole('button', { name: '+ Site' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '+ Equipment' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '+ Point' })).toBeDisabled()
  })
  it('with equipment selected both work', () => {
    bar(ahu)
    expect(screen.getByRole('button', { name: '+ Equipment' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '+ Point' })).toBeEnabled()
  })
  it('with a point selected neither does', () => {
    bar(pt)
    expect(screen.getByRole('button', { name: '+ Equipment' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ Point' })).toBeDisabled()
  })
  it('with nothing loaded yet, only sites', () => {
    bar(null)
    expect(screen.getByRole('button', { name: '+ Site' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '+ Equipment' })).toBeDisabled()
  })
  it('opens and closes a dialog', async () => {
    bar(ahu)
    await userEvent.click(screen.getByRole('button', { name: '+ Point' }))
    expect(await screen.findByRole('dialog', { name: /Add a point to/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
