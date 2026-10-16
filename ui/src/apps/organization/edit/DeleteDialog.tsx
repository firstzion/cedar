import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { deleteRecord, displayName, planDelete, refId, type HDict } from '@ssl/haystack'
import { client } from '../../../lib/client.ts'
import { ErrorBanner, Loading } from '../../../components/Status.tsx'
import { DialogButtons, Modal } from './Modal.tsx'
import { Field } from './Field.tsx'
import { useRefreshAll } from './hooks.ts'

export function DeleteDialog({ rec, onClose, onDone }: { rec: HDict; onClose(): void; onDone(message: string, goTo: string | null): void }) {
  const refresh = useRefreshAll()
  const id = refId(rec.id)!
  const plan = useQuery({ queryKey: ['delete-plan', id], queryFn: () => planDelete(client, rec), retry: false, gcTime: 0 })
  const [clearLinks, setClearLinks] = useState(true)
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const isSite = !!rec.site
  const name = displayName(rec)
  const p = plan.data
  const total = p?.records.length ?? 0
  const equips = p?.subtree.equips.length ?? 0
  const points = p?.subtree.points.length ?? 0
  const other = p ? p.subtree.below.length - equips - points : 0
  const confirmed = !isSite || typed.trim() === name

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!p || !confirmed) return
    setBusy(true)
    setErr(null)
    try {
      const r = await deleteRecord(client, rec, { clearLinks })
      await refresh()
      onDone(`Deleted ${name}${r.removed > 1 ? ` and ${r.removed - 1} ${r.removed === 2 ? 'item' : 'items'} inside it` : ''}.`, refId(rec.equipRef) ?? refId(rec.siteRef) ?? null)
    } catch (x) {
      setErr(x)
      setBusy(false)
    }
  }

  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return (
    <Modal title={`Delete ${name}`} onClose={onClose}>
      <form onSubmit={submit}>
        {err ? <ErrorBanner error={err} /> : null}
        {plan.isLoading && <Loading label="Checking what would be deleted…" />}
        {plan.isError && <ErrorBanner error={plan.error} onRetry={() => void plan.refetch()} />}
        {p && (
          <>
            <p>This permanently deletes <strong>{name}</strong>
              {total > 1 && <> and everything inside it: {[equips ? part(equips, 'piece of equipment', 'pieces of equipment') : '', points ? part(points, 'point', 'points') : '', other ? part(other, 'other record', 'other records') : ''].filter(Boolean).join(', ')}</>}.
            </p>
            {p.samples > 0 && <p className="alert alert-warn">{p.samples.toLocaleString()} stored history samples will be lost with it.</p>}
            {p.dependents.length > 0 && (
              <div className="callout">
                <strong>{part(p.dependents.length, 'other record links', 'other records link')} to something being deleted:</strong>
                <ul className="missing-list">{p.dependents.slice(0, 8).map((d) => <li key={refId(d.id)}>{displayName(d)}</li>)}{p.dependents.length > 8 && <li className="muted">and {p.dependents.length - 8} more</li>}</ul>
                <label className="check"><input type="checkbox" checked={clearLinks} onChange={(e) => setClearLinks(e.target.checked)} /> Remove those links (otherwise they will show as spec problems)</label>
              </div>
            )}
            {isSite && (
              <Field label={`Type the site name to confirm: ${name}`}>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </Field>
            )}
            <p className="muted small">This cannot be undone. (Demo data can be recreated with <code>make load</code>.)</p>
          </>
        )}
        <DialogButtons onCancel={onClose} submitLabel={total > 1 ? `Delete ${total} records` : 'Delete'} busy={busy} disabled={!p || !confirmed} danger />
      </form>
    </Modal>
  )
}
