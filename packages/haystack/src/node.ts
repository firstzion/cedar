// Node-only helper (reads .env values). Not exported from index.ts so browser bundles never see `process`.
import { HaystackClient } from './client.ts'

export async function clientFromEnv(): Promise<HaystackClient> {
  const c = new HaystackClient(`http://localhost:${process.env.HAXALL_PORT ?? '8080'}`)
  await c.login(process.env.HAXALL_SU_USERNAME!, process.env.HAXALL_SU_PASSWORD!)
  return c
}
