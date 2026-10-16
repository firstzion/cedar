import { describeError } from '../lib/errors.ts'

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="muted pad" role="status">{label}</div>
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint && <div className="muted">{hint}</div>}
    </div>
  )
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const info = describeError(error)
  return (
    <div role="alert" className={`alert ${info.kind === 'unreachable' ? 'alert-warn' : 'alert-error'}`}>
      <strong>{info.title}</strong>
      <div>{info.message}</div>
      {info.detail && (
        <details>
          <summary>Details</summary>
          <pre>{info.detail}</pre>
        </details>
      )}
      {onRetry && <button className="link" onClick={onRetry}>Try again</button>}
    </div>
  )
}
