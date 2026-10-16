// Shared helpers for spec checks and tests. Plain TypeScript (no enums / parameter properties)
// so Node can run it directly.
import { clientFromEnv } from '../../packages/haystack/src/node.ts'
import type { HaystackClient } from '../../packages/haystack/src/client.ts'

export const LIB = 'ats'
export const TEST_TAG = 'sslTest'
export const marker = { _kind: 'marker' }
export const ref = (val: string) => ({ _kind: 'ref', val })

/** Standard libs our specs depend on; they are not enabled in a fresh Haxall. */
export const REQUIRED_LIBS = ['ph.points', 'ph.points.sugar', 'ph.elec', LIB]

export type Rec = Record<string, any>

/** Enable any missing libs. Safe to run repeatedly. */
export async function enableLibs(c: HaystackClient): Promise<string[]> {
  const g = await c.evalAxon('libs().keepCols(["name"])')
  const have = new Set(g.rows.map((r) => r.name as string))
  const missing = REQUIRED_LIBS.filter((l) => !have.has(l))
  for (const l of missing) await c.evalAxon(`libAdd("${l}")`)
  return missing
}

export interface LibStatus { name: string; libStatus: string; version?: string; err?: string }

export async function libStatus(c: HaystackClient, name = LIB): Promise<LibStatus | undefined> {
  const g = await c.evalAxon(`libs().findAll(r => r->name == "${name}")`)
  return g.rows[0] as unknown as LibStatus | undefined
}

/** Validate recs (by their own `spec` tag) including required points. Returns "slot: msg" lines. */
export async function validateGraph(c: HaystackClient, id: string): Promise<string[]> {
  const g = await c.evalAxon(`readById(@${id}).validate(null, {graph})`)
  return g.rows.map((r) => `${r.slot ?? ''}: ${r.msg}`)
}

export async function instantiateGraph(c: HaystackClient, spec: string, parent?: string): Promise<Rec[]> {
  const opts = parent ? `{graph, useSlotSpec, parent: readById(@${parent})}` : '{graph}'
  const g = await c.evalAxon(`instantiate(spec("${spec}"), ${opts}).toGrid`)
  return g.rows as Rec[]
}

/** Commit a list of fully-formed recs (with ids) as new recs, tagging them for cleanup. */
export async function commitRecs(c: HaystackClient, recs: Rec[]): Promise<void> {
  const rows = recs.map((r) => ({ ...r, [TEST_TAG]: marker }))
  const names = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  await c.op('commit', rows, { cols: names, meta: { commit: 'add' } })
}

export async function cleanup(c: HaystackClient): Promise<void> {
  await c.evalAxon(`readAll(${TEST_TAG}).each(r => commit(diff(r, null, {remove})))`)
}

export { clientFromEnv }
