import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { displayName, ianaFromHaystack, isDateTime, iso, refId, str, type HDict } from '@ssl/haystack'
import { client } from '../lib/client.ts'
import { Empty, ErrorBanner, Loading } from '../components/Status.tsx'
import { useSite } from '../shell/SiteContext.tsx'
import type { PlotSeries } from './trends/chartOption.ts'
import { HistoryChart } from './trends/HistoryChart.tsx'
import { HistoryTable } from './trends/HistoryTable.tsx'
import { PointPicker } from './trends/PointPicker.tsx'
import { RangeBar } from './trends/RangeBar.tsx'
import { resolveRange } from './trends/ranges.ts'
import { kindOfValues, prepare, toCsv, type Kind, type SeriesInput } from './trends/series.ts'
import { SeriesLegend } from './trends/SeriesLegend.tsx'
import { useDark } from './trends/useDark.ts'
import { MAX_POINTS, readState, writeState } from './trends/url.ts'

const SLOTS = 8

function cssColor(slot: number): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--series-${slot + 1}`).trim() || '#2a78d6'
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.hidden = true
  // Firefox only follows a link that is on the page, and some browsers have not started reading the file
  // when click() returns, so the link is removed and the file released a little later
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 1000)
}

export function TrendViewer() {
  const { site, siteId, loading, error, refetch } = useSite()
  const [params, setParams] = useSearchParams()
  const state = readState(params)
  const dark = useDark()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [win, setWin] = useState<[number, number] | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [drawMs, setDrawMs] = useState<number | null>(null)
  const slots = useRef(new Map<string, number>()) // point id -> colour slot, kept while the point stays selected

  const update = (c: Parameters<typeof writeState>[1]) => setParams(writeState(params, c), { replace: true })
  const tzName = str(site?.tz) ?? 'UTC'
  const iana = ianaFromHaystack(tzName)

  const idsKey = state.points.join(',')
  const recsQ = useQuery({ queryKey: ['recs', idsKey], enabled: state.points.length > 0, queryFn: () => client.readByIds(state.points), retry: false })
  const recs = useMemo(() => new Map((recsQ.data ?? []).map((r) => [refId(r.id)!, r] as const)), [recsQ.data])

  // the earliest and latest stored sample of the chosen points (for "All data")
  const extent = useMemo(() => {
    let s = Infinity, e = -Infinity
    for (const r of recs.values()) {
      if (isDateTime(r.hisStart)) s = Math.min(s, r.hisStart.ms)
      if (isDateTime(r.hisEnd)) e = Math.max(e, r.hisEnd.ms)
    }
    return Number.isFinite(s) && Number.isFinite(e) ? { startMs: s, endMs: e } : null
  }, [recs])

  // "now" is taken once per choice of range. Only "All data" depends on the points' extent, so other presets
  // must not be recomputed (and the history refetched) just because the point details arrived.
  const extentForRange = state.range === 'all' ? extent : null
  const range = useMemo(() => resolveRange(state.range, Date.now(), iana, extentForRange), [state.range, iana, extentForRange])

  const hisQs = useQueries({
    queries: state.points.map((id) => ({
      queryKey: ['his', id, range?.startMs, range?.endMs],
      enabled: !!range,
      queryFn: () => client.hisSeries(id, range!.startMs, range!.endMs),
      placeholderData: keepPreviousData, // keep the old picture on screen (dimmed) while new data loads
      staleTime: 60_000,
      retry: false,
    })),
  })

  // build inputs once the data and the record details have both arrived
  const sig = hisQs.map((q) => q.dataUpdatedAt).join(',') + '|' + (recsQ.dataUpdatedAt ?? 0)
  const inputs = useMemo<SeriesInput[]>(() => {
    const siteDis = site ? displayName(site) : ''
    return state.points.flatMap((id, k) => {
      const q = hisQs[k]
      const rec = recs.get(id)
      if (!q?.data || !rec) return []
      const full = displayName(rec)
      const name = siteDis && full.startsWith(siteDis + ' ') ? full.slice(siteDis.length + 1) : full
      const kindTag = str(rec.kind)
      const kind: Kind = kindTag === 'Bool' ? 'bool' : kindTag === 'Str' ? 'enum' : kindTag === 'Number' ? 'number' : kindOfValues(q.data.val)
      return [{ id, name, unit: q.data.unit ?? str(rec.unit), kind, ms: q.data.ms, val: q.data.val }]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, idsKey, recs, site])

  // stable colours: a point keeps its colour while others are added or removed
  for (const id of [...slots.current.keys()]) if (!state.points.includes(id)) slots.current.delete(id)
  for (const id of state.points) {
    if (!slots.current.has(id)) {
      const used = new Set(slots.current.values())
      let n = 0
      while (used.has(n)) n++
      slots.current.set(id, n)
    }
  }
  const all = useMemo<PlotSeries[]>(() => inputs.map((s) => {
    const slot = slots.current.get(s.id) ?? 0
    return { prep: prepare(s), color: cssColor(slot % SLOTS), dashed: slot >= SLOTS }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [inputs, dark])
  // keep these arrays stable between renders: the chart rebuilds (and forgets its zoom) whenever `shown` changes
  const shown = useMemo(() => all.filter((s) => !hidden.has(s.prep.id)), [all, hidden])
  const shownInputs = useMemo(() => inputs.filter((s) => !hidden.has(s.id)), [inputs, hidden])

  const toggle = (id: string) => update({ points: state.points.includes(id) ? state.points.filter((x) => x !== id) : [...state.points, id].slice(0, MAX_POINTS) })
  const add = (ids: string[]) => update({ points: [...new Set([...state.points, ...ids])].slice(0, MAX_POINTS) })
  const toggleHidden = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (loading) return <Loading label="Loading sites…" />
  if (error) return <ErrorBanner error={error} onRetry={refetch} />
  if (!site || !siteId) return <Empty title="No sites found" hint="Load the demo site with: make load" />

  const fetching = hisQs.some((q) => q.isFetching)
  const placeholder = hisQs.some((q) => q.isPlaceholderData)
  const firstError = hisQs.find((q) => q.isError)?.error ?? recsQ.error
  // try again whatever failed: the point details as well as the histories
  const retry = () => {
    if (recsQ.isError) void recsQ.refetch()
    hisQs.forEach((q) => void q.refetch())
  }
  const window_: [number, number] | null = range ? (win ?? [range.startMs, range.endMs]) : null
  const samples = shownInputs.reduce((n, s) => n + s.ms.length, 0)
  const empties = inputs.filter((s) => s.ms.length === 0).map((s) => s.name)
  const hasGaps = shown.some((s) => s.prep.gaps.length > 0)

  const exportCsv = () => {
    if (!window_) return
    const f = (ms: number) => iso(ms, iana).slice(0, 16).replace(/[:T]/g, '')
    download(`trend-viewer_${f(window_[0])}_${f(window_[1])}.csv`, toCsv(shownInputs, window_[0], window_[1], iana))
  }
  const coverage = (r: HDict | undefined) => (r && isDateTime(r.hisStart) && isDateTime(r.hisEnd)
    ? `${iso(r.hisStart.ms, iana).slice(0, 16).replace('T', ' ')} to ${iso(r.hisEnd.ms, iana).slice(0, 16).replace('T', ' ')}` : '')

  return (
    <section className="trends">
      <RangeBar key={state.range} rangeKey={state.range} resolved={range} tz={iana} onRange={(r) => { setWin(null); update({ range: r }) }} />
      <div className="toolbar">
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={state.view === 'chart'} className={state.view === 'chart' ? 'active' : ''} onClick={() => update({ view: 'chart' })}>Chart</button>
          <button aria-pressed={state.view === 'table'} className={state.view === 'table' ? 'active' : ''} onClick={() => update({ view: 'table' })}>Table</button>
        </div>
        {state.view === 'chart' && (
          <div className="seg" role="group" aria-label="Axes">
            <button aria-pressed={state.layout === 'panels'} className={state.layout === 'panels' ? 'active' : ''} onClick={() => update({ layout: 'panels' })} title="One panel per unit, each with its own axis">Panel per unit</button>
            <button aria-pressed={state.layout === 'overlay'} className={state.layout === 'overlay' ? 'active' : ''} onClick={() => update({ layout: 'overlay' })} title="All lines on one chart with an axis for each unit">Overlay</button>
          </div>
        )}
        {state.view === 'chart' && win && <button className="secondary" onClick={() => setResetKey((k) => k + 1)}>Reset zoom</button>}
        <span className="spacer" />
        <button className="secondary" disabled={shownInputs.length === 0} onClick={exportCsv}>Export CSV{win ? ' (zoomed range)' : ''}</button>
      </div>

      <div className="hist-body">
        <aside className="pane">
          <PointPicker siteId={siteId} selected={state.points} max={MAX_POINTS} onToggle={toggle} onAdd={add} />
        </aside>
        <div className="pane hist-main" aria-busy={fetching}>
          {state.points.length === 0 ? (
            <Empty title="No points selected" hint="Tick points in the point picker, or press “Open in Trend Viewer” on a point in Site Organization." />
          ) : (
            <>
              {all.length > 0 && <SeriesLegend items={all} hidden={hidden} onToggle={toggleHidden} onRemove={(id) => toggle(id)} />}
              {firstError ? <ErrorBanner error={firstError} onRetry={retry} /> : null}
              {!range && <Empty title="No data to show yet" hint="Choose a range." />}
              {range && inputs.length === 0 && !firstError && <Loading label="Loading history…" />}
              {range && inputs.length > 0 && samples === 0 && (
                <Empty title="No samples in this range" hint={`${empties.join(', ')} — stored data covers ${coverage(recs.get(state.points[0])) || 'a different period'}. Try “All data”.`} />
              )}
              {range && samples > 0 && (
                <div className={placeholder ? 'dim' : ''}>
                  {state.view === 'chart' ? (
                    <HistoryChart series={shown} layout={state.layout} startMs={range.startMs} endMs={range.endMs} tz={tzName} dark={dark}
                      resetKey={resetKey} onWindow={setWin} onRendered={setDrawMs} />
                  ) : (
                    <HistoryTable series={shownInputs} fromMs={window_![0]} toMs={window_![1]} tz={iana} />
                  )}
                  <p className="muted small status-line">
                    {samples.toLocaleString()} samples from {shownInputs.length} {shownInputs.length === 1 ? 'point' : 'points'}
                    {drawMs !== null && state.view === 'chart' ? ` · chart built in ${drawMs} ms` : ''}
                    {hasGaps && state.view === 'chart' ? ' · shaded bands are gaps with no stored samples; lines are not joined across them' : ''}
                    {empties.length > 0 ? ` · no samples in range for: ${empties.join(', ')}` : ''}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
