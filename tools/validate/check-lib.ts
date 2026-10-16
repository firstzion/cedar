// Prints the status of the ats lib and exits non-zero if it did not compile.
// Run after editing specs:  make specs
import { clientFromEnv, enableLibs, libStatus, LIB } from './helpers.ts'

const c = await clientFromEnv()
const added = await enableLibs(c)
if (added.length) console.log('enabled libs:', added.join(', '))
const s = await libStatus(c)
if (!s) {
  console.error(`FAIL: lib "${LIB}" not found. A new lib folder needs a Haxall restart (make specs).`)
  process.exit(1)
}
if (s.libStatus !== 'ok') {
  console.error(`FAIL: lib "${LIB}" status=${s.libStatus}\n${s.err ?? ''}`)
  process.exit(1)
}
console.log(`OK: lib "${LIB}" ${s.version} compiled`)
