// Live checks of the typed Haystack client against the running Haxall (login, reads, errors).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXAMPLE_FILTERS } from '../../ui/src/apps/organization/examples.ts'
import { HaystackClient, ApiError, AuthError, UnreachableError, refId, str, displayName } from '../../packages/haystack/src/index.ts'

const origin = `http://localhost:${process.env.HAXALL_PORT ?? '8080'}`
const user = process.env.HAXALL_SU_USERNAME!
const pass = process.env.HAXALL_SU_PASSWORD!

async function loggedIn() {
  const c = new HaystackClient(origin)
  await c.login(user, pass)
  return c
}

test('login works and about identifies Haxall and the user', async () => {
  const c = await loggedIn()
  const about = await c.about()
  assert.equal(str(about.productName), 'Haxall')
  assert.equal(str(about.whoami), user)
})

test('wrong password -> AuthError', async () => {
  const c = new HaystackClient(origin)
  await assert.rejects(c.login(user, 'not-the-password'), AuthError)
})

test('unreachable server -> UnreachableError', async () => {
  const c = new HaystackClient('http://localhost:1')
  await assert.rejects(c.login(user, pass), UnreachableError)
})

test('a bad or missing token is rejected as AuthError', async () => {
  const c = new HaystackClient({ origin, tokenStore: { get: () => 'bogus', set() {}, clear() {} } })
  await assert.rejects(c.read('site'), AuthError)
})

test('after logout the old token no longer works on Haxall', async () => {
  const c = await loggedIn()
  const token = c.authToken
  await c.about()
  await c.logout()
  const old = new HaystackClient({ origin, tokenStore: { get: () => token, set() {}, clear() {} } })
  await assert.rejects(old.about(), AuthError)
})

test('read, readByIds and nav return decoded records', async () => {
  const c = await loggedIn()
  const sites = await c.read('site')
  assert.equal(sites.length, 1)
  assert.equal(displayName(sites[0]), 'Demo Office')
  const id = refId(sites[0].id)!
  assert.equal((await c.readByIds([id]))[0].dis, 'Demo Office')
  const equips = await c.nav(id)
  assert.equal(equips.length, 15)
  assert.equal((await c.read('point and his', 3)).length, 3)
})

test('hisRead returns typed samples', async () => {
  const c = await loggedIn()
  const [p] = await c.read('point and his and navName=="OutsideAirTempSensor"', 1)
  const items = await c.hisRead(refId(p.id)!, 'yesterday')
  assert.equal(items.length, 96)
  assert.equal(typeof items[0].val, 'number')
  assert.equal(items[0].unit, '°F')
})

test('bad filter -> ApiError with a message', async () => {
  const c = await loggedIn()
  await assert.rejects(c.read('site and =='), (e: unknown) => e instanceof ApiError && e.message.length > 0)
})

test('evalGrid decodes numbers', async () => {
  const c = await loggedIn()
  const g = await c.evalGrid('1 + 1')
  assert.deepEqual(g.rows[0].val, { type: 'number', val: 2 })
})

test('validateSite is clean for the demo site and validateRec agrees', async () => {
  const c = await loggedIn()
  const [site] = await c.read('site')
  const siteId = refId(site.id)!
  assert.deepEqual((await c.validateSite(siteId)).filter((i) => i.level === 'err'), [])
  assert.deepEqual(await c.validateRec(siteId), [])
  const [ahu] = await c.read('ahu', 1)
  assert.deepEqual(await c.validateRec(refId(ahu.id)!), [])
})

test('validateRec explains what is missing in plain language', async () => {
  const c = await loggedIn()
  // a throwaway AHU with no points, tagged so it can be removed
  const site = (await c.read('site'))[0]
  const m = { _kind: 'marker' }
  const added = await c.op('commit', [{
    equip: m, ahu: m, navName: 'sslTest AHU', siteRef: { _kind: 'ref', val: refId(site.id) }, spec: { _kind: 'ref', val: 'ats::AtsAhu' }, sslClientTest: m,
  }], { meta: { commit: 'add' } })
  const id = (added.rows[0].id as { val: string }).val
  try {
    const items = await c.validateRec(id)
    assert.equal(items.length, 14) // the 14 required AHU points
    assert.ok(items.every((i) => i.level === 'err'))
    assert.ok(items.some((i) => i.text === 'Missing required point: Mixed Air Temp Sensor (ph.points.sugar::MixedAirTempSensor)'), JSON.stringify(items.map((i) => i.text)))
  } finally {
    await c.evalAxon('readAll(sslClientTest).each(r => commit(diff(r, null, {remove})))')
  }
})

test('record ids that could change an Axon expression are refused', async () => {
  const c = await loggedIn()
  await assert.rejects(c.validateRec('x) + commit('), ApiError)
})

test('latestSample finds the final stored sample of a point', async () => {
  const c = await loggedIn()
  const [p] = await c.read('point and his and navName=="OutsideAirTempSensor"', 1)
  const last = await c.latestSample(p)
  assert.ok(last)
  assert.equal(last.unit, '°F')
  assert.equal(typeof last.val, 'number')
  const end = p.hisEnd as { ms: number }
  assert.equal(last.ms, end.ms)
})

test('every example filter offered in Site Organization is accepted by Haxall and finds something', async () => {
  const c = await loggedIn()
  for (const f of EXAMPLE_FILTERS) assert.ok((await c.read(f, 5)).length > 0, `no results for: ${f}`)
})
