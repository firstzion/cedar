// Usage (from repo root):
//   npm run demo:load -- [--seed 42] [--reset] [--now 2026-10-16T08:00:00Z]
//   npm run demo:ensure          load only if the demo data is missing or its histories are gone
//   npm run demo:reset           remove the demo data
import { clientFromEnv } from '../../packages/haystack/src/node.ts'
import { DEFAULT_SEED } from './config.ts'
import { demoDataState, loadDemoData, removeDemoData } from './loader.ts'

const [cmd = 'load', ...rest] = process.argv.slice(2)
const flag = (n: string) => rest.includes(`--${n}`)
const log = (s: string) => console.log(s)

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}
/** The value after --name, undefined if the option is not given; an option given without a value is an error. */
const val = (n: string) => {
  const i = rest.indexOf(`--${n}`)
  if (i < 0) return undefined
  const v = rest[i + 1]
  if (v === undefined || v.startsWith('--')) fail(`--${n} needs a value`)
  return v
}

if (!['load', 'ensure', 'reset'].includes(cmd)) fail(`unknown command: ${cmd} (use load, ensure or reset)`)
const seedText = val('seed') ?? String(DEFAULT_SEED)
if (!/^\d+$/.test(seedText)) fail(`--seed needs a whole number (0 or more), not "${seedText}"`)
const seed = Number(seedText)
const nowText = val('now')
const nowMs = nowText === undefined ? Date.now() : Date.parse(nowText)
if (Number.isNaN(nowMs)) fail(`--now needs a date and time such as 2026-10-16T08:00:00Z, not "${nowText}"`)

const c = await clientFromEnv()

async function fullLoad() {
  const t = Date.now()
  const removed = await removeDemoData(c)
  if (removed) log(`removed ${removed} existing demo records`)
  await loadDemoData(c, { seed, nowMs, log })
  log(`done in ${((Date.now() - t) / 1000).toFixed(1)} s (seed ${seed})`)
}

if (cmd === 'load') {
  const st = await demoDataState(c)
  if (st.recs > 0 && !flag('reset')) {
    console.error(`Demo data already loaded (${st.recs} records). Use --reset to wipe and reload.`)
    process.exit(1)
  }
  await fullLoad()
} else if (cmd === 'ensure') {
  const st = await demoDataState(c)
  if (st.recs > 0 && st.pointsMissingHis === 0) log('demo data present with histories: nothing to do')
  else {
    log(st.recs === 0 ? 'no demo data: loading' : `${st.pointsMissingHis} points have no history (Haxall restarted?): reloading`)
    await fullLoad()
  }
} else {
  log(`removed ${await removeDemoData(c)} demo records`)
}
