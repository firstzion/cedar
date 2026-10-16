import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isRef, refId, type HDict } from '@ssl/haystack'
import { client } from '../../lib/client.ts'
import { Empty, ErrorBanner, Loading } from '../../components/Status.tsx'
import { EXAMPLE_FILTERS } from './examples.ts'
import { kindOf, nameOf } from './tree.ts'

const LIMIT = 500

export function FilterBar({ value, onRun, onClear }: { value: string | null; onRun(f: string): void; onClear(): void }) {
  const [text, setText] = useState(value ?? '')
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) onRun(text.trim()) }
  return (
    <form className="filterbar" onSubmit={submit} role="search">
      <label className="grow">
        <span className="muted small">Haystack filter</span>
        <input className="mono" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          placeholder="e.g. point and his and equipRef==@abc-123" aria-label="Haystack filter" />
      </label>
      <button type="submit" disabled={!text.trim()}>Run</button>
      {value !== null && <button type="button" className="secondary" onClick={() => { setText(''); onClear() }}>Clear</button>}
      <div className="examples">
        {EXAMPLE_FILTERS.map((x) => <button key={x} type="button" className="link small" onClick={() => { setText(x); onRun(x) }}>{x}</button>)}
      </div>
    </form>
  )
}

export function FilterResults({ filter, selectedId, onSelect }: { filter: string; selectedId: string | null; onSelect(id: string): void }) {
  const q = useQuery({ queryKey: ['filter', filter], queryFn: () => client.read(filter, LIMIT + 1), retry: false })
  if (q.isLoading) return <Loading label="Running filter…" />
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
  const rows: HDict[] = q.data ?? []
  if (rows.length === 0) return <Empty title="No records match" hint={filter} />
  const shown = rows.slice(0, LIMIT)
  return (
    <div>
      <p className="muted small">{rows.length > LIMIT ? `Showing the first ${LIMIT} records` : `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`}</p>
      <ul className="results" aria-label="Filter results">
        {shown.map((r) => {
          const id = refId(r.id)!
          return (
            <li key={id}>
              <button className={`result ${selectedId === id ? 'selected' : ''}`} onClick={() => onSelect(id)}>
                <span>{nameOf(r)}</span>
                <span className="muted small">
                  {isRef(r.equipRef) && r.equipRef.dis ? `${r.equipRef.dis} \u00B7 ` : ''}{kindOf(r)} &middot; {refId(r.spec)?.split('::')[1] ?? 'no spec'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
