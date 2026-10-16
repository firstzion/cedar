# Notes for Phase 2: connectors, current values and rules

Phase 1 has **no connector**, no `curVal`, and no rules. This note records where those things plug in so nothing built so far gets in their way. Items marked *verified* were tried on the running Haxall in Chunk 8; the rest are SkySpark conventions to confirm against the chosen connector's own library when the protocol is picked.

## 1. Keep two kinds of tags apart

| Kind | Examples | Who owns it |
|---|---|---|
| **Model tags**: what the thing *is* | `spec`, `point`, `his`, `equipRef`, `siteRef`, `airRef`, `kind`, `unit`, `tz`, the markers that make up the spec (`discharge`, `air`, `temp`, `sensor`) | the `ats` / `ph` specs and our loader |
| **Ingestion tags**: how data *gets in* | a connector's `<protocol>ConnRef`, `<protocol>Cur`, `<protocol>His`, `<protocol>Write`, `curConvert`, `curCalibration`, `hisCollectInterval`, `hisConvert`, `writeLevel` | the connector, added to a point *after* it exists |
| **Runtime tags**: written by the system, not by us | `curVal`, `curStatus`, `curErr`, `hisStatus`, `hisErr`, `hisSize`, `hisStart`, `hisEnd`, `writeVal`, `connState`, `connStatus` | Haxall |

Rules that follow from this:
- The generator and `ats` specs never write ingestion or runtime tags. (Today the loader writes only model tags plus `hisMaxItems` and our own `demoData` marker.)
- *Verified:* extra ingestion-style tags on a point (`fooCur`, `hisCollectInterval`, `curCalibration`) do **not** upset `validate()`. A tag that is a **Ref** must point at a real record: a `fooConnRef` pointing nowhere is reported as "Unresolved ref". A real connector's `...ConnRef` will point at a real connector record, so that works as intended.
- *Verified:* `curVal` cannot be committed ("Cannot set tag persistently"). It only exists when a connector fills it. This is why Site Organization labels the history value "latest history sample" and never fakes a current value.

## 2. Where a connector will attach

1. **Connector record** (new, not in `ats`): a record with `conn` plus the protocol marker (`<protocol>Conn`), a `uri`, and Haxall's own status tags. It is *not* equipment, so it lives outside the site/equip/point tree. Site Organization's tree will not show it unless we choose to; a filter such as `conn` finds it.
2. **Points** get `<protocol>ConnRef` (to that record) plus `<protocol>Cur`, `<protocol>His` and, for writable points, `<protocol>Write`, whose values are the protocol's address of the point. This is added by a *connector learn/sync step*, not by editing the spec.
3. **Libraries:** the protocol's Haxall library (in Haxall 4.0.6 the source tree contains, for example, `hx.modbus`, `hx.mqtt`, `hx.obix`, `hx.sql`, plus the `hx.conn` and `hx.point` frameworks; no BACnet library is in that list) is enabled with `libAdd("hx.xxx")`, exactly as `ph.points` was. The Dockerfile already builds all of Haxall's libraries, so no image change is needed to enable one.
4. **History from a connector** arrives as `hisWrite` calls from the connector's collection, the same operation the demo loader uses. Because the loader already goes through `commit` and `hisWrite` (never into Haxall's files), swapping demo data for live data does not change the Trend Viewer.

## 3. Things to remember when a connector arrives

- **History is in memory and capped.** Haxall keeps history in memory only (lost on restart) and each point holds `hisMaxItems` samples (default 1000; the demo sets 20,000). A live site needs a deliberate `hisMaxItems` per point, and a plan for what happens at restart. This is a Haxall limitation; SkySpark has neither limit. `hisMaxItems` is Haxall-only, so strip it when moving records to SkySpark.
- **Site Organization**: `PointRows` and the point detail already have a "latest history sample" slot. When `curVal` exists, show it next to that with its own label ("Current value") and status. Do not replace the history figure.
- **Numbers are 32-bit** in Haxall's history store (about 7 significant digits). Energy registers near 100,000 kWh have about 0.01 kWh resolution.
- **Demo data tags** (`demoData`, `hisMaxItems`) should not be copied into a real site. `make load` removes only records tagged `demoData`.

## 4. Rules (Phase 2)

- *Verified:* Haxall can store Axon functions as ordinary records. `companionParseAxon("name", "(a)=>...").companionAdd` creates an `rt:func` record that compiles (`companionStatus()` says `ok`), can be called by name, and is removed with `companionRemove`. So rule functions can live in Haxall, shaped like SkySpark rules, with no Fantom. (Try: `make axon E='companionParseAxon("probe", "(a)=>a*2").companionAdd'` then `make axon E='probe(21)'`, then `companionReadByName("probe").companionRemove`.)
- **Ground truth for testing:** `tools/demo_data/faults.json` is machine-readable and lists, for each planted fault, the equipment, the points, the start and end times and a `kind` label. A rule test should assert: run the rule over the whole 90 days and require a result on that equipment inside `[start, end)`, and no results elsewhere (false-positive check).

| Fault `kind` | Idea for the rule |
|---|---|
| `simultaneous-heat-cool` | heating and cooling valve commands both above a threshold while the fan runs |
| `stuck-damper` | damper command constant while airflow setpoint varies, and flow does not follow the setpoint |
| `flatline` | sensor variance zero over a window longer than several hours |
| `weekend-override` | fan status on during unoccupied schedule hours, for a long run |
| `data-gap` | missing samples: interval between samples greater than a few times the normal spacing |
| `implausible-value` | value outside physical limits (for example air temperature below -20 F or above 150 F) |

- **Remember:** the planted sensor faults change only the *recorded* values; the simulated control still used the true values, so the equipment around a faulty sensor behaves normally. `faults.json` times shift with each load (they are relative to "now"), so tests should read the file rather than hard-code dates.
- **Spark-like results** (SkySpark's `spark` records, with the rule, target equipment, and a time span) are not stored anywhere yet. The `Site Organization` and `Trend Viewer` do not need to change for that; a "Sparks" app would be new.

## 5. SkySpark portability checklist (for Phase 2 work)

- Records use `spec: @ats::...` and `ph` tags. In SkySpark 4 the `ats` lib would need to be installed (as a `.xetolib`) or renamed to a registered prefix.
- Records made from `instantiate()` templates use `navName` plus `disMacro` instead of a literal `dis`. SkySpark 4.x understands both.
- VAVs reference their AHU with `airRef` (Haystack 4's name for the old `ahuRef`).
- Strip `demoData` and `hisMaxItems`.
