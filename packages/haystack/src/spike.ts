// Quick check that login, about and eval work against the running Haxall:  make spike
import { clientFromEnv } from './node.ts'

const c = await clientFromEnv()
console.log('login ok')
const about = await c.about()
console.log('about:', about.productName, about.productVersion, '(user', about.whoami + ')')
const g = await c.evalGrid(process.argv[2] ?? '1+1')
console.log('eval:', JSON.stringify(g.rows))
const sites = await c.read('site')
console.log('sites:', sites.map((s) => s.dis))
