import { scramLogin } from './scram.ts'
import { ApiError, AuthError, UnreachableError } from './errors.ts'
import { decode, decodeGrid, isDateTime, isNumber, isRecordId, rawRef as encRef, type HDict, type HGrid, type HVal } from './values.ts'
import { parseValidation, type ValidationItem } from './validate.ts'

/** Raw Hayson grid as it comes over the wire. Tools use this; the UI uses the typed methods below. */
export interface RawGrid {
  _kind: 'grid'
  meta: Record<string, unknown>
  cols: { name: string; meta?: Record<string, unknown> }[]
  rows: Record<string, unknown>[]
}

/** Where the auth token is kept between page loads. The UI passes sessionStorage; Node scripts use none. */
export interface TokenStore {
  get(): string | null
  set(token: string): void
  clear(): void
}

/** History as parallel arrays, parsed straight from the wire (much cheaper than decoding every row). */
export interface HisSeries {
  ms: number[]
  val: (number | boolean | string | null)[]
  unit?: string
}

/** Haystack range string for [startMs, endMs) in UTC, e.g. "2026-10-16T07:00:00Z UTC,2026-10-17T07:00:00Z UTC". */
export function hisRangeString(startMs: number, endMs: number): string {
  const f = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z') + ' UTC'
  return `${f(startMs)},${f(endMs)}`
}

export interface HisItem { ms: number; val: boolean | number | string | null; unit?: string }

export interface ClientOptions {
  /** Server origin, e.g. http://localhost:8080. Empty string means "same origin" (browser with dev proxy). */
  origin?: string
  /** The Haxall daemon is one combined system/project, always addressed as "sys". */
  proj?: string
  tokenStore?: TokenStore
  /** Called when the server rejects our token (expired or revoked). */
  onAuthLost?: () => void
}

/** Haystack v4 client (Hayson JSON grids). Reads only have typed helpers; writes use the raw `op`. */
export class HaystackClient {
  readonly origin: string
  readonly proj: string
  private token: string
  private store: TokenStore | undefined
  private onAuthLost: (() => void) | undefined

  constructor(optsOrOrigin: ClientOptions | string = {}, proj?: string) {
    const o: ClientOptions = typeof optsOrOrigin === 'string' ? { origin: optsOrOrigin, proj } : optsOrOrigin
    this.origin = o.origin ?? ''
    this.proj = o.proj ?? 'sys'
    this.store = o.tokenStore
    this.onAuthLost = o.onAuthLost
    this.token = this.store?.get() ?? ''
  }

  get base() {
    return `${this.origin}/api/${this.proj}`
  }

  /** The current auth token (empty when signed out). Tools such as the screenshot script hand it to a browser. */
  get authToken() {
    return this.token
  }

  get isLoggedIn() {
    return this.token !== ''
  }

  async login(username: string, password: string) {
    this.token = await scramLogin(`${this.base}/about`, username, password)
    this.store?.set(this.token)
  }

