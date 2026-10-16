import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatVal, ianaFromHaystack, isDateTime, refId, str, type HDict, type HNumber } from '@ssl/haystack'
import { client } from '../../lib/client.ts'
import { Loading, ErrorBanner, Empty } from '../../components/Status.tsx'
import { organizationHref, trendsHref, nameOf } from './tree.ts'

/** What Site Organization shows as a point's "current value": the latest stored history sample. There is no curVal (no connector). */
export function LatestSample({ point, siteTz }: { point: HDict; siteTz?: string }) {
  const end = isDateTime(point.hisEnd) ? point.hisEnd.ms : 0
  const q = useQuery({
    queryKey: ['latest', refId(point.id), end],
    queryFn: () => client.latestSample(point),
    enabled: !!point.his,
    retry: false,
  })
  if (!point.his) return <span className="muted">no history</span>
  if (q.isLoading) return <span className="muted">&hellip;</span>
  if (q.isError) return <span className="muted" title={String(q.error)}>error</span>
  if (!q.data) return <span className="muted">no samples</span>
  const tz = ianaFromHaystack(str(point.tz) ?? siteTz ?? q.data.tz)
  const v = q.data.val
  const shown = typeof v === 'number'
    ? formatVal({ type: 'number', val: v, unit: q.data.unit } as HNumber)
    : String(v ?? '')
  const when = new Intl.DateTimeFormat(undefined, { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(q.data.ms)
  return <span><strong>{shown}</strong> <span className="muted">at {when}</span></span>
}

export function PointRows({ equipId, filter, siteTz }: { equipId: string; filter: string | null; siteTz?: string }) {
  const q = useQuery({ queryKey: ['points', equipId], queryFn: () => client.read(`point and equipRef==@${equipId}`), retry: false })
  if (q.isLoading) return <Loading label="Loading points…" />
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
  const points = [...(q.data ?? [])].sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }))
  if (points.length === 0) return <Empty title="No points" hint="This equipment has no points that reference it." />
  const hisIds = points.filter((p) => p.his).map((p) => refId(p.id)!)
  return (
    <div>
      <div className="row-between">
        <h3>Points ({points.length})</h3>
        {hisIds.length > 0 && <Link className="button-link" to={trendsHref(hisIds)}>Open all in Trend Viewer</Link>}
      </div>
      <p className="muted small">&ldquo;Latest&rdquo; is the most recent stored history sample, not a live value.</p>
      <table className="points">
        <thead><tr><th>Point</th><th>Spec</th><th>Latest history sample</th><th /></tr></thead>
        <tbody>
          {points.map((p) => {
            const id = refId(p.id)!
            return (
              <tr key={id}>
                <td><Link to={organizationHref(id, filter)}>{nameOf(p)}</Link></td>
                <td className="muted small">{refId(p.spec) ?? 'no spec'}</td>
                <td><LatestSample point={p} siteTz={siteTz} /></td>
                <td>{p.his ? <Link to={trendsHref([id])}>Trend Viewer</Link> : null}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
