// Run one Axon expression against local Haxall:  npm run axon -- 'readAll(site)'
import { clientFromEnv } from './node.ts'
const c = await clientFromEnv()
const g = await c.evalAxon(process.argv[2])
console.log(JSON.stringify(g.rows, null, 1))
