import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { displayName, isRef, refId, str, type HDict } from '@ssl/haystack'
import { client } from '../../lib/client.ts'
import { Empty, ErrorBanner, Loading } from '../../components/Status.tsx'
import { nameOf } from '../organization/tree.ts'

/** Words typed in the search box must all appear somewhere in the point's names, spec or unit. */
export function matchesSearch(p: HDict, text: string): boolean {
  const hay = `${displayName(p)} ${nameOf(p)} ${refId(p.spec) ?? ''} ${str(p.unit) ?? ''}`.toLowerCase()
  return text.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

const equipLabel = (p: HDict) => (isRef(p.equipRef) ? p.equipRef.dis ?? p.equipRef.id : '(no equipment)')

export function PointPicker({ siteId, selected, max, onToggle, onAdd }: {
  siteId: string; selected: string[]; max: number; onToggle(id: string): void; onAdd(ids: string[]): void
}) {
  const [text, setText] = useState('')
  const [useFilter, setUseFilter] = useState(false)
  const [applied, setApplied] = useState('')

  const all = useQuery({ queryKey: ['hisPoints', siteId], queryFn: () => client.read(`point and his and siteRef==@${siteId}`), retry: false })
  const filtered = useQuery({
    queryKey: ['hisPointsFilter', siteId, applied], enabled: useFilter && applied !== '', retry: false,
    queryFn: () => client.read(`(${applied}) and point and his and siteRef==@${siteId}`, 500),
  })

  const source = useFilter ? filtered : all
  const rows = useMemo(() => {
    const list = source.data ?? []
    return useFilter ? list : list.filter((p) => matchesSearch(p, text))
  }, [source.data, useFilter, text])

  const groups = useMemo(() => {
    const m = new Map<string, HDict[]>()
    for (const p of rows) { const k = equipLabel(p); if (!m.has(k)) m.set(k, []); m.get(k)!.push(p) }
    const collator = new Intl.Collator(undefined, { numeric: true })
    return [...m.entries()].sort((a, b) => collator.compare(a[0], b[0])).map(([k, v]) => [k, v.sort((x, y) => collator.compare(nameOf(x), nameOf(y)))] as const)
  }, [rows])

  const full = selected.length >= max
  return (
    <section aria-label="Point picker" className="picker">
      <form onSubmit={(e) => { e.preventDefault(); setApplied(text.trim()) }} role="search">
        <input aria-label={useFilter ? 'Haystack filter' : 'Search points'} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          placeholder={useFilter ? 'e.g. temp and sensor' : 'Search: ahu-1 temp'} className={useFilter ? 'mono' : ''} />
        {useFilter && <button type="submit" disabled={!text.trim()}>Run</button>}
      </form>
      <label className="check small"><input type="checkbox" checked={useFilter} onChange={(e) => { setUseFilter(e.target.checked); setApplied('') }} /> Use a Haystack filter</label>
      <p className="muted small">{selected.length} of {max} points selected{full ? ' (limit reached)' : ''}</p>
      {source.isLoading && <Loading label="Loading points…" />}
      {source.isError && <ErrorBanner error={source.error} onRetry={() => void source.refetch()} />}
      {!source.isLoading && !source.isError && groups.length === 0 && <Empty title={useFilter && !applied ? 'Type a filter and press Run' : 'No matching points'} />}
      <div className="picker-list">
        {groups.map(([equip, pts]) => (
          <div key={equip} className="picker-group">
            <div className="row-between">
              <strong className="small">{equip}</strong>
              <button className="link small" disabled={full} onClick={() => onAdd(pts.map((p) => refId(p.id)!))}>add all</button>
            </div>
            {pts.map((p) => {
              const id = refId(p.id)!
              const on = selected.includes(id)
              return (
                <label key={id} className={`pick ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} disabled={!on && full} onChange={() => onToggle(id)} />
                  <span>{nameOf(p)}</span>
                  <span className="muted small">{str(p.unit) ?? (p.kind === 'Bool' ? 'on/off' : '')}</span>
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
