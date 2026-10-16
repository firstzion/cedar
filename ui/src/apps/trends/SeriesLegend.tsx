import type { PlotSeries } from './chartOption.ts'

/** The legend doubles as the list of selected points: show/hide a series or remove it. Text stays in ink; the line key carries the colour. */
export function SeriesLegend({ items, hidden, onToggle, onRemove }: {
  items: PlotSeries[]; hidden: Set<string>; onToggle(id: string): void; onRemove(id: string): void
}) {
  return (
    <ul className="legend" aria-label="Selected points">
      {items.map((s) => {
        const off = hidden.has(s.prep.id)
        return (
          <li key={s.prep.id} className={off ? 'off' : ''}>
            <button className="legend-main" onClick={() => onToggle(s.prep.id)} aria-pressed={!off} title={off ? 'Show on chart' : 'Hide from chart'}>
              <span className="legend-key" style={{ borderTopColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }} />
              <span>{s.prep.name}</span>
              {s.prep.unit && <span className="muted small">{s.prep.unit}</span>}
            </button>
            <button className="legend-x" onClick={() => onRemove(s.prep.id)} aria-label={`Remove ${s.prep.name}`}>&times;</button>
          </li>
        )
      })}
    </ul>
  )
}
