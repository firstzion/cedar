import { Link } from 'react-router-dom'
import { formatVal, ianaFromHaystack, isMarker, isRef, str, type HDict, type HVal } from '@ssl/haystack'
import { organizationHref } from './tree.ts'

const FIRST = ['id', 'dis', 'navName', 'disMacro', 'spec', 'siteRef', 'equipRef', 'airRef', 'submeterOf', 'kind', 'unit', 'tz']

function RefLink({ v, filter }: { v: HVal; filter: string | null }) {
  if (!isRef(v)) return <>{formatVal(v)}</>
  // spec refs such as ats::AtsAhu name a Xeto spec, not a record, so there is nothing to open
  if (v.id.includes('::')) return <code>{v.id}</code>
  return <Link to={organizationHref(v.id, filter)}>{v.dis ?? `@${v.id}`}</Link>
}

function Cell({ v, tz, filter }: { v: HVal; tz: string | undefined; filter: string | null }) {
  if (isRef(v)) return <RefLink v={v} filter={filter} />
  if (Array.isArray(v)) {
    return <>{v.map((x, i) => <span key={i}>{i > 0 && ', '}<Cell v={x} tz={tz} filter={filter} /></span>)}</>
  }
  return <>{formatVal(v, { tz })}</>
}

/** Every tag of a record: markers as chips, everything else in a table. References are links. */
export function TagTable({ rec, siteTz, filter }: { rec: HDict; siteTz?: string; filter: string | null }) {
  const tz = ianaFromHaystack(str(rec.tz) ?? siteTz ?? 'UTC')
  const names = Object.keys(rec).filter((k) => rec[k] !== null)
  const markers = names.filter((k) => isMarker(rec[k])).sort()
  const rank = (k: string) => { const i = FIRST.indexOf(k); return i < 0 ? 1000 : i }
  const values = names.filter((k) => !isMarker(rec[k])).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))

  return (
    <div>
      <h3>Tags</h3>
      <table className="tags">
        <tbody>
          {values.map((k) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td className={k === 'id' ? 'mono' : undefined}>
                {k === 'id' && isRef(rec[k]) ? (rec[k] as { id: string }).id : <Cell v={rec[k]} tz={tz} filter={filter} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {markers.length > 0 && (
        <>
          <h3>Markers</h3>
          <div className="chips">{markers.map((m) => <span className="chip" key={m}>{m}</span>)}</div>
        </>
      )}
    </div>
  )
}
