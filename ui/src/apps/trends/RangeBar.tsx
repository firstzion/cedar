import { useState } from 'react'
import { customKey, msToDate, parseCustom, PRESETS, type ResolvedRange } from './ranges.ts'

export function RangeBar({ rangeKey, resolved, tz, onRange }: { rangeKey: string; resolved: ResolvedRange | null; tz: string; onRange(key: string): void }) {
  const custom = parseCustom(rangeKey)
  const [from, setFrom] = useState(custom?.from ?? (resolved ? msToDate(resolved.startMs, tz) : ''))
  const [to, setTo] = useState(custom?.to ?? (resolved ? msToDate(resolved.endMs - 1, tz) : ''))
  const bad = !from || !to || from > to
  return (
    <div className="rangebar" role="group" aria-label="Date range">
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.key} className={`preset ${rangeKey === p.key ? 'active' : ''}`} aria-pressed={rangeKey === p.key} onClick={() => onRange(p.key)}>{p.label}</button>
        ))}
      </div>
      <div className="custom">
        <label className="small muted">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="small muted">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className={`preset ${custom ? 'active' : ''}`} disabled={bad} onClick={() => onRange(customKey(from, to))}>Apply</button>
      </div>
    </div>
  )
}
