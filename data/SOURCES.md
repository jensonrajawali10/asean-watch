# Data sources and provenance

Everything in the watch view is **real**. Every record comes from a named public source and keeps its original timestamp. Nothing is simulated, modelled or staged. The simulated Merapi scenario, the simulated Riau example and their files (`data/demo-events.json`, `data/incidents.json`) were removed on 13 October 2026.

Times are UTC. All links below were checked on 13 October 2026 between 07:10 and 07:30 UTC.

## Current snapshot

| | |
|---|---|
| Retrieved | **2026-10-13T07:26:44Z** (`data/real/meta.json` `retrievedAt`) |
| Window | 2026-10-07T00:00:00Z to 2026-10-13T07:26:44Z: the last 7 UTC days, today up to the retrieval time |
| Newest satellite file | 2026-10-13T06:50:48Z (Last-Modified of the Suomi NPP VIIRS file) |
| Size | about 96 KB (`firms.json` 87 KB, `meta.json` 9 KB, `quakes.json` under 1 KB) |
| Refresh | `npm run refresh:data` (runs `node scripts/refresh-data.mjs`) |

The refresh script downloads every source, keeps only rows near the watch areas and inside the window, and writes `data/real/firms.json`, `data/real/quakes.json`, `data/real/meta.json` and the `scenarioWindow` of each watch in `data/watches.json`. It writes nothing unless every download and parse succeeds, so a failed run leaves the previous snapshot in place. The app reads the snapshot only; it makes no runtime call to these sources. Every record is labelled `historical`.

## Sources

| Source id | What | Downloaded from | Last-Modified | Rows read / kept |
|---|---|---|---|---|
| `firms-viirs-snpp` | NASA FIRMS VIIRS 375 m NRT, Suomi NPP, South East Asia, 7 days (CSV, 7.8 MB) | https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_7d.csv | 2026-10-13T06:50:48Z | 95,339 / 239 |
| `firms-viirs-noaa20` | Same, NOAA-20 (8.1 MB) | https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_7d.csv | 2026-10-13T06:43:17Z | 96,437 / 70 |
| `firms-viirs-noaa21` | Same, NOAA-21 (8.4 MB) | https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_SouthEast_Asia_7d.csv | 2026-10-13T06:46:03Z | 99,667 / 78 |
| `firms-modis` | NASA FIRMS MODIS C6.1 1 km NRT, Terra and Aqua (1.4 MB) | https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_SouthEast_Asia_7d.csv | 2026-10-13T06:48:07Z | 17,857 / 22 |
| `usgs-fdsn` | USGS ComCat earthquakes, FDSN event query for one box around all watch areas (lat -8.57 to 3.63, lon 97.93 to 113.39) | https://earthquake.usgs.gov/fdsnws/event/1/query (full URL in `meta.json`) | 2026-10-13T07:26:45Z | 4 / 0 |
| `bmkg-gempaterkini` | BMKG Data Terbuka, latest 15 earthquakes M 5.0+ (covers 17 Sep to 11 Oct) | https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json | 2026-10-13T07:27:02Z | 15 / 0 |
| `bmkg-gempadirasakan` | BMKG Data Terbuka, latest 15 felt earthquakes (covers 9 to 13 Oct) | https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json | 2026-10-13T07:27:02Z | 15 / 0 |
| `bmkg-live30event` | BMKG InaTEWS, latest located earthquakes, all magnitudes (covers 8 Oct 20:34 to 13 Oct 06:42) | https://bmkg-content-inatews.storage.googleapis.com/live30event.xml | 2026-10-13T06:48:29Z | 199 / 0 |

"Kept" means within the collection margin of a watch (10 km of a summit for hotspots, 50 km for earthquakes, or inside the haze box) and inside the window. The watch rules then apply the tighter 5 km and 30 km radii.

**No earthquake** from USGS or BMKG fell within 50 km of any of the four summits, or inside the Riau box, during this window, so the snapshot has no seismic records. That is the real result, not a gap in the pipeline. Small volcano-tectonic earthquakes are recorded by PVMBG's own network, which has no open feed.

**BMKG coverage is rolling.** The three BMKG lists hold the latest 15 or about 200 events, so quakes below M 5.0 that were not felt and happened before 8 Oct 20:34 UTC are not in the snapshot.

## Product pages used as `sourceUrl`

Each record links to the public page for its product, or to its own event page. No granule, scene or orbit identifier is invented or stored.

