import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'

/**
 * A labelled form row. The label is tied to its one control (so clicking it focuses the control and screen readers read just the
 * label), and any hint or error is linked to the control as its description.
 */
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactElement<Record<string, unknown>> }) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-error`
  const described = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {hint && <span id={hintId} className="muted small">{hint}</span>}
      {error && <span id={errId} className="field-error" role="alert">{error}</span>}
    </div>
  )
}
