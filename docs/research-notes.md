# Research Notes (Chunk 1, desk research)

Date: 2026-10-16. Status: **desk research from source only. Nothing has been run yet.**
Items marked **[VERIFY]** must be confirmed against a running Haxall in Chunk 2/3.

Sources read (shallow clones of `master`, Haxall 4.0.6):
- Haxall repo: https://github.com/haxall/haxall (`readme.md`, `docker/`, `docker-compose.yml`, `src/ext/hxApi/design.md`, `src/xeto/hx*/funcs.xeto`, `src/xeto/hx.doc.haxall/*.md`)
- Xeto repo: https://github.com/Project-Haystack/xeto (`src/xeto/ph/*.xeto`, `ph.points`, `ph.elec`, `doc.xeto/HttpApi.md`, `doc.xeto/Auth.md`, `doc.xeto/Libs.md`, `doc.xeto.tools/Setup.md`)
- Haxall setup docs: https://haxall.io/doc/docHaxall/Setup
- Phable: https://pypi.org/project/phable/
- npm: `haystack-nclient` 4.0.7, `haystack-core` 3.0.13 (J2 Innovations)

## Findings that change the plan

| # | Plan said | Reality | Impact |
|---|---|---|---|
| 1 | "Run Haxall via its official Docker image" | **There is no published image.** The repo ships a `docker-compose.yml` + `docker/Dockerfile` that *builds* the image locally (installs Fantom, clones xeto and haystack-defs, compiles Haxall). First build is slow (several minutes) and needs network. | Chunk 2 vendors/clones the Haxall repo and builds from it. Pin a release tag. |
| 2 | Standard specs live in `ph.equips`, `ph.points`, `ph.points.elec` | `Site`, `Ahu`, `Vav`, `ElecMeter`, `Meter`, `Equip` are all in **`ph`** (`ph/equip.xeto`, `ph/site.xeto`). Points are in **`ph.points`** (air, fan, valve, damper, occupied). Electric points are in **`ph.elec`** (not `ph.points.elec`). `ph.equips.sugar` exists but only holds sugar specs. | Use the real names below. |
| 3 | `fits` / `fitsExplain` | `fits(val, spec)` exists and returns Bool, but **it never checks required slots**. Use **`validate(val, spec?, opts?)`**, which returns a grid of err/warn items with messages. That is our "what's missing" source for the conformance badge. | Badge = `validate()`. |
| 4 | Browser may call Haxall directly or need proxy | No CORS support found anywhere in Haxall source. **Vite dev proxy is required** (and a reverse proxy for any prod build). | Decided: proxy. |
| 5 | `hisRollup` for server-side rollups | Appears in Haxall Axon docs examples; not found in the lib func lists I read. **[VERIFY]** it exists in Haxall. | Fallback: downsample client-side (min/max/avg buckets) or via Axon `eval`. |
| 6 | Phable needs Python 3.11+ | Confirmed (PyPI). This Mac has only system Python 3.9.6. | See language decision. |

## 1. Running Haxall

- Compose service `haxall`, built from `docker/Dockerfile` (base `eclipse-temurin:17`, builds Fantom 1.0.82 and current master of `xeto` and `haystack-defs`).
- Env vars (via `.env`): `HAXALL_PORT` (default 8080), `HAXALL_DB_NAME` (default `var`), `HAXALL_SU_USERNAME` (default `su`), `HAXALL_SU_PASSWORD` (if unset, a random one is generated and printed in container logs on first start).
- Persistence: bind mount `./dbs:/app/haxall/dbs`. The DB is created only if `dbs/<HAXALL_DB_NAME>` does not exist. Wipe by deleting that folder.
- Start script runs `fan hx init -headless ...` then `fan hx run <db>`.
- Release zips (non-Docker) also exist: `bin/hx init <name>`, `bin/hx run <name>`; needs Java 8+.
- Docker Desktop **is installed but the daemon was not running** when checked (Chunk 2 prerequisite: open Docker Desktop).
- The Dockerfile and compose live in Haxall's repo, not ours, and `COPY . /app/haxall/`. So our compose file must either build with Haxall's repo as context, or we maintain our own Dockerfile derived from theirs. **Decision pending in Chunk 2** (leaning: our own small compose + Dockerfile that clones a pinned Haxall tag, so our repo contains no Haxall source).

## 2. Custom Xeto lib (no Fantom needed)

