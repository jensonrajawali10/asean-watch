# Implementation contract

The shared agreement every builder works against. Types live in `src/types.ts`; this file explains the behaviour those types carry.

## Data flow

```
data/*.json fixtures → validateObservations → visibleObservations(incident, replayIndex)
  → deriveReview → map + queue + detail + timeline → buildBriefing → .txt download
```

No server, database, model API, or runtime network call. External links (sources, references) open in a new tab and are never fetched by the app.

## File ownership

| Owner | Files |
|---|---|
| Lead (integration) | `src/types.ts`, `docs/CONTRACT.md`, `docs/ACCEPTANCE.md`, `package.json`, `vite.config.ts`, `tsconfig*.json` |
| Data | `data/volcanoes.json`, `data/incidents.json`, `data/demo-events.json`, `data/SOURCES.md` |
| Logic | `src/lib/reviewRules.ts`, `src/lib/briefing.ts`, `src/lib/fixtures.ts`, `src/lib/*.test.ts` |
| Map | `scripts/build-region.mjs`, `data/region.geojson`, `src/components/RegionMap.tsx`, `src/components/RegionMap.css` |
| UI shell | `src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/App.css`, every other `src/components/*`, `index.html`, `public/favicon.svg` |
| Docs | `README.md`, `docs/DEMO_SCRIPT.md`, `docs/DATA_AND_LIMITATIONS.md`, `docs/ROADMAP.md` |

Rules for every builder: edit only your files; do not run `npm install` or add dependencies (installed: react, d3-geo, topojson-client, world-atlas, vitest); do not run git; do not start dev servers. Ask the lead for anything outside your files.

## Observation records

Schema: `Observation` in `src/types.ts`. ISO 8601 UTC timestamps (`...Z`). Categories: thermal, gas, deformation, ash, report. `dataMode`: simulated, historical, live. Numeric values must be finite and carry a unit; qualitative reports use a text value and `unit: null`.

Anomalies are **configured in the fixtures** (`anomaly`, `anomalyReason`) and never computed from values. `replayStep` controls when a record becomes visible.

Labels that protect the demo:

- Every sprint record is `dataMode: "simulated"` and is displayed with the text SIMULATED.
- A historical record stays HISTORICAL even when replayed.
- Never invent a satellite granule, scene, or acquisition identifier. `sourceName` names the product type the fixture is modelled on (for example, "Simulated fixture modelled on VIIRS 375 m active fire detections"); `sourceUrl` points to the public page describing that product, not to a specific record.
- Never present a simulated value as a measured product, and never state an official alert level.

## Review rules (illustrative, not scientific thresholds)

Given the visible records for one incident:

1. Drop records whose `observedAt` falls outside `incident.scenarioWindow` from the count. Show them with the reason "Outside scenario window, not counted".
2. Collect the distinct categories of the remaining records with `anomaly: true`.
3. Zero categories → `monitoring` / "Monitoring". One → `check` / "Check observation". Two or more → `review` / "Review needed".
4. Within one category, only the earliest anomalous record is `counted: true`. Later records from the same category get the reason "Same category as an earlier anomaly; not independent corroboration".
5. Non-anomalous records get the reason "Within configured baseline; not an anomaly".

`explanation` lists the rule and one line per counted category. `latestObservedAt` is the max `observedAt` of the visible records.

Validation (`validateObservations`): the input must be an array. Drop and report (readable `message`) any record with a missing or non-string id, an unknown incident, an unknown category or data mode, an unparseable or non-UTC timestamp, a non-finite numeric value, a numeric value without a unit, or a non-integer or negative `replayStep`. Duplicate ids: keep the first and increment `duplicatesIgnored`.

## Merapi scenario

Incident id `inc-merapi-demo`, volcano id `gvp-263250` (Smithsonian GVP 263250, lat -7.54, lon 110.446). Scenario dates are fictional and labelled as a scenario clock.

| Step | Label | New records | Expected state |
|---|---|---|---|
| 0 | Baseline | Non-anomalous thermal, gas, and deformation records | Monitoring |
| 1 | Thermal observation | One thermal anomaly plus a second thermal anomaly from another sensor | Check observation (one category; the second thermal record is not counted) |
| 2 | Gas observation | One SO2 gas anomaly | Review needed (thermal + gas) |

Secondary examples are static (`replayable: false`, every record at `replayStep: 0`), simulated, and own their own records: one wildfire and haze example (one thermal anomaly → Check observation) and one flood example (no anomaly → Monitoring).

## UI state

`App` owns `selectedIncidentId`, `replayIndex`, and the generated brief. Everything else is derived. Selecting an incident from the map or the queue sets the same state. Changing the incident or replay step clears the brief; Reset sets `replayIndex` to 0 and clears the brief. Replay controls apply to replayable incidents only.

