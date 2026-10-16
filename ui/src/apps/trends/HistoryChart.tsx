import { useEffect, useMemo, useRef } from 'react'
import { BarChart, LineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { ianaFromHaystack } from '@ssl/haystack'
import { buildOption, chartHeight, gapBands, seriesData, type Layout, type PlotSeries, type Theme } from './chartOption.ts'
import { cleanNumber, groupByUnit, wallClock } from './series.ts'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent, CanvasRenderer])

/** Theme colours come from the page's CSS variables, so light and dark mode need no separate chart code. */
export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return { text: v('--text', '#1c2430'), muted: v('--muted', '#657084'), line: v('--line', '#dde2ea'), surface: v('--panel', '#fff'), gap: v('--gap-band', 'rgba(128,128,128,0.16)'), font: v('--font', 'sans-serif') }
}

const dateFmt = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'medium' })
const lastAtOrBefore = (a: number[], x: number) => {
  let lo = 0, hi = a.length - 1, r = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] <= x) { r = m; lo = m + 1 } else hi = m - 1 }
  return r
}

export interface HistoryChartProps {
  series: PlotSeries[]
  layout: Layout
  startMs: number
  endMs: number
  tz: string // Haystack or IANA name
  dark: boolean
  /** bump to reset zoom */
  resetKey: number
  onWindow(w: [number, number] | null): void
  onRendered?(ms: number): void
}

export function HistoryChart({ series, layout, startMs, endMs, tz, dark, resetKey, onWindow, onRendered }: HistoryChartProps) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const win = useRef<[number, number] | null>(null)
  const latest = useRef({ series, layout, startMs, endMs, tz, dark })
  latest.current = { series, layout, startMs, endMs, tz, dark }
  const iana = ianaFromHaystack(tz)
  const wall = useMemo(() => wallClock(iana), [iana])
  const groups = groupByUnit(series.map((s) => s.prep)).length
  const t0 = useRef(0)

  // create once
  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'canvas' })
    chart.current = c
    // dev only: lets tests and the browser console drive the chart (zoom etc.)
    if (import.meta.env.DEV) (window as unknown as { __trendChart?: echarts.ECharts }).__trendChart = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); c.dispose(); chart.current = null }
  }, [])

  const buckets = () => Math.max(200, Math.floor((el.current?.clientWidth ?? 800) / 2))

  // full rebuild whenever the data, layout, range or theme change
  useEffect(() => {
    const c = chart.current
    if (!c) return
    win.current = null
    onWindow(null)
    t0.current = performance.now()
    const opt = buildOption({ series, layout, startMs, endMs, window: null, buckets: buckets(), wall, theme: readTheme() })
    const tooltip = opt.tooltip as Record<string, unknown>
    tooltip.formatter = (params: unknown) => tooltipElement(params, latest.current.series, wall, iana)
    c.setOption(opt, { notMerge: true })
    c.resize({ height: chartHeight(groups, layout) })
    // time spent in our code and the chart library to build the view (not the browser's wait for its next frame)
    onRendered?.(Math.round(performance.now() - t0.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, layout, startMs, endMs, wall, dark, iana])

  // zooming re-decimates from the full-resolution data so peaks and flatlines stay exact
  useEffect(() => {
    const c = chart.current
    if (!c) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const handler = (e: unknown) => {
      const p = ((e as { batch?: { start: number; end: number }[] }).batch?.[0] ?? e) as { start?: number; end?: number }
      if (p.start === undefined || p.end === undefined) return
      const cur = latest.current
      const span = cur.endMs - cur.startMs
      const full = p.start <= 0.01 && p.end >= 99.99
      const w: [number, number] | null = full ? null : [cur.startMs + (p.start / 100) * span, cur.startMs + (p.end / 100) * span]
      clearTimeout(timer)
      timer = setTimeout(() => {
        win.current = w
        onWindow(w)
        const a = { window: w, startMs: cur.startMs, endMs: cur.endMs, buckets: buckets(), wall }
        c.setOption({ series: cur.series.map((s) => ({ id: s.prep.id, data: seriesData(s, a), markArea: s.prep.gaps.length ? { silent: true, data: gapBands(s, a) } : undefined })) })
      }, 80)
    }
    c.on('datazoom', handler)
    return () => { clearTimeout(timer); c.off('datazoom', handler) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wall])

  useEffect(() => { if (resetKey > 0) chart.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }) }, [resetKey])

  return <div ref={el} className="chart" role="img" aria-label="History chart" style={{ height: chartHeight(groups, layout) }} />
}

/** One tooltip with every series at the hovered time: exact stored sample, value first, name second. */
function tooltipElement(params: unknown, series: PlotSeries[], wallc: ReturnType<typeof wallClock>, iana: string): HTMLElement {
  const list = Array.isArray(params) ? params : [params]
  const wallX = (list[0] as { axisValue?: number })?.axisValue ?? 0
  const t = wallc.fromWall(wallX)
  const box = document.createElement('div')
  box.className = 'tip'
  const head = document.createElement('div')
  head.className = 'tip-head'
  head.textContent = dateFmt(iana).format(t)
  box.appendChild(head)
  for (const s of series) {
    const p = s.prep
    const i = lastAtOrBefore(p.ms, t)
    const row = document.createElement('div')
    row.className = 'tip-row'
    const key = document.createElement('span')
    key.className = 'tip-key'
    key.style.borderTopColor = s.color
    key.style.borderTopStyle = s.dashed ? 'dashed' : 'solid'
    const val = document.createElement('strong')
    const name = document.createElement('span')
    name.className = 'tip-name'
    name.textContent = p.name
    const fresh = i >= 0 && (p.gapMs === 0 || t - p.ms[i] <= p.gapMs) && !Number.isNaN(p.y[i])
    if (!fresh) val.textContent = 'no data'
    else if (p.kind === 'bool') val.textContent = p.y[i] ? 'on' : 'off'
    else if (p.kind === 'enum') val.textContent = p.levels[p.y[i]] ?? ''
    else val.textContent = `${cleanNumber(p.y[i])}${p.unit ? ' ' + p.unit : ''}`
    if (!fresh) val.className = 'tip-none'
    row.append(key, val, name)
    box.appendChild(row)
  }
  return box
}
