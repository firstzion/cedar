// Builds the ECharts option for the Trend Viewer. All the data decisions (gaps, decimation, units) are made
// in series.ts; this file only turns them into chart settings.
import type { EChartsCoreOption } from 'echarts/core'
import { decimate, groupByUnit, type Prepared, type UnitGroup } from './series.ts'

export interface PlotSeries { prep: Prepared; color: string; dashed: boolean }
export interface Theme { text: string; muted: string; line: string; surface: string; gap: string; font: string }
export type Layout = 'panels' | 'overlay'

export interface WallClock { toWall(ms: number): number; fromWall(wall: number): number }

export interface BuildArgs {
  series: PlotSeries[]
  layout: Layout
  startMs: number
  endMs: number
  /** visible window in real ms, or null for the whole range */
  window: [number, number] | null
  buckets: number
  wall: WallClock
  theme: Theme
}

export const PANEL_HEIGHT = 150
export const chartHeight = (groups: number, layout: Layout) =>
  layout === 'panels' ? Math.min(900, Math.max(340, groups * PANEL_HEIGHT + 120)) : 420

const MAX_GAP_BANDS = 30

/** What to draw for one series in the current window, in wall-clock x. */
export function seriesData(s: PlotSeries, a: Pick<BuildArgs, 'window' | 'startMs' | 'endMs' | 'buckets' | 'wall'>) {
  const [from, to] = a.window ?? [a.startMs, a.endMs]
  return decimate(s.prep, from, to, a.buckets).map(([ms, y]) => [a.wall.toWall(ms), y])
}

export function gapBands(s: PlotSeries, a: Pick<BuildArgs, 'wall'>) {
  return s.prep.gaps.slice(0, MAX_GAP_BANDS).map((g) => [{ xAxis: a.wall.toWall(g.startMs) }, { xAxis: a.wall.toWall(g.endMs) }])
}

export function buildOption(a: BuildArgs): EChartsCoreOption {
  const groups: UnitGroup[] = groupByUnit(a.series.map((s) => s.prep))
  const groupOf = (i: number) => groups.findIndex((g) => g.members.includes(i))
  const panels = a.layout === 'panels'
  const n = groups.length
  const wallStart = a.wall.toWall(a.startMs)
  const wallEnd = a.wall.toWall(a.endMs)
  const axisText = { color: a.theme.muted, fontSize: 11 }

  // ---- grids ----
  const top = 28, bottom = 78, gap = 22
  const height = chartHeight(n, a.layout)
  const grids = panels
    ? groups.map((_, i) => {
        const panelH = (height - top - bottom - gap * (n - 1)) / n
        return { left: 64, right: 24, top: top + i * (panelH + gap), height: panelH }
      })
    : [{ left: 64 + 56 * Math.max(0, Math.ceil((n - 1) / 2) - 1) * 0, right: 24, top, height: height - top - bottom }]

  // overlay: spread extra y axes to both sides
  const leftCount = Math.ceil(n / 2)
  const rightCount = n - leftCount
  if (!panels) {
    grids[0].left = 64 + 56 * Math.max(0, leftCount - 1)
    grids[0].right = 24 + 56 * Math.max(0, rightCount)
  }

  const xAxis = grids.map((_, i) => ({
    type: 'time' as const, gridIndex: i, min: wallStart, max: wallEnd,
    axisLine: { lineStyle: { color: a.theme.line } },
    axisTick: { show: false },
    axisLabel: { ...axisText, show: !panels || i === grids.length - 1 },
    splitLine: { show: true, lineStyle: { color: a.theme.line, opacity: 0.5 } },
    axisPointer: { lineStyle: { color: a.theme.muted, width: 1 } },
  }))

  const yAxis = groups.map((g, i) => {
    const base = {
      type: 'value' as const,
      gridIndex: panels ? i : 0,
      name: g.label,
      nameTextStyle: { ...axisText, align: 'left' as const },
      nameGap: 8,
      axisLine: { show: !panels, lineStyle: { color: a.theme.line } },
      axisTick: { show: false },
      splitLine: { show: panels || i === 0, lineStyle: { color: a.theme.line, opacity: 0.5 } },
    }
    const side = panels ? {} : i % 2 === 0
      ? { position: 'left' as const, offset: 56 * Math.floor(i / 2) }
      : { position: 'right' as const, offset: 56 * Math.floor(i / 2) }
    if (g.kind === 'bool') {
      return { ...base, ...side, min: -0.2, max: 1.2, interval: 0.2, splitLine: { show: false },
        axisLabel: { ...axisText, formatter: (v: number) => (Math.abs(v) < 1e-9 ? 'off' : Math.abs(v - 1) < 1e-9 ? 'on' : '') } }
    }
    if (g.kind === 'enum') {
      const levels = Math.max(...g.members.map((m) => a.series[m].prep.levels.length), 1)
      const names = a.series[g.members[0]].prep.levels
      return { ...base, ...side, min: -0.5, max: levels - 0.5, interval: 1,
        axisLabel: { ...axisText, formatter: (v: number) => names[Math.round(v)] ?? '' } }
    }
    return { ...base, ...side, scale: true, axisLabel: { ...axisText } }
  })

  // ---- series ----
  const sArgs = { window: a.window, startMs: a.startMs, endMs: a.endMs, buckets: a.buckets, wall: a.wall }
  const lines = a.series.map((s, i) => {
    const gi = groupOf(i)
    return {
      id: s.prep.id, name: s.prep.name, type: 'line' as const,
      xAxisIndex: panels ? gi : 0, yAxisIndex: gi,
      data: seriesData(s, sArgs),
      showSymbol: false, symbol: 'none', connectNulls: false, animation: false,
      step: s.prep.kind === 'number' ? (false as const) : ('end' as const),
      sampling: undefined, // we decimate ourselves so spikes survive
      lineStyle: { width: 2, color: s.color, type: s.dashed ? ('dashed' as const) : ('solid' as const) },
      itemStyle: { color: s.color },
      emphasis: { disabled: true },
      markArea: s.prep.gaps.length
        ? { silent: true, itemStyle: { color: a.theme.gap }, data: gapBands(s, a) }
        : undefined,
    }
  })

  const axisIdx = Array.from({ length: grids.length }, (_, i) => i)
  return {
    useUTC: true,
    animation: false,
    textStyle: { color: a.theme.text, fontFamily: a.theme.font },
    grid: grids,
    xAxis,
    yAxis,
    series: lines,
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: a.theme.muted } },
    tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'line' }, backgroundColor: a.theme.surface,
      borderColor: a.theme.line, textStyle: { color: a.theme.text } },
    dataZoom: [
      { type: 'inside', xAxisIndex: axisIdx, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true },
      { type: 'slider', xAxisIndex: axisIdx, filterMode: 'none', height: 22, bottom: 10,
        borderColor: a.theme.line, textStyle: { color: a.theme.muted }, brushSelect: false },
    ],
  }
}
