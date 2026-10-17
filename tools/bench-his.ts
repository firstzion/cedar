// Chunk 2 check: commit a throwaway point, time hisWrite batches and a large hisRead, then delete it.
import { clientFromEnv } from '../packages/haystack/src/node.ts'

const c = await clientFromEnv()
const mk = { _kind: 'marker' }
const t = async <T>(label: string, f: () => Promise<T>) => {
  const s = performance.now()
  const r = await f()
  console.log(`${label}: ${Math.round(performance.now() - s)} ms`)
  return r
}
const rec = {
  dis: 'bench pt', point: mk, his: mk, tz: 'Los_Angeles', kind: 'Number', unit: '°F', hisMaxItems: 100000, demoBench: mk,
  spec: { _kind: 'ref', val: 'ph.points::AirTempSensor' },
}
const added = await c.op('commit', [rec], { meta: { commit: 'add' } })
console.log('commit result cols:', added.cols.map((x) => x.name).join(','))
const id = (added.rows[0].id ?? added.rows[0]) as { val: string }
console.log('new id', JSON.stringify(id))
const ref = { _kind: 'ref', val: id.val }
const start = Date.parse('2026-07-18T00:00:00Z')
const N = Number(process.argv[2] ?? 8640)
const rows = Array.from({ length: N }, (_, i) => ({
  ts: { _kind: 'dateTime', val: new Date(start + i * 900000).toISOString().replace('.000Z', 'Z'), tz: 'Los_Angeles' },
  val: { _kind: 'number', val: 60 + (i % 40) / 4, unit: '°F' },
}))
await t(`hisWrite ${N} rows in one call`, () => c.op('hisWrite', rows, { cols: ['ts', 'val'], meta: { id: ref } }))
const back = await t('hisRead', () => c.op('hisRead', [{ id: ref, range: '2020-01-01,2030-12-31' }], { cols: ['id', 'range'] }))
console.log('rows read:', back.rows.length, 'first', JSON.stringify(back.rows[0]))
const v = await c.evalAxon(`readById(@${id.val}).validate`)
console.log('validate:', JSON.stringify(v.rows).slice(0, 600))
// (record is left for the persistence check; cleaned up by the caller)