- A Xeto lib is just a folder: `{dir}/src/xeto/{lib-name}/lib.xeto` plus any `.xeto` files (all compiled, any depth). Lib name = folder name. Lowercase ASCII, digits, underbar, dot-separated.
- `lib.xeto` holds `pragma: Lib < doc: "...", version: "0.1.0", depends: { { lib: "sys" } { lib: "ph" } { lib: "ph.points" } ... } >`. See `ph/lib.xeto` for the real shape (it uses BuildVar for versions; ours uses literals).
- Discovery: Xeto searches an env path: workDir first, then `path=` entries in `xeto.props`, then Haxall home. Each dir is searched at `src/xeto/<lib>/` then `lib/xeto/<lib>/`. We can mount our `specs/` folder into the container and point `xeto.props` `path=` at it. **[VERIFY]** exact mount point and that `hx run` honors it.
- Enabling in a running Haxall project: Axon `libAdd("ats")` (admin only), stored as an `rt:lib` managed record. Also `libs()`, `libRemove()`, `libReload()`.
- Compile check: `xeto` CLI is bundled (`xeto version` shows the path). **[VERIFY]** the CLI command that compiles/validates a lib (likely `xeto build`/`xeto compile`; check `xeto help`). Fallback: `libAdd("ats")` over the API and read `libs()` status.
- **Namespace "ats":** valid as a lib name. Docs say top-level prefixes are formally granted via xeto.dev to avoid name collisions. Fine for local use. If we ever publish, we'd register or rename (e.g. `ats.equips`). Cost to rename later is small if the name is only in one place (see decisions).

## 3. Exact standard spec names (copied from source)

Equips (all in `ph`):
- `ph::Site` (extends `GeoPlace`). Slots: `area: Number?`, `tz: TimeZone?`, `geoAddr`, `geoCity`, `geoState`, `geoCoord`, `geoPostalCode`, `primaryFunction`, `yearBuilt`, etc.
- `ph::Ahu` (extends `AirHandlingEquip`, marker `ahu`).
- `ph::Vav` (extends `AirTerminalUnit`, marker `vav`; optional `vavAirCircuit`, `vavModulation`, `heatingProcess`).
- `ph::ElecMeter` (extends `Meter`, marker `elec`). `Meter` has optional `submeterOf: Ref?`; `SubmeterMeterScope` / `SiteMeterScope` are choices for main vs sub.
- Points: `ph::Point` base requires `kind`; `NumberPoint` also requires `unit`. Slots: `equipRef`, `siteRef`, `his`, `cur`, `tz`, `writable`, `pointFunction`, `pointQuantity`, `pointSubject`.

Points in `ph.points` (candidates for §4 mapping; each is a distinct spec, to be matched to the table in Chunk 3 by reading the actual definitions):
- Air temp: `AirTempSensor`, `AirTempSp`, `DuctAirTempSensor`, `DuctAirTempSp`, `ZoneAirTempSensor`, `ZoneAirTempSp`
- Airflow / pressure: `AirFlowSensor/Sp`, `DuctAirFlowSensor/Sp`, `AirPressureSensor/Sp`, `DuctAirPressureSensor/Sp`
- Fans: `FanRunCmd`, `FanRunSensor`, `FanEnableCmd`, `FanSpeedModulatingCmd/Sensor`, `DuctFanRunCmd/Sensor`, `DuctFanSpeedModulatingCmd/Sensor`
- Valves: `ValveModulatingCmd/Sensor`, `ValveOpenCmd/Sensor`, `WaterValveModulatingCmd/Sensor`
- Dampers: `DamperModulatingCmd/Sensor`, `DuctAirDamperModulatingCmd/Sensor`
- Occupancy: `OccupancySensor`, `OccupiedSensor`, `OccupiedSp`, `ZoneOccupiedSensor/Sp`
- Electric (`ph.elec`): `ElecAcImportActiveEnergySensor`, `ElecAcImportActiveDemandSensor`, `ElecAcImportActivePowerSensor`, plus Export/Net/Apparent/Reactive variants.

Note: many point specs are tag-combination ("sugar") specs selected by choices (e.g. discharge vs return, cooling vs heating), so the exact marker tags a record must carry come from each spec. Chunk 3 will read each one in full and document it in the lib comments. Do not guess markers.

## 4. Record validation

- `validate(rec, spec)` returns a grid of items; empty means OK. `fits(rec, spec)` is a cheap Bool for subtype/tag match only.
- Records declare their spec via the `spec` tag as a Ref, e.g. `spec: @ph::Ahu` (see `fits({spec:@ph::Ahu}, Equip)` in funcs docs). `validate(rec)` with null spec uses the record's `spec` tag and reports `sys::missingSpecRef` if absent. **[VERIFY]** that Haxall resolves `@ats::AhuVav` style refs for a lib we added.
- Python/TS side: call via the `eval` op, e.g. `readAll(equip).map(r => validate(r))`.

## 5. HTTP API

