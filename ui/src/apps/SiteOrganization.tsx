import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { refId, str, type HDict } from '@ssl/haystack'
import { Empty, ErrorBanner, Loading } from '../components/Status.tsx'
import { useSite } from '../shell/SiteContext.tsx'
import { FilterBar, FilterResults } from './organization/FilterBar.tsx'
import { AddBar } from './organization/edit/AddBar.tsx'
import { NavTree } from './organization/NavTree.tsx'
import { NothingSelected, RecordDetail } from './organization/RecordDetail.tsx'

/** Browse, add, edit, move and delete the site, equipment and points. State lives in the URL (?sel=<id>&filter=<text>) so views can be bookmarked. */
export function SiteOrganization() {
  const { site, siteId, setSiteId, loading, error, refetch } = useSite()
  const [params, setParams] = useSearchParams()
  const sel = params.get('sel')
  const filter = params.get('filter')
  const [revealRec, setRevealRec] = useState<HDict | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  // on a narrow screen the detail sits below the tree, so bring it into view when something is picked
  useEffect(() => {
    if (sel && typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches) detailRef.current?.scrollIntoView?.({ block: 'start' })
  }, [sel])

  // When another site is picked, the selection still belongs to the old site: start again at the new site's top.
  // Only a change from one loaded site to another counts, so a bookmarked ?sel= survives the first load.
  const shownSite = useRef(siteId)
  useEffect(() => {
    const before = shownSite.current
    shownSite.current = siteId
    if (!before || !siteId || before === siteId) return
    setRevealRec(null)
    setParams((p) => { const next = new URLSearchParams(p); next.delete('sel'); return next })
  }, [siteId, setParams])

  const update = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v === null) next.delete(k); else next.set(k, v) }
    setParams(next)
  }, [params, setParams])

  const goTo = (id: string | null) => update({ sel: id })
  const notify = (message: string) => setNotice(message)

  if (loading) return <Loading label="Loading sites…" />
  if (error) return <ErrorBanner error={error} onRetry={refetch} />
  if (!site || !siteId) return <Empty title="No sites found" hint="Load the demo site with: make load" />

  const selected = sel ?? siteId
  // the add buttons work on the record shown in the detail pane, never on one that is still being replaced
  const shownRec = revealRec && refId(revealRec.id) === selected ? revealRec : null
  return (
    <section className="org">
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice(null)} aria-label="Dismiss">dismiss</button>
        </div>
      )}
      <FilterBar value={filter} onRun={(f) => update({ filter: f })} onClear={() => update({ filter: null })} />
      <div className="org-body">
        <nav className="pane" aria-label="Navigation">
          <AddBar selected={shownRec} siteId={siteId} notify={notify} goTo={goTo}
            onSiteCreated={(s) => { const id = refId(s.id); if (id) { setSiteId(id); update({ sel: id, filter: null }) } }} />
          {filter
            ? <FilterResults filter={filter} selectedId={sel} onSelect={(id) => update({ sel: id })} />
            : <NavTree key={siteId} siteId={siteId} site={site} selectedId={selected} revealRec={revealRec} onSelect={(id) => update({ sel: id })} />}
        </nav>
        <div className="pane detail-pane" ref={detailRef}>
          {selected
            ? <RecordDetail key={selected} id={selected} filter={filter} siteTz={str(site.tz)} onLoaded={setRevealRec} notify={notify} goTo={goTo} />
            : <NothingSelected />}
        </div>
      </div>
    </section>
  )
}
