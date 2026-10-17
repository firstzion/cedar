import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MARKER, type HDict } from '@ssl/haystack'

const mocks = vi.hoisted(() => ({ client: { read: vi.fn(), readByIds: vi.fn(), hisSeries: vi.fn() } }))
vi.mock('../../lib/client.ts', () => ({ client: mocks.client }))
vi.mock('../../shell/SiteContext.tsx', () => ({
  useSite: () => ({ site, siteId: 'site1', sites: [site], loading: false, error: null, refetch: () => {}, setSiteId: () => {} }),
}))
// the chart itself needs a real canvas; here we only check what it is given
vi.mock('./HistoryChart.tsx', () => ({
  HistoryChart: (p: { series: { prep: { name: string; ms: number[] } }[]; layout: string }) => (
    <div data-testid="chart" data-layout={p.layout}>{p.series.map((s) => <span key={s.prep.name}>{s.prep.name}:{s.prep.ms.length}</span>)}</div>
  ),
}))

import { TrendViewer } from '../TrendViewer.tsx'
import { matchesSearch } from './PointPicker.tsx'

const ref = (id: string, dis?: string) => ({ type: 'ref' as const, id, ...(dis ? { dis } : {}) })
const dt = (iso: string) => ({ type: 'dateTime' as const, ms: Date.parse(iso), iso, tz: 'Los_Angeles' })
const site: HDict = { id: ref('site1', 'Demo Office'), dis: 'Demo Office', site: MARKER, tz: 'Los_Angeles' }
const pt = (id: string, navName: string, equip: string, unit?: string, kind = 'Number'): HDict => ({
  id: ref(id, `Demo Office ${equip} ${navName}`), navName, point: MARKER, his: MARKER, kind, ...(unit ? { unit } : {}),
  equipRef: ref(`e-${equip}`, `Demo Office ${equip}`), siteRef: ref('site1'), spec: ref(`ph.points.sugar::${navName}`),
  hisStart: dt('2026-07-18T00:00:00-07:00'), hisEnd: dt('2026-10-16T00:00:00-07:00'),
})
const points = [
  pt('p1', 'DischargeAirTempSensor', 'AHU-1', '°F'), pt('p2', 'OutsideAirTempSensor', 'AHU-1', '°F'),
  pt('p3', 'DischargeFanRunCmd', 'AHU-1', undefined, 'Bool'), pt('p4', 'ZoneAirTempSensor', 'VAV-1-1', '°F'),
]
const Q = 900000
const T0 = Date.now() - 3 * 86400000
const series = (n: number) => ({ ms: Array.from({ length: n }, (_, i) => T0 + i * Q), val: Array.from({ length: n }, (_, i) => 70 + (i % 5)), unit: '°F' as string | undefined })

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }
function setup(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><TrendViewer /><Where /></MemoryRouter></QueryClientProvider>,
  )
}
const where = () => screen.getByTestId('where').textContent!

beforeEach(() => {
  vi.clearAllMocks()
  mocks.client.read.mockImplementation(async () => points)
  mocks.client.readByIds.mockImplementation(async (ids: string[]) => points.filter((p) => ids.includes((p.id as { id: string }).id)))
  mocks.client.hisSeries.mockImplementation(async () => series(96))
})

describe('matchesSearch', () => {
  it('needs every word to appear in the names, spec or unit', () => {
    expect(matchesSearch(points[0], 'ahu-1 discharge')).toBe(true)
    expect(matchesSearch(points[0], 'discharge vav')).toBe(false)
    expect(matchesSearch(points[0], '°f')).toBe(true)
    expect(matchesSearch(points[0], '')).toBe(true)
  })
})

