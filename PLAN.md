# SkySpark Lite (working title) — Phase 1 Plan (for Claude Code)

> **Scope change (2026-10-16):** the apps were renamed (Builder became **Site Organization**, Historian became **Trend Viewer**) and the owner asked for create / read / update / delete of items in the hierarchy. That is no longer out of scope; see `docs/implementation-plan.md` ("Editing") and the README.
>
> **Status (2026-10-16): Phase 1 complete.** All chunks 2-8 are done and the Definition of Done (section 9) is checked. This file is kept as written, with the revisions below.
>
> **Revision log (2026-10-16):** Chris answered the open questions and desk research was done. Answers are in §0; research is in `docs/research-notes.md`; corrections to this plan are marked **[UPDATED]**.

> **Audience:** a Claude Code agent. Use this as the source of truth for *what* to build and *why*. Your first job is to turn it into a detailed, chunked implementation plan. Then execute one chunk at a time, ending each chunk in a runnable, documented state (see §0 on git).
>
> **Owner:** Chris. He is a domain expert (BAS, Project Haystack, Xeto, SkySpark, Axon) but a coding novice. Explain code decisions in plain language, and do not assume he can debug Fantom, Docker, or build tooling unaided.

---

## 0. Decisions made (answers from Chris + research)

| Topic | Decision |
|---|---|
| Xeto lib namespace | **`ats`**. Keep the name in exactly one place (lib folder name + one constants file in tooling) so a later rename is cheap. |
| Project name | **SkySpark Lite** (working title; will change). Don't bake the name into code identifiers beyond folder/README. |
| Git | Not yet. Don't `git init` and don't commit. "Committed state" in §8 means "runnable, documented, and summarized" until Chris says to add git. Keep a `.gitignore` and `.env.example` ready. |
| Docker | Installed, but the daemon wasn't running at last check. Chris must open Docker Desktop before Chunk 2. |
| Point lists in §4 | Approved as a starting point. Expect Chris to add to them often, so make adding a point to a spec a small, well-commented edit. |
| Language for tooling | **TypeScript (Node 24, already installed) for everything, including `tools/`.** Replaces Python/Phable. Reasons: no Python 3.11+ install needed (Mac has only 3.9), one language to maintain, and the same Haystack client code is shared by tools and UI. Trade-off: Phable is more mature than the JS client; if `haystack-nclient` proves unreliable for `commit`/`hisWrite`, fall back to a thin `fetch` wrapper and tell Chris. |
| Browser/API access | Vite dev proxy for `/api` (Haxall has no CORS support). |
| Protocol version | Haystack v4 (zinc/JSON grids). Same as SkySpark. |
| Spec conformance badge | Uses Axon `validate()` via the `eval` op, not `fits`. |

---

## 1. What we're building

A lightweight, SkySpark-style analytics platform built on **Haxall**, SkyFoundry's open-source core of SkySpark. It uses **Xeto** for the data model.

**The guiding principle is SkySpark compatibility.** Anything built here should be transferable to a real SkySpark instance with minimal translation: records, tags, specs, histories, and later rules. When in doubt, do it the way SkySpark does it.

