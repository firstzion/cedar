import { useQuery } from '@tanstack/react-query'
import { conformanceOf, isDateTime, type HDict } from '@ssl/haystack'
import { client } from '../../lib/client.ts'
import { refId } from '@ssl/haystack'

/** "Fits ats::AtsVav" or the list of what is missing or wrong. This is Xeto's validate() shown to a person. */
export function ConformanceBadge({ rec }: { rec: HDict }) {
  const id = refId(rec.id)!
  const mod = isDateTime(rec.mod) ? rec.mod.ms : 0 // re-check whenever the record changes
  const q = useQuery({
    queryKey: ['conformance', id, mod],
    queryFn: async () => conformanceOf(rec, await client.validateRec(id)),
    retry: false,
  })

  if (q.isLoading) return <span className="badge badge-wait" role="status">Checking spec&hellip;</span>
  if (q.isError) return <span className="badge badge-warn" role="status">Could not check the spec</span>
  const c = q.data!

  if (c.status === 'fits') {
    return (
      <div>
        <span className="badge badge-ok" role="status">&#10003; Fits <code>{c.spec}</code></span>
        {c.warnings.length > 0 && (
          <ul className="issues">{c.warnings.map((w, i) => <li key={i} className="issue-warn">{w.text}</li>)}</ul>
        )}
      </div>
    )
  }
  if (c.status === 'nospec') {
    return <span className="badge badge-warn" role="status" title={c.item.text}>No spec &mdash; {c.item.text}</span>
  }
  return (
    <div>
      <span className="badge badge-err" role="status">
        &#10007; Does not fit <code>{c.spec}</code> &mdash; {c.items.length} {c.items.length === 1 ? 'problem' : 'problems'}
      </span>
      <ul className="issues">
        {c.items.map((i, k) => <li key={k}>{i.text}{i.slot && !i.text.includes(i.slot) && !/^points\._\d+$/.test(i.slot) ? <span className="muted"> ({i.slot})</span> : null}</li>)}
      </ul>
    </div>
  )
}
