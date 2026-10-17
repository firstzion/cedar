import { useState } from 'react'
import { displayName, refId, type Created, type HDict } from '@ssl/haystack'
import { AddEquipDialog } from './AddEquipDialog.tsx'
import { AddPointDialog } from './AddPointDialog.tsx'
import { AddSiteDialog } from './AddSiteDialog.tsx'

/** "+ Site", "+ Equipment" and "+ Point" above the tree. Equipment and points go into whatever is selected. */
export function AddBar({ selected, notify, goTo, onSiteCreated }: {
  selected: HDict | null
  notify(message: string): void
  goTo(id: string | null): void
  onSiteCreated(site: HDict): void
}) {
  const [open, setOpen] = useState<'site' | 'equip' | 'point' | null>(null)
  const close = () => setOpen(null)
  const isSite = !!selected?.site
  const isEquip = !!selected?.equip
  const canEquip = (isSite || isEquip) && !!(isSite ? refId(selected!.id) : refId(selected!.siteRef))
  const equipSite = isSite ? refId(selected!.id) : refId(selected?.siteRef)

  const title = (what: string, ok: boolean, need: string) => (ok ? `Add ${what} inside ${selected ? displayName(selected) : 'the selection'}` : need)
  return (
    <div className="addbar" role="toolbar" aria-label="Add to the site">
      <button type="button" className="secondary" onClick={() => setOpen('site')} aria-haspopup="dialog">+ Site</button>
      <button type="button" className="secondary" onClick={() => setOpen('equip')} disabled={!canEquip} aria-haspopup="dialog"
        title={title('equipment', canEquip, 'Select a site or a piece of equipment first')}>+ Equipment</button>
      <button type="button" className="secondary" onClick={() => setOpen('point')} disabled={!isEquip} aria-haspopup="dialog"
        title={title('a point', isEquip, 'Select a piece of equipment first')}>+ Point</button>
      {open === 'site' && <AddSiteDialog onClose={close} onDone={(s, m) => { close(); onSiteCreated(s); notify(m) }} />}
      {open === 'equip' && equipSite && selected && (
        <AddEquipDialog siteId={equipSite} parentEquip={isEquip ? selected : undefined} where={displayName(selected)} onClose={close}
          onDone={(c: Created, m) => { close(); notify(m); goTo(refId(c.equip.id) ?? null) }} />
      )}
      {open === 'point' && selected && isEquip && (
        <AddPointDialog equip={selected} onClose={close} onDone={(p, m) => { close(); notify(m); if (p) goTo(refId(p.id) ?? null) }} />
      )}
    </div>
  )
}