| Records | `sourceUrl` | Checked |
|---|---|---|
| VIIRS hotspots (Suomi NPP, NOAA-20, NOAA-21) | https://www.earthdata.nasa.gov/data/instruments/viirs/viirs-i-band-375-m-active-fire-data | 200, "VIIRS I-Band 375 m Active Fire Data" |
| MODIS hotspots (Terra, Aqua) | https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs | 200, FIRMS attribute definitions for MODIS and VIIRS, including confidence |
| USGS earthquakes | the event's own page, e.g. https://earthquake.usgs.gov/earthquakes/eventpage/us6000u1q2 | 200 |
| BMKG gempaterkini, gempadirasakan | https://data.bmkg.go.id/gempabumi/ | 200 |
| BMKG live30event | https://inatews.bmkg.go.id/ | 200 |

## Field mapping

- **FIRMS, volcano watches.** One record per satellite overpass: hotspots within 5 km from the same satellite with the same `acq_date` and `acq_time` (HHMM, UTC per FIRMS). `observedAt` = that time with `Z`. `value` = the highest `frp` in the overpass (MW); the hotspot count and summed FRP are in the summary.
- **FIRMS, haze box.** One record per sensor per UTC day. `value` = the count of confident hotspots (`unit: "detections"`); summed FRP is in the summary, and `observedAt` is the last detection that day.
- **FIRMS hotspots are never dropped by grouping.** Each one is kept as a member of its record (`loadFixtures().members[observationId]`): coordinates, distance to the summit, FRP, confidence as given (VIIRS low, nominal or high; MODIS 0 to 100), day/night, brightness temperature, satellite and `version` (e.g. `2.0NRT`).
- **Heavy days in a haze box are counted, not all kept.** Inside a haze box the snapshot keeps at most 10 hotspots per satellite per UTC day, highest FRP first, so it stays under its 300 KB budget in a fire season (the Central Kalimantan box had 19,861 hotspots in the four FIRMS files on 22 Oct 2026). A satellite-day over that limit gets an entry in `hazeDayTotals` in `firms.json`: every hotspot in the box, counted per confidence value as given, with summed FRP and the detection times. The record's count, summed FRP and low-confidence count come from that total; its members are the strongest hotspots, and its summary and quality note say so. Hotspots near a volcano summit are always kept. `meta.json` gives `rowsCountedNotKept` per FIRMS file.
- **USGS.** `observedAt` = `time` (epoch ms). `value` = `mag`, `unit` = `M (<magType>)`. `sourceUrl` = the event page. The `updated` time is quoted in the quality note.
- **BMKG Data Terbuka.** `observedAt` = `DateTime` (given as `+00:00`). `Coordinates` is "lat,lon". Magnitude type is not published, so `unit` = `M (type not stated)`.
- **BMKG live30event.** `waktu` (e.g. `2026/10/13  06:42:29.657`) is read as UTC. Check: 14 of the 15 felt events in `gempadirasakan` (whose `DateTime` is explicit UTC) match a live30event entry within 10 s and 100 km when `waktu` is read as UTC. The refresh fails if none match.
- **`ingestedAt`** = the Last-Modified header of the file or response the record came from, which is when the provider last wrote it (not when the record first appeared in it); if no header was sent, the retrieval time.
- **USGS and BMKG reports of one event are never merged or averaged.** Each is its own record, naming its product and magnitude type.
- **ids** are stable. Volcano overpasses: watch key + sensor + acquisition time (`merapi-firms-n20-20261007T1752Z`). Haze totals: watch key + sensor + date (`riau-firms-snpp-20261007`). Single hotspots (members): the overpass id + coordinates (`merapi-firms-n20-20261007T1752Z-7.54423S-110.44315E`). Earthquakes: the provider's event id for USGS and live30event, and time + coordinates for the BMKG lists that have no id.

## Watch rules

Defined in `src/lib/watchRules.ts`. Every rule is an **illustrative watch rule, not an official threshold**, and its text travels with each flagged record as `anomalyReason`.

- **Thermal, volcano:** FIRMS hotspots within 5 km of the GVP summit point are grouped per satellite overpass. An overpass is flagged when at least one hotspot has VIIRS confidence nominal or high, or MODIS confidence 50 or more, and the reason says how many of its hotspots did. Overpasses with only low-confidence hotspots are shown but not flagged.
- **Thermal, haze box:** hotspots inside the box are totalled per sensor per UTC day; 10 or more confident hotspots from one sensor on one day is flagged.
- **Seismic:** USGS or BMKG earthquakes within 30 km of the summit (or inside the haze box); M 3.0 or more is flagged, smaller ones are context.
- **Gas:** there is no open numeric SO2 feed, so no gas records exist. Each volcano watch links to MOUNTS instead. Modelled data (Open-Meteo, CAMS) is never used as evidence.

