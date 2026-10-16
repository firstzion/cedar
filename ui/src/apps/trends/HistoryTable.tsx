import { useMemo, useRef, useState } from 'react'
import { iso } from '@ssl/haystack'
import { cleanNumber, mergeRows, type RawVal, type SeriesInput } from './series.ts'

const ROW = 30
const VIEW = 480

const fmt = (v: RawVal | undefined): string => {
  if (v === undefined || v === null) return ''
  if (typeof v === 'number') return String(cleanNumber(v))
  return String(v)
}

/** Same numbers as the chart, as a table. Only the rows on screen are drawn, so 90 days of data scrolls smoothly. */
export function HistoryTable({ series, fromMs, toMs, tz }: { series: SeriesInput[]; fromMs: number; toMs: number; tz: string }) {
  const merged = useMemo(() => mergeRows(series, fromMs, toMs), [series, fromMs, toMs])
  const [top, setTop] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const total = merged.ms.length
  const first = Math.max(0, Math.floor(top / ROW) - 5)
  const last = Math.min(total, Math.ceil((top + VIEW) / ROW) + 5)

  if (total === 0) return <div className="empty"><strong>No samples in this range</strong></div>
  return (
    <div>
      <p className="muted small">{total.toLocaleString()} rows</p>
      <div ref={box} className="table-scroll" style={{ height: VIEW }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} tabIndex={0} aria-label="History table">
        <table className="his-table" style={{ height: total * ROW + ROW }}>
          <thead>
            <tr>
              <th scope="col">Time</th>
              {series.map((s) => <th scope="col" key={s.id}>{s.name}{s.unit ? <span className="muted"> ({s.unit})</span> : null}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: first * ROW }} aria-hidden="true"><td colSpan={series.length + 1} /></tr>
            {Array.from({ length: last - first }, (_, k) => {
              const r = first + k
              return (
                <tr key={r} style={{ height: ROW }}>
                  <td className="mono">{iso(merged.ms[r], tz).replace('T', ' ').slice(0, 16)}</td>
                  {merged.cols.map((c, j) => <td key={j} className="num">{fmt(c[r])}</td>)}
                </tr>
              )
            })}
            <tr style={{ height: (total - last) * ROW }} aria-hidden="true"><td colSpan={series.length + 1} /></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
