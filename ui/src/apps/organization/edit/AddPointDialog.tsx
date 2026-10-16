import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { canonicalUnit, createPoint, displayName, humanize, refId, type HDict } from '@ssl/haystack'
import { client } from '../../../lib/client.ts'
import { ErrorBanner } from '../../../components/Status.tsx'
import { DialogButtons, Modal } from './Modal.tsx'
import { Field } from './Field.tsx'
import { usePointSpecs, useRefreshAll } from './hooks.ts'
import { COMMON_UNITS } from './units.ts'

const MAX_SHOWN = 12
const lastName = (spec: string) => spec.split('::')[1] ?? spec

/** Pull the spec names out of "Missing required point: ..." checks of an equipment. */
export function missingSpecs(texts: string[]): string[] {
  return texts.flatMap((t) => {
    const m = /\(([A-Za-z0-9_.]+::[A-Za-z0-9_]+)\)\s*$/.exec(t)
    return m ? [m[1]] : []
  })
}

export function AddPointDialog({ equip, onClose, onDone }: { equip: HDict; onClose(): void; onDone(point: HDict | null, message: string): void }) {
  const equipId = refId(equip.id)!
  const refresh = useRefreshAll()
  const specs = usePointSpecs()
  const check = useQuery({ queryKey: ['conformance-for-add', equipId], queryFn: () => client.validateRec(equipId), retry: false })
  const missing = useMemo(() => missingSpecs((check.data ?? []).filter((i) => /Missing required point/.test(i.text)).map((i) => i.text)), [check.data])

  const [custom, setCustom] = useState(false)
  const [search, setSearch] = useState('')
  const [spec, setSpec] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'Number' | 'Bool' | 'Str'>('Number')
  const [unit, setUnit] = useState('')
  const [his, setHis] = useState(true)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<Record<string, string>>({})

  const matches = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    return (specs.data ?? []).filter((s) => words.every((w) => `${s.name} ${humanize(s.name)} ${s.lib}`.toLowerCase().includes(w)))
  }, [specs.data, search])

  const pick = (id: string) => { setSpec(id); setName((n) => n || lastName(id)) }

  const run = async (work: () => Promise<{ point: HDict | null; message: string }>) => {
    setBusy(true)
    setErr(null)
    try {
      const r = await work()
      await refresh()
      onDone(r.point, r.message)
    } catch (x) {
      setErr(x)
      setBusy(false)
    }
  }

  const addMissing = (list: string[]) => run(async () => {
    let last: HDict | null = null
    for (const s of list) last = await createPoint(client, { name: lastName(s), equipId, spec: s })
    return { point: list.length === 1 ? last : null, message: `Added ${list.length} required ${list.length === 1 ? 'point' : 'points'} to ${displayName(equip)}.` }
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p: Record<string, string> = {}
    if (!custom && !spec) p.spec = 'Choose a point type from the list'
    if (!name.trim()) p.name = 'Give the point a name'
    const u = unit.trim()
    const needsUnit = custom && kind === 'Number'
    if (needsUnit && !u) p.unit = 'A number point needs a unit'
    let canon: string | undefined
    if (u && (custom ? kind === 'Number' : true)) {
      canon = (await canonicalUnit(client, u)) ?? undefined
      if (!canon) p.unit = `Haxall does not know the unit “${u}”`
    }
    setProblems(p)
    if (Object.keys(p).length) return
    await run(async () => {
      const point = await createPoint(client, { name: name.trim(), equipId, spec: custom ? undefined : spec, kind: custom ? kind : undefined, unit: canon, his })
      return { point, message: `Added ${name.trim()}.` }
    })
  }

  return (
    <Modal title={`Add a point to ${displayName(equip)}`} onClose={onClose} wide>
      {err ? <ErrorBanner error={err} /> : null}
      {missing.length > 0 && (
        <section className="callout" aria-label="Required points that are missing">
          <div className="row-between">
            <strong>{missing.length} required {missing.length === 1 ? 'point is' : 'points are'} missing</strong>
            <button type="button" onClick={() => void addMissing(missing)} disabled={busy}>Add all {missing.length}</button>
          </div>
          <ul className="missing-list">
            {missing.map((s) => (
              <li key={s}>
                <span>{humanize(lastName(s))}</span>
                <button type="button" className="link" onClick={() => void addMissing([s])} disabled={busy}>add</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form onSubmit={submit} noValidate>
        <h3 className="form-h">{missing.length > 0 ? 'Or add a different point' : 'Point details'}</h3>
        <label className="check"><input type="checkbox" checked={custom} onChange={(e) => { setCustom(e.target.checked); setSpec('') }} /> Custom point (no standard type)</label>
        {!custom && (
          <Field label="Point type" error={problems.spec} hint={specs.isLoading ? 'Loading the list of point types…' : `${matches.length} of ${(specs.data ?? []).length} types`}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search: discharge temp sensor" />
          </Field>
        )}
        {!custom && (
          <ul className="spec-list" aria-label="Point types">
            {matches.slice(0, MAX_SHOWN).map((s) => (
              <li key={s.id}>
                <button type="button" className={`result ${spec === s.id ? 'selected' : ''}`} aria-pressed={spec === s.id} onClick={() => pick(s.id)}>
                  <span>{humanize(s.name)}</span><span className="muted small">{s.lib}</span>
                </button>
              </li>
            ))}
            {matches.length > MAX_SHOWN && <li className="muted small pad">Showing {MAX_SHOWN}. Type more to narrow the list.</li>}
          </ul>
        )}
        <div className="field-row">
          <Field label="Name" error={problems.name}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {custom && (
            <Field label="Holds">
              <select value={kind} onChange={(e) => setKind(e.target.value as 'Number' | 'Bool' | 'Str')}>
                <option value="Number">A number</option><option value="Bool">On / off</option><option value="Str">Text</option>
              </select>
            </Field>
          )}
          {(!custom || kind === 'Number') && (
            <>
              <Field label={custom ? 'Unit' : 'Unit (optional)'} error={problems.unit} hint={custom ? undefined : 'Leave blank to use the type’s usual unit'}>
                <input list="common-units" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </Field>
              <datalist id="common-units">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={his} onChange={(e) => setHis(e.target.checked)} /> Keep history for this point</label>
        <DialogButtons onCancel={onClose} submitLabel="Add point" busy={busy} />
      </form>
    </Modal>
  )
}