Official volcano levels (PVMBG/MAGMA listed Merapi, Semeru, Anak Krakatau and Sinabung at Level III, Siaga, at about 07:00 UTC on 13 October 2026) are **not** observations here. They are relayed separately and verbatim by the official-warnings layer (`src/lib/warnings.ts`).

## Volcano catalog (`volcanoes.json`)

Facts come from the Smithsonian Global Volcanism Program's own GeoServer service (Volcanoes of the World, Holocene list), queried on 13 October 2026 at about 07:12 UTC:

https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json&CQL_FILTER=Volcano_Name%20IN%20('Merapi','Semeru','Krakatau','Sinabung','Anak%20Krakatau')

| GVP number | GVP name | Lat | Lon | Elevation | Region / subregion | Type |
|---|---|---|---|---|---|---|
| 263250 | Merapi | -7.54 | 110.446 | 2910 m | Sunda-Banda Volcanic Regions / Sunda Volcanic Arc | Stratovolcano |
| 263300 | Semeru | -8.108 | 112.922 | 3657 m | Sunda-Banda Volcanic Regions / Sunda Volcanic Arc | Stratovolcano |
| 262000 | Krakatau | -6.1009 | 105.4233 | 285 m | Sunda-Banda Volcanic Regions / Sunda Volcanic Arc | Caldera |
| 261080 | Sinabung | 3.17 | 98.392 | 2460 m | Sunda-Banda Volcanic Regions / Sunda Volcanic Arc | Stratovolcano |

- `volcanoes.json` was generated from that response, not typed by hand; each record's `Latitude`/`Longitude` matched its point geometry.
- **Anak Krakatau** is not a separate GVP entry. The GVP catalogues it under Krakatau (262000); its summary names Anak Krakatau as the cone built inside the 1883 caldera since 1927. The watch uses the GVP point for Krakatau. The WFS record does not say which feature that point marks, and 285 m is GVP's elevation for the Krakatau entry as a whole.
- Catalog pages cited in the app: `https://volcano.si.edu/volcano.cfm?vn=<number>`. That site returns a bot-verification challenge (HTTP 403) to scripts, so the pages were not read directly; nothing was done to get past the challenge.
- Location names in `watches.json` follow the GVP summaries plus the province: the Merapi summary places it just north of Yogyakarta, the Semeru summary calls it Java's highest volcano, the Krakatau summary places it in the Sunda Strait, and the Sinabung photo caption names the Karo Plateau.

## Watch areas (`watches.json`)

