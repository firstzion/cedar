# SkySpark Lite: Phase 1 Implementation Plan

Companion to `PLAN.md` (what and why) and `docs/research-notes.md` (facts from source). This file is the how: ordered chunks, each ending runnable and documented. No git yet (see PLAN.md §0).

Status key: **[VERIFY]** = assumption from desk research that Chunk 2 must confirm on a running Haxall.

## Environment (checked 2026-10-16)

- Docker 29.8 running, Apple Silicon (aarch64), 10 CPUs, ~8 GB RAM for Docker.
- Port 8080 is free.
- **Other Docker containers exist on this machine** (`supabase_*` for an unrelated project, plus `hello-world`). We never touch them. All our resources use the Compose project name `skyspark-lite` and container name `skyspark_lite_haxall`, so `docker compose down` here cannot affect anything else.
- Node 24.19 and npm available (`~/.local/node`). No Python needed, no pnpm, no Homebrew.
- Haxall base image `eclipse-temurin:17` is multi-arch, and Fantom compiles on the JVM, so arm64 should be fine **[VERIFY]**.

## Conventions

- **TypeScript everywhere** (tools and UI), npm workspaces: `tools/` and `ui/`, shared code in `packages/haystack/`.
- **Every command is an npm script** run from the repo root, wrapped by a `Makefile` for the common ones (`make up`, `make load`, `make ui`, `make test`).
- Config in `.env` (gitignored) with committed `.env.example`. One constants file (`packages/haystack/src/config.ts`) holds lib name (`ats`), project name, and default URLs.
- Each chunk ends with a short summary to Chris (what was built, how to see it, what to review). Explain choices in plain language.
- Tests: Vitest for TypeScript. Spec/data checks run against the live Haxall container (integration tests), so `make test` requires `make up`.
- If something needs Fantom, stop and ask. (PLAN.md hard constraint.)

## Target repo layout

```
SkySpark Lite/
├── PLAN.md  docs/{research-notes,implementation-plan,connector-notes,known-limitations}.md
├── README.md  Makefile  .env.example  .gitignore  package.json (workspaces)
├── docker/
│   ├── Dockerfile            # ours: clones pinned Haxall tag, builds, runs
│   ├── compose.yaml          # project name skyspark-lite
│   └── xeto.props            # path=/app/specs
├── specs/src/xeto/ats/       # the Xeto lib: lib.xeto, site.xeto, ahu.xeto, vav.xeto, meter.xeto, points.xeto
├── dbs/                      # Haxall database (bind mount, gitignored)
├── packages/haystack/        # Haystack client layer shared by tools and UI
├── tools/
│   ├── demo_data/            # generator, loader, faults.json
│   └── validate/             # spec validation + lib compile check scripts
└── ui/                       # Vite + React + TypeScript (shell, builder, historian)
```

---

## Chunk 2: Repo skeleton and a running Haxall

**Goal:** `make up` starts Haxall with a login that works, and a script can talk to it.

