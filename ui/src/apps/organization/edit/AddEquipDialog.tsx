import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createEquipment, displayName, EQUIP_TEMPLATES, refId, templateFor, type Created, type HDict } from '@ssl/haystack'
import { client } from '../../../lib/client.ts'
import { ErrorBanner } from '../../../components/Status.tsx'
import { DialogButtons, Modal } from './Modal.tsx'
import { Field } from './Field.tsx'
import { useEquipSpecs, useRefreshAll } from './hooks.ts'

/** Add a piece of equipment directly under a site, or inside another piece of equipment. */
export function AddEquipDialog({ siteId, parentEquip, where, onClose, onDone }: {
  siteId: string
  parentEquip?: HDict
  /** what to call the place it is going into, for the heading */
  where: string
  onClose(): void
  onDone(created: Created, message: string): void
}) {
  const refresh = useRefreshAll()
  const otherTypes = useEquipSpecs()
  const [spec, setSpec] = useState(EQUIP_TEMPLATES[0].spec)
  const [name, setName] = useState('')
  const [withPoints, setWithPoints] = useState(true)
  const [linkId, setLinkId] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<Record<string, string>>({})

  const template = templateFor(spec)
  const link = template?.link
  const choices = useQuery({
    queryKey: ['linkChoices', siteId, link?.filter], enabled: !!link, retry: false,
    queryFn: () => client.read(`(${link!.filter}) and siteRef==@${siteId}`),
  })
  const others = useMemo(() => (otherTypes.data ?? []).filter((s) => !EQUIP_TEMPLATES.some((t) => t.spec === s.id)).sort((a, b) => a.name.localeCompare(b.name)), [otherTypes.data])
  const noParentAvailable = !!link?.required && choices.isSuccess && (choices.data?.length ?? 0) === 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p: Record<string, string> = {}
    if (!name.trim()) p.name = 'Give the equipment a name'
    if (link?.required && !linkId) p.link = `Choose what this is ${link.label.toLowerCase()}`
    setProblems(p)
    if (Object.keys(p).length) return
    setBusy(true)
    setErr(null)
    try {
      const created = await createEquipment(client, {
        name: name.trim(), siteId, parentEquipId: parentEquip ? refId(parentEquip.id) : undefined, spec,
        withPoints: template ? withPoints : false, links: link && linkId ? { [link.tag]: linkId } : undefined,
      })
      await refresh()
      const n = created.points.length
      onDone(created, `Created ${name.trim()}${n ? ` with ${n} points` : ''}.`)
    } catch (x) {
      setErr(x)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Add equipment to ${where}`} onClose={onClose} closable={!busy}>
      <form onSubmit={submit} noValidate>
        {err ? <ErrorBanner error={err} /> : null}
        <Field label="Type" hint={template?.description ?? 'A standard Haystack equipment type. Add its points afterwards.'}>
          <select value={spec} onChange={(e) => { setSpec(e.target.value); setLinkId('') }}>
            <optgroup label="Templates (come with their required points)">
              {EQUIP_TEMPLATES.map((t) => <option key={t.spec} value={t.spec}>{t.label}</option>)}
            </optgroup>
            <optgroup label="Other standard types">
              {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          </select>
        </Field>
        <Field label="Name" error={problems.name}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="for example AHU-3" /></Field>
        {link && (
          <Field label={link.label + (link.required ? '' : ' (optional)')} error={problems.link}
            hint={noParentAvailable ? 'There is nothing to link to yet. Add the main meter first.' : undefined}>
            <select value={linkId} onChange={(e) => setLinkId(e.target.value)} disabled={choices.isLoading}>
              <option value="">{link.required ? 'Choose…' : 'None'}</option>
              {(choices.data ?? []).map((r) => <option key={refId(r.id)} value={refId(r.id)}>{displayName(r)}</option>)}
            </select>
          </Field>
        )}
        {template && (
          <label className="check">
            <input type="checkbox" checked={withPoints} onChange={(e) => setWithPoints(e.target.checked)} /> Also create the points this type requires
          </label>
        )}
        <DialogButtons onCancel={onClose} submitLabel="Add equipment" busy={busy} disabled={noParentAvailable} />
      </form>
    </Modal>
  )
}
