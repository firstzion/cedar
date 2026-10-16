import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { displayName, refId, str, type HDict } from '@ssl/haystack'
import { client } from '../../lib/client.ts'
import { Empty, ErrorBanner, Loading } from '../../components/Status.tsx'
import { ConformanceBadge } from './ConformanceBadge.tsx'
import { LatestSample, PointRows } from './PointRows.tsx'
import { TagTable } from './TagTable.tsx'
import { RecordActions } from './edit/RecordActions.tsx'
import { trendsHref, kindOf } from './tree.ts'

const LABEL = { site: 'Site', equip: 'Equipment', point: 'Point', record: 'Record' }

export function RecordDetail({ id, filter, siteTz, onLoaded, notify, goTo }: {
  id: string; filter: string | null; siteTz?: string; onLoaded?: (r: HDict) => void; notify?: (message: string) => void; goTo?: (id: string | null) => void
}) {
  const q = useQuery({
    queryKey: ['rec', id],
    queryFn: async () => {
      const r = (await client.readByIds([id]))[0]
      if (!r) throw new Error(`No record with id ${id}`)
      return r
    },
    retry: false,
  })
  const loaded = q.data
  useEffect(() => { if (loaded) onLoaded?.(loaded) }, [loaded, onLoaded])

  if (q.isLoading) return <Loading label="Loading record…" />
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
  const rec = q.data!
  const kind = kindOf(rec)
  return (
    <article className="detail" aria-label="Record detail">
      <header>
        <div className="row-between">
          <div className="muted small">{LABEL[kind]}</div>
          {notify && goTo && <RecordActions rec={rec} notify={notify} goTo={goTo} />}
        </div>
        <h2>{displayName(rec)}</h2>
        <ConformanceBadge rec={rec} />
      </header>
      {kind === 'point' && (
        <div className="card inner">
          <div className="row-between">
            <div><div className="muted small">Latest history sample</div><LatestSample point={rec} siteTz={siteTz} /></div>
            {rec.his && <Link className="button-link" to={trendsHref([refId(rec.id)!])}>Open in Trend Viewer</Link>}
          </div>
          {str(rec.kind) && <div className="muted small">Kind: {str(rec.kind)}</div>}
        </div>
      )}
      {kind === 'equip' && <PointRows equipId={refId(rec.id)!} filter={filter} siteTz={siteTz} />}
      <TagTable rec={rec} siteTz={siteTz} filter={filter} />
    </article>
  )
}

export function NothingSelected() {
  return <Empty title="Nothing selected" hint="Pick a site, equipment or point from the tree, or run a filter." />
}
