// Pure helpers for the Site Organization: build the equipment hierarchy and URLs.
import { displayName, refId, str, type HDict } from '@ssl/haystack'

export interface EquipNode {
  id: string
  name: string
  rec: HDict
  children: EquipNode[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const nameOf = (r: HDict) => str(r.navName) ?? displayName(r)
export const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name)

/** Nest equips under their parent equip (equipRef). Equips whose parent is missing become top level. */
export function buildEquipTree(equips: HDict[]): EquipNode[] {
  const nodes = new Map<string, EquipNode>()
  for (const rec of equips) {
    const id = refId(rec.id)
    if (id) nodes.set(id, { id, name: nameOf(rec), rec, children: [] })
  }
  const roots: EquipNode[] = []
  for (const n of nodes.values()) {
    const parent = refId(n.rec.equipRef)
    const p = parent && parent !== n.id ? nodes.get(parent) : undefined
    // a parent chain that loops back would hide the equip, so treat loops as top level
    if (p && !isAncestor(n, p, nodes)) p.children.push(n)
    else roots.push(n)
  }
  const sort = (list: EquipNode[]) => { list.sort(byName); list.forEach((n) => sort(n.children)) }
  sort(roots)
  return roots
}

function isAncestor(candidate: EquipNode, of: EquipNode, nodes: Map<string, EquipNode>): boolean {
  const seen = new Set<string>()
  for (let cur: EquipNode | undefined = of; cur && !seen.has(cur.id); ) {
    if (cur.id === candidate.id) return true
    seen.add(cur.id)
    const up = refId(cur.rec.equipRef)
    cur = up ? nodes.get(up) : undefined
  }
  return false
}

export function countEquips(nodes: EquipNode[]): number {
  return nodes.reduce((n, x) => n + 1 + countEquips(x.children), 0)
}

/** Ids of the equips above a record (nearest first), so the tree can open to it. */
export function ancestorEquipIds(rec: HDict, equipsById: Map<string, HDict>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let up = refId(rec.equipRef)
  while (up && !seen.has(up)) {
    out.push(up)
    seen.add(up)
    const e = equipsById.get(up)
    up = e ? refId(e.equipRef) : undefined
  }
  return out
}

export type RecKind = 'site' | 'equip' | 'point' | 'record'
export function kindOf(rec: HDict): RecKind {
  if (rec.site) return 'site'
  if (rec.equip) return 'equip'
  if (rec.point) return 'point'
  return 'record'
}

/** Link target for the Trend Viewer app. The Trend Viewer reads `points` (comma separated ids) and `range`. */
export function trendsHref(ids: string[], range = 'last7'): string {
  return `/trend-viewer?points=${ids.map(encodeURIComponent).join(',')}&range=${range}`
}

/** Site Organization URL that selects a record and keeps the current filter. */
export function organizationHref(sel: string, filter?: string | null): string {
  const q = new URLSearchParams({ sel })
  if (filter) q.set('filter', filter)
  return `/site-organization?${q.toString()}`
}
