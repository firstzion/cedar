import { afterEach, describe, expect, it, vi } from 'vitest'
import { HaystackClient, type TokenStore } from './client.ts'
import { ApiError, AuthError, UnreachableError } from './errors.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const grid = (rows: Record<string, unknown>[] = [], meta: Record<string, unknown> = {}) =>
  ({ _kind: 'grid', meta: { ver: '3.0', ...meta }, cols: Object.keys(rows[0] ?? {}).map((name) => ({ name })), rows })

const memStore = (initial: string | null = null): TokenStore & { value: string | null } => {
  const s = { value: initial, get: () => s.value, set: (t: string) => { s.value = t }, clear: () => { s.value = null } }
  return s
}

afterEach(() => vi.unstubAllGlobals())

describe('HaystackClient error mapping', () => {
  it('network failure -> UnreachableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(new HaystackClient().about()).rejects.toBeInstanceOf(UnreachableError)
  })

  it('proxy 502 / html 500 -> UnreachableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })))
    await expect(new HaystackClient().about()).rejects.toBeInstanceOf(UnreachableError)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 500, headers: { 'content-type': 'text/html' } })))
    await expect(new HaystackClient().about()).rejects.toBeInstanceOf(UnreachableError)
  })

  it('401/403 -> AuthError, clears the stored token and calls onAuthLost', async () => {
    const store = memStore('tok')
    const lost = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))
    const c = new HaystackClient({ tokenStore: store, onAuthLost: lost })
    expect(c.isLoggedIn).toBe(true)
    await expect(c.read('site')).rejects.toBeInstanceOf(AuthError)
    expect(store.value).toBeNull()
    expect(c.isLoggedIn).toBe(false)
    expect(lost).toHaveBeenCalledOnce()
  })

  it('error grid -> ApiError with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(grid([], { err: { _kind: 'marker' }, dis: 'Unknown tag', errTrace: 'trace...' }))))
    const e = await new HaystackClient().read('bogus ==').catch((x) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e.message).toBe('Unknown tag')
    expect(e.trace).toBe('trace...')
  })
})

describe('HaystackClient requests', () => {
  it('never sends cookies and always sends the bearer token', async () => {
    const f = vi.fn().mockResolvedValue(json(grid([{ dis: 'S' }])))
    vi.stubGlobal('fetch', f)
    const c = new HaystackClient({ tokenStore: memStore('abc') })
    await c.read('site', 5)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/sys/read')
    expect(init.credentials).toBe('omit')
    expect(init.headers.Authorization).toBe('BEARER authToken=abc')
    const body = JSON.parse(init.body)
    expect(body.rows[0]).toEqual({ filter: 'site', limit: { _kind: 'number', val: 5 } })
  })

  it('read decodes rows; readByIds skips missing records', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(grid([{ id: { _kind: 'ref', val: 'a', dis: 'A' }, site: { _kind: 'marker' } }])))
      .mockResolvedValueOnce(json(grid([{ id: { _kind: 'ref', val: 'a' } }, { dis: 'ghost' }])))
    vi.stubGlobal('fetch', f)
    const c = new HaystackClient()
    expect((await c.read('site'))[0].id).toEqual({ type: 'ref', id: 'a', dis: 'A' })
    expect(await c.readByIds(['a', 'b'])).toHaveLength(1)
    expect(await c.readByIds([])).toEqual([])
  })

  it('hisRead returns ms, value and unit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(grid([
      { ts: { _kind: 'dateTime', val: '2026-10-16T00:00:00-07:00', tz: 'Los_Angeles' }, val: { _kind: 'number', val: 70.5, unit: '°F' } },
      { ts: { _kind: 'dateTime', val: '2026-10-16T00:15:00-07:00', tz: 'Los_Angeles' }, val: true },
    ]))))
    const items = await new HaystackClient().hisRead('p', 'today')
    expect(items[0]).toEqual({ ms: Date.parse('2026-10-16T00:00:00-07:00'), val: 70.5, unit: '°F' })
    expect(items[1].val).toBe(true)
  })

  it('logout forgets the token', () => {
    const store = memStore('abc')
    const c = new HaystackClient({ tokenStore: store })
    c.logout()
    expect(c.isLoggedIn).toBe(false)
    expect(store.value).toBeNull()
  })
})