describe('Trend Viewer page', () => {
  it('with no points selected explains what to do', async () => {
    setup('/trend-viewer')
    expect(await screen.findByText('No points selected')).toBeInTheDocument()
    expect(await screen.findByText('Demo Office AHU-1')).toBeInTheDocument()
    expect(mocks.client.hisSeries).not.toHaveBeenCalled()
  })

  it('loads the points named in the address and draws them', async () => {
    setup('/trend-viewer?points=p1,p2&range=last7')
    const chart = await screen.findByTestId('chart')
    await waitFor(() => expect(within(chart).getByText('AHU-1 DischargeAirTempSensor:96')).toBeInTheDocument())
    expect(within(chart).getByText('AHU-1 OutsideAirTempSensor:96')).toBeInTheDocument()
    expect(mocks.client.hisSeries).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/192 samples from 2 points/)).toBeInTheDocument()
    const [id, start, end] = mocks.client.hisSeries.mock.calls[0]
    expect(id).toBe('p1')
    expect(end - start).toBe(7 * 86400000)
  })

  it('ticking a point adds it to the address; the × removes it', async () => {
    setup('/trend-viewer?points=p1')
    await screen.findByTestId('chart')
    await userEvent.click(await screen.findByRole('checkbox', { name: /ZoneAirTempSensor/ }))
    expect(where()).toContain('points=p1%2Cp4')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove VAV-1-1 ZoneAirTempSensor' }))
    await waitFor(() => expect(where()).toContain('points=p1'))
    expect(where()).not.toContain('p4')
  })

  it('searching narrows the picker', async () => {
    setup('/trend-viewer')
    await screen.findByText('Demo Office VAV-1-1')
    await userEvent.type(screen.getByRole('textbox', { name: 'Search points' }), 'zone')
    expect(screen.queryByText('Demo Office AHU-1')).toBeNull()
    expect(screen.getByRole('checkbox', { name: /ZoneAirTempSensor/ })).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search points' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search points' }), 'nonexistent')
    expect(await screen.findByText('No matching points')).toBeInTheDocument()
  })

  it('stops adding at the limit', async () => {
    const many = Array.from({ length: 12 }, (_, i) => pt(`q${i}`, `Point${i}`, 'AHU-9', '%'))
    mocks.client.read.mockResolvedValue(many)
    mocks.client.readByIds.mockImplementation(async (ids: string[]) => many.filter((p) => ids.includes((p.id as { id: string }).id)))
    setup('/trend-viewer')
    await userEvent.click(await screen.findByRole('button', { name: 'add all' }))
    expect(await screen.findByText(/10 of 10 points selected \(limit reached\)/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Point11/ })).toBeDisabled()
  })

  it('range presets change the address and refetch', async () => {
    setup('/trend-viewer?points=p1')
    await screen.findByTestId('chart')
    await userEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
    await waitFor(() => expect(where()).toContain('range=last30'))
    await waitFor(() => expect(mocks.client.hisSeries.mock.calls.some(([, s, e]) => e - s === 30 * 86400000)).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => expect(where()).not.toContain('range='))
  })

  it('a custom range uses whole local days', async () => {
    setup('/trend-viewer?points=p1&range=2026-08-24_2026-08-26')
    await screen.findByTestId('chart')
    const [, start, end] = mocks.client.hisSeries.mock.calls[0]
    expect(new Date(start).toISOString()).toBe('2026-08-24T07:00:00.000Z')
    expect(new Date(end).toISOString()).toBe('2026-08-27T07:00:00.000Z')
  })

  it('table view lists the rows and the URL remembers it', async () => {
    setup('/trend-viewer?points=p1')
    await screen.findByTestId('chart')
    await userEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(await screen.findByLabelText('History table')).toBeInTheDocument()
    expect(screen.getByText('96 rows')).toBeInTheDocument()
    expect(where()).toContain('view=table')
  })

  it('layout toggle passes the choice to the chart', async () => {
    setup('/trend-viewer?points=p1')
    expect((await screen.findByTestId('chart')).dataset.layout).toBe('panels')
    await userEvent.click(screen.getByRole('button', { name: 'Overlay' }))
    await waitFor(() => expect(screen.getByTestId('chart').dataset.layout).toBe('overlay'))
  })

  it('hiding a series in the legend takes it off the chart but keeps it selected', async () => {
    setup('/trend-viewer?points=p1,p2')
    const chart = await screen.findByTestId('chart')
    await waitFor(() => expect(within(chart).getAllByText(/:96$/)).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: /AHU-1 OutsideAirTempSensor/ , pressed: true }))
    await waitFor(() => expect(within(screen.getByTestId('chart')).getAllByText(/:96$/)).toHaveLength(1))
    expect(where()).toContain('points=p1,p2')
  })

  it('says so when there are no samples in the range, and shows what the data covers', async () => {
    mocks.client.hisSeries.mockResolvedValue({ ms: [], val: [], unit: undefined })
    setup('/trend-viewer?points=p1&range=today')
    expect(await screen.findByText('No samples in this range')).toBeInTheDocument()
    expect(screen.getByText(/stored data covers 2026-07-18/)).toBeInTheDocument()
  })

  it('shows Haxall errors with a retry', async () => {
    mocks.client.hisSeries.mockRejectedValue(new Error('boom'))
    setup('/trend-viewer?points=p1')
    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('Try again also retries the point details when those failed', async () => {
    mocks.client.readByIds.mockRejectedValueOnce(new Error('details failed'))
    setup('/trend-viewer?points=p1')
    expect(await screen.findByText('details failed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('chart')).toHaveTextContent('AHU-1 DischargeAirTempSensor:96')
    expect(screen.queryByText('details failed')).toBeNull()
  })

  it('exports a CSV of what is shown', async () => {
    const created: Blob[] = []
    const realCreate = URL.createObjectURL
    URL.createObjectURL = (b: Blob | MediaSource) => { created.push(b as Blob); return 'blob:x' }
    const realRevoke = URL.revokeObjectURL
    const revoke = vi.fn()
    URL.revokeObjectURL = revoke
    let linkOnPage = false
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { linkOnPage = document.body.contains(this) })
    try {
      setup('/trend-viewer?points=p1,p2')
      await waitFor(() => expect(screen.getByRole('button', { name: /Export CSV/ })).toBeEnabled())
      await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
      expect(click).toHaveBeenCalled()
      // some browsers only download from a link that is on the page, and need the file to stay available a moment
      expect(linkOnPage).toBe(true)
      expect(revoke).not.toHaveBeenCalled()
      await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'), { timeout: 3000 })
      const text = await created[0].text()
      const lines = text.split('\r\n')
      expect(lines[0]).toBe('Timestamp,AHU-1 DischargeAirTempSensor (°F),AHU-1 OutsideAirTempSensor (°F)')
      expect(lines.length).toBe(96 + 2)
    } finally {
      URL.createObjectURL = realCreate
      URL.revokeObjectURL = realRevoke
      click.mockRestore()
    }
  })
})
