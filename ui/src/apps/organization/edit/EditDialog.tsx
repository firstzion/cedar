import { useMemo, useState, type FormEvent } from 'react'
import { canonicalUnit, displayName, isTagName, updateRecord, type HDict } from '@ssl/haystack'
import { client } from '../../../lib/client.ts'
import { ErrorBanner } from '../../../components/Status.tsx'
import { DialogButtons, Modal } from './Modal.tsx'
import { Field } from './Field.tsx'
import { useRefreshAll } from './hooks.ts'
import { diffTags, draftOf, emptyDraft, LOCKED_TAGS, type Draft, type DraftKind } from './tagdraft.ts'
import { COMMON_UNITS } from './units.ts'

const KIND_LABEL: Record<DraftKind, string> = { marker: 'Marker (a yes/no tag)', text: 'Text', number: 'Number', bool: 'True / false', ref: 'Link to a record', fixed: '' }
const NEW_KINDS: DraftKind[] = ['marker', 'text', 'number', 'bool', 'ref']

/** Rename a record and edit its tags. Only what you change is sent. Links to the site or equipment are changed with Move. */
export function EditDialog({ rec, onClose, onDone }: { rec: HDict; onClose(): void; onDone(message: string): void }) {
  const refresh = useRefreshAll()
  const nameTag = rec.navName !== undefined && rec.navName !== null ? 'navName' : 'dis'
  const initial = useMemo(() => {
    const m: Record<string, Draft | null> = {}
    for (const [k, v] of Object.entries(rec)) if (v !== null && v !== undefined && !LOCKED_TAGS.includes(k)) m[k] = draftOf(v)
    if (!m[nameTag]) m[nameTag] = { ...emptyDraft('text') }
    return m
  }, [rec, nameTag])
  const [edits, setEdits] = useState<Record<string, Draft | null>>(initial)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<DraftKind>('marker')
  const [newError, setNewError] = useState('')

  const patch = (tag: string, change: Partial<Draft>) => setEdits((e) => ({ ...e, [tag]: { ...(e[tag] as Draft), ...change } }))
  const tags = Object.keys(edits).filter((t) => t !== nameTag).sort((a, b) => a.localeCompare(b))

  const addTag = () => {
    const t = newName.trim()
    if (!isTagName(t)) return setNewError('Tag names start with a lowercase letter and use letters and digits only')
    if (LOCKED_TAGS.includes(t)) return setNewError('That tag is managed by the system')
    if (edits[t] !== undefined && edits[t] !== null) return setNewError('That tag already exists')
    setEdits((e) => ({ ...e, [t]: emptyDraft(newKind) }))
    setNewName('')
    setNewError('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true) // straight away: the unit check below waits for Haxall, and a second click must not save twice
    const { changes, errors } = diffTags(rec, edits)
    const nameDraft = edits[nameTag]
    if (!nameDraft || !nameDraft.text.trim()) errors[nameTag] = 'The name cannot be empty'
    // Haxall does not check units when a record is saved, so look up the ones that changed and store Haxall's own spelling
    for (const [t, d] of Object.entries(edits)) {
      if (!d || d.kind !== 'number' || !d.unit.trim() || !(t in changes)) continue
      const canon = await canonicalUnit(client, d.unit.trim())
      if (!canon) errors[t] = `Haxall does not know the unit “${d.unit.trim()}”`
      else changes[t] = { ...(changes[t] as Record<string, unknown>), unit: canon }
    }
    setProblems(errors)
    if (Object.keys(errors).length) { setBusy(false); return }
    if (Object.keys(changes).length === 0) return onClose()
    setErr(null)
    try {
      await updateRecord(client, rec, changes)
      await refresh()
      onDone(`Saved changes to ${nameDraft?.text.trim() || displayName(rec)}.`)
    } catch (x) {
      setErr(x)
      setBusy(false)
    }
  }

  const row = (tag: string, d: Draft | null) => {
    if (d === null) {
      return (
        <tr key={tag} className="removed">
          <th scope="row"><s>{tag}</s></th>
          <td className="muted">Will be removed</td>
          <td><button type="button" className="link" onClick={() => setEdits((x) => ({ ...x, [tag]: initial[tag] ?? emptyDraft('text') }))}>undo</button></td>
        </tr>
      )
    }
    return (
      <tr key={tag}>
        <th scope="row">{tag}</th>
        <td>
          {d.kind === 'marker' && <span className="chip">present</span>}
          {d.kind === 'text' && <input aria-label={`${tag} value`} value={d.text} onChange={(e) => patch(tag, { text: e.target.value })} />}
          {d.kind === 'bool' && <label className="check"><input type="checkbox" aria-label={`${tag} value`} checked={d.bool} onChange={(e) => patch(tag, { bool: e.target.checked })} /> {d.bool ? 'true' : 'false'}</label>}
          {d.kind === 'ref' && <input aria-label={`${tag} value`} className="mono" value={d.text} onChange={(e) => patch(tag, { text: e.target.value })} />}
          {d.kind === 'number' && (
            <span className="num-edit">
              <input aria-label={`${tag} value`} inputMode="decimal" value={d.text} onChange={(e) => patch(tag, { text: e.target.value })} />
              <input aria-label={`${tag} unit`} list="edit-units" value={d.unit} onChange={(e) => patch(tag, { unit: e.target.value })} placeholder="unit" />
            </span>
          )}
          {d.kind === 'fixed' && <span className="muted small">kept as is (not editable here)</span>}
          {problems[tag] && <span className="field-error" role="alert">{problems[tag]}</span>}
        </td>
        <td><button type="button" className="link" aria-label={`Remove ${tag}`} onClick={() => setEdits((x) => ({ ...x, [tag]: null }))}>remove</button></td>
      </tr>
    )
  }

  return (
    <Modal title={`Edit ${displayName(rec)}`} onClose={onClose} closable={!busy} wide>
      <form onSubmit={submit} noValidate>
        {err ? <ErrorBanner error={err} /> : null}
        <Field label={nameTag === 'dis' ? 'Name (dis)' : 'Name'} error={problems[nameTag]} hint={nameTag === 'navName' ? 'The full display name is built from this and its parents.' : undefined}>
          <input value={edits[nameTag]?.text ?? ''} onChange={(e) => patch(nameTag, { text: e.target.value })} />
        </Field>
        <h3 className="form-h">Tags</h3>
        <table className="tag-edit">
          <tbody>{tags.map((t) => row(t, edits[t]))}</tbody>
        </table>
        <datalist id="edit-units">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        <div className="add-tag">
          <input aria-label="New tag name" value={newName} onChange={(e) => { setNewName(e.target.value); setNewError('') }} placeholder="new tag name" />
          <select aria-label="New tag type" value={newKind} onChange={(e) => setNewKind(e.target.value as DraftKind)}>
            {NEW_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <button type="button" className="secondary" onClick={addTag}>Add tag</button>
        </div>
        {newError && <div className="field-error" role="alert">{newError}</div>}
        <p className="muted small">The id, links to the site and equipment, and values Haxall keeps itself are not shown. Use <strong>Move</strong> to change where this sits.</p>
        <DialogButtons onCancel={onClose} submitLabel="Save changes" busy={busy} />
      </form>
    </Modal>
  )
}
