import { useState } from 'react'
import type { HDict } from '@ssl/haystack'
import { DeleteDialog } from './DeleteDialog.tsx'
import { EditDialog } from './EditDialog.tsx'
import { MoveDialog } from './MoveDialog.tsx'

/** Edit, Move and Delete for the record being looked at. */
export function RecordActions({ rec, notify, goTo }: { rec: HDict; notify(message: string): void; goTo(id: string | null): void }) {
  const [open, setOpen] = useState<'edit' | 'move' | 'delete' | null>(null)
  const close = () => setOpen(null)
  const movable = !!rec.equip || !!rec.point
  return (
    <div className="actions" role="group" aria-label="Change this record">
      <button type="button" className="secondary" onClick={() => setOpen('edit')} aria-haspopup="dialog">Edit</button>
      {movable && <button type="button" className="secondary" onClick={() => setOpen('move')} aria-haspopup="dialog">Move</button>}
      <button type="button" className="secondary danger-text" onClick={() => setOpen('delete')} aria-haspopup="dialog">Delete</button>
      {open === 'edit' && <EditDialog rec={rec} onClose={close} onDone={(m) => { close(); notify(m) }} />}
      {open === 'move' && <MoveDialog rec={rec} onClose={close} onDone={(m) => { close(); notify(m) }} />}
      {open === 'delete' && <DeleteDialog rec={rec} onClose={close} onDone={(m, to) => { close(); notify(m); goTo(to) }} />}
    </div>
  )
}