| Watch | Centre | Area |
|---|---|---|
| `watch-merapi`, `watch-semeru`, `watch-anak-krakatau`, `watch-sinabung` | GVP summit point (above) | 5 km thermal and 30 km seismic radius around the point |
| `watch-riau-haze` | 0.50, 102.55 (Siak-Kampar peatlands, Key Biodiversity Area "Hutan Rawa Gambut Siak-Kampar", https://www.keybiodiversityareas.org/site/factsheet/15811) | Box: latitude -0.5 to 1.6, longitude 101.0 to 103.2 |
| `watch-kalteng-haze` | -2.5, 114.0 (the box centre, south-east of Palangka Raya) | Box: latitude -3.5 to -1.5, longitude 113.0 to 115.0 |

The Riau box was narrowed on purpose. A wider box (latitude -0.5 to 2.5, longitude 100 to 104) also covers Singapore, the Johor and Melaka coasts and part of West Sumatra. In this window it picked up at least 19 hotspots on Malaysian land (checked against the Natural Earth polygons in `region.geojson`), which would have been counted as Riau peatland hotspots. The chosen box contains no Malaysian or Singapore land on a 0.02° grid. It still covers the Siak-Kampar peninsula, Pekanbaru, Bengkalis and the Meranti islands. It leaves out Dumai (1.67° N, a port with a refinery), the northern Rokan coast and the coast east of 103.2° E. Province boundaries were not checked, so the box is an approximation of the Riau mainland, not its border.

The Central Kalimantan box (added 30 October 2026) is the study area of a peer-reviewed paper on peatland fires there: Usup, A. and Hayasaka, H. (2023), "Peatland Fire Weather Conditions in Central Kalimantan, Indonesia", *Fire* 6(5), 182, https://doi.org/10.3390/fire6050182. The paper defines it as latitude 1.5° to 3.5° S and longitude 113° to 115° E, about 49,500 km², and chose it because it holds Central Kalimantan's major peatland (the ex-Mega Rice Project and part of Sebangau National Park) and one of Indonesia's highest hotspot densities. That is about 87% of the Riau box's area, so the 10-per-sensor-per-day rule stays comparable. Palangka Raya (2.21° S, 113.92° E) is inside. The box also takes in the lower Barito near Banjarmasin, in South Kalimantan (the paper places Banjarbaru airport, 3.45° S 114.74° E, in its south-east), so hotspots there are counted too: it is a peatland fire area, not the province border. The paper's figures come from MODIS hotspots over 2002 to 2022; this watch uses FIRMS VIIRS and MODIS rows for the last 7 days only.

Reference links on each watch (MAGMA activity levels, MOUNTS time series for 263250, 263300, 262000 and 261080, ASMC) returned HTTP 200 when checked. MOUNTS is served over plain HTTP only. The Central Kalimantan links (BMKG's Peringatan Karhutla and PM2.5 pages, and the paper's DOI) were opened in a browser on 30 October 2026: BMKG and MDPI answer scripts with HTTP 403, and ASMC returned 200.

## Attribution (show in the app and the brief)

- **NASA FIRMS, LANCE.** "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS)." This is the acknowledgement FIRMS asks for at https://www.earthdata.nasa.gov/data/tools/firms. NASA data are open.
- **USGS.** U.S. Geological Survey, Earthquake Hazards Program. Public domain.
- **BMKG.** "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)." BMKG's Data Terbuka terms (https://data.bmkg.go.id/gempabumi/) require BMKG to be credited as the data source and shown in the app, and limit access to 60 requests per minute per IP. The refresh makes three BMKG requests.
- **Smithsonian GVP.** Global Volcanism Program, Volcanoes of the World, Smithsonian Institution. Its terms page was blocked (HTTP 403) and could not be checked.

The same texts are stored per source in `data/real/meta.json` (`attribution`, `licence`) and exposed by `loadFixtures().snapshot.attributions`.

## Caveats every reader should see

- A FIRMS hotspot near a volcano can also be a vegetation fire or other hot ground. In the haze box it can be a fire, a gas flare or other hot ground. Every hotspot needs contextual review.
- FIRMS NRT data are preliminary and can change. Cloud and thick smoke hide hotspots, so a day without detections is not evidence of no heat, and daily counts are lower bounds.
- Each satellite is counted separately, so one fire seen by two satellites appears in two daily totals.
- Earthquake magnitudes differ between agencies and products. Both are shown, never merged.
- The review states (Monitoring, Check observation, Review needed) are analyst prompts built from illustrative rules. They are not official alert levels and never say "evacuate".

## Map geometry

`data/region.geojson` comes from Natural Earth (public domain) through the `world-atlas` npm package. The map builder generates it with `scripts/build-region.mjs`.

## Other snapshots

`data/nea-snapshot.json` (NEA wind and haze) and `data/warnings-snapshot.json` (official warnings) are owned and documented by the logic builder (`scripts/capture-nea-snapshot.mjs`, `scripts/capture-warnings-snapshot.mjs`).

## Ash drift winds and tsunami warning areas (added 2026-10-14)

| File | What | Source and licence | Refresh |
|---|---|---|---|
| `data/ash-wind-snapshot.json` | MODELLED hourly wind at 700, 500 and 300 hPa (~3, ~5.5, ~9 km) at each watched volcano's Smithsonian GVP summit point, 3 days from 00 UTC. Fallback for the illustrative ash-drift lines (`src/lib/ashDrift.ts`); the app fetches the same variables live first. Variables verified 2026-10-14: `wind_speed_{700,500,300}hPa`, `wind_direction_{700,500,300}hPa` (m/s, FROM). | Weather data by Open-Meteo.com, CC BY 4.0 (https://open-meteo.com/en/licence). The capture uses the Forecast API, or the Historical Forecast API (archived forecasts of the same models) when the Forecast API refuses; `source` records which. The 2026-10-14 11:48 UTC capture came from the Historical Forecast API (Forecast API hourly limit reached). | `npm run refresh:ashwind` |
| `data/idn-adm2-centroids.json` | 519 Indonesian regency and city centre points (area-weighted centroid of the largest polygon), used to place BMKG InaTEWS `<wzarea>` districts at approximate positions (`src/lib/tsunamiAreas.ts`). | geoBoundaries gbOpen IDN ADM2 (2020), https://www.geoboundaries.org/api/current/gbOpen/IDN/ADM2/, from Badan Pusat Statistik (BPS), World Food Programme and OCHA ROAP. Licence: Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO). Attribution: "District centres derived from geoBoundaries (Runfola et al. 2020, www.geoboundaries.org), IDN ADM2 from BPS, WFP, OCHA ROAP; CC BY 3.0 IGO." | `npm run build:idn-centroids` |

Tsunami warning areas and observed heights are BMKG InaTEWS (`last30tsunamievent.xml`), relayed verbatim; see `data/warnings-snapshot.json`.

## Fires, eruption scenario and analyst workspace (added 2026-10-15)

| File | What | Source and licence | Refresh |
|---|---|---|---|
| `data/fires-snapshot.json` | MEASURED. Whole-region NASA FIRMS active-fire detections over 7 days, kept only when confident (VIIRS nominal or high; MODIS confidence of 50 or more). Each UTC day is aggregated into a 0.25° grid of detection count, summed and maximum fire radiative power (MW) and a sensor mask. The file also holds country and province rollups, the top clusters for 24 h and 7 days, and a daily history that each refresh carries forward, so week-over-week needs a daily refresh. Periods start at the latest time every sensor has data, not at the retrieval time. FRP is a proxy for fire intensity, not emissions; for emissions see Copernicus CAMS Fire Emissions Watch (GFAS). | The same four FIRMS 7-day South East Asia CSVs as `data/real/firms.json`, with the same FIRMS acknowledgement (see Attribution). | `npm run refresh:fires` (part of `refresh:all`) |
| `data/fire-admin-lookup.json` | The province or state of each district centre, plus first-level unit centres, used to name fire clusters and rollups. Only `scripts/refresh-fires.mjs` reads it; it is not bundled. Names are approximate, taken from the nearest district or province centre; the 2022 Papua split is applied by regency name. | geoBoundaries gbOpen: IDN ADM2 (CC BY 3.0 IGO); IDN ADM1 (2017; OpenStreetMap, Wambacher; **ODbL 1.0, © OpenStreetMap contributors**); MYS ADM2 and ADM1 (CC BY 3.0); and ADM1 for the other ASEAN members and Papua New Guinea. Each unit's licence is stored in the file's `sources`. | `npm run build:fire-admin` |
| `data/ash-wind-snapshot.json` | Now 96 h (yesterday plus three days), so the "If it erupted now" scenario (`src/lib/eruptionScenario.ts`) can run 48 h from the scrubber's "now". It is a MODELLED SCENARIO: hourly puffs at about 3, 5.5 and 9 km carried by the summit winds, with an illustrative spread rate (Heffter 1965). It is not a dispersion model and not a VAAC advisory. Town coordinates come from GeoNames, with ids in the code. | Open-Meteo, CC BY 4.0 | `npm run refresh:ashwind` |

## Volcanic ash advisories (added 2026-10-30)

| File | What | Source and licence | Refresh |
|---|---|---|---|
| `data/vaac-snapshot.json` | OFFICIAL, aviation. The newest Tokyo VAAC Volcanic Ash Advisory per volcano issued in the 24 hours before capture, each text word for word (only the HTML line breaks become newlines). The offline fallback for the live relay `GET /api/vaac`, which runs the same builder (`scripts/lib/vaacBuild.mjs`). The browser applies the 24-hour window again on the visitor's clock, so an old capture shows nothing as current. Only texts that say `VAAC: TOKYO` are kept. | Tokyo Volcanic Ash Advisory Center, Japan Meteorological Agency: list https://www.data.jma.go.jp/vaac/data/vaac_list.html and the text pages it links. CORS open (`Access-Control-Allow-Origin: *`), `Cache-Control: max-age=600`. JMA Website Terms of Use: Public Data License (Version 1.0), compatible with CC BY 4.0; source cited as "Source: Japan Meteorological Agency website (URL)". | `npm run refresh:vaac` (part of `refresh:all`) |

Linked, not relayed:
- **ASEAN Specialised Meteorological Centre (ASMC).** Its regional haze alert levels and hotspot maps are linked only. It has no keyless machine-readable feed, and its terms require written permission from the Meteorological Service Singapore to republish.
- **NUS CRISP satellite imagery.** Linked only.
- **VAAC Darwin ash advisories** (Bureau of Meteorology; Indonesia, including the four watched volcanoes). Linked only: the Bureau blocks automated access to its advisory page, and its copyright notice allows personal or in-house use only where no other terms are stated. Copies on JMA's "Darwin VAAC Backup" page and NOAA's tgftp server are still the Bureau's text, so they are not used either.
- **MAGMA hazard maps (KRB).** Linked only.