- Base: `/api/{proj}/{op}` (v4 default, grids in zinc). Header `Xeto-Version: 5` (or `?xeto-version=5`) selects the typed JSON protocol. `{proj}` is the DB name (`var` by default in Docker; the Haxall daemon is a single project). `sys` is reserved.
- Ops in sources: `about`, `ops`, `libs`, `filetypes`, `read`, `readById`, `readByIds`, `readAll`, `nav`, `hisRead`, `hisWrite`, `commit` (admin), `eval`, `watchSub/Unsub/Poll`, `pointWrite`, `close`, `openapi`. All ops the plan needs exist.
- `commit`, `hisWrite`, `nav`, `hisRead` take a request grid (`opGrid`). **Decision: use v4 (zinc/JSON grids)** because Phable and haystack-nclient target it, and it is what SkySpark speaks. v5 is new; revisit later.
- Auth: SCRAM-SHA-256 (required by spec), yielding a Bearer `authToken` after handshake. Plaintext and OAuth are also in the spec but Haxall defaults to SCRAM. Browser clients must implement SCRAM (WebCrypto) or use `haystack-nclient`, which does.
- Watches/curVal: not needed (no connectors).

## 6. CORS / proxy

No CORS handling found. Use Vite `server.proxy` for `/api` to `localhost:8080` in dev, and the same-origin proxy approach for a built bundle.

## 7. SkySpark conventions

- Refs: `siteRef`, `equipRef` on points; `siteRef` (and optionally `equipRef` for nested equip) on equips; `submeterOf` for submeters. Matches `ph`.
- Points: `point`, `his`, `tz`, `unit`, `kind` required by `ph::Point` / `NumberPoint`. `cur` is for connector-fed values; omit (plan §6).
- `spec: @ph::X` tag drives Xeto typing in SkySpark 4.x/Haxall 4.x.
- The doc date inside `design.md` says 2026 (the repo is current as of this research).

## Tooling check on this Mac

| Tool | Status |
|---|---|
| Docker 29.8 / Compose 5.5 | Installed; **daemon not running** |
| Python | System 3.9.6 only. Phable needs 3.11+. `brew` and `uv` not installed |
| Node | v24.19 / npm present (`~/.local/node`). `pnpm` absent (not needed) |
| git, make | present |

## Open items to verify with a running Haxall (Chunk 2/3)
1. Mounting `specs/` into the container and having Haxall find `ats`; `libAdd("ats")` works.
2. CLI/Axon way to compile-check a lib.
3. `validate()` output format and that `@ats::...` spec refs resolve on commit.
4. `hisRollup` availability; actual 86k-sample `hisRead` latency over zinc vs JSON.
5. Whether `commit` accepts a `spec` Ref tag as-is.
6. Haxall's `hisWrite` limits per request (batch 1-2k rows if needed).

---

# Chunk 2 hands-on results (2026-10-16)

Built and ran Haxall from pinned source on this Mac (Apple Silicon, Docker 29.8). Everything below was observed on the running container.

## Build and run
- Image builds on arm64 with no changes. First build took roughly 3 minutes (mostly Fantom + Haxall compile). Image: `skyspark-lite-haxall`, container `skyspark_lite_haxall`, Compose project `skyspark-lite`.
- Pinned commits (all in `.env.example`): Haxall `b13ca10` (master, 15 Oct 2026, reports version 4.0.6), Xeto `deb8135`, haystack-defs `d042781`, Fantom `3602f0e`. We pin master commits, not the `v4.0.6` tag, because the research above was read from master (the v5 API and `validate()` may not be in the tag **[unchecked]**).
- First start: `hx init -headless` creates the DB and su user from `.env`; healthcheck on `/` goes healthy in about 25 s.