### Phase 1 scope (this plan)
1. **Xeto specs** for basic equipment: Site, AHU, VAV, electric meter (main + submeter), and their required points.
2. **Demo data**: a realistic fake site loaded into Haxall, with histories and deliberately planted faults.
3. **Site Organization app**: navigation and inspection of the site/equip/point model. *(Started read-only; add, edit, move and delete were added later at the owner's request, see the scope change note below.)*
4. **Trend Viewer app**: time-series charting of point histories.

### Explicitly out of scope (do not build, do not scaffold)
- **Any device connector (BACnet, Modbus, MQTT, etc.).** The protocol hasn't been chosen. Do not add BACnet libraries or stub connector code.
- Rules engine / sparks (Phase 2, but see §6 so we don't paint ourselves into a corner).
- ~~Record editing in Site Organization. Read-only only.~~ **Now in scope** (2026-10-16): create, edit, move and delete of sites, equipment and points.
- Multi-tenant, user management UI, alarms, dashboards, reporting, mobile layout polish.

---

## 2. Architecture

```
┌──────────────────────────┐        Haystack HTTP API        ┌───────────────────────┐
│  Web UI (TypeScript)     │  ───────────────────────────▶   │  Haxall (Docker)      │
│  ├─ App shell + switcher │   read, nav, hisRead, eval ...  │  ├─ Folio DB          │
│  ├─ Site Organization              │                                 │  ├─ Axon              │
│  └─ Trend Viewer            │                                 │  ├─ Xeto libs         │
└──────────────────────────┘                                 │  └─ his storage       │
                                                             └───────────▲───────────┘
┌──────────────────────────┐   commit, hisWrite (Haystack API)          │
│  tools/ (TypeScript)     │  ──────────────────────────────────────────┘
│  ├─ demo data generator  │
│  └─ validation scripts   │
└──────────────────────────┘
```

### Stack decisions
| Layer | Choice | Reason |
|---|---|---|
| Platform | Haxall, built into a Docker image from a pinned release of the `haxall/haxall` repo via Docker Compose **[UPDATED: no prebuilt image exists; first build takes several minutes]** | Avoids a local Fantom toolchain. |
| Data model | Xeto: standard libs plus one custom namespaced lib | SkySpark compatibility. |
| Tooling | **TypeScript on Node 24** with `haystack-nclient` (shared with the UI) **[UPDATED from Python/Phable; see §0]** | Node is already installed; one language; client code shared. |
| UI | TypeScript + React + Vite | Mainstream and well-supported. |
| Charts | Apache ECharts (or uPlot if performance demands it; justify the switch) | Handles multi-series time data with zoom. |
| Haystack client in browser | Evaluate `haystack-nclient` (J2 Innovations) vs. thin `fetch` wrappers. Pick one and record why. | — |

### Hard constraints
- **Write zero custom Fantom.** If a feature seems to need Fantom, stop and propose an alternative (Axon or TypeScript) to Chris first.
- **Never modify standard Xeto libraries** (`sys`, `ph`, `ph.*`). Extend them in our own lib.
- **No database other than Haxall.** Histories live in Haxall's his storage, not Influx, SQLite, etc. This keeps sites portable to SkySpark.
- **Everything runs locally with one command.** Docker Compose, or a documented `make`/script equivalent.
- Secrets (Haxall admin password, etc.) go in `.env`, which is gitignored, with a committed `.env.example`.

---

## 3. Verify before you build (do this first)

Your knowledge of Haxall and Xeto is likely incomplete or out of date. Before writing the implementation plan, **research and confirm each of the following against primary sources**: haxall.io docs, the `haxall/haxall` GitHub repo, and the `Project-Haystack/xeto` GitHub repo. Write findings to `docs/research-notes.md` with links.

1. **Running Haxall:** current Docker image name/tag, ports, how the admin user is configured, and where the DB is persisted.
2. **Which Xeto libs Haxall loads, and how to add a custom lib** (file layout, `lib.xeto` pragma, how Haxall discovers and enables it).
3. **Standard spec names.** Confirm the exact names in `ph`, `ph.points`, `ph.elec` for: Site, AHU, VAV, electric meter, and the points listed in §4. **Do not guess spec names.** Copy them from the lib source.
4. **Record validation:** how to check that a record fits its spec (Haxall CLI or Axon `validate()`; `fits()` only checks type, not required slots). We need this in tests.
5. **Haystack API ops** available in Haxall for: read by filter, nav, hisRead, hisWrite, commit, eval. Also the auth flow (SCRAM) and how a browser client should authenticate.
6. **CORS / dev proxy:** whether the UI can call Haxall directly or needs a Vite dev proxy.
7. **SkySpark conventions** to mirror: `spec` tag usage on records, `equipRef`/`siteRef`, `his`/`tz`/`unit`/`kind` on points, and how SkySpark 4.x apps expect Xeto-typed records.

If any finding contradicts this plan, **flag it to Chris before proceeding**. Don't silently work around it.

### Research status (2026-10-16) **[UPDATED]**
Desk research is done from the Haxall 4.0.6 and Xeto source and is written up in `docs/research-notes.md`. Nothing has been run yet, so each item below still needs a hands-on check in Chunk 2/3. Summary against the seven items:

1. **Running Haxall:** no official prebuilt image; build with Compose from the repo (`HAXALL_PORT`, `HAXALL_DB_NAME`, `HAXALL_SU_USERNAME`, `HAXALL_SU_PASSWORD`; DB in bind-mounted `dbs/`). Confirmed in source.
2. **Custom lib:** a Xeto lib is a folder `src/xeto/ats/lib.xeto` found via the `xeto.props` `path=` search; enable with Axon `libAdd("ats")`. No Fantom needed. Mount point and compile-check command still to verify.
3. **Spec names:** `ph::Site`, `ph::Ahu`, `ph::Vav`, `ph::ElecMeter` (all in `ph`, there is no `ph.equips`); points in `ph.points` and `ph.elec`. Full candidate list in the notes. Chunk 3 reads each full definition before writing `ats`.
4. **Validation:** use Axon `validate()`; `fits()` does not check required slots.
5. **API ops:** all needed ops exist (`readAll`, `nav`, `hisRead`, `hisWrite`, `commit`, `eval`). SCRAM-SHA-256 auth.
6. **CORS:** none found, so Vite proxy is required.
7. **Conventions:** `spec: @ph::X` tag, `siteRef`/`equipRef`, `submeterOf` confirmed in `ph`.

**Chunk 2 hands-on results (see research notes):** Haxall builds and runs in Docker on this Mac; API base is `/api/sys`; SCRAM login works with our own client (`haystack-nclient` lacks SCRAM); `validate()` and `libAdd` work; **`hisRollup` does not exist in Haxall**; **history is capped at 1000 samples per point unless `hisMaxItems` is set, and is lost on restart (in-memory only)**. Phase 1 handles both (see implementation plan).

**Contradictions found:** (a) no official Docker image, (b) `ph.equips` / `ph.points.elec` don't exist, (c) `fitsExplain` doesn't exist, (d) `hisRollup` availability unconfirmed (docs mention it, not in the func lists). Each is handled in §0/§2/§4 and none blocks the plan.

---

## 4. Xeto specs

Create one custom library. The lib name is **`ats`** (decided; see §0). It must:

- Depend on the standard libs and **extend** standard specs rather than redefining them.
- Define opinionated equipment specs with **required points**. These are our "standard" equip templates.

### Target specs (starting point; Chris should review the point lists)
| Spec | Extends (confirm name) | Required points (map each to an exact `ph.points` spec) |
|---|---|---|
| Site | `ph::Site` | Area, tz, geo address. Mostly meta, few/no points. |
| AHU (VAV-serving) | `ph::Ahu` | Supply/discharge air temp + setpoint, return air temp, mixed air temp, outside air temp, supply fan cmd + status, supply fan speed, duct static pressure + setpoint, cooling valve cmd, heating valve cmd, OA damper cmd, occupancy mode |
| VAV (reheat) | `ph::Vav` | Zone air temp, zone cooling/heating setpoints, airflow + airflow setpoint, damper cmd, reheat valve cmd, discharge air temp, occupancy |
| Elec meter (main) | `ph::ElecMeter` | Total active energy (import), active demand/power |
| Elec submeter | same base, linked via `submeterOf` | Same as main |

Rules:
- Each spec file gets a doc comment explaining intent, so Chris can read the specs as documentation.
- Optional/nice-to-have points are marked optional (`?`), not omitted.
- Add a test that loads the lib in Haxall and confirms it compiles with no errors.

---

## 5. Demo data

Build a TypeScript generator in `tools/demo_data/` that produces and loads a realistic site.

### Site composition
- 1 site, "Demo Office" (fictional, in America/Los_Angeles), roughly 50k sq ft.
- 2 AHUs; AHU-1 serves 6 VAVs and AHU-2 serves 4 VAVs, linked with the proper ref tags.
- 1 main electric meter + 2 submeters (e.g., HVAC and lighting/plug).
- **Every record must fit its spec.** Validate before loading and fail loudly if not.

### Histories
- 90 days at 15-minute intervals, ending "now" at generation time.
- Realistic behavior: weekday occupancy schedule (e.g., 6am–6pm), unoccupied setbacks, diurnal outside air temp, VAV loads that vary by zone, AHU responses that roughly track VAV demand, and meter demand/energy that correlates with HVAC activity. Energy totals must be monotonically increasing.
- Deterministic: seeded random, so the same seed gives the same data.

### Planted faults (essential: these are future rule test cases)
Plant at least these, at known equipment and time ranges:
1. AHU simultaneous heating and cooling (both valves open) for several days.
2. VAV damper stuck at a fixed position while airflow setpoint changes.
3. Zone temp sensor flatlined (identical value) for a week.
4. AHU running 24/7 over a weekend (schedule override left on).
5. Submeter data gap (missing samples) for ~1 day.
6. OA temp sensor reading implausibly (e.g., spike or stuck at an extreme).

Write a **fault manifest** (`tools/demo_data/faults.json`) listing each fault: equip ref, points, start/end, and description. This is the ground truth Phase 2 rules will be tested against.

### Loading
- Load records with `commit` and histories with `hisWrite` through the Haystack API. **Load through the same API path a future connector would use**, not by writing directly into Haxall's DB files.
- Idempotent: rerunning wipes and reloads the demo site cleanly, using a reset flag.
- One command: e.g., `npm run demo:load -- --seed 42`.

---

## 6. Design so Phase 2 doesn't hurt

Don't build these, but don't block them either:
- **Connectors:** keep point records' ingestion-related tags separate from model tags. A future connector will add its own tags (SkySpark-style `*Conn`, `*Cur`, `*His` conventions). Keep a short note in `docs/` on where those tags will go.
- **Rules:** Phase 2 rules will be Axon functions shaped like SkySpark rules, producing spark-like results. Keep the Haxall setup able to store Axon funcs as records, and keep the fault manifest machine-readable.
- **Current values:** there's no connector, so `curVal` won't be populated. For MVP, Site Organization shows the **latest history sample** as the "current value" and labels it as such. Do not fake `curVal`.

---

## 7. UI

One web app with a shared shell and an app switcher, like SkySpark's apps. The MVP has two apps.

### Shell
- Login against Haxall auth.
- App switcher (Site Organization, Trend Viewer).
- Global site selector (only one demo site for now, but don't hard-code it).
- Clear error states: Haxall unreachable, auth failed, empty results.

### Site Organization (originally read-only; editing added later, see the note above)
- **Navigation tree:** Site → Equip → Point, with nested equips supported.
- **Record detail panel:** all tags shown in a readable table, with Refs rendered as clickable links to the target record.
- **Spec conformance badge** per record: "fits `<spec>`" or a list of what's missing/wrong. This is the feature that shows off Xeto; prioritize it.
- **Filter bar:** accept a raw Haystack filter (e.g., `point and his and equipRef==@...`) and show the results as a list.
- Point rows show the latest history sample plus timestamp, and a button to open the point in Trend Viewer.

### Trend Viewer
- Add points from a picker (search by name/filter) or via deep link from Site Organization.
- Date range presets (today, yesterday, this week, last 7 days, last 30 days, custom).
- Multi-series line chart with zoom/pan, one y-axis per unit, and boolean/enum points rendered as step lines.
- Hover tooltip with the exact value, unit, and timestamp.
- A table view toggle with the same data.
- CSV export of the current view.
- Handle data gaps visibly. Don't interpolate across them; fault #5 must be obvious.
- URL encodes the selected points and range, so a view can be shared and bookmarked.

### Performance target
A 90-day, 15-minute history for 10 points (~86k samples) renders in under 2 seconds locally. If it doesn't, use server-side rollups via Axon `hisRollup` (or equivalent; verify) before reaching for client-side tricks.

---

## 8. Suggested chunk order

Refine this in your implementation plan; each chunk should end runnable and documented (no git yet; see §0).

1. **Research** (§3) → `docs/research-notes.md`. **Desk research done 2026-10-16; hands-on verification folds into Chunk 2.**
2. **Repo skeleton**: Docker Compose for Haxall (pinned release, built locally), `.env.example`, README with one-command startup, folder layout (`specs/`, `tools/`, `ui/`, `docs/`), npm workspace for `tools/` and `ui/`. Exit criteria: Haxall starts, an Axon `eval` over the API returns `about`, and every **[VERIFY]** item in the research notes is closed or escalated. Prerequisite: Chris opens Docker Desktop. Includes the tiny "hello" check that `haystack-nclient` can do SCRAM login from Node.
3. **Xeto lib** (§4) with a compile test. Chris reviews the point lists.
4. **Demo data generator + loader** (§5) with spec validation and a fault manifest.
5. **UI shell + auth + Haystack client layer.**
6. **Site Organization**, including the conformance badge.
7. **Trend Viewer.**
8. **Polish pass**: error states, README walkthrough with screenshots, known-limitations list.

---

## 9. Definition of done (Phase 1)

Checked 2026-10-16 after a clean-state run (node_modules, database and build output deleted, then the README's own steps).

- [x] `docker compose up` (or one documented command) starts Haxall with the custom Xeto lib loaded. **`make up`**: from no database to Haxall running, `ats` loaded and demo data in 23 s (the first-ever image build takes about 3 minutes).
- [x] One command loads the demo site; every record passes spec validation. **`make load`** (also run by `make up`): 140 records, `validate(..., {graph})` clean with no warnings, 1,071,168 samples in about 2 s. Enforced by `tools/demo_data/loaded.test.ts`.
- [x] `faults.json` exists and matches what's actually in the data. The loaded-data tests read each fault's window back from Haxall and assert its signature.
- [x] Site Organization lets you navigate the full site, inspect any record, and see spec conformance. Tree, tag table with ref links, conformance badge (including missing required points), filter bar, latest sample, deep links.
- [x] Trend Viewer charts any combination of demo points over any range; all six planted faults are visually identifiable. Seen in the browser pane (screenshots in `docs/img/`). Performance: 90 days x 10 points (86k samples) fetched, parsed and thinned in about 0.25 s against the 2 s target.
- [x] README lets a novice go from clone to running app without asking questions. Prerequisites, quick start, tour with screenshots, command table, troubleshooting. Followed from a clean state.
- [x] No Fantom written, no standard libs modified, no extra databases, no connector code. Audited by search: no `.fan` files in the repo; the 88 standard library files in the running container are byte-identical to the pinned upstream commit; the only service is Haxall and no database packages are installed; no protocol libraries or code outside the docs.

Test status at close: 103 unit tests (client, decoding, validation messages, ranges, series logic, Site Organization, Trend Viewer, sign-in) + 49 live checks against Haxall (specs, demo data, faults, client, performance), plus a type check and a production build.

---

## 10. Working agreement

- **Ask Chris before:** choosing the Xeto lib namespace, changing anything in §2's stack, adding a dependency that isn't obviously standard, or deviating from SkySpark conventions.
- **Don't ask Chris about:** routine implementation choices. Make the call and note it in the chunk summary.
- After each chunk, give a 3–5 line plain-language summary: what was built, how to see it working, and anything Chris should review.
- Prefer boring, well-documented approaches over clever ones. Chris will maintain this with AI help, not as a full-time developer.
