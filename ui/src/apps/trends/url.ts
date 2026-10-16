// The Trend Viewer keeps its state in the address bar: ?points=id,id&range=last7&view=chart&layout=panels
import { DEFAULT_RANGE, isKnownRange } from './ranges.ts'
import type { Layout } from './chartOption.ts'

export const MAX_POINTS = 10

export interface TrendViewerState { points: string[]; range: string; view: 'chart' | 'table'; layout: Layout }

export function readState(p: URLSearchParams): TrendViewerState {
  const points = [...new Set((p.get('points') ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_POINTS)
  const range = p.get('range') ?? DEFAULT_RANGE
  return {
    points,
    range: isKnownRange(range) ? range : DEFAULT_RANGE,
    view: p.get('view') === 'table' ? 'table' : 'chart',
    layout: p.get('layout') === 'overlay' ? 'overlay' : 'panels',
  }
}

/** Write state back, leaving out values that are the defaults so shared links stay short. */
export function writeState(prev: URLSearchParams, change: Partial<TrendViewerState>): URLSearchParams {
  const s = { ...readState(prev), ...change }
  const next = new URLSearchParams(prev)
  if (s.points.length) next.set('points', s.points.join(',')); else next.delete('points')
  if (s.range !== DEFAULT_RANGE) next.set('range', s.range); else next.delete('range')
  if (s.view === 'table') next.set('view', 'table'); else next.delete('view')
  if (s.layout === 'overlay') next.set('layout', 'overlay'); else next.delete('layout')
  return next
}
