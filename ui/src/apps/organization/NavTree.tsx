import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { displayName, errorCounts, refId, type HDict, type ValidationItem } from '@ssl/haystack'
import { client } from '../../lib/client.ts'
import { Empty, ErrorBanner, Loading } from '../../components/Status.tsx'
import { ancestorEquipIds, buildEquipTree, countEquips, nameOf, type EquipNode } from './tree.ts'

interface RowProps {
  label: string; depth: number; kind: 'site' | 'equip' | 'point'
  selected: boolean; expandable: boolean; expanded: boolean
  problems: number; note?: string
  onSelect(): void; onToggle(): void
}

function Row({ label, depth, kind, selected, expandable, expanded, problems, note, onSelect, onToggle }: RowProps) {
  return (
    <div role="treeitem" aria-level={depth + 1} aria-selected={selected} aria-expanded={expandable ? expanded : undefined}
      className={`tree-row ${selected ? 'selected' : ''}`} style={{ paddingLeft: `${depth * 1.1 + 0.25}rem` }}>
      {expandable
        ? <button className="twisty" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`} onClick={onToggle}>{expanded ? '▾' : '▸'}</button>
        : <span className="twisty" />}
      <button className={`tree-label kind-${kind}`} onClick={onSelect}>{label}</button>
      {note && <span className="muted small">{note}</span>}
      {problems > 0 && <span className="dot dot-err" title={`${problems} spec ${problems === 1 ? 'problem' : 'problems'}`} aria-label={`${problems} spec problems`}>!</span>}
    </div>
  )
}

export function NavTree({ siteId, site, selectedId, revealRec, onSelect }: {
  siteId: string; site: HDict; selectedId: string | null; revealRec: HDict | null; onSelect(id: string): void
}) {
  const equipsQ = useQuery({ queryKey: ['equips', siteId], queryFn: () => client.read(`equip and siteRef==@${siteId}`), retry: false })
  const valQ = useQuery({ queryKey: ['siteValidation', siteId], queryFn: () => client.validateSite(siteId), retry: false })
  const [open, setOpen] = useState<Set<string>>(() => new Set([siteId]))

  const equips = equipsQ.data
  const tree = useMemo(() => buildEquipTree(equips ?? []), [equips])
  const byId = useMemo(() => new Map((equips ?? []).flatMap((e) => (refId(e.id) ? [[refId(e.id)!, e] as const] : []))), [equips])
  const problems = useMemo(() => errorCounts((valQ.data ?? []) as ValidationItem[]), [valQ.data])

  // open the tree down to the selected record, once each time the selection (or the equipment list) changes,
  // so the branches can still be closed by hand afterwards
  const [revealed, setRevealed] = useState<{ rec: HDict | null; byId: Map<string, HDict> } | null>(null)
  if (revealed?.rec !== revealRec || revealed?.byId !== byId) {
    setRevealed({ rec: revealRec, byId })
    const ids = revealRec ? ancestorEquipIds(revealRec, byId) : []
    const self = revealRec ? refId(revealRec.id) : undefined
    if (revealRec?.equip && self) ids.push(self)
    if (ids.length) setOpen((o) => new Set([...o, siteId, ...ids]))
  }

  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const renderEquip = (n: EquipNode, depth: number): ReactNode => {
    const expanded = open.has(n.id)
    return (
      <div key={n.id}>
        <Row label={n.name} depth={depth} kind="equip" selected={selectedId === n.id} expandable expanded={expanded}
          problems={problems.get(n.id) ?? 0} note={n.children.length ? `${n.children.length} equip` : undefined}
          onSelect={() => onSelect(n.id)} onToggle={() => toggle(n.id)} />
        {expanded && (
          <div role="group">
            {n.children.map((c) => renderEquip(c, depth + 1))}
            <EquipPoints equipId={n.id} depth={depth + 1} selectedId={selectedId} problems={problems} onSelect={onSelect} />
          </div>
        )}
      </div>
    )
  }

  if (equipsQ.isLoading) return <Loading label="Loading equipment…" />
  if (equipsQ.isError) return <ErrorBanner error={equipsQ.error} onRetry={() => void equipsQ.refetch()} />
  return (
    <div role="tree" aria-label="Site tree" className="tree">
      <Row label={displayName(site)} depth={0} kind="site" selected={selectedId === siteId} expandable expanded={open.has(siteId)}
        problems={problems.get(siteId) ?? 0} note={`${countEquips(tree)} equip`} onSelect={() => onSelect(siteId)} onToggle={() => toggle(siteId)} />
      {open.has(siteId) && (
        <div role="group">
          {tree.length === 0 ? <Empty title="No equipment" hint="This site has no equipment records." /> : tree.map((n) => renderEquip(n, 1))}
        </div>
      )}
      {valQ.isError && <div className="muted small pad">Spec check unavailable.</div>}
    </div>
  )
}

function EquipPoints({ equipId, depth, selectedId, problems, onSelect }: {
  equipId: string; depth: number; selectedId: string | null; problems: Map<string, number>; onSelect(id: string): void
}) {
  const q = useQuery({ queryKey: ['points', equipId], queryFn: () => client.read(`point and equipRef==@${equipId}`), retry: false })
  if (q.isLoading) return <div className="muted small" style={{ paddingLeft: `${depth * 1.1 + 1.5}rem` }}>Loading points&hellip;</div>
  if (q.isError) return <div className="muted small" style={{ paddingLeft: `${depth * 1.1 + 1.5}rem` }}>Could not load points.</div>
  const points = [...(q.data ?? [])].sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }))
  return (
    <div role="group">
      {points.map((p) => {
        const id = refId(p.id)!
        return <Row key={id} label={nameOf(p)} depth={depth} kind="point" selected={selectedId === id} expandable={false} expanded={false}
          problems={problems.get(id) ?? 0} onSelect={() => onSelect(id)} onToggle={() => {}} />
      })}
    </div>
  )
}
