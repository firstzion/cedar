import { useQuery } from '@tanstack/react-query'
import { formatVal, str } from '@ssl/haystack'
import { client } from '../lib/client.ts'
import { Empty, ErrorBanner, Loading } from '../components/Status.tsx'
import { useSite } from '../shell/SiteContext.tsx'

/** Shared by the placeholder apps: shows the selected site and a few counts, proving the data path works. */
export function SiteSummary({ title, note, pointFilter }: { title: string; note: string; pointFilter: string }) {
  const { site, siteId, loading, error, refetch } = useSite()
  const counts = useQuery({
    queryKey: ['counts', siteId, pointFilter],
    enabled: !!siteId,
    retry: false,
    queryFn: async () => {
      const [equips, points] = await Promise.all([
        client.read(`equip and siteRef==@${siteId}`),
        client.read(`(${pointFilter}) and siteRef==@${siteId}`),
      ])
      return { equips: equips.length, points: points.length }
    },
  })

  if (loading) return <Loading label="Loading sites…" />
  if (error) return <ErrorBanner error={error} onRetry={refetch} />
  if (!site) return <Empty title="No sites found" hint="Load the demo site with: make load" />

  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">{note}</p>
      <div className="card summary">
        <h2>{str(site.dis)}</h2>
        <dl>
          <dt>Address</dt><dd>{[site.geoAddr, site.geoCity, site.geoState].map((v) => formatVal(v)).filter(Boolean).join(', ')}</dd>
          <dt>Area</dt><dd>{formatVal(site.area)}</dd>
          <dt>Time zone</dt><dd>{formatVal(site.tz)}</dd>
          <dt>Spec</dt><dd>{formatVal(site.spec)}</dd>
          <dt>Equipment</dt><dd>{counts.isLoading ? '…' : counts.data?.equips ?? '–'}</dd>
          <dt>Points</dt><dd>{counts.isLoading ? '…' : counts.data?.points ?? '–'}</dd>
        </dl>
        {counts.isError && <ErrorBanner error={counts.error} onRetry={() => void counts.refetch()} />}
      </div>
    </section>
  )
}
