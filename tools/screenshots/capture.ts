// Takes the screenshots used in the README:  make screenshots   (needs Haxall and `make ui` running)
// Drives a headless Chromium-family browser (Chrome, Brave, Edge or Chromium) through the DevTools protocol,
// using only Node built-ins: no extra packages.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HaystackClient, refId } from '../../packages/haystack/src/index.ts'

const UI = process.env.UI_URL ?? 'http://localhost:5173'
const OUT = fileURLToPath(new URL('../../docs/img/', import.meta.url))
const PORT = 9333
const BROWSERS = [
  process.env.BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter((p): p is string => !!p && existsSync(p))
if (BROWSERS.length === 0) throw new Error('No Chrome, Brave, Edge or Chromium found. Set BROWSER_PATH to its executable.')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- minimal DevTools protocol client ----
class Cdp {
  private ws: WebSocket
  private n = 0
  private waiting = new Map<number, (v: unknown) => void>()
  constructor(ws: WebSocket) {
    this.ws = ws
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data))
      if (m.id && this.waiting.has(m.id)) { this.waiting.get(m.id)!(m); this.waiting.delete(m.id) }
    }
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.n
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (m: any) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression: string): Promise<any> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return r.result?.value
  }
}

async function main() {
  // data we need to point at
  const c = new HaystackClient(`http://localhost:${process.env.HAXALL_PORT ?? '8080'}`)
  await c.login(process.env.HAXALL_SU_USERNAME!, process.env.HAXALL_SU_PASSWORD!)
  const one = async (filter: string) => { const r = await c.read(filter, 1); if (!r[0]) throw new Error(`nothing matches: ${filter}`); return refId(r[0].id)! }
  const ahu1 = await one('equip and navName=="AHU-1"')
  const oaTemp = await one('point and navName=="OutsideAirTempSensor" and equipRef->navName=="AHU-1"')
  const ahu2 = await one('equip and navName=="AHU-2"')
  const dat = await one('point and navName=="DischargeAirTempSensor" and equipRef->navName=="AHU-1"')
  const faults = (await import('node:fs')).readFileSync(fileURLToPath(new URL('../demo_data/faults.json', import.meta.url)), 'utf8')
  const f = JSON.parse(faults).faults as { id: number; start: string; end: string; points: { id: string; name: string }[] }[]
  const fault = (id: number) => f.find((x) => x.id === id)!
  const day = (iso: string, plus = 0) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + plus); return d.toISOString().slice(0, 10) }
  const range = (id: number, before = 2, after = 2) => `${day(fault(id).start, -before)}_${day(fault(id).end, after)}`
  const ids = (id: number, names?: string[]) => fault(id).points.filter((p) => !names || names.includes(p.name)).map((p) => p.id)

  // a deliberately broken AHU, created only for the one picture that shows the spec badge catching problems
  const m = { _kind: 'marker' }
  const site = (await c.read('site'))[0]
  const addBadAhu = async () => {
    const bad = await c.op('commit', [{
      equip: m, ahu: m, navName: 'AHU-3 (demo of a problem)', siteRef: { _kind: 'ref', val: refId(site.id) },
      spec: { _kind: 'ref', val: 'ats::AtsAhu' }, sslShot: m,
    }], { meta: { commit: 'add' } })
    return (bad.rows[0].id as { val: string }).val
  }
  const removeBadAhu = () => c.evalAxon('readAll(sslShot).each(r => commit(diff(r, null, {remove})))')

  const click = (text: string) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`
  const setValue = (selector: string, value: string) =>
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })()`
  const tenPoints = [ids(1)[0], ids(1)[1], ids(2)[0], ids(2)[1], ids(2)[2], ids(3)[0], ids(4)[0], ids(5)[0], ids(5)[1], ids(6)[0]]

  // `act` is JavaScript run in the page once `ready` shows up (to click a button, fill a field); `after` is what to wait for next
  const shots: { name: string; url: string | (() => Promise<string>); width?: number; height?: number; ready: string; token?: boolean; act?: string; after?: string }[] = [
    { name: '01-login', url: '/', ready: 'form', token: false },
    { name: '02-organization-site', url: '/site-organization', ready: '[role=treeitem]' },
    { name: '03-organization-equip', url: `/site-organization?sel=${ahu1}`, ready: 'table.points .mono, table.points td', height: 900 },
    { name: '04-organization-point', url: `/site-organization?sel=${dat}`, ready: '[aria-label="Record detail"] .badge', height: 800 },
    { name: '05-organization-problem', url: async () => `/site-organization?sel=${await addBadAhu()}`, ready: '.badge-err', height: 760 },
    { name: '06-organization-filter', url: `/site-organization?filter=${encodeURIComponent('point and his and unit=="°F" and sensor')}`, ready: 'ul.results li', height: 700 },
    { name: '07-trends-oat-fault6', url: `/trend-viewer?points=${oaTemp}&range=${range(6, 3, 3)}`, ready: '.status-line', height: 700 },
    { name: '08-trends-gap-fault5', url: `/trend-viewer?points=${ids(5).join(',')}&range=${range(5, 3, 3)}`, ready: '.status-line', height: 860 },
    { name: '09-trends-damper-fault2', url: `/trend-viewer?points=${ids(2).join(',')}&range=${range(2, 3, 3)}&layout=overlay`, ready: '.status-line', height: 780 },
    { name: '10-trends-ten-points-90-days', url: `/trend-viewer?points=${tenPoints.join(',')}&range=last90`, ready: '.status-line', width: 1280, height: 1500 },
    { name: '11-trends-table', url: `/trend-viewer?points=${dat},${oaTemp}&range=last7&view=table`, ready: '.his-table tbody tr', height: 800 },
    { name: '12-organization-add-equipment', url: '/site-organization', ready: '[role=treeitem]', height: 760,
      act: `${click('+ Equipment')}; setTimeout(() => { ${setValue('.modal select', 'ats::AtsVav')}; ${setValue('.modal input', 'VAV-7')} }, 300)`, after: '.modal' },
    { name: '13-organization-add-point', url: async () => `/site-organization?sel=${await addBadAhu()}`, ready: '.badge-err', height: 900,
      act: click('+ Point'), after: '.modal .callout' },
    { name: '14-organization-edit', url: `/site-organization?sel=${ahu1}`, ready: '.actions', height: 900, act: click('Edit'), after: '.modal table.tag-edit' },
    { name: '15-organization-delete', url: `/site-organization?sel=${ahu2}`, ready: '.actions', height: 700, act: click('Delete'), after: '.modal .callout' },
  ]

  const dir = mkdtempSync(join(tmpdir(), 'ssl-shot-'))
  const browser = spawn(BROWSERS[0], [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' })
  try {
    let tab: { webSocketDebuggerUrl: string } | undefined
    for (let i = 0; i < 50 && !tab; i++) {
      await sleep(200)
      try { tab = (await (await fetch(`http://localhost:${PORT}/json/list`)).json()).find((t: any) => t.type === 'page') } catch { /* still starting */ }
    }
    if (!tab) throw new Error('browser did not start')
    const ws = new WebSocket(tab.webSocketDebuggerUrl)
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.SHOT_THEME ?? 'light' }] })

    const token = await (async () => { const cl = new HaystackClient(UI); await cl.login(process.env.HAXALL_SU_USERNAME!, process.env.HAXALL_SU_PASSWORD!); return cl.authToken })()
    const go = async (url: string) => { await cdp.send('Page.navigate', { url: UI + url }); await sleep(300) }
    const waitFor = async (sel: string) => {
      for (let i = 0; i < 100; i++) { if (await cdp.eval(`!!document.querySelector(${JSON.stringify(sel)})`)) return; await sleep(150) }
      throw new Error(`timed out waiting for ${sel}`)
    }

    // SHOT_THEME=dark saves files with a -dark suffix; SHOT_ONLY=01,02 limits which shots are taken
    const theme = process.env.SHOT_THEME ?? 'light'
    const suffix = theme === 'dark' ? '-dark' : ''
    const only = process.env.SHOT_ONLY?.split(',')
    for (const s of shots.filter((x) => !only || only.some((o) => x.name.startsWith(o)))) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.width ?? 1280, height: s.height ?? 800, deviceScaleFactor: 1, mobile: false })
      await go('/')
      await cdp.eval(s.token === false ? `sessionStorage.clear()` : `sessionStorage.setItem('ssl.token', ${JSON.stringify(token)})`)
      await go(typeof s.url === 'function' ? await s.url() : s.url)
      await waitFor(s.ready)
      if (s.act) { await cdp.eval(s.act); await waitFor(s.after ?? '.modal'); await sleep(600) }
      await cdp.eval('document.fonts.ready.then(() => true)') // the Ubuntu font must be in before the picture is taken
      await sleep(900) // let the chart settle
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(OUT, `${s.name}${suffix}.png`), Buffer.from(shot.data, 'base64'))
      console.log('saved', `docs/img/${s.name}${suffix}.png`)
      if (typeof s.url === 'function') await removeBadAhu()
    }
    ws.close()
  } finally {
    // remove the deliberately broken demo record first, so a problem below cannot leave it behind
    await removeBadAhu()
    browser.kill()
    await new Promise((r) => { browser.once('exit', r); setTimeout(r, 3000) })
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch { /* temp folder, the system cleans it up */ }
  }
}

await main()
