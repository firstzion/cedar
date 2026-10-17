import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { displayName, findSubtree, moveRecord, refId, type HDict } from '@ssl/haystack'
import { client } from '../../../lib/client.ts'
import { ErrorBanner, Loading } from '../../../components/Status.tsx'
import { DialogButtons, Modal } from './Modal.tsx'
import { Field } from './Field.tsx'
import { useRefreshAll } from './hooks.ts'
import { nameOf } from '../tree.ts'

export interface Destination { value: string; label: string; siteId: string; equipId?: string }

/** Everywhere a record may go: the top of any site (equipment only) or inside any other equipment, never inside itself. */
export function destinationsFor(rec: HDict, sites: HDict[], equips: HDict[], excluded: Set<string>): Destination[] {
  const byId = new Map(equips.map((e) => [refId(e.id)!, e]))
  const siteName = new Map(sites.map((s) => [refId(s.id)!, displayName(s)]))
  const pathOf = (e: HDict): string => {
    const names: string[] = []
    const seen = new Set<string>()
    for (let cur: HDict | undefined = e; cur && !seen.has(refId(cur.id)!); cur = byId.get(refId(cur.equipRef) ?? '')) {
      seen.add(refId(cur.id)!)
      names.unshift(nameOf(cur))
    }
    return names.join(' › ')
  }
  const out: Destination[] = []
  if (!rec.point) {
    for (const s of sites) out.push({ value: `${refId(s.id)}|`, label: `${displayName(s)} (top level)`, siteId: refId(s.id)! })
  }
  for (const e of equips) {
    const id = refId(e.id)!
    if (excluded.has(id)) continue
    const sid = refId(e.siteRef)
    if (!sid) continue
    out.push({ value: `${sid}|${id}`, label: `${siteName.get(sid) ?? sid} › ${pathOf(e)}`, siteId: sid, equipId: id })
  }
  // by site, then the top of the site before the equipment inside it, then by name
  const siteOf = (d: Destination) => siteName.get(d.siteId) ?? d.siteId
  return out.sort((a, b) =>
    siteOf(a).localeCompare(siteOf(b), undefined, { numeric: true }) ||
    Number(!!a.equipId) - Number(!!b.equipId) ||
    a.label.localeCompare(b.label, undefined, { numeric: true }))
}

export function MoveDialog({ rec, onClose, onDone }: { rec: HDict; onClose(): void; onDone(message: string): void }) {
  const refresh = useRefreshAll()
  const id = refId(rec.id)!
  const data = useQuery({
    queryKey: ['move-options', id], retry: false,
    queryFn: async () => {
      const [sites, equips, sub] = await Promise.all([client.read('site'), client.read('equip', 2000), rec.equip ? findSubtree(client, rec) : Promise.resolve(null)])
      return { sites, equips, below: sub?.below ?? [] }
    },
  })
  const current = `${refId(rec.siteRef)}|${refId(rec.equipRef) ?? ''}`
  const [value, setValue] = useState(current)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const options = useMemo(() => {
    if (!data.data) return []
    const excluded = new Set([id, ...data.data.below.map((r) => refId(r.id)!)])
    return destinationsFor(rec, data.data.sites, data.data.equips, excluded)
  }, [data.data, rec, id])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const dest = options.find((o) => o.value === value)
    if (!dest || value === current) return onClose()
    setBusy(true)
    setErr(null)
    try {
      const n = await moveRecord(client, rec, { siteId: dest.siteId, equipId: dest.equipId })
      await refresh()
      onDone(`Moved ${displayName(rec)}${n > 1 ? ` and ${n - 1} ${n === 2 ? 'item' : 'items'} inside it` : ''} to ${dest.label}.`)
    } catch (x) {
      setErr(x)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Move ${displayName(rec)}`} onClose={onClose} closable={!busy}>
      <form onSubmit={submit}>
        {err ? <ErrorBanner error={err} /> : null}
        {data.isLoading && <Loading label="Loading places to move to…" />}
        {data.isError && <ErrorBanner error={data.error} onRetry={() => void data.refetch()} />}
        {data.data && (
          <Field label="Move to" hint={rec.equip ? 'Everything inside it moves too. Moving to another site updates their site as well.' : 'A point lives inside a piece of equipment.'}>
            <select value={value} onChange={(e) => setValue(e.target.value)}>
              {!options.some((o) => o.value === current) && <option value={current}>(where it is now)</option>}
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        <DialogButtons onCancel={onClose} submitLabel="Move" busy={busy} disabled={!data.data || value === current} />
      </form>
    </Modal>
  )
}
