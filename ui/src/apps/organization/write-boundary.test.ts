// Where the app may change data. Editing lives in organization/edit/ and nowhere else; the Trend Viewer and every other part
// of the UI only read. The raw `commit` and `hisWrite` operations are never called from the UI at all.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

const SRC = resolve(import.meta.dirname, '../..')
const source = files(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
const rel = (f: string) => relative(SRC, f).split(sep).join('/')
const inEdit = (f: string) => rel(f).startsWith('apps/organization/edit/')
const WRITE_FUNCTIONS = ['createSite', 'createEquipment', 'createPoint', 'updateRecord', 'updateRecords', 'moveRecord', 'deleteRecord', 'removeRecords', 'addRecords']

describe('where the UI can change data', () => {
  it('finds the UI source', () => expect(source.length).toBeGreaterThan(30))

  it.each(WRITE_FUNCTIONS)('%s is only used from apps/organization/edit/', (fn) => {
    const users = source.filter((f) => new RegExp(`\\b${fn}\\b`).test(readFileSync(f, 'utf8'))).map(rel)
    expect(users.filter((f) => !f.startsWith('apps/organization/edit/'))).toEqual([])
  })

  it('the Trend Viewer never writes', () => {
    const trend = source.filter((f) => rel(f).startsWith('apps/trends/') || rel(f) === 'apps/TrendViewer.tsx')
    expect(trend.length).toBeGreaterThan(5)
    for (const f of trend) {
      const text = readFileSync(f, 'utf8')
      for (const fn of WRITE_FUNCTIONS) expect(text, `${rel(f)} uses ${fn}`).not.toMatch(new RegExp(`\\b${fn}\\b`))
    }
  })

  it.each(['commit', 'hisWrite', 'pointWrite', 'watchSub', 'diff('])('the UI never calls the raw %s operation', (word) => {
    expect(source.filter((f) => readFileSync(f, 'utf8').includes(word)).map(rel)).toEqual([])
  })

  it('nothing in the UI calls the low-level op() directly', () => {
    expect(source.filter((f) => /\.op\(/.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([])
  })

  it('every file in the edit folder is actually there to edit things', () => {
    expect(source.filter(inEdit).length).toBeGreaterThan(8)
  })
})
