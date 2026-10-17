import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, MARKER, type HDict } from '@ssl/haystack'

const mocks = vi.hoisted(() => ({
  client: { read: vi.fn(), readByIds: vi.fn(), validateRec: vi.fn(), validateSite: vi.fn(), latestSample: vi.fn() },
  // the site picked in the top bar; a test can change it to act like the site dropdown
  current: { siteId: 'site1' },
}))
vi.mock('../../lib/client.ts', () => ({ client: mocks.client }))
vi.mock('../../shell/SiteContext.tsx', () => ({
  useSite: () => {
    const cur = sites.find((s) => (s.id as { id: string }).id === mocks.current.siteId)!
    return { site: cur, siteId: mocks.current.siteId, sites, loading: false, error: null, refetch: () => {}, setSiteId: () => {} }
  },
}))

import { SiteOrganization } from '../SiteOrganization.tsx'
import { ConformanceBadge } from './ConformanceBadge.tsx'
import { TagTable } from './TagTable.tsx'

const ref = (id: string, dis?: string) => ({ type: 'ref' as const, id, ...(dis ? { dis } : {}) })
const dt = (iso: string) => ({ type: 'dateTime' as const, ms: Date.parse(iso), iso, tz: 'Los_Angeles' })

const site: HDict = { id: ref('site1', 'Demo Office'), dis: 'Demo Office', site: MARKER, tz: 'Los_Angeles', spec: ref('ats::AtsSite') }
const ahu: HDict = { id: ref('ahu1', 'Demo Office AHU-1'), navName: 'AHU-1', equip: MARKER, ahu: MARKER, siteRef: ref('site1', 'Demo Office'), spec: ref('ats::AtsAhu'), mod: dt('2026-10-16T10:00:00-07:00') }
const vav: HDict = { id: ref('vav1', 'Demo Office VAV-1-1'), navName: 'VAV-1-1', equip: MARKER, vav: MARKER, siteRef: ref('site1'), equipRef: ref('ahu1', 'Demo Office AHU-1'), spec: ref('ats::AtsVav') }
const point: HDict = {
  id: ref('p1', 'Demo Office AHU-1 DischargeAirTempSensor'), navName: 'DischargeAirTempSensor', point: MARKER, his: MARKER, kind: 'Number', unit: '°F',
  equipRef: ref('ahu1', 'Demo Office AHU-1'), siteRef: ref('site1'), spec: ref('ph.points.sugar::DischargeAirTempSensor'),
  hisEnd: dt('2026-10-16T15:00:00-07:00'), tz: 'Los_Angeles',
}
const site2: HDict = { id: ref('site2', 'Second Office'), dis: 'Second Office', site: MARKER, tz: 'Los_Angeles', spec: ref('ats::AtsSite') }
const sites = [site, site2]
const all: HDict[] = [site, site2, ahu, vav, point]

function setup(url = '/site-organization') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const page = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><SiteOrganization /></MemoryRouter>
    </QueryClientProvider>
  )
  const r = render(page())
  return { ...r, rerender: () => r.rerender(page()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.current.siteId = 'site1'
  mocks.client.read.mockImplementation(async (f: string) => {
    if (f === 'equip and siteRef==@site1') return [ahu, vav]
    if (f.startsWith('point and equipRef==@ahu1')) return [point]
    if (f.startsWith('point and equipRef')) return []
    return []
  })
  mocks.client.readByIds.mockImplementation(async (ids: string[]) => all.filter((r) => ids.includes((r.id as { id: string }).id)))
  mocks.client.validateSite.mockResolvedValue([])
  mocks.client.validateRec.mockResolvedValue([])
  mocks.client.latestSample.mockResolvedValue({ ms: Date.parse('2026-10-16T15:00:00-07:00'), val: 55.1, unit: '°F', tz: 'Los_Angeles' })
})

describe('ConformanceBadge', () => {
  const item = (text: string, extra = {}) => ({ subject: 'x', slot: undefined, level: 'err' as const, rule: 'sys::missingSlot', msg: text, text, ...extra })
  const renderBadge = (rec: HDict) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}><ConformanceBadge rec={rec} /></QueryClientProvider>)
  }

  it('fits', async () => {
    renderBadge(ahu)
    expect(await screen.findByText(/Fits/)).toBeInTheDocument()
    expect(screen.getByText('ats::AtsAhu')).toBeInTheDocument()
  })

  it('lists what is missing in plain language', async () => {
    mocks.client.validateRec.mockResolvedValue([item('Missing required point: Mixed Air Temp Sensor (ph.points.sugar::MixedAirTempSensor)'), item('Missing required tag: tz')])
    renderBadge(ahu)
    expect(await screen.findByText(/2 problems/)).toBeInTheDocument()
    expect(screen.getByText(/Mixed Air Temp Sensor/)).toBeInTheDocument()
    expect(screen.getByText(/Missing required tag: tz/)).toBeInTheDocument()
  })

  it('a record with no spec says so', async () => {
    mocks.client.validateRec.mockResolvedValue([{ ...item(''), rule: 'sys::missingSpecRef', text: 'No spec is assigned to this record (it has no spec tag).' }])
    const { spec: _spec, ...noSpec } = ahu
    renderBadge(noSpec)
    expect(await screen.findByText(/No spec/)).toBeInTheDocument()
  })

  it('a failed check does not claim the record fits', async () => {
    mocks.client.validateRec.mockRejectedValue(new ApiError('eval', 'boom'))
    renderBadge(ahu)
    expect(await screen.findByText('Could not check the spec')).toBeInTheDocument()
    expect(screen.queryByText(/Fits/)).toBeNull()
  })
})