## Answers to the [VERIFY] items
1. **API project name is `sys`, not the DB name.** Calls go to `/api/sys/<op>`. `/api/demo/...` returns 404. (Plan said `/api/<proj>/`; the research notes assumed the DB name.)
2. **Login:** SCRAM-SHA-256 works. `haystack-nclient` does **not** support it (it only has FIN/SkySpark-style auth), so we wrote `packages/haystack/src/scram.ts` (Web Crypto + fetch, works in Node and browsers, verifies the server signature). `haystack-nclient` was removed. Decision: own thin client, as the plan's fallback allowed.
3. **Custom lib discovery works.** `fan.props` `path=...;/app/specs` makes Haxall find `/app/specs/src/xeto/ats/`. **The lib list is scanned once at startup**, so a *new* lib folder needs a container restart before `libAdd("ats")` works (otherwise `UnknownLibErr`). After that, `libs()` shows `ats` with `libStatus: ok`. **[VERIFY in Chunk 3]** whether editing an existing lib's files needs only `libReload()` or also a restart.
4. **`libAdd` works** (admin). The standard point/elec libs are **not enabled by default**: `libAdd(["ph.points","ph.elec"])` is required before `@ph.points::...` spec refs resolve (otherwise `validate` says `unknownSpecRef`). `ats` must declare these in `depends`, and the loader/setup must enable them.
5. **`validate(rec, null)` works with the rec's own `spec` ref** and returns rows with `subject, slot, level, rule, msg` (e.g. "Missing required slot 'siteRef'", "Missing required choice 'ph::Temp'", "Unresolved ref @e", "Point should have tz"). This is exactly what the conformance badge needs.
6. **`commit` accepts a `spec` Ref tag** and custom marker tags with no validation at commit time. Grid meta `commit: "add"` / `"remove"` as in the Haystack spec.
7. **No `hisRollup`/`hisClip`/etc.** Only `hisRead` and `hisWrite` exist (`funcs()` filter). Rollups must be done client-side (min/max bucketing) in the UI. **Docs mentioning `hisRollup` describe SkySpark.**
8. **No Xeto CLI check needed for compile:** `libs()` status plus the error message from `libAdd` is enough for the compile test. **[VERIFY]** the message for a syntax error in Chunk 3.
9. **hisWrite limits:** none hit. 86,400 rows in one call took 270 ms.
10. **hisRead speed:** 86,400 samples (one point) as Hayson JSON: 1.2 s including parsing in Node. Target (86k total across 10 points, in a browser) looks achievable; payload size not yet measured.

## Surprises that change the plan
- **History buffer is capped at 1000 items per point by default** (`IndexMgr.hisMaxItems`, in Haxall source). Older samples are silently dropped when you write more. Fix: set the tag **`hisMaxItems`** on every point (we use 20000; tested 100000). 90 days at 15 min is 8,640 samples. This is a Haxall-specific tag; SkySpark has no such limit, so strip it if records are ever exported to SkySpark.
- **History is in memory only and is lost when Haxall restarts.** Verified: wrote 8,640 samples, restarted the container, `hisRead` returned 0 rows (db folder stays ~336 KB). Records (site/equip/points) *do* persist. Consequence: the demo loader must be re-runnable after every restart; `make up` should call a cheap "ensure demo data loaded" check (load if the site is missing or histories are empty). Because generation is seeded, the data is identical except the "now" anchor, so faults shift in absolute time on each reload (manifest regenerated every time). Real deployments will rely on connectors refilling history; call this out in Known Limitations.
- Node's built-in TypeScript stripping (`--experimental-strip-types`) does not allow constructor parameter properties or enums; keep TS code to plain syntax in `packages/haystack`/`tools` (the UI uses Vite, so it is not affected).
- Commit result is a grid containing the new rec including `id` (with `dis` in the Hayson ref) and `mod`; `mod` is required for later edits/removes.

---

# Chunk 3 results (2026-10-16): the `ats` lib

- `ats` compiles (`libStatus: ok`). Specs: `AtsSite`, `AtsAhu`, `AtsVav`, `AtsElecMeter`, `AtsElecSubmeter`, `AtsOccupiedSp`. Required points use the `points: { ... }` pattern copied from `ashrae.g36` (Xeto repo).
- **Point spec names live in `ph.points.sugar`** (e.g. `DischargeAirTempSensor`, `OutsideAirDamperModulatingCmd`, `HotWaterValveModulatingCmd`) and `ph.elec`, not just `ph.points`. `ats` depends on `sys, ph, ph.points, ph.points.sugar, ph.elec`; all three non-default libs must be enabled with `libAdd` (done by `tools/validate/helpers.ts: enableLibs`).
- **Edits to spec files need a Haxall restart** (`libReload()` does not rescan files). `make specs` automates restart + compile check. Compile errors come back as `libs()` `err` text with file:line, e.g. `vav.xeto(5,5): Unresolved spec: ...`.
- **`validate(rec, null)` alone does not check required points.** Use `validate(rec, null, {graph})`. Result lines look like `points._3: Missing required Point: ph.points.sugar::MixedAirTempSensor`. Referenced recs (siteRef, equipRef) must exist or validate reports `Unresolved ref`.
- **`instantiate(spec, {graph, useSlotSpec, parent: site})` generates equip + points** with correct markers, `spec` refs, `kind`, `disMacro`/`navName`. It does not add `unit`, `tz`, `his`; the loader adds those. This is the SkySpark-style template mechanism and is the basis for Chunk 4.
- Records get names from `navName` plus `disMacro` (`$equipRef $navName`) instead of a literal `dis`; we should follow that so display names match SkySpark 4.x.
- `commit` with preset `id` values works (used by tests).
- Tests use Node's built-in `node:test` (no extra dependency). Test records are tagged `sslTest` and removed afterward.
- Optional points: `Name?` inside `points: { }` compiles and a missing optional point passes `validate(..., {graph})`. `instantiate(..., {graph})` still generates optional points, so the loader must drop the ones it does not want.