  /**
   * Forget the token here and ask Haxall to close the session (the standard Haystack `close` op), so the
   * token stops working there too. Signing out never waits on or fails because of Haxall: the promise always resolves.
   */
  logout(): Promise<void> {
    const token = this.token
    this.token = ''
    this.store?.clear()
    if (!token) return Promise.resolve()
    return fetch(`${this.base}/close`, {
      method: 'POST',
      credentials: 'omit', // see op()
      headers: { Authorization: `BEARER authToken=${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ _kind: 'grid', meta: { ver: '3.0' }, cols: [], rows: [] }),
    }).then(() => undefined, () => undefined)
  }

  // ---- low level -------------------------------------------------------------

  /** Call any op with a request grid; returns the raw Hayson grid. Throws UnreachableError / AuthError / ApiError. */
  async op(
    name: string,
    rows: Record<string, unknown>[] = [{}],
    opts: { cols?: string[]; meta?: Record<string, unknown> } = {},
  ): Promise<RawGrid> {
    const names = opts.cols ?? Object.keys(rows[0] ?? {})
    const grid = { _kind: 'grid', meta: { ver: '3.0', ...opts.meta }, cols: names.map((n) => ({ name: n })), rows }
    let res: Response
    try {
      res = await fetch(`${this.base}/${name}`, {
        method: 'POST',
        // We authenticate with the bearer token only. If the browser also sent Haxall's session cookie,
        // Haxall would demand an Attest-Key header on every POST (its CSRF protection) and answer 400.
        credentials: 'omit',
        headers: {
          Authorization: `BEARER authToken=${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(grid),
      })
    } catch {
      throw new UnreachableError()
    }
    // 403 means two things in Haxall: a token it no longer knows (after a restart or a sign-out, sys.api::AuthErr)
    // or a signed-in user who may not do this (sys.api::PermissionErr). Only the first ends the session.
    if (res.status === 403) {
      const denied = await permissionDenied(res)
      if (denied !== null) throw new ApiError(name, denied)
    }
    if (res.status === 401 || res.status === 403) {
      this.token = ''
      this.store?.clear()
      this.onAuthLost?.()
      throw new AuthError('Your session has ended. Please sign in again.')
    }
    const isJson = (res.headers.get('content-type') ?? '').includes('json')
    if (res.status === 502 || res.status === 503 || res.status === 504 || (res.status >= 500 && !isJson)) {
      throw new UnreachableError(`Haxall is not answering (HTTP ${res.status}). Is it running?`)
    }
    if (!res.ok) throw new ApiError(name, `${name} failed: HTTP ${res.status}`, (await res.text()).slice(0, 500))
    const out = (await res.json()) as RawGrid
    if (out.meta?.err) {
      throw new ApiError(name, String(out.meta.dis ?? `${name} failed`), String(out.meta.errTrace ?? '').slice(0, 800))
    }
    return out
  }

  // ---- typed reads (decoded, no wire details) ---------------------------------

  async about(): Promise<HDict> {
    return decodeGrid(await this.op('about', [{}], { cols: [] })).rows[0] ?? {}
  }

  /** Records matching a Haystack filter, e.g. "equip and siteRef==@abc". */
  async read(filter: string, limit?: number): Promise<HDict[]> {
    const row: Record<string, unknown> = { filter }
    if (limit !== undefined) row.limit = { _kind: 'number', val: limit }
    return decodeGrid(await this.op('read', [row])).rows
  }

  /** Records by id, in request order. Ids that do not exist are skipped. */
  async readByIds(ids: string[]): Promise<HDict[]> {
    if (ids.length === 0) return []
    const g = await this.op('read', ids.map((id) => ({ id: encRef(id) })), { cols: ['id'] })
    return decodeGrid(g).rows.filter((r) => r.id !== undefined && r.id !== null)
  }

  /** Children of a navigation node. No id returns the top level (sites). */
  async nav(navId?: string): Promise<HDict[]> {
    const row = navId ? { navId: encRef(navId) } : {}
    return decodeGrid(await this.op('nav', [row], { cols: navId ? ['navId'] : [] })).rows
  }

  /** History of one point. range is a Haystack range string such as "today", "yesterday" or "2026-01-01,2026-01-31". */
  async hisRead(id: string, range: string): Promise<HisItem[]> {
    const g = decodeGrid(await this.op('hisRead', [{ id: encRef(id), range }], { cols: ['id', 'range'] }))
    return g.rows.map((r) => {
      const v: HVal | undefined = r.val
      const ts = r.ts as { ms: number }
      if (isNumber(v)) return { ms: ts.ms, val: v.val, unit: v.unit }
      return { ms: ts.ms, val: typeof v === 'boolean' || typeof v === 'string' ? v : null }
    })
  }

  /** History of one point over [startMs, endMs) as arrays. This is what the Trend Viewer charts. */
  async hisSeries(id: string, startMs: number, endMs: number): Promise<HisSeries> {
    const g = await this.op('hisRead', [{ id: encRef(id), range: hisRangeString(startMs, endMs) }], { cols: ['id', 'range'] })
    const n = g.rows.length
    const ms = new Array<number>(n)
    const val = new Array<number | boolean | string | null>(n)
    let unit: string | undefined
    for (let i = 0; i < n; i++) {
      const r = g.rows[i] as { ts: { val: string }; val?: unknown }
      ms[i] = Date.parse(r.ts.val)
      const v = r.val
      if (typeof v === 'number') val[i] = v
      else if (typeof v === 'boolean' || typeof v === 'string') val[i] = v
      else if (v && typeof v === 'object' && (v as { _kind?: string })._kind === 'number') {
        const o = v as { val: unknown; unit?: string }
        val[i] = typeof o.val === 'number' ? o.val : Number(o.val === 'INF' ? Infinity : o.val === '-INF' ? -Infinity : NaN)
        if (o.unit && !unit) unit = o.unit
      } else val[i] = null
    }
    return { ms, val, unit }
  }

  /** Spec validation of one record, including its required points. Empty list = fits its spec. */
  async validateRec(id: string): Promise<ValidationItem[]> {
    return parseValidation((await this.evalGrid(`readById(@${safeIdLocal(id)}).validate(null, {graph})`)).rows)
  }

  /** Validate a site and everything that belongs to it (equips and points). Returns only problems. */
  async validateSite(siteId: string): Promise<ValidationItem[]> {
    const id = safeIdLocal(siteId)
    return parseValidation((await this.evalGrid(`readAll(siteRef==@${id} or id==@${id}).validate(null, {graph})`)).rows)
  }

  /** The most recent stored history sample of a point (found from its hisEnd tag), or null if it has none. */
  async latestSample(point: HDict): Promise<(HisItem & { tz: string }) | null> {
    const end = point.hisEnd
    const id = point.id
    if (!isDateTime(end) || !id || typeof id !== 'object' || (id as { type?: string }).type !== 'ref') return null
    const items = await this.hisRead((id as { id: string }).id, hisRangeString(end.ms - 2 * 3600000, end.ms + 60000))
    const last = items[items.length - 1]
    return last ? { ...last, tz: end.tz } : null
  }

  /** Evaluate Axon and return the decoded result grid. */
  async evalGrid(expr: string): Promise<HGrid> {
    return decodeGrid(await this.evalAxon(expr))
  }

  /** Evaluate Axon and return the raw Hayson grid (used by the Node tools). */
  evalAxon(expr: string): Promise<RawGrid> {
    return this.op('eval', [{ expr }])
  }
}

/** Haxall's message when a 403 is a missing permission rather than a dead session, otherwise null. */
async function permissionDenied(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { spec?: unknown; dis?: unknown }
    if (typeof body.spec !== 'string' || !body.spec.endsWith('::PermissionErr')) return null
    return typeof body.dis === 'string' && body.dis ? body.dis : 'You do not have permission to do that.'
  } catch {
    return null // no readable body: treat it as the session ending, as before
  }
}

/** Record ids are used inside Axon text, so refuse anything that is not a plain id before it is sent. */
function safeIdLocal(id: string): string {
  if (!isRecordId(id)) throw new ApiError('validate', `Not a valid record id: ${id}`)
  return id
}

export { decode }
