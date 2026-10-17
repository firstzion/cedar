// Turns Haxall's validate() output into items the UI can show, with plain-language messages.
import { refId, str, type HDict } from './values.ts'

export interface ValidationItem {
  subject: string | undefined // record id
  slot: string | undefined
  level: 'err' | 'warn'
  rule: string // e.g. sys::missingSlot
  msg: string // Haxall's message
  text: string // plain-language message
}

export type Conformance =
  | { status: 'fits'; spec: string; warnings: ValidationItem[] }
  | { status: 'issues'; spec: string; items: ValidationItem[] }
  | { status: 'nospec'; item: ValidationItem }

/** "DischargeAirTempSensor" -> "Discharge Air Temp Sensor" */
export const humanize = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')

// Haxall's wording when an equipment lacks one of the points its spec requires
const MISSING_POINT = /^Missing required Point: (.+)::(.+)$/

/** The point spec a "missing required point" problem asks for, such as ph.points.sugar::MixedAirTempSensor. */
export function missingPointSpec(item: Pick<ValidationItem, 'msg'>): string | undefined {
  const m = MISSING_POINT.exec(item.msg)
  return m ? `${m[1]}::${m[2]}` : undefined
}

export function friendlyMessage(msg: string, rule = ''): string {
  let m: RegExpMatchArray | null
  if (rule === 'sys::missingSpecRef' || msg.startsWith("Missing 'spec' ref tag")) return 'No spec is assigned to this record (it has no spec tag).'
  if ((m = msg.match(/^Unknown 'spec' ref: (.+)$/))) return `The spec ${m[1]} is not available in this Haxall. Is its library enabled?`
  if ((m = msg.match(/^Missing required slot '(.+)'$/))) return `Missing required tag: ${m[1]}`
  if ((m = msg.match(MISSING_POINT))) return `Missing required point: ${humanize(m[2])} (${m[1]}::${m[2]})`
  if ((m = msg.match(/^Missing required choice '(.+)'$/))) return `Missing a required choice from ${m[1]}`
  if ((m = msg.match(/^Unresolved ref @(.+)$/))) return `Points to a record that does not exist: @${m[1]}`
  return msg
}

export function parseValidation(rows: HDict[]): ValidationItem[] {
  return rows.map((r) => {
    const msg = str(r.msg) ?? ''
    const rule = refId(r.rule) ?? ''
    return {
      subject: refId(r.subject),
      slot: str(r.slot),
      level: str(r.level) === 'warn' ? 'warn' : 'err',
      rule,
      msg,
      text: friendlyMessage(msg, rule),
    }
  })
}

/** Decide the badge for one record from its own validation items. */
export function conformanceOf(rec: HDict, items: ValidationItem[]): Conformance {
  const spec = refId(rec.spec)
  const noSpec = items.find((i) => i.rule === 'sys::missingSpecRef')
  if (!spec || noSpec) return { status: 'nospec', item: noSpec ?? { subject: refId(rec.id), slot: undefined, level: 'err', rule: 'sys::missingSpecRef', msg: "Missing 'spec' ref tag", text: friendlyMessage('', 'sys::missingSpecRef') } }
  const errs = items.filter((i) => i.level === 'err')
  if (errs.length) return { status: 'issues', spec, items: errs }
  return { status: 'fits', spec, warnings: items.filter((i) => i.level === 'warn') }
}

/** Count error items per subject id. */
export function errorCounts(items: ValidationItem[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of items) if (i.subject && i.level === 'err') m.set(i.subject, (m.get(i.subject) ?? 0) + 1)
  return m
}