---

# Chunk 4 results (2026-10-16): demo data

- Loader runs entirely through the Haystack API: `commit` (records), `eval` (instantiate, validate), `hisWrite` (history). 140 records and 1,071,168 samples load in about 2 seconds.
- Records come from `instantiate(spec, {graph, useSlotSpec, parent: site})`. Each point gets `spec` = its own template spec ref (e.g. `ph.points.sugar::DischargeAirTempSensor`), not the equip slot. The loader adds only what a template cannot know: `navName`, extra choice markers, `airRef` / `submeterOf`, `his`, `tz`, `unit`, `hisMaxItems`, and our `demoData` marker.
- **VAV to AHU link is `airRef`** (Haystack 4 renamed `ahuRef`). Submeters: `submeter` marker plus `submeterOf`; main meter has `siteMeter`.
- `validate(readAll(demoData), null, {graph})` is clean with no warnings. Extra tags (demoData, hisMaxItems, airRef, chilledWaterCooling etc.) do not upset validation.
- Display names come from `navName` + `disMacro`; the site has a literal `dis`. We do not write `dis` on equips or points.
- Validation happens after the records are committed (references must resolve) and before any history is written. On errors the loader removes the demo records and prints the errors.
- Reset removes everything tagged `demoData`; `ensure` reloads when the data is missing or any demo point has `hisSize` below 100 (Haxall restarted).
- `hisRead` range strings need the zone, like `2026-08-24T00:00:00-07:00 Los_Angeles,2026-08-28T00:00:00-07:00 Los_Angeles`. Window ends are exclusive.
- Haxall rounds nothing: values come back exactly as written. Units are stored per sample (`{_kind: number, val, unit}`); the unit must equal the point's `unit` tag.
- Haxall and the sim use different clocks: `faults.json` records `firstSample`/`lastSample` so tests and Phase 2 rules know the reference time.

---

# Chunk 5 results (2026-10-16): web app shell and client layer

- **Haxall's CSRF rule:** once the browser holds Haxall's session cookie (set by the SCRAM login response, and also by the Haxall web UI on `localhost:8080`, because cookies ignore port numbers), every non-GET request without an `Attest-Key` header is rejected with `400 Attest-Key header required` (source: `HxdUserAuth.fan`). Our client authenticates only with `Authorization: BEARER authToken=...` and sends `credentials: 'omit'` on every fetch, so the cookie is never sent. Node scripts never hit this because they have no cookies. A unit test pins this behaviour.
- **v4 `read` op returns many rows** (with `filter` and optional `limit` columns); `readAll` is not usable over v4 (it expects a Filter type and rejects a string). `read` with `id` returns one record; `nav` with a ref `navId` lists children (for the demo site: all 15 equips as siblings, because VAVs point at AHUs with `airRef`, not `equipRef`). The Site Organization tree in Chunk 6 will build nesting itself.
- **TypeScript 7 and Vite 8, React 19, Vitest 5** are what npm installed (exact versions pinned in `package.json`). `erasableSyntaxOnly` is on for the UI so code stays compatible with Node's type stripping.
- **Dev proxy:** Vite forwards `/api` to Haxall (target from root `.env`: `HAXALL_URL` or `HAXALL_PORT`). When Haxall is stopped the proxy answers 502, which the client maps to `UnreachableError`.
- **Client layer** (`packages/haystack`): `HaystackClient` with typed reads (`about`, `read`, `readByIds`, `nav`, `hisRead`, `evalGrid`), values decoded from Hayson into plain shapes (`HRef`, `HNumber`, `HDateTime`, markers), three error classes (`UnreachableError`, `AuthError`, `ApiError`). Writes (`commit`, `hisWrite`) exist only on the raw `op()` used by the Node tools; no typed write helpers exist for the UI.
- `haystack-nclient` is no longer used anywhere (Chunk 2 decision stands).
- Verified in the browser pane: wrong password message, successful login, session resume on refresh, app switching, site selector, yellow "Haxall is not responding" bar while the container is stopped, unreachable message on the login page when reloaded while stopped, and quiet fallback to login after a Haxall restart invalidates the token.

---

# Chunk 6 results (2026-10-16): Site Organization