## Briefing

Plain text, deterministic (no wall-clock time; the timestamp is the replay clock). Contents: incident name and location, coordinates and catalog source, replay step and clock, data mode notice, current review state and the rule, evidence references (id, category, value, observed and ingested times, mode, source name and URL, quality note, counted reason), validation issues if any, limitations, questions for an analyst, and the suggested next step: consult the relevant volcano observatory and corroborating ground measurements. Never a predicted eruption date, probability, or evacuation boundary.

## NEA live context layer (wind direction and haze)

Requested by Jenson: when the map zooms in near Singapore, show wind direction and haze from the NEA API.

- Source: NEA real-time APIs on data.gov.sg, v2, no key, CORS open: `https://api-open.data.gov.sg/v2/real-time/api/{wind-direction,wind-speed,psi,pm25}`. Wind direction is degrees FROM (10-minute average), speed in knots, 18 Singapore stations; timestamps are `+08:00` and get normalised to UTC `Z`.
- It is **context, not evidence**. It never changes a review state and never enters `deriveReview`.
- `src/lib/nea.ts` owns fetching and normalising: `loadNeaContext()` tries live (5 s timeout) and on any failure falls back to the bundled real snapshot `data/nea-snapshot.json` (`dataMode: "historical"`, original timestamps kept). It never throws. The core demo still works fully offline.
- `assessDrift(incident, ctx)` returns null when the incident is more than 600 km from Singapore (Merapi and Ayutthaya show "No NEA station coverage here"). For the Riau example it returns distance, bearing, downwind direction and whether Singapore is within ±45° of downwind.
- Labels: LIVE or HISTORICAL SNAPSHOT plus the reading time; "Wind measured at NEA Singapore stations"; drift is "Illustrative haze drift using Singapore station wind, not a dispersion model"; PSI bands are NEA's own descriptors with their source and time. Attribution follows the Singapore Open Data Licence.
- Types: `NeaContext`, `WindSummary`, `HazeReading`, `DriftAssessment` in `src/types.ts`.

| Owner | Files |
|---|---|
| Logic | `src/lib/nea.ts`, `src/lib/nea.test.ts`, `scripts/capture-nea-snapshot.mjs`, `data/nea-snapshot.json`, the optional NEA section in `briefing.ts` |
| Map | `RegionMap` optional props `nea?: NeaContext \| null` and `drift?: DriftAssessment \| null`, drawn in the zoomed view |
| UI shell | Calls `loadNeaContext()` once on mount, passes `nea` and `drift` to the map, detail panel and brief |

## Official warnings (evacuation awareness)

Decision (Jenson, 2026-10-13): the product exists to make people aware of potential evacuation. It does this by **relaying official warnings from the agencies with authority**, never by issuing its own.

- Sources are authoritative issuers only: tsunami warning centres (PTWC, NTWC, BMKG InaTEWS, JMA), volcano agencies (PVMBG/MAGMA, PHIVOLCS, GeoNet, JMA, VAACs for ash), national flood, haze and weather agencies, and GDACS for cross-hazard context. Final source list follows the research in `docs/research/`.
- Each warning shows, **verbatim from the issuer**: issuer name, warning level or severity, headline, affected area, issue time, expiry when given, and any evacuation instruction. It also links to the issuer's public page ("Follow official instructions from <issuer>").
- Issuer levels are never restyled into our review states, re-scored, merged, or paraphrased into stronger or weaker language. Our own corroboration states (Monitoring / Check observation / Review needed) stay analyst prompts and never say "evacuate".
- **Absence is not safety.** If a feed is unreachable, stale, or returns nothing, the UI says "Official feed unavailable: check <issuer> directly", never "no warnings" or "all clear". Expired warnings are labelled EXPIRED with their expiry time.
- Mode labels apply: LIVE for messages fetched this session; HISTORICAL for bundled examples, with their original times. A bundled example must never look current.
- Types: `OfficialWarning`, `OfficialWarningArea`, `WarningFeedStatus`, `WarningHazard` in `src/types.ts`. `authority: "aggregator"` (e.g. GDACS) is an impact estimate and is never styled or worded as a warning.
- Adapter: `src/lib/warnings.ts`, `loadOfficialWarnings()` (never throws; per-feed live, cache, backoff, then bundled snapshot) and `warningsNear()`. v1 feeds: BMKG InaTEWS and BMKG earthquakes, JMA tsunami and volcano, GeoNet volcanic alert levels, NWS Pacific tsunami, GDACS, plus a recorded MAGMA Indonesia level notice for Merapi (historical; MAGMA's API is token-only). Source research: `docs/research/APIS_GEOPHYSICAL.md`.
- A real official level shown next to a simulated scenario sits in a separate panel and style, so the two can never be confused.