describe('TagTable', () => {
  it('shows refs as links, spec as plain text, markers as chips', () => {
    render(<MemoryRouter><TagTable rec={vav} siteTz="Los_Angeles" filter={null} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Demo Office AHU-1' })).toHaveAttribute('href', '/site-organization?sel=ahu1')
    expect(screen.getByRole('link', { name: '@site1' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /AtsVav/ })).toBeNull()
    expect(screen.getByText('ats::AtsVav')).toBeInTheDocument()
    expect(screen.getByText('vav')).toHaveClass('chip')
  })

  it('keeps the current filter when following a link', () => {
    render(<MemoryRouter><TagTable rec={vav} filter="point and his" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Demo Office AHU-1' }).getAttribute('href')).toBe('/site-organization?sel=ahu1&filter=point+and+his')
  })
})

describe('Site Organization', () => {
  it('shows the site tree, selects the site and loads points only when equipment is opened', async () => {
    setup()
    expect(await screen.findByRole('treeitem', { name: /AHU-1/ })).toBeInTheDocument()
    expect(await screen.findByText(/Fits/)).toBeInTheDocument()
    expect(mocks.client.read).not.toHaveBeenCalledWith('point and equipRef==@ahu1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand AHU-1' }))
    expect(await screen.findByRole('button', { name: 'DischargeAirTempSensor' })).toBeInTheDocument()
    expect(mocks.client.read).toHaveBeenCalledWith('point and equipRef==@ahu1')
  })

  it('marks records with spec problems in the tree', async () => {
    mocks.client.validateSite.mockResolvedValue([{ subject: 'vav1', slot: undefined, level: 'err', rule: 'r', msg: 'm', text: 'm' }])
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Expand AHU-1' })) // VAV-1-1 sits under AHU-1
    const row = await screen.findByRole('treeitem', { name: /VAV-1-1/ })
    expect(await within(row).findByLabelText('1 spec problems')).toBeInTheDocument()
  })

  it('opens a record from the URL, with the latest history sample and a Trend Viewer link', async () => {
    setup('/site-organization?sel=p1')
    expect(await screen.findByRole('heading', { name: 'Demo Office AHU-1 DischargeAirTempSensor' })).toBeInTheDocument()
    expect(await screen.findByText('55.1 °F')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Trend Viewer' })).toHaveAttribute('href', '/trend-viewer?points=p1&range=last7')
    expect(screen.getAllByText(/Latest history sample/).length).toBeGreaterThan(0)
  })

  it('runs a filter and lists results with their equipment', async () => {
    mocks.client.read.mockImplementation(async (f: string) => (f === 'point and his' ? [point] : []))
    setup('/site-organization?filter=point+and+his')
    const list = await screen.findByRole('list', { name: 'Filter results' })
    expect(within(list).getByText('DischargeAirTempSensor')).toBeInTheDocument()
    expect(within(list).getByText(/Demo Office AHU-1/)).toBeInTheDocument()
  })

  it('shows Haxall’s message for a bad filter', async () => {
    mocks.client.read.mockRejectedValue(new ApiError('read', 'sys::ParseErr: Expecting tag name, not =='))
    setup('/site-organization?filter=point+and+%3D%3D')
    expect(await screen.findByText(/Expecting tag name/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('Back shows the filter that is running again, not the one typed last', async () => {
    function Back() { const nav = useNavigate(); return <button onClick={() => void nav(-1)}>Back</button> }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/site-organization?filter=equip', '/site-organization?filter=point+and+his']} initialIndex={1}>
          <SiteOrganization /><Back />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByLabelText('Haystack filter')).toHaveValue('point and his')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByLabelText('Haystack filter')).toHaveValue('equip'))
  })

  it('empty filter result is explained', async () => {
    mocks.client.read.mockResolvedValue([])
    setup('/site-organization?filter=nothing')
    await waitFor(() => expect(screen.getByText('No records match')).toBeInTheDocument())
  })

  it('shows the add toolbar and Edit / Move / Delete for the selected record', async () => {
    setup('/site-organization?sel=p1')
    expect(await screen.findByRole('toolbar', { name: 'Add to the site' })).toBeInTheDocument()
    const actions = await screen.findByRole('group', { name: 'Change this record' })
    expect(within(actions).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(within(actions).getByRole('button', { name: 'Move' })).toBeInTheDocument()
    expect(within(actions).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('a site can be edited or deleted but not moved', async () => {
    setup('/site-organization?sel=site1')
    const actions = await screen.findByRole('group', { name: 'Change this record' })
    expect(within(actions).queryByRole('button', { name: 'Move' })).toBeNull()
    expect(within(actions).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('picking another site drops the old selection, so adding goes into the new site', async () => {
    const page = setup('/site-organization?sel=ahu1')
    expect(await screen.findByRole('heading', { name: 'Demo Office AHU-1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Point' })).toBeEnabled()

    mocks.current.siteId = 'site2'
    page.rerender()
    expect(await screen.findByRole('heading', { name: 'Second Office' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Demo Office AHU-1' })).toBeNull()
    // the new site's tree is open, and the add buttons point at the new site, not at AHU-1
    expect(await screen.findByRole('treeitem', { name: /Second Office/ })).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('No equipment')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Equipment' })).toHaveAttribute('title', 'Add equipment inside Second Office'))
    expect(screen.getByRole('button', { name: '+ Point' })).toBeDisabled()
  })

  it('a link to a record survives the first load of the sites', async () => {
    setup('/site-organization?sel=p1')
    expect(await screen.findByRole('heading', { name: 'Demo Office AHU-1 DischargeAirTempSensor' })).toBeInTheDocument()
  })

  it('Edit opens a dialog for that record; closing it leaves the page as it was', async () => {
    setup('/site-organization?sel=p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: /Edit/ })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('DischargeAirTempSensor')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