- **Equipment hierarchy:** in the demo, VAVs point at their AHU with `airRef` (a *fed-by* relationship), not `equipRef` (containment), so all 15 equips are siblings in the tree. Nesting is built from `equipRef`, as the plan asks, and is covered by unit tests (including loops and orphans). If you later want VAVs listed under their AHU, that is a display choice on `airRef`, not a data change.
- **Spec check source:** `validate(rec, null, {graph})` for the selected record (exact, cached by the record's `mod` time) and one site-wide call `readAll(siteRef==@id or id==@id).validate(null, {graph})` for the red `!` marks (about 60 ms for 140 records). Equip-level validation covers required *points*; a point's own errors (such as a missing `sensor` marker) show on the point, not on its equip. Because the equip badge is cached by the equip's `mod`, it will not notice a point being added or removed until the cache expires (30 s) or the page is reloaded.
- **Plain-language messages** are produced by `friendlyMessage()` in `packages/haystack/src/validate.ts` for the rules seen so far (missing slot, missing point, missing choice, unresolved ref, missing or unknown spec). Anything else is shown as Haxall wrote it.
- **Latest history sample:** points carry `hisStart`, `hisEnd`, `hisSize` but no value, so the client reads the last two hours before `hisEnd` and takes the final item (one small `hisRead` per visible point).
- **Display names:** records made from templates have no `dis` tag. Haxall puts the expanded name on the id reference (`Demo Office AHU-1 DischargeAirTempSensor`); `displayName()` uses `dis`, then that, then `navName`.
- **Spec references** such as `ats::AtsAhu` are not records, so they are shown as plain text rather than links.
- **Safety of the Axon text:** the UI never sends user text as Axon. Record ids used inside the validate expressions must match `[A-Za-z0-9_.:~-]+` (tested). The user's raw filter goes through the `read` op's `filter` column, not through Axon.
- **Trend Viewer link contract (for Chunk 7):** `/trend-viewer?points=<id>,<id>&range=last7`. Range presets: `today`, `yesterday`, `thisWeek`, `last7`, `last30`, or a custom range (to be defined in Chunk 7).
- Live tests now run one file at a time (`--test-concurrency=1`) because they share one Haxall database.
- Verified in the browser pane: site view with the green badge, AHU-1 with its 14 points and latest values, a point with the tree opening to it automatically, a VAV with a removed point (named in the badge, red `!` in the tree), a point with a removed marker (two problems explained), a filter run, an invalid filter error, an unknown id, and a deep link straight to a record.

---

# Chunk 7 results (2026-10-16): Trend Viewer

- **Performance (target: 90 days x 10 points, about 86k samples, under 2 s):** measured against the real demo data. Fetch + parse of 86,400 samples over 10 parallel `hisRead` calls took about 210-340 ms; preparing and thinning them for display about 11 ms; building the chart about 10-20 ms. A zoom re-thins the full-resolution data in roughly 6 ms. No server-side rollups were needed (Haxall has none anyway). The fast path is `HaystackClient.hisSeries()`, which reads rows straight into arrays instead of decoding every cell. Tests: `tools/validate/trend-viewer.perf.test.ts`.
- **Spikes and flatlines survive thinning:** instead of the chart library's averaging or LTTB sampling, `decimate()` keeps the first, lowest, highest and last sample in every pixel column, and re-runs on every zoom from the full data held in memory. Tests cover a one-sample spike, a flatline and a step.
- **Gaps:** a jump of more than 2.5 x the median sample spacing is a gap. The line breaks (a null point is inserted) and a shaded band marks it. Fault 5 (24 h with no samples) is obvious at 90 days and when zoomed.
- **Axes:** the plan asks for one y-axis per unit. The data-viz guidance forbids two y-scales on one plot, so the default is *Panel per unit* (one panel and axis per unit on a shared, linked time axis and zoom); *Overlay* (one plot, axis per unit) is a toggle. Booleans and enums get their own panel/axis with step lines.
- **Time zone:** ECharts has no per-zone time axis. Timestamps are shifted by the site's UTC offset at that moment and drawn with the chart's UTC option, so ticks and the tooltip read in site time, including across daylight saving. Tests cover spring-forward and fall-back.
- **Bug found and fixed:** `localMidnight()` (used by the demo fault windows) mis-handled daylight saving change days. It was moved from `tools/demo_data` into `packages/haystack/src/timeutil.ts` and rewritten around the zone's UTC offset; the 90-day demo window contains no clock change so the data did not change. Range tests now cover 23- and 25-hour days.
- **Colour:** the reference palette's fixed order, validated with the skill's validator against this app's chart surfaces: light passes (3 slots under 3:1 contrast, relief provided by the always-visible legend, tooltip and table view); dark passes everything. Text stays in ink; only the line keys carry series colour. A colour stays with its point while others are added or removed. Points 9 and 10 reuse slots 1 and 2 as dashed lines (secondary encoding); the limit is 10 points, as the performance target needs.
- **Haxall stores history numbers as 32-bit floats** (about 7 significant digits). 8.83 is read back as 8.829999923706055 and 182,959.98 kWh as 182,959.984375. Display, tooltip and CSV round to 7 significant digits. Energy registers near 100,000 kWh therefore have roughly 0.01 kWh resolution.
- **A bug the tests caught:** the changing "now" in a preset range was recomputed when the point details arrived, so every point was fetched twice. The range is now fixed once per choice (only "All data" depends on the points' extent).
- **Another:** the chart rebuilt (and lost its zoom) whenever the page re-rendered because the list of shown series was a new array each time; now memoized.
- **Bundle:** the chart library makes the Trend Viewer chunk about 590 kB (200 kB compressed); it is loaded only when the Trend Viewer is opened.
- **Dev only:** `window.__trendChart` exposes the chart in development so zoom can be driven from tests or the console. It is not present in a production build.
- Verified in the browser pane: all six planted faults are visually identifiable (1: both valves open together Mon-Thu; 2: damper frozen at 35% while airflow setpoint moves; 3: seven-day flatline; 4: AHU-2 fan on across a whole weekend; 5: shaded 24 h gap with broken lines; 6: -40 F plunge), hover tooltip with every series, zoom, table, CSV content, overlay layout, custom range, and the Site Organization "Open in Trend Viewer" link.

---

# Chunk 8 results (2026-10-16): polish and audit

- **Axon functions can be stored as records** (needed for Phase 2 rules, plan section 6): `companionParseAxon("f", "(a)=>a*2").companionAdd` creates an `rt:func` record, `companionStatus()` reports `ok`, the function can be called by name, and `companionRemove` deletes it. No Fantom.
- **Connector-style tags coexist with specs:** extra ingestion tags (`fooCur`, `hisCollectInterval`, `curCalibration`) leave `validate()` clean; a Ref-typed tag must point at a real record. `curVal` cannot be committed at all ("Cannot set tag persistently"): it is runtime-managed, which is why Site Organization never fakes it. Details in `docs/connector-notes.md`.
- **Bug found by the audit:** the example filter chip `point and unit==°F` failed in Haxall (a Str tag needs quotes: `unit=="°F"`). Fixed; the examples now live in `ui/src/apps/organization/examples.ts` and a live test runs every example against Haxall.
- **Bug found by the screenshots:** a record with no name has an id label equal to its own id, which made the detail heading show a raw id. `displayName()` now ignores a ref label that is just the id.
- **Responsive check:** at tablet (768 px) and phone (375 px) widths nothing overflows. On narrow screens the Trend Viewer shows the chart before the picker, the picker list is height-limited, and Site Organization scrolls the detail into view when a record is picked. Legend labels wrap so the remove button stays visible.
- **Screenshots are reproducible:** `make screenshots` drives a headless Chromium-family browser (Chrome, Brave, Edge or Chromium; found automatically) through the DevTools protocol with Node's built-in WebSocket: no extra packages. It signs in by handing the browser a token, builds a deliberately broken AHU for the "problem" picture and removes it afterwards.
- **Clean-state run-through:** deleted `node_modules`, `dbs/` and `ui/dist`; `make install` then `make up` (a fresh database was created, the `ats` lib and the standard libs enabled, 140 records and 1.07 M samples loaded, 23 s total with a cached image), `make spike`, `make test` (all green). A fresh clone's first image build is the only slow step (about 3 minutes).
- **Standard libraries untouched:** the 88 files of `sys`, `sys.api`, `sys.refs`, `sys.files`, `ph`, `ph.points`, `ph.points.sugar`, `ph.elec`, `ph.api` and `ph.attrs` in the running container are byte-identical to the pinned upstream commit.
- **A note about the tooling environment:** the assistant's file-deletion safety check refused an `rm` inside a `bash -c` script during the audit. Nothing needed deleting, so the check was left alone and the comparison script writes to the scratch folder instead.

---

# Design system (2026-10-16): the ATS theme

- **Source:** the ATS website (https://www.atsintegrators.com/companies/ats-automation/), read in the browser pane. Colours come from its theme palette variables (`--global-palette1`..): gold `#f8bb34`, navy `#004681`, ink `#222222`, grays `#636363 #757575 #aaaaaa #eaeaea #f2f2f2`, green `#13612e`, bright blue `#1159af`, red `#b82105`, orange `#f7630c`, amber `#f5a524`. Observed styling: Ubuntu typeface, square corners, bold uppercase buttons, gold slanted call-to-action buttons, navy bars with white text, white (reversed) logo on dark photography.
- **Logo:** `logo-reverse.png` from the website's uploads folder (900x450 PNG, 7.9 KB), downloaded with the owner's permission into `ui/public/brand/`.
- **Chart palette re-derived and validated** with the data-viz validator, on the exact surfaces used (light `#ffffff`, dark `#112338`):
  - light `#1159af,#f7630c,#1baf7a,#eda100,#e87ba4,#13612e,#4a3aa7,#b82105` passes lightness, chroma, colour-blind (worst adjacent dE 9.1) and normal-vision (19.6) checks; the standard contrast warning for aqua, amber and magenta remains, with its relief in place (legend, tooltip, table);
  - dark `#4a8fe0,#e8661a,#199e70,#c98500,#d55181,#008300,#9085e9,#e66767` passes every check (a first try with `#f0701f` for slot 2 failed the lightness band at L 0.688, so it was darkened to `#e8661a`);
  - brand navy (L about 0.39) and gold (L about 0.84) both fall outside the allowed band, so they are not chart colours.
- **Text contrast** of every token pairing was calculated (lowest 5.4:1); results are tabulated in `docs/design-system.md`.
- **Implementation:** `ui/src/theme.css` (variables only) + `ui/src/styles.css` (components). Slanted shapes are drawn with a skewed `::before` layer so text and focus rings stay upright and unclipped. No application logic changed; all 103 unit tests and 49 live checks still pass.
- **Font bundled (2026-10-16):** `@fontsource/ubuntu` 5.3.0 (Ubuntu Font Licence 1.0) installed in the `ui` workspace; `latin` and `latin-ext` stylesheets for weights 400, 500 and 700 are imported in `ui/src/main.tsx`. Vite copies the files into the build (about 30 KB per weight for the Latin range; the browser downloads only what a page uses, and it was confirmed in the browser pane that the page loads `ubuntu-latin-400` and `-700` from the app itself). The full package imports every alphabet and made the build 1.6 MB; the Latin-only imports make it 1.3 MB. The chart passes `--font` to ECharts, whose canvas text would otherwise use the browser default.

---

# Editing (2026-10-16): what Haxall does when records are created, changed, moved and deleted

- **Create:** `commit` with meta `commit: "add"` and no `id` returns the stored record with its new id and `mod`. Given ids (from `instantiate`), it keeps them. A `spec` Ref is accepted without checking.
- **Update:** `commit: "update"` rows carry `id`, the record's current `mod`, and only the changed tags; `{_kind: "remove"}` deletes a tag. The result is the whole record with a new `mod`. A stale `mod` is refused with `folio::ConcurrentChangeErr`, which the client turns into `ConflictError`.
- **Remove:** `commit: "remove"` rows carry `id` and `mod`. Removing a record deletes its stored history with it.
- **`curVal` and other runtime tags cannot be written** (`Cannot set tag persistently`).
- **Units are not checked at commit.** A point with unit `notAUnit` is stored without complaint and fails later at `hisWrite`. The app checks with `parseNumber("1" + unit).unit`, which also reveals Haxall's canonical spelling (`h` becomes `hr`, `s` becomes `sec`, `ft²` stays).
- **Point types:** `specs(specLib("ph.points"))` and the sugar, `ph.elec` and `ats` libraries give 416 concrete point specs (those that are a `ph::Point` and not abstract). `instantiate(spec("lib::Name"))` on one gives its marker tags, `kind`, and usually its unit. **Every Number point in the four equipment templates already carries its unit** (the loader's own unit table was a fallback it never needed).
- **Equipment types:** 79 concrete `ph::` equipment specs (Boiler, Chiller, Pump, ...). `instantiate(spec, {graph, parent: equip})` sets `equipRef` and `siteRef` correctly for nesting.
- **Equipment with no spec makes its points report "Ref target spec not found"**, so the editor always creates equipment from a spec.
- **Deleting an AHU leaves dangling `airRef`s** on the VAVs it served (`Unresolved ref` in the spec check); the editor finds them (`airRef`, `submeterOf`, `systemRef`, `hotWaterRef`, `chilledWaterRef`, `spaceRef`) and offers to clear them.
- **Bugs the tests found:** my unit suggestion list used "h" and "s"; the form field wrapped its label around hints and option lists (poor for screen readers); dialogs inherited the toolbar's button styling until they were drawn in a portal; the destructive button was gold until its style was fixed.
- **Tests:** 17 live tests (every operation against Haxall, including conflicts, cross-site moves, dependents and unit spelling), 54 dialog tests (all inputs, validation messages and cancel paths), tag-editing logic tests, modal focus tests and a write-boundary test.