Tasks
1. Create folder skeleton, `.gitignore`, `.env.example` (HAXALL_PORT, HAXALL_DB_NAME, HAXALL_SU_USERNAME, HAXALL_SU_PASSWORD, HAXALL_REF), root `package.json` with workspaces, `Makefile`.
2. **Our own Dockerfile** (derived from Haxall's, which is the pattern in the Haxall repo): base `eclipse-temurin:17`, install Fantom release, clone `xeto`, `haystack-defs`, and `haxall` at a **pinned tag** (`HAXALL_REF`, start with the tag matching 4.0.6 **[VERIFY tag name]**), build, run `hx init -headless` then `hx run`. Reasons for our own file: our repo holds none of Haxall's source, the pin is explicit, and `specs/` is mounted in.
3. `compose.yaml`: project `skyspark-lite`, bind mounts `../dbs` and `../specs`, `xeto.props` with `path=/app/specs`, healthcheck on `GET /api/<db>/about` (or login page).
4. First build (expect several minutes; run in the background and report). Confirm arm64 build works.
5. Set an explicit `HAXALL_SU_PASSWORD` in local `.env` so there is no log-scraping step. (Local dev password only; never printed back in chat.)
6. `packages/haystack`: spike with `haystack-nclient` from Node. SCRAM login, call `about`, then `eval("1+1")`. Decide client library vs thin `fetch` wrapper. Record the decision in research notes.
7. Close every **[VERIFY]** item in `docs/research-notes.md` that can be checked now (see list in that file: lib mount discovery, `libAdd`, compile-check command, `validate()` output, `spec` ref resolution, `hisRollup`, `hisWrite` batch limits). Keep results in the notes.
8. README: "Prerequisites, first run, stop/reset" in novice-friendly steps.

Verification: `make up` then `curl` of about op returns Haxall 4.0.x; `node` spike prints `about` and `2`. `make down` stops cleanly; `make reset` deletes `dbs/` and restarts.

Risks and fallbacks
- Build fails on arm64 or a Fantom/branch mismatch: fall back to the official `docker-compose.yml` from the Haxall repo cloned into `vendor/` (gitignored) and wrap it. Tell Chris.
- `haystack-nclient` fails SCRAM or `commit`: use a ~150-line `fetch` + WebCrypto SCRAM wrapper (works in Node and browsers). Needed for the UI anyway.
- `xeto.props` path not honored: mount `specs/src/xeto/ats` directly under Haxall's `src/xeto` in the image; if that needs a rebuild per spec change, switch to a `lib/xeto/*.xetolib` build step. Ask Chris only if Fantom is required.

Exit: container healthy, spike works, notes updated. **Stop and summarize to Chris.**

---

## Chunk 3: The `ats` Xeto lib

**Goal:** a lib named `ats` that Haxall loads, with Site, AHU, VAV, ElecMeter (main/sub), and their points, each documented.

Tasks
1. **Read, don't guess.** For every point in PLAN.md §4's table, open the candidate spec in `ph.points` / `ph.elec` (names in the research notes), record the exact markers and required slots in a table in `specs/README.md`. Resolve ambiguity by reading the spec (e.g. discharge vs supply air; heating valve vs reheat valve). Flag any point with no standard spec to Chris instead of inventing one.
2. Write `specs/src/xeto/ats/lib.xeto` (`pragma: Lib < doc, version: "0.1.0", depends: sys, ph, ph.points, ph.elec (+ ph.equips.sugar only if needed) >`).
3. Design approach to "required points": Xeto equips can declare `points: Query<of:..., via:"equipRef+">` slots. Read how `ph` does this (e.g. `Equip.points`) and how `ph.examples` or `ashrae.g36` define required points **[VERIFY pattern]**. Prefer that over inventing structure, because SkySpark compatibility is the rule.
4. Specs: `AtsSite : ph::Site`, `AtsAhu : ph::Ahu`, `AtsVav : ph::Vav`, `AtsElecMeter : ph::ElecMeter`, `AtsElecSubmeter : AtsElecMeter` (requires `submeterOf`). Names are prefixed to avoid ambiguity with `ph` in docs; confirm Xeto naming style **[VERIFY]**. Point specs for our usage extend `ph.points` specs (e.g. `AtsAhuDischargeAirTemp : DuctAirTempSensor` plus the discharge marker) only where a required point needs extra constraints; otherwise reference the `ph` spec directly.
5. Optional points marked `?`. Every spec has a `//` doc comment (intent in plain language for Chris).
6. `tools/validate/compile-lib`: enables the lib via `libAdd("ats")` and fails on non-ok `libs()` status; also runs the Xeto CLI check if one exists.
7. Test: `lib.test.ts` loads `ats`, asserts status ok, and asserts each spec resolves via `eval("specs")`-style lookup.
8. Hand-built sample records (one per spec, one deliberately broken per spec) in `specs/tests/` and a test that `validate()` is clean for good and reports specific items for bad. This is the contract Chunk 4 relies on.

Verification: `make test` green; deliberately breaking `lib.xeto` makes the compile test fail.

Exit: lib loads, tests pass. **Stop for Chris to review point lists** (he said they will be edited often, so keep the "add a point" steps in `specs/README.md`).

---

## Chunk 4: Demo data generator and loader

**Goal:** `make load` wipes and loads the Demo Office with 90 days of history and six planted faults; `faults.json` is accurate.

Site model
- 1 site `Demo Office`, tz `America/Los_Angeles`, ~50,000 sq ft, fictional LA-area address.
- 2 AHUs (AHU-1 → VAV-1-1..1-6, AHU-2 → VAV-2-1..2-4), 1 main meter, 2 submeters (HVAC, Lighting/Plug).
- Records built from a single declarative `model.ts` (names, refs, specs, per-point kind/unit/his flags). IDs are deterministic (derived from names) so reruns match.
- Every record carries `spec: @ats::...`, `point`, `his`, `tz`, `kind`, `unit`, `siteRef`, `equipRef`, and the markers the spec demands. No `cur`, no connector tags.

Pipeline (`tools/demo_data`)
1. `model.ts` builds records. 2. `validate` step calls Haxall `validate()` over the **eval** op on the records *before* loading; any item fails the run with a readable list. 3. `commit` to load recs. 4. `generate.ts` produces samples. 5. `hisWrite` in batches (size from Chunk 2 **[VERIFY]**). 6. `faults.json` written.
- Reset: `--reset` deletes all `site/equip/point` recs created by us (filter on a `demoData` marker tag, so we never touch other recs) then reloads. **Open check:** a custom marker tag on recs is fine in Haxall and ignored by `ph` validation **[VERIFY]**; if the spec rejects unknown tags, track the ids in a manifest file instead.
- CLI: `npm run demo:load -- --seed 42 [--reset]`.

Simulation (deterministic, seeded PRNG such as mulberry32; no `Math.random`)
- Timeline: 15-min samples, 90 days back from "now" rounded down to the quarter hour, in site tz. Anchor "now" in the manifest so faults have absolute timestamps.
- Outside air temp: seasonal baseline plus diurnal sine (+ noise).
- Occupancy: weekdays 06:00-18:00, setback otherwise; holidays ignored (document).
- VAV: zone temp tracks setpoints with a load model per zone (solar/exposure factor); damper and airflow follow demand; reheat valve opens at low zone temp; discharge temp from AHU supply plus reheat.
- AHU: supply fan speed and duct static follow total VAV flow; cooling/heating valves follow mixed-air vs supply setpoint; OA damper by simple economizer.
- Meters: HVAC submeter power from fans + valves activity; lighting/plug from occupancy; main = sum + base load. Energy = cumulative integral (strictly non-decreasing; test it).
- Units, kinds, ranges match each point spec.

Planted faults (offsets from "now" decided in code, recorded in manifest)
| # | Fault | Where | Duration | How it appears |
|---|---|---|---|---|
| 1 | Simultaneous heating and cooling | AHU-1 both valves open | 3-5 days | valve cmds both > 20% during occupied hours |
| 2 | Damper stuck | one VAV damper cmd/pos fixed at a value | ~5 days | airflow setpoint varies, damper constant |
| 3 | Zone temp flatline | one VAV zone temp | 7 days | identical value every sample |
| 4 | 24/7 operation | AHU-2 over one weekend | Sat+Sun | fan on, setpoints occupied, VAV flow normal |
| 5 | Submeter data gap | lighting/plug submeter | ~24 h | **no samples written** (not nulls) |
| 6 | Bad OA sensor | OA temp | a few hours | spike to an implausible value, plus a separate stuck-at-extreme window |

`faults.json` fields: `id, name, description, equipRef, equipName, points[{id,name}], start, end, kind`, plus top-level `generatedAt`, `seed`, `tz`. A test re-reads the loaded data from Haxall and asserts each fault's signature is present (e.g. fault 3 variance is zero; fault 5 has no samples in range).

Verification
- `validate` clean for all records; counts match model; `hisRead` of each point returns the expected sample count (except fault 5 gap); energy monotonic; same seed gives byte-identical samples (hash test); `faults.json` assertions pass.
- **Chunk 2 findings that apply here:** every point gets `hisMaxItems: 20000` (default cap is 1000); history is lost on Haxall restart, so add `npm run demo:ensure` (load only if the site is missing or histories are empty) and call it from `make up`/a `make start` target; enable `ph.points` and `ph.elec` via `libAdd` before validating (not enabled by default); commit with a `spec` ref works.
- Performance note: 90 days x 4/h x 24 = 8,640 samples per point; about 80 points means roughly 700k samples. Batch writes and log progress.

Risks: `hisWrite` slow or size-limited (batch; parallelism of 1-2); `his` requires `tz`/`kind`/`unit` precisely on point recs (spec validation will tell us); history of strictly-increasing timestamps required per write.

Exit: `make load` twice yields identical state. **Stop and summarize.**

---

## Chunk 5: UI shell, auth, Haystack client layer

**Goal:** a React app that logs in against Haxall, switches between two empty apps, has a site selector, and shows clear errors.

Tasks
1. `ui/` via Vite + React + TypeScript. Dev proxy `/api` to Haxall. Router (React Router) with `/site-organization`, `/trend-viewer`.
2. `packages/haystack`: typed wrappers `about`, `read`, `readAll`, `nav`, `hisRead`, `hisWrite`, `commit`, `evalAxon`, plus helpers for refs, dates (tz-aware), numbers with units. SCRAM login; token kept in memory (+ sessionStorage so refresh doesn't re-prompt). Returns a normalized JS shape the UI uses everywhere (don't leak raw Zinc).
3. Login screen; auth failure and Haxall-unreachable error states; global error boundary; empty-results component.
4. App switcher (Site Organization, Trend Viewer) and global site selector driven by `readAll(site)` (no hard-coded site).
5. State: TanStack Query for fetching/caching. Tailwind or plain CSS modules for styling (pick one; Tailwind unless a reason arises). Record the choice.
6. Tests: client unit tests with a mocked fetch for parsing; one live integration test for login + `about`.

Verification: log in with the su user, switch apps, stop the container and see "Haxall unreachable", enter a bad password and see "auth failed".

---

## Chunk 6: Site Organization

**Goal:** read-only site/equip/point navigation with spec conformance.

1. Nav tree: Site → Equip (nested via `equipRef` on equips) → Point. Use `nav` where it fits; otherwise `readAll` by refs and build the tree client side. Lazy-load children. Show counts.
2. Record detail panel: all tags in a readable table, Refs as links (display name from `dis`/`navName` via batched `readByIds`), Bool/Number/Date formatting with units.
3. **Conformance badge:** call `validate(rec)` through `eval` per selected record (and a batched `readByIds(...).validate()` for tree-level rollups). Show "fits `ats::AtsAhu`" or a list of missing/wrong items with plain-language messages. Cache by record `mod` timestamp.
4. Filter bar: raw Haystack filter, `readAll`, results list, click-through to detail. Surface filter syntax errors from Haxall.
5. Point rows: latest history sample (`hisRead` last point; label "Latest history sample", not "current value") plus timestamp, and "Open in Trend Viewer" deep link (`/trend-viewer?points=<ids>&range=...`).
6. Tests: component tests for the tree and the badge states (ok, missing, no spec); one Playwright smoke test later in Chunk 8.

Verification: click through the whole Demo Office; break a record (use the Axon shell or a test script) and see the badge list what's wrong; restore with `make load -- --reset`.

*(Site Organization was read-only when this chunk was built; editing was added afterwards, see "Editing" at the end.)*

---

## Chunk 7: Trend Viewer

**Goal:** multi-series charting of any demo points and range, with gaps and faults visible.

1. Chart library: **Apache ECharts** (plan default). Decide uPlot only if the benchmark fails (see below).
2. Point picker (search by name/filter, grouped by equip) and deep-link input. URL holds `points` (ids) and `range` (preset or ISO), and is the source of truth for state so links are shareable.
3. Range presets: today, yesterday, this week, last 7 days, last 30 days, custom. Computed in the site's tz.
4. Data: batch `hisRead` for selected points, parsed into typed arrays. Cache by (id, range).
5. Chart: line series, one y-axis per unit (group by unit), step lines for Bool/enum, dataZoom for zoom/pan, tooltip with value + unit + timestamp. Gaps: insert `null` between samples farther apart than a threshold (e.g. 2.5x the median interval) so lines break; fault #5 must be obvious. Never interpolate across gaps.
6. Table view toggle (virtualized) and CSV export of the current view (timestamp, id/name, value, unit).
7. **Performance benchmark** (target 86k samples in under 2 s, 10 points x 90 days): measure fetch time (zinc vs JSON), parse time, and render time separately. If slow: (a) request JSON where cheaper, (b) downsample for display with min/max bucketing (ECharts `sampling: 'lttb'` or manual min/max to preserve spikes), (c) server-side `hisRollup` if **[VERIFY]**ed available (rollups can hide faults like flatlines, so keep a "raw" zoom level that refetches visible window).
8. Tests: gap-insertion unit tests, URL encode/decode tests, CSV format test, range computation tests (DST boundaries in America/Los_Angeles).

Verification: open each fault's range (from `faults.json`) and confirm it's visually identifiable; shared URL reproduces the view.

---

## Chunk 8: Polish and documentation

1. Error/empty/loading states audited in both apps.
2. README walkthrough with screenshots (taken via the browser pane), "Known limitations" list (no curVal, no connectors, read-only, desktop-first, holiday schedule ignored).
3. `docs/connector-notes.md`: where `*Conn`, `*Cur`, `*His` tags will go and how connector tags stay separate from model tags (PLAN.md §6).
4. `docs/known-limitations.md`.
5. Full run-through from a clean state: `make reset && make up && make load && make ui`, then check the Definition of Done in PLAN.md §9 item by item.
6. Final constraints audit: no Fantom written, no standard lib edits, no extra database, no connector code or BACnet dependency.

---

## Decision log (to be appended per chunk)

| Chunk | Decision | Why |
|---|---|---|
| 2 | Own Dockerfile cloning pinned Haxall tag | No prebuilt image exists |
| 2 | TypeScript for tools and UI | Node installed; one language; shared client |
| 2 | Compose project `skyspark-lite` | Machine has unrelated Supabase containers; isolates ours |
| 2 | Pin Haxall/Xeto/defs/Fantom master commits, not the v4.0.6 tag | Research was done on master; tag may lack v5 API / `validate()` |
| 2 | Own SCRAM client, drop `haystack-nclient` | nclient has no SCRAM; thin client works in Node and browser |
| 2 | API base is `/api/sys` | Haxall daemon project is always `sys` |
| 2 | Set `hisMaxItems: 20000` on every demo point | Haxall caps history at 1000 items per point by default |
| 2 | Demo loader must re-run after restart; `make up` ensures data | Haxall history is in-memory only (verified) |
| 2 | Client-side downsampling, no server rollups | Haxall has only hisRead/hisWrite (no hisRollup) |
| 3 | `node:test` instead of Vitest for tools/spec tests | no extra dependency; UI can still use Vitest in Chunk 5 |
| 3 | Spec edits need a Haxall restart (`make specs`) | libReload does not rescan files |
| 3 | Added `ats::AtsOccupiedSp` for AHU occupancy | ph has no concrete AHU occupancy point |
| 4 | Records built from `instantiate(..., {graph})` templates | specs stay the single source of truth |
| 4 | VAV to AHU link is `airRef` | Haystack 4 name for ahuRef |
| 4 | Validate after commit, before history write | refs must resolve for `validate`; failure removes the demo recs |
| 4 | Sensor faults are recorded values only | simulated controls use true values, so faults do not cascade |
| 4 | VAV-1-3 given a high solar load | so its airflow setpoint visibly changes during the stuck-damper fault |
| 4 | `make up` / `make specs` call `demo:ensure` | history is lost on every Haxall restart |
| 5 | Plain CSS (one file, CSS variables, light/dark) instead of Tailwind | no extra build tooling for a novice maintainer; small app |
| 5 | Client sends bearer token only, `credentials: 'omit'` | Haxall's cookie session demands Attest-Key on POST |
| 5 | Token in `sessionStorage` | refresh keeps login, tab close ends it |
| 5 | Site selection kept in `localStorage` via a context (URL params arrive with Site Organization/Trend Viewer) | simplest global selector now |
| 5 | Vitest for UI and client unit tests; node:test for live checks | unit tests need no Haxall; live ones do |
| 5 | Heartbeat `about` every 15 s drives the "Haxall not responding" bar | cheap, tells us when it recovers |
| 6 | Badge = per-record `validate(..., {graph})`; tree marks = one site-wide validate | exact detail, cheap overview |
| 6 | Points loaded lazily per equipment, no per-equip point counts in the tree | keeps the tree light; counts appear in the detail list |
| 6 | Latest sample via a 2-hour `hisRead` ending at `hisEnd` | no stored latest value on the point |
| 6 | Filter goes through the `read` op, 500-row cap | never builds Axon from user text |
| 6 | URL holds `sel` and `filter` | bookmarkable and shareable |
| 6 | Spec refs are not links | they are specs, not records |
| 6 | Trend Viewer deep link `/trend-viewer?points=a,b&range=last7` | contract for Chunk 7 |
| 7 | ECharts (tree-shaken), no React wrapper | plan default; performance far inside target, no need for uPlot |
| 7 | Default layout is one panel per unit, Overlay as a toggle | honours "one y-axis per unit" without a dual-axis plot |
| 7 | Own min/max-per-pixel thinning, re-run on zoom | keeps spikes and flatlines exact; no refetch needed |
| 7 | Gap = jump over 2.5 x median spacing; break line + shaded band | fault 5 must be obvious; never interpolate |
| 7 | Site clock via shifted timestamps + UTC axis | ECharts has no per-zone axis |
| 7 | Limit 10 points; 9th and 10th reuse colours 1 and 2 dashed | performance target needs 10; palette has 8 |
| 7 | Round numbers to 7 significant digits for display and CSV | Haxall stores float32 |
| 7 | Trend Viewer lazy-loaded | keeps the main bundle small |
| 7 | Table is virtualized (rows on screen only) | 86k rows scroll smoothly |
| 8 | Screenshots by a dependency-free script over the DevTools protocol | no Playwright/Puppeteer to install; any Chromium-family browser |
| 8 | README rewritten as a tour with screenshots and a troubleshooting table | the Definition of Done asks for a novice-proof README |
| 8 | Narrow screens: chart before picker, detail scrolled into view | usable on a tablet or phone without mobile polish |
| 8 | Example filters moved to `examples.ts` and tested live | one of them was invalid |
| 8 | No git yet (as agreed) | `.gitignore` and `.env.example` are ready |
| After 8 | Design system = tokens in `theme.css`, components in `styles.css` | change a colour in one place; light and dark share component rules |
| After 8 | Gold, slanted button only for the main action; navy for selection (light), gold (dark) | follows the ATS site's call-to-action style |
| After 8 | Chart colours: four slots take ATS hues, validated; navy and gold excluded | validator band: navy too dark, gold too light |
| After 8 | Ubuntu bundled via `@fontsource/ubuntu` (Latin alphabets, 3 weights) | looks like the ATS site on every machine, works offline; standard package, UFL licence |
| After 8 | Chart text uses the same font (passed to ECharts) | canvas text ignores page CSS |

## Things I'll ask Chris about (only if they come up)

- A point in §4 with no standard `ph` spec (so we'd have to create one in `ats`).
- Fantom ever appearing necessary.
- Any dependency that is not obviously standard.
- Deviating from SkySpark conventions.
- Whether to initialize git once Chunk 4 works.


## Phase 1 status (2026-10-16)

All chunks (2-8) are complete and the Definition of Done in `PLAN.md` section 9 is checked. Open questions for Chris are in the closing summary: initialize git, whether to register or rename the `ats` namespace, which protocol to choose for Phase 2 and what the rules should be.


## Naming and editing (2026-10-16, after Phase 1)

| Decision | Why |
|---|---|
| Builder is now **Site Organization**, Historian is **Trend Viewer** (screen names, addresses `/site-organization` and `/trend-viewer`, folders `apps/organization` and `apps/trends`) | owner's request; old `/builder` and `/historian` links redirect and keep their query |
| Editing is in scope: create, edit, move and delete sites, equipment and points | owner's request (this reverses the Phase 1 "read-only" scope line) |
| All writing code lives in `packages/haystack/src/write.ts` and is used only from `ui/src/apps/organization/edit/`; a test enforces it, and the Trend Viewer can never write | keeps the risky code in one place |
| Equipment is created from the spec with Haxall's `instantiate(spec, {graph, useSlotSpec, parent})`, the same call the demo loader uses | specs stay the single source of truth; required points come for free |
| Equipment templates (AHU, VAV, meters) and their choice markers live in `packages/haystack/src/templates.ts`, shared by the loader and the editor | one place to change |
| Equipment with no type is not offered: points inside it fail the spec check ("Ref target spec not found"). Other equipment uses a standard `ph::` type (79 of them) | found by a live test |
| Every update carries the record's `mod`; a stale one is refused (`ConflictError`) | never silently overwrite someone else's change |
| Units are resolved to Haxall's canonical spelling (`canonicalUnit`) before saving | Haxall does not check units at commit; "h" and "hr" would otherwise mismatch later when history is written |
| Deleting removes children first, offers to clear links from records outside the deletion, and reports samples lost; sites need the name typed | irreversible and wide-reaching |
| Moving across sites rewrites `siteRef` on everything inside; moving into itself or its own contents is refused | keeps the hierarchy consistent |
| Dialogs are drawn in a portal on the page body with focus handling and Esc to close; fields use a proper label tied to the control | accessibility, and no inherited toolbar styles |
| After any change all on-screen Haxall data (except history downloads) is re-read | simple and always correct |
