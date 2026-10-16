# The `ats` Xeto library

Our equipment templates. Files in `src/xeto/ats/`:

| File | Defines |
|---|---|
| `lib.xeto` | Lib name, version, and which standard libs it uses |
| `site.xeto` | `AtsSite`: a site with area, time zone, street address required |
| `ahu.xeto` | `AtsAhu`: VAV-serving AHU and its required points; also `AtsOccupiedSp` |
| `vav.xeto` | `AtsVav`: reheat VAV terminal unit and its required points |
| `meter.xeto` | `AtsElecMeter` (main) and `AtsElecSubmeter` (needs `submeterOf`) |

Nothing in `ph` is modified. Each spec *extends* a standard one (`Site`, `Ahu`, `Vav`, `ElecMeter`) and adds a `points:` list.

## Required points (current)

Names are the exact standard `ph` spec names (all but one from `ph.points.sugar` or `ph.elec`).

**AtsAhu** (extends `ph::Ahu`)
| Your wording | Spec |
|---|---|
| Supply/discharge air temp, setpoint | `DischargeAirTempSensor`, `DischargeAirTempSp` |
| Return / mixed / outside air temp | `ReturnAirTempSensor`, `MixedAirTempSensor`, `OutsideAirTempSensor` |
| Supply fan command, status, speed | `DischargeFanRunCmd`, `DischargeFanRunSensor`, `DischargeFanSpeedModulatingCmd` |
| Duct static pressure, setpoint | `DischargeAirPressureSensor`, `DischargeAirPressureSp` |
| Cooling valve command | `ChilledWaterValveModulatingCmd` |
| Heating valve command | `HotWaterValveModulatingCmd` |
| OA damper command | `OutsideAirDamperModulatingCmd` |
| Occupancy mode | `ats::AtsOccupiedSp` (ours) |

**AtsVav** (extends `ph::Vav`)
| Your wording | Spec |
|---|---|
| Zone air temp | `ZoneAirTempSensor` |
| Zone cooling / heating setpoints | `ZoneAirTempCoolingSp`, `ZoneAirTempHeatingSp` |
| Airflow, airflow setpoint | `DischargeAirFlowSensor`, `DischargeAirFlowSp` |
| Damper command | `DischargeAirDamperModulatingCmd` |
| Reheat valve command | `HotWaterValveModulatingCmd` |
| Discharge air temp | `DischargeAirTempSensor` |
| Occupancy | `ZoneOccupiedSensor` |

**AtsElecMeter / AtsElecSubmeter** (extend `ph::ElecMeter`)
`ElecAcImportActiveEnergySensor` (total energy), `ElecAcImportActiveDemandSensor` (demand). Submeters also require `submeterOf`.

### Things to review
1. **Occupancy mode on the AHU:** `ph` has no concrete AHU occupancy point (`OccupiedSp` is abstract; only the zone version `ZoneOccupiedSp` is concrete). I added `AtsOccupiedSp : OccupiedSp`. Alternative: use `ZoneOccupiedSp` or leave it out.
2. **VAV "occupancy":** I used `ZoneOccupiedSensor` (true/false occupied), not `OccupancySensor` (which counts people).
3. **"Active demand/power":** I required demand (`...ActiveDemandSensor`). Instantaneous power (`ElecAcImportActivePowerSensor`) is not required. Swap or add if you prefer.
4. **Supply fan status** is `DischargeFanRunSensor`; there is no separate speed *feedback* required (`DischargeFanSpeedModulatingSensor` would add it).
5. **Optional points:** none yet. Syntax is confirmed: put `?` after the name (e.g. `ZoneCo2Sensor?`). A missing optional point passes validation. Tell me which nice-to-haves to add. Note `instantiate` still creates optional points, so the demo loader will skip the ones it doesn't need.

## How to add a point to a spec
1. Find the standard name: browse `ph.points.sugar`/`ph.points`/`ph.elec` (e.g. `make axon E='specs(...)'`), or ask me.
2. Add one line to the `points: { ... }` list in the right file, for example `ReturnAirHumiditySensor` doesn't exist yet in sugar, but `DischargeAirHumiditySensor` does.
3. `make specs` (restarts Haxall, about 40 s, prints OK or the exact error with file and line).
4. `make test`.

## Handy facts
- `instantiate(spec("ats::AtsVav"), {graph})` builds a VAV plus all its points with the right markers; the demo data loader uses this so the specs stay the single source of truth.
- Validation: `readById(@id).validate(null, {graph})` checks a record **and** its required points. Without `{graph}` required points are not checked.
- Haxall reads lib files only at startup: **edit a spec, then `make specs`**.
