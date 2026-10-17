import { useState, type FormEvent } from 'react'
import { COMMON_TIMEZONES, createSite, displayName, type HDict } from '@ssl/haystack'
import { client } from '../../../lib/client.ts'
import { ErrorBanner } from '../../../components/Status.tsx'
import { DialogButtons, Modal } from './Modal.tsx'
import { Field } from './Field.tsx'
import { useRefreshAll } from './hooks.ts'

export function AddSiteDialog({ onClose, onDone }: { onClose(): void; onDone(site: HDict, message: string): void }) {
  const refresh = useRefreshAll()
  const [f, setF] = useState({ name: '', area: '', tz: 'Los_Angeles', addr: '', city: '', state: '', zip: '', country: 'US' })
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p: Record<string, string> = {}
    if (!f.name.trim()) p.name = 'Give the site a name'
    const area = Number(f.area)
    if (!(area > 0)) p.area = 'Enter the floor area as a number above zero'
    if (!f.addr.trim()) p.addr = 'Enter a street address'
    setProblems(p)
    if (Object.keys(p).length) return
    setBusy(true)
    setErr(null)
    try {
      const site = await createSite(client, {
        name: f.name.trim(), areaFt2: area, tz: f.tz, geoAddr: f.addr.trim(),
        geoCity: f.city.trim() || undefined, geoState: f.state.trim() || undefined, geoPostalCode: f.zip.trim() || undefined, geoCountry: f.country.trim() || undefined,
      })
      await refresh()
      onDone(site, `Created site ${displayName(site)}.`)
    } catch (x) {
      setErr(x)
      setBusy(false)
    }
  }

  return (
    <Modal title="Add a site" onClose={onClose} closable={!busy}>
      <form onSubmit={submit} noValidate>
        {err ? <ErrorBanner error={err} /> : null}
        <Field label="Site name" error={problems.name}><input value={f.name} onChange={set('name')} /></Field>
        <div className="field-row">
          <Field label="Floor area (ft²)" error={problems.area}><input inputMode="decimal" value={f.area} onChange={set('area')} /></Field>
          <Field label="Time zone">
            <select value={f.tz} onChange={set('tz')}>{COMMON_TIMEZONES.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}</select>
          </Field>
        </div>
        <Field label="Street address" error={problems.addr}><input value={f.addr} onChange={set('addr')} /></Field>
        <div className="field-row">
          <Field label="City"><input value={f.city} onChange={set('city')} /></Field>
          <Field label="State"><input value={f.state} onChange={set('state')} /></Field>
          <Field label="Postal code"><input value={f.zip} onChange={set('zip')} /></Field>
        </div>
        <p className="muted small">The site is created from the <code>ats::AtsSite</code> spec, which needs a name, area, time zone and address.</p>
        <DialogButtons onCancel={onClose} submitLabel="Add site" busy={busy} />
      </form>
    </Modal>
  )
}
