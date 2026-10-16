import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A dialog on top of the page. Esc or clicking outside closes it, focus moves into it and stays inside while it is open,
 * and goes back to where it was afterwards.
 */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const first = box.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? box.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const a = items[0], z = items[items.length - 1]
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true); before?.focus?.() }
  }, [])

  // drawn at the top of the page so no surrounding layout or styling can touch it
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={box} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">&times;</button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** The Cancel / main-action row at the bottom of a dialog. */
export function DialogButtons({ onCancel, submitLabel, busy, disabled, danger = false }: { onCancel(): void; submitLabel: string; busy?: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" className={danger ? 'danger' : undefined} disabled={busy || disabled}>{busy ? 'Working…' : submitLabel}</button>
    </div>
  )
}
