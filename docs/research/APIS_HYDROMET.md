# Hydro-meteorological APIs for APAC: flood, rain, wind, haze, official warnings

Research for ASEAN Watch. Scope: flood watch and river levels, rainfall, wind anywhere, haze and air quality, official warning feeds, and satellite imagery for the zoomed view. Volcanoes, earthquakes, tsunami and tide gauges are covered in a sibling document.

**How this was tested.** Every source in the summary table was requested live with `curl` on **2026-10-13 between 06:49 and 07:06 UTC**, using real APAC points: Riau 0.5,102.55; Merapi -7.54,110.446; Ayutthaya 14.35,100.56; Jakarta -6.2,106.85; Manila 14.6,121.0; Johor/Singapore box 0.6–2.2 N, 103.0–104.6 E. Each request sent `Origin: http://localhost:5173`. "CORS yes" means the response carried `Access-Control-Allow-Origin` for that origin (`*` or reflected). A source with no such header cannot be called from the browser and needs a proxy or a build-time snapshot. Trimmed samples (≤ 20 KB each) are in the session scratchpad at `scratchpad/api-research/hydromet/`, outside the repo. Licence and terms wording was read from the provider's page where a link is given. Where it says "not reviewed", the terms page was not read in this pass.

**The labelling rule this document assumes.** Every value carries a basis: OBSERVED (a sensor or gauge measured it), MODELLED (a numerical model's analysis or nowcast for "now"), FORECAST (a model's future value), SATELLITE IMAGE (a picture, with its acquisition time), or OFFICIAL WARNING (relayed verbatim from the issuing agency). Today `DataMode` (`simulated | historical | live`) describes freshness, not basis. A `live` CAMS PM2.5 value is still modelled. See "Schema implications".

---

## 1. Summary table

Verdicts: **Integrate now** (browser-callable, no key, stable enough) · **Proxy/snapshot** (open data but no CORS, or very large; fetch at build time or through a small proxy) · **Key** (needs a key or account we did not request) · **Reference** (link out only) · **Avoid**.

| Source | Hazard | Coverage | Basis | Key? | CORS? | Format | Latency at test | Licence / terms | Verified (UTC) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Open-Meteo Forecast API | Wind 10 m + pressure levels, rain | Global | MODELLED (current, 15-min) / FORECAST | No | Yes `*` | JSON | current = 15-min model step | CC BY 4.0; free tier non-commercial, 600/min, 5,000/h, 10,000/day | 200 @ 06:49 | **Integrate now** |
| Open-Meteo Air Quality API (CAMS) | PM2.5, PM10, AOD, dust, CO | Global (~0.4° in Asia) | MODELLED / FORECAST | No | Yes `*` | JSON | hourly; CAMS global run every 12 h | CC BY 4.0 + CAMS attribution; non-commercial | 200 @ 06:49 | **Integrate now** |
| Open-Meteo Flood API (GloFAS v4) | River discharge | Global 0.05° | MODELLED / FORECAST | No | Yes `*` | JSON | daily | CC BY 4.0 (Copernicus EMS GloFAS) | 200 @ 06:49 | **Integrate now** (grid search, modelled label) |
| Open-Meteo Historical (ERA5) | Rain, wind (past) | Global | MODELLED (reanalysis) | No | Yes `*` | JSON | days | CC BY 4.0 | 200 @ 06:51 | Reference / optional |
| data.gov.sg PUB flood alerts | Flash flood alerts | Singapore | OFFICIAL WARNING | No (lower limit without login) | Yes `*` | JSON | 2-min records | Singapore Open Data Licence | 200 @ 06:51 (no active alerts) | **Integrate now** |
| data.gov.sg NEA rainfall | Rain 5-min | Singapore, 89 stations | OBSERVED | No | Yes `*` | JSON | 5 min | Singapore Open Data Licence | 200 @ 06:51 | **Integrate now** |
| NEA wind, PSI, PM2.5 (in use) | Wind, haze | Singapore | OBSERVED | No | Yes `*` | JSON | 5–60 min | Singapore Open Data Licence | in use | Keep |
| ThaiWater `waterlevel_load` (HII) | River level vs bank, discharge | Thailand, 807 telemetry stations | OBSERVED + situation level | No | Yes (reflects any origin, with credentials) | JSON, gzip 240 KB (1.4 MB raw) | ~1–2 h | Not found; undocumented public API | 200 @ 06:52 | **Integrate now** (cache; confirm terms) |
| Jakarta DSDA Posko Banjir `xmldata.xml` | Floodgate water level + Siaga 1–4 | Jakarta + upstream Ciliwung etc. | OBSERVED + official thresholds | No | Yes `*` | XML | ~15 min (13:40 WIB reading fetched 13:52 WIB) | Not stated | 200 @ 06:52 | **Integrate now** (attribute DSDA DKI) |
| Malaysia Public Info Banjir (JPS) | River level + Normal/Alert/Warning/Danger | Malaysia, per state | OBSERVED + official thresholds | No | No | HTML table | 15 min–hours | Not reviewed | 200 @ 06:57 | **Proxy/snapshot** |
| PAGASA Pasig-Marikina-Tullahan FFWS | River level + alert/alarm/critical | Metro Manila, 21 stations | OBSERVED + official thresholds | No | No | JSON via undocumented POST | not measured (values now, −30 min, −1 h, −2 h) | Not reviewed | 200 POST @ 06:57 (GET 405) | **Proxy/snapshot** |
| MRC Mekong (api / FFW) | Mekong levels, forecasts | Mekong main stem | OBSERVED + FORECAST | API 401 (auth) | n/a | HTML | daily in season | Not reviewed | 401 / 200 HTML @ 06:52 | **Reference** (see integrity note) |
| BoM Water Data (KiWIS) and warnings XML | River levels, flood warnings | Australia | OBSERVED / OFFICIAL | No key, but 403 to scripted client | — | — | — | Not reviewed | 403 @ 06:57 | **Avoid** for hackathon |
| data.gov.my MET Malaysia `weather/warning` | Official weather warnings | Malaysia | OFFICIAL WARNING (text) | No | Yes `*` | JSON | as issued | CC BY 4.0; **4 requests/min** | 200 @ 06:52 | **Integrate now** (cache) |
| data.gov.my `weather/forecast` | 7-day forecast (Malay text) | Malaysia districts | FORECAST | No | Yes `*` | JSON | daily | CC BY 4.0; 4/min | 200 @ 06:52 | Reference |
| BMKG `prakiraan-cuaca` | Wind dir/speed, rain forecast | Indonesia, per village (adm4 code) | FORECAST (3-hourly) | No | Yes `*` | JSON | daily run | Must cite BMKG; 60 req/min/IP | 200 @ 06:53 | Integrate (needs adm4 lookup) |
| BMKG nowcast warnings (RSS + CAP 1.2) | Heavy rain, thunderstorm, wind | Indonesia | OFFICIAL WARNING, CAP with polygons | No | No | RSS + CAP XML | minutes | RSS states "public domain" | 200 @ 06:53 | **Proxy/snapshot** (high value) |
| WMO SWIC `wmo_all.json` | All CAP warnings (aggregated) | Global; APAC: SG MSS, BMKG, BoM, CMA, TMD, NZ | OFFICIAL WARNING summaries | No | No | JSON | minutes | Not reviewed | 200 @ 06:53 | **Proxy/snapshot** |
| `cap-sources.s3.amazonaws.com` mirrors | CAP RSS | — | — | No | Yes `*` | RSS | **stale (2018)** or 404 | — | 200/404 @ 06:53 | **Avoid** |
| GDACS events API (FL, TC) | Flood and cyclone events | Global | MODELLED/automatic alerts (FL source "GLOFAS") | No | Yes `*` | GeoJSON | daily | Not reviewed | 200 @ 06:53 | Integrate (event layer, labelled) |
| JMA bosai (AMeDAS, warnings) | Wind, rain obs; warnings | Japan | OBSERVED (10-min) + OFFICIAL | No | Yes `*` | JSON | 10–20 min | JMA site terms (not reviewed); undocumented | 200 @ 06:52 | Integrate for Japan extension |
| HKO open data (`rhrread`, `warnsum`; 10-min wind CSV) | Rain, warnings, wind | Hong Kong | OBSERVED + OFFICIAL | No | JSON `*`; CSV no | JSON / CSV | 10 min | Not reviewed | 200 @ 06:52 | Integrate (JSON) for HK |
| NASA GIBS WMS/WMTS | VIIRS true colour, Himawari IR/visible, AOD | Global; Himawari = APAC | SATELLITE IMAGE | No | Yes `*` | PNG/JPEG | Himawari ~45 min; VIIRS daily (previous day) | NASA open data, attribution | 200 @ 06:55, 07:06 | **Integrate now** |
| JMA MSC Himawari images | True colour, IR sectors | APAC fixed sectors | SATELLITE IMAGE (10-min) | No | Yes `*` | JPEG | ~30 min | JMA terms (not reviewed) | 200 @ 06:57 | Integrate (fixed crops) |
| RAMMB/CIRA SLIDER | Himawari GeoColor tiles | Full disk | SATELLITE IMAGE (10-min) | No | No (img only) | PNG tiles | ~37 min | Not reviewed | 200 @ 06:56 | Reference / `<img>` only |
| NASA FIRMS regional 24 h CSV | Fire hotspots (haze source) | SE Asia | SATELLITE DETECTION | No (API needs MAP_KEY) | No | CSV 670 KB | ~3 h | NASA open data | 200 @ 06:53 | **Proxy/snapshot** |
| ASMC hotspot TXT (NOAA-20) | Fire hotspots | ASEAN sub-regions | SATELLITE DETECTION, daily, high confidence | No | No (ASMC origin only) | Fixed-width text | daily | ASMC T&C (not reviewed) | 200 @ 06:59 | **Proxy/snapshot** |
| WAQI / aqicn | Station AQI | Global | OBSERVED | **Token** | Yes `*` | JSON | — | Not reviewed | `Invalid key` @ 06:53 | **Key** |
| OpenAQ v3 | Station PM2.5 | Global | OBSERVED | **X-API-Key** | — | JSON | — | Not reviewed | 401 @ 06:53 | **Key** |
| Malaysia DOE APIMS | Station API (air pollutant index) | Malaysia | OBSERVED | — | — | No open documented endpoint found | — | — | checked @ 07:00 | **Reference** (link out) |
| NASA POWER daily point | Rain, wind (daily) | Global | MODELLED (GEOS-IT) | No | Yes `*` | JSON | ~3 days | NASA open data | 200 @ 06:53; **WD10M invalid** | **Avoid** for wind |
| Copernicus GFM API | Satellite flood extent | Global | SATELLITE-DERIVED | Account (user/AOI endpoints) | reflected | JSON | per Sentinel-1 pass | Not reviewed | Swagger 200 @ 06:57 | **Key** |
| NASA GPM IMERG | Satellite rainfall | Global | SATELLITE-DERIVED | Earthdata login (per NASA) | — | — | — | — | not tested | Reference |
| Japan MLIT river (`river.go.jp`), DFO Flood Observatory | River levels / flood archive | Japan / global | — | — | — | — | — | — | not tested | Reference |

---

## 2. Top 5 for the hackathon

Criteria: browser-callable, no key, APAC coverage, highest demo value. Authoritative sources rank first where they exist, per the relay-official-warnings stance.

**1. ThaiWater `waterlevel_load` (Thailand, observed, official situation level).** At test time, station C.35 (Ban Pom, Ayutthaya, Chao Phraya) read 4.96 m MSL against a lowest bank of 4.35 m: 0.61 m over the bank, situation level 5 ("overflowing bank"), with an observed discharge of 1,333 m³/s. That is our Ayutthaya flood example, live and real. *Adapter:* `loadThaiWaterContext(incident)` fetches `https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load` once per session (gzip, about 240 KB) with a 5 s timeout and falls back to a bundled snapshot, as `loadNeaContext` does. It keeps stations within 50 km of the incident and sorts them by `situation_level` and then distance. It normalises `waterlevel_datetime` from Thai local time (UTC+7, no offset in the payload) to UTC `Z`. Each station becomes a `GaugeReading`: `levelM = waterlevel_msl`, `bankM = min_bank`, `overBankM = diff_wl_bank`, `dischargeM3s`, and `situationLevel` with ThaiWater's own colour and term (level 5 = overflowing bank, 4 = high, 3 = normal, 2 = low, 1 = critically low, keyed to percent of bank capacity). The label is "OBSERVED · Royal Irrigation Department gauge via ThaiWater (HII), {time} ICT". The situation level is a monitoring category, not an evacuation order. Link out to `https://www.thaiwater.net`. For a 72 h sparkline, `.../public/waterlevel_graph?station_type=tele_waterlevel&station_id=2609&start_date=…&end_date=…` returns hourly `value` and `discharge`.

**2. Open-Meteo Forecast + Air Quality (wind and haze anywhere, modelled).** This answers the "wind and haze when zoomed in anywhere" request in two keyless GETs at any lat/lon, both CORS `*`. *Adapter:* `loadModelledContext(lat, lon, hazard)` calls `api.open-meteo.com/v1/forecast?current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,wind_speed_700hPa,wind_direction_700hPa,wind_speed_500hPa,wind_direction_500hPa&hourly=precipitation&past_days=1&forecast_days=1&timezone=GMT` and `air-quality-api.open-meteo.com/v1/air-quality?current=pm2_5,pm10,aerosol_optical_depth,dust&hourly=pm2_5&past_days=1&forecast_days=2&timezone=GMT`. It converts km/h to knots so the values match `WindSummary`. It picks the drift wind by hazard: 700 hPa or 500 hPa for volcano plumes, 10 m for surface peat smoke (see section 5). It returns a `ModelledContext` with `basis: 'modelled'` and the grid resolution. For the zoomed haze field, one request with 48 comma-separated coordinates (0.2° spacing) returns the whole box in about 0.9 s. It counts as 48 calls against the free-tier limit, so cache it for at least 30 minutes. Attribution: "Weather data by Open-Meteo.com (CC BY 4.0); air quality from Copernicus Atmosphere Monitoring Service (CAMS)".

**3. data.gov.sg PUB flood alerts + NEA rainfall (Singapore, official and observed).** This uses the same host, conventions and licence as the NEA layer we already ship, so the cost is mostly reusing `nea.ts`. *Adapter:* extend `loadNeaContext()` to also fetch `https://api-open.data.gov.sg/v2/real-time/api/weather/flood-alerts` (records every ~2 min; `item.readings` was empty at test because no alert was active) and `https://api-open.data.gov.sg/v2/real-time/api/rainfall` (5-min totals, mm, 89 stations). Normalise `+08:00` to UTC. Show "No PUB flood alert in force at {time}" when the readings are empty; that is an honest and useful state. Show the five wettest stations in the last reading as OBSERVED. The populated alert schema was not observed (no alerts at test time), so the parser must tolerate unknown fields and show the raw text. Keep a fixture of a historical alert once one is captured. A live MSS "HEAVY RAIN WARNING" for northern, western and central Singapore (05:23–07:00 UTC) was visible in WMO SWIC during the test, so a heavy-rain warning source for Singapore exists as CAP. Its own feed URL was not resolved in this pass.

**4. NASA GIBS WMS (satellite image on click and haze underlay).** No key, CORS `*`, and server-side cropping to any bounding box. This gives "an up-to-date weather image for the clicked location". *Adapter:* `satelliteImageUrl(lat, lon, layer, time?)` builds `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX={lat-1},{lon-1},{lat+1},{lon+1}&WIDTH=512&HEIGHT=512&FORMAT=image/png&LAYERS={layer}` (with WMS 1.3.0 and EPSG:4326 the BBOX order is lat,lon). Use `Himawari_AHI_Band13_Clean_Infrared` for "now". Omitting `TIME` returns the latest 10-minute frame; the capabilities document listed 06:10 UTC as latest at about 06:55 UTC. Use `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (`FORMAT=image/jpeg`, `TIME=yesterday`) for haze, which is visible as grey veil in true colour. Render it as an `<img>` in the detail panel, or as a georeferenced underlay in the zoomed map since the bounding box is known. The label must carry the acquisition time: "SATELLITE IMAGE · Himawari-9 AHI band 13 (infrared), 06:10 UTC" or "SATELLITE IMAGE · NOAA-20 VIIRS true colour, 12 Oct 2026 (early-afternoon pass)". Attribution: "Imagery from NASA GIBS, part of NASA ESDIS; Himawari data from JMA".

**5. Jakarta DSDA Posko Banjir (official Siaga levels for Jakarta's rivers and gates).** This is open XML with CORS `*`, giving the current level per floodgate or weir plus the four official Siaga thresholds and a status string. Jakarta is the archetypal ASEAN urban flood case, and the format is "relay official status" by construction. *Adapter:* `loadJakartaGates()` fetches `https://poskobanjir.dsdadki.web.id/xmldata.xml` and parses `SP_GET_LAST_STATUS_PINTU_AIR` elements with `DOMParser`: `NAMA_PINTU_AIR`, `LOKASI` (river), `LATITUDE`/`LONGITUDE`, `TANGGAL` (has `+07:00`), `TINGGI_AIR`, `SIAGA1..4`, `STATUS_SIAGA`. Display `STATUS_SIAGA` verbatim as OFFICIAL STATUS. Siaga 1 is the most severe and Siaga 4 the least, which is the opposite of what many readers expect, so spell it out. Unit caveat: Katulampa's `SIAGA1/2/3 = 2000/1500/800` match its published 200/150/80 cm thresholds, so the values appear to be **millimetres**. Confirm per gate before printing units. Link to `https://bpbd.jakarta.go.id` as the public channel.

**Runners-up:** data.gov.my MET Malaysia warnings (official, CC BY 4.0, but text-only and 4 requests/min); Open-Meteo Flood API (modelled discharge anywhere; needs grid search); JMA MSC Himawari true-colour sectors (10-min, CORS `*`, fixed crops); GDACS FL/TC event list; BMKG village forecast (needs an adm4 code lookup).

---

## 3. Official warnings for evacuation awareness

Stance: ASEAN Watch **relays** official warnings and never issues its own evacuation call. A relayed warning shows: issuing agency, event, severity or official level, affected area, message time, expiry, any evacuation guidance in the agency's own words, and a link to the agency's public channel. Never paraphrase a warning into a stronger or weaker one.

| Feed | Official levels / thresholds | Affected area | Evacuation guidance in feed | Message time and expiry | Machine format | Browser? | Public channel to link |
|---|---|---|---|---|---|---|---|
| **BMKG nowcast** (`https://www.bmkg.go.id/alerts/nowcast/id/rss.xml` → per-alert CAP) | CAP `severity`/`urgency`/`certainty` (e.g. Moderate/Immediate/Observed) | `areaDesc` + **polygons** | Advisory text ("Masyarakat dihimbau untuk tetap waspada…"); no evacuation order seen | `sent`, `effective`, `expires` (e.g. 16:00–19:00 WIT) | **CAP 1.2** | No CORS → proxy/snapshot | bmkg.go.id, infographic URL in `<web>` |
| **PUB flood alerts** (data.gov.sg) | Alert per location (populated schema not observed) | Location/station | Unknown until an alert is captured | `datetime`, `updatedTimestamp` | JSON | **Yes** | PUB / MyENV app, @PUBsingapore |
| **MSS Singapore heavy rain** (seen in WMO SWIC) | CAP event "Heavy Rain" | "northern, western and central area(s) of Singapore" | — | sent 05:23, expires 07:00 UTC | CAP (via SWIC) | Not directly | weather.gov.sg |
| **ThaiWater** situation level | 5 levels by % of bank-full capacity; 101 of 807 stations also carry a critical level | Station + province | None (monitoring category) | `waterlevel_datetime` (ICT, no offset) | JSON | **Yes** | thaiwater.net; RID; DDPM for evacuation |
| **Jakarta DSDA** Siaga 1–4 | Per-gate Siaga thresholds + `STATUS_SIAGA` | Gate/river | None in feed; BPBD DKI issues evacuations | `TANGGAL` (+07:00) | XML | **Yes** | bpbd.jakarta.go.id |
| **Malaysia Public Info Banjir** | Normal / Alert / Warning / **Danger** per station; legend: "Danger Level: River level caused considerable flooding, evacuation to be initiated." | Station, district, basin | **Yes, defined by threshold** (Danger implies evacuation to be initiated) | Last-update time per row (MYT) | HTML (page shows JSON/XLS/CSV export buttons, not tested) | No → proxy/snapshot | publicinfobanjir.water.gov.my; NADMA Portal Bencana |
| **PAGASA FFWS** (Pasig-Marikina-Tullahan) | `alertwl`, `alarmwl`, `criticalwl` per station | Station | None in feed | Query time; values now, 30 min, 1 h, 2 h ago | JSON via POST | No → proxy | pagasa.dost.gov.ph; MMDA / Marikina LGU |
| **MET Malaysia warnings** (data.gov.my) | Warning type in title (e.g. "Strong Winds and Rough Seas", "Thunderstorms") | Free-text states/waters | Safety text only | `issued`, `valid_from`, `valid_to` (no offset; MYT) | JSON | **Yes** | met.gov.my |
| **JMA warnings** (`/bosai/warning/data/warning/{area}.json`) | JMA warning/advisory codes per municipality | Municipality codes | Linked to JMA levels; mapping tables needed | report time | JSON | **Yes** | jma.go.jp |
| **HKO `warnsum`** | Signal codes (e.g. rainstorm amber/red/black) | Hong Kong | — | issue/update time | JSON (`{}` when none in force) | **Yes** | hko.gov.hk |
| **GDACS** FL/TC | Green/Orange/Red (automatic, modelled) | Country, centroid, polygon URL | None | `fromdate`/`todate` | GeoJSON | **Yes** | gdacs.org report URL in feed |
| **WMO SWIC** aggregate | CAP summary fields (`s`,`u`,`c` codes) | `areaDesc` | — | `sent`, `effective`, `expires` | JSON → CAP URLs | No | severeweather.wmo.int |
| BoM warnings | Official | — | — | — | XML/FTP | 403 to scripts | bom.gov.au (link only) |
| PAGASA, MET Malaysia, HKO CAP on `cap-sources` S3 | — | — | — | — | 404 | — | Avoid; not the live channel |

Gaps: no open CAP feed for PAGASA, MET Malaysia, NDRRMC, DDPM (Thailand) or BNPB (Indonesia) was found in this pass. In SWIC at test time, the only South-East Asian sources with active alerts in the feed were BMKG (`id-inatews-id`), MSS Singapore (`sg-mss-en`) and TMD Thailand (`th-tmd-th`). The feed lists active alerts only, so other agencies may contribute when they have alerts in force.

**Recommendation.** Add an `OfficialWarning` type, kept separate from `deriveReview`. A relayed warning must never be turned into, or blended with, our illustrative review state. Show it as a banner in the detail panel and brief: "OFFICIAL WARNING · {agency} · {event} · issued {time} · expires {time} · [open agency page]". Browser-callable now: PUB, ThaiWater, Jakarta DSDA, MET Malaysia, JMA, HKO, GDACS. For BMKG CAP, Public Info Banjir, PAGASA FFWS and SWIC, add a capture script like `scripts/capture-nea-snapshot.mjs` and label the result HISTORICAL SNAPSHOT with its capture time, or put them behind a tiny proxy after the hackathon. Never show an expired warning as current: check `expires` against the clock and grey it out.

---

## 4. Flood watch with water levels

Water level is not discharge. Gauges give **observed stage** (metres, against a local datum or MSL) with official thresholds. GloFAS gives **modelled discharge** (m³/s) on a 5 km grid with no thresholds of its own. GDACS turns GloFAS into automatic alerts.

| Hotspot | Observed river levels (open) | Thresholds | Browser? | Latency at test | Modelled discharge (GloFAS via Open-Meteo, test day) |
|---|---|---|---|---|---|
| Chao Phraya (Ayutthaya) | ThaiWater C.35 Ban Pom: 4.96 m MSL, bank 4.35 m, **+0.61 m over bank**, situation 5, observed Q 1,333 m³/s | Bank heights; situation level; 23 stations nationally at level 5 | **Yes** | ~1–2 h (C.35 12:00 ICT reading fetched 13:52 ICT; most stations at 13:00 ICT when fetched 14:02 ICT) | Requested point → minor channel, 1.8–3.4 m³/s; best cell in a 5×5 grid (14.275, 100.525) → **4,314 m³/s**, about 3× the gauge |
| Mekong | Thai-side tributary and main-stem stations in ThaiWater ("North Khong" 30, "Northeast Khong" 46 stations). MRC main-stem API returns 401; FFW page is HTML | ThaiWater bank levels; MRC alarm/flood levels on its site | Thai side **yes**; MRC no | ~1 h (ThaiWater) | Phnom Penh point → 3.5 m³/s; best grid cell (11.525, 104.925) → **28,248 m³/s**; Vientiane best cell → 6,025 m³/s |
| Jakarta | DSDA Posko Banjir XML, all gates incl. Katulampa (Depok and Manggarai expected; not individually checked) | Siaga 1–4 per gate + status | **Yes** | ~15 min (13:40 WIB reading fetched 13:52 WIB) | Ciliwung point → 4–12 m³/s (small basin; 5 km model is weak here) |
| Metro Manila | PAGASA FFWS JSON, 21 stations (e.g. Burgos 27.28 m vs alert 27.40 / alarm 27.90 / critical 28.40) | Alert/alarm/critical | No (POST, no CORS) | not measured | Marikina best cell → 65 m³/s (small basin; low confidence) |
| Kelantan | Public Info Banjir HTML (e.g. Sg. Lebir di Kuala Koh 63.17 m; thresholds 62 / 67 / 71 / 75 m) | Normal/Alert/Warning/**Danger (evacuation to be initiated)** | No | ~15 min–12 h per station | Kuala Krai point → 525 m³/s on 10 Oct rising to a modelled peak of ~1,137 m³/s on 14 Oct (forecast), then falling |

Column order for the Public Info Banjir values was inferred from the table header. Confirm it before shipping.

**Honest recommendation.**
1. For the demo, show **observed** levels where they are browser-callable: ThaiWater for Ayutthaya, DSDA for Jakarta, PUB alerts plus NEA rain for Singapore. Show each with its official threshold or status in the agency's own words.
2. For Kelantan and Metro Manila, capture a build-time snapshot (HISTORICAL SNAPSHOT, capture time shown) or link out. Do not scrape on every page load.
3. Use GloFAS only as **MODELLED CONTEXT**: "Modelled river discharge (GloFAS v4, 5 km), not a gauge reading and not a warning." Always grid-search: request a 5×5 block of points at 0.05° spacing in one call and take the cell with the highest median discharge. Without that, the API often returns a tributary cell (Ayutthaya came back as 2 m³/s, Phnom Penh as 3.5 m³/s). Show discharge relative to its own climatology (`river_discharge_median`, `_p75`, `_max`) rather than as an absolute, and never derive an alert level from it. The Ayutthaya comparison (4,314 modelled against 1,333 observed m³/s) is a good on-screen example of why the labels differ.
4. GDACS FL events (source "GLOFAS") can populate a regional "possible flood events" list labelled "Automatic model-based alert (GDACS), not an official national warning". At test time the 30-day query returned 30 FL/TC events in a 60–180° E box, including Indonesia (0.58 S, 100.61 E, West Sumatra, 10–12 Oct, Green).
5. Inundation extent (Copernicus GFM) needs an account. Treat it as roadmap.

---

## 5. Wind and haze anywhere (the design question)

**Question:** can one global open source give modelled wind direction and PM2.5 at any selected incident, so the zoomed view shows wind and haze drift for Merapi and Riau too, while NEA stays the observed ground truth for Singapore?

**Answer: yes, Open-Meteo, with three conditions.** It was verified live at Merapi, Riau and a 48-point Johor grid, browser-direct with no key. Two hosts (`api.open-meteo.com`, `air-quality-api.open-meteo.com`) share one JSON shape and one licence.

1. **It is modelled, and coarse for haze.** PM2.5 and AOD come from the CAMS global forecast. Over the 1.4° × 1.0° Johor box sampled at 0.2°, the 48 points returned only **16 distinct hourly series**, so the effective grid is about 0.4° (~45 km). Riau at 06:00 UTC: PM2.5 50.9 µg/m³, AOD 2.27, US AQI 131. Johor box: 38.6 to 69.2 µg/m³. A global model at this scale smooths and can misplace a smoke plume near its source, so it must never be called a reading. "Current" wind is a 15-minute model step, not an anemometer.
2. **Pick the right wind level per hazard.** At Merapi (grid elevation 2,863 m) at 07:00 UTC, the 10 m wind was **from 198° (SSW) at 12.7 km/h**, while 700 hPa (~3 km, summit level) was **from 46° (NE) at 18 km/h** and 500 hPa **from 56° at 38.9 km/h**. A 10 m arrow would point an ash plume almost the opposite way. Use 700 or 500 hPa for volcanic ash drift and 10 m for surface peat smoke (Riau), and print the level in the label.
3. **NEA stays the ground truth in Singapore.** Within NEA coverage, show NEA OBSERVED first and the Open-Meteo MODELLED value second, side by side. Never average them, and show the disagreement when they differ.

`DriftAssessment` is currently Singapore-specific (`bearingToSingaporeDeg`, `singaporeDownwind`). Generalise it to `downwindDeg` from the incident plus an optional list of named places checked within ±45° of downwind (Singapore, Kuala Lumpur, Pekanbaru, Yogyakarta). Keep the sentence "Illustrative drift using modelled wind, not a dispersion model."

**Labels needed (exact strings proposed):**
- Wind, modelled: `MODELLED · Wind at 10 m (or 700 hPa) from {dir} ({deg}°) at {kn} kn · Open-Meteo best-match weather model · valid {HH:MM} UTC · model value, not a station measurement`
- PM2.5, modelled: `MODELLED · PM2.5 {v} µg/m³ · CAMS global forecast (~45 km grid) via Open-Meteo · valid {HH:MM} UTC · not a monitor reading; not an official air-quality index`
- AOD, modelled: `MODELLED · Aerosol optical depth {v} (unitless) · CAMS`. Never show it as an AQI band.
- US AQI from Open-Meteo: do not show it. It is computed from modelled concentrations, and placing it next to NEA PSI invites confusion.
- NEA: unchanged (`OBSERVED · NEA station …`, PSI bands with NEA's own descriptors).
- Drift: `Illustrative drift using {source} wind at {level}; not a dispersion model.`

---

## 6. Haze visuals at local zoom (Johor / Singapore / Riau Islands)

Recommended stack, bottom to top. Each layer has its own mode label and can be toggled.

| Layer | Source | Rendering | Mode label |
|---|---|---|---|
| 1. Satellite underlay | GIBS WMS `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (daily, 250 m; latest available at test = 2026-10-12) cropped to the zoom bbox | Georeferenced JPEG under the basemap at about 70% opacity. Haze appears as a grey veil; the 12 Oct Johor crop showed cloud plus a uniform grey cast | `SATELLITE IMAGE · NOAA-20 VIIRS true colour · acquired {date} (one early-afternoon pass) · not today's air` |
| 1b. Optional: latest cloud | GIBS `Himawari_AHI_Band13_Clean_Infrared` (2 km, 10-min; latest 06:10 UTC at about 06:55 UTC) | Same bbox crop; toggle instead of VIIRS | `SATELLITE IMAGE · Himawari-9 infrared · {HH:MM} UTC` |
| 2. Satellite AOD (optional) | GIBS `MODIS_Combined_Value_Added_AOD` / `VIIRS_NOAA20_AOD_Deep_Blue_Land_Ocean` (daily, 2 km) | Semi-transparent colour layer. Our Johor crop was empty (no retrieval under cloud), so expect gaps | `SATELLITE RETRIEVAL · aerosol optical depth · {date} · gaps = cloud` |
| 3. Modelled haze field | Open-Meteo AQ, one request with a 0.2° grid (48 points for 1.4° × 1.0°) for `pm2_5` | Smooth interpolated raster or 3–4 contour bands at ≤ 40% opacity; never draw finer than the ~0.4° model can support; legend in µg/m³, not PSI | `MODELLED · PM2.5 (CAMS, ~45 km) · valid {time} UTC` |
| 4. Modelled wind | Open-Meteo forecast, same 48-point grid, `wind_direction_10m`, `wind_speed_10m` | Thin grey arrows (streamlet style) | `MODELLED · wind at 10 m · {time} UTC` |
| 5. Hotspots | ASMC NOAA-20 daily TXT, or FIRMS SE Asia 24 h CSV (snapshot; neither has CORS) | Small red points, no glow | `SATELLITE DETECTION · {sensor} · {date}` |
| 6. Observed stations | NEA PSI and PM2.5 regions (Singapore) | Solid points coloured by NEA's own PSI band | `OBSERVED · NEA · {time}` |
| 7. Observed wind | NEA 18 stations | Solid black arrows, distinct from the modelled grey | `OBSERVED · NEA station wind` |

**Johor station data (Malaysia DOE APIMS).** No open, documented, machine-readable endpoint was found. data.gov.my's realtime APIs are GTFS and Weather only. Its `air_pollution` data-catalogue item is a monthly national aggregate (e.g. `{"date": "2017-01-01", "pollutant": "CO", "concentration": 0.561}`), not station API values. The APIMS site (`https://eqms.doe.gov.my/APIMS/main`) is a JavaScript app. Its internal endpoints were not probed, per instruction. Recommendation: in Johor, show the modelled CAMS field and a clear link, "Official Malaysian readings: DOE APIMS", and do not imply that station data is shown.

**ASMC.** Machine-readable today: per-region daily NOAA-20 hotspot text files at `https://asmc.asean.org/files/msscommunity/hotspots/DailyJP1NOAA20.{sumatra|kalimantan|p_malaysia|singapore|thailand|…}.txt`. They are fixed-width, "Daytime High Confidence"; Sumatra had 142 hotspots for the 2026-10-12 06:55 UTC pass. CORS is limited to `https://asmc.asean.org`, so use a snapshot. The haze-and-air-quality page returned 404 at test. `hazeportal.asean.org` redirects (307). Its data was not explored.

**Satellite image on click (any APAC location).**
- **Best: NASA GIBS WMS GetMap** with a ±1° bbox around the click (example in Top 5 #4). No key, CORS `*`, crops server-side, and omitting `TIME` returns the latest frame. For "right now" use `Himawari_AHI_Band13_Clean_Infrared` (works day and night; ~45–60 min behind real time; twice-daily gaps around 02:40 and 14:40 UTC, visible in the layer's time list). For daytime context use `Himawari_AHI_Band3_Red_Visible_1km` (rendered over Merapi; one Johor request returned an empty 1.5 KB PNG, so fall back to band 13 on an empty image). For the clearest haze picture use `VIIRS_NOAA20_CorrectedReflectance_TrueColor` from yesterday. Note: GIBS has no Himawari true-colour layer (only Band 3, Band 13 and Air Mass).
- **JMA MSC Himawari images**: `https://www.data.jma.go.jp/mscweb/data/himawari/img/{area}/{area}_{band}_{HHMM}.jpg`. Areas include `se1`–`se4` and `fd`; bands include `tre` (true colour reproduction), `b13`, `snd`, `dst` and others. CORS `*`, 10-minute frames, real true colour that shows smoke well. These are fixed regional crops in their own projection, so use them as a "regional view" picture, not a lat/lon crop. Terms not reviewed; attribute JMA.
- **RAMMB/CIRA SLIDER**: `latest_times.json` gives 10-minute timestamps (06:20 UTC at about 06:57 UTC). Tiles are at `https://rammb-slider.cira.colostate.edu/data/imagery/YYYY/MM/DD/himawari---full_disk/geocolor/{YYYYMMDDhhmmss}/{zz}/{row}_{col}.png` in satellite projection. There is no CORS header, so `<img>` only, and a lat/lon crop needs projection maths. Terms not reviewed. Reference only.

---

## 7. Per-source notes

### Open-Meteo Forecast API
- Endpoint used: `https://api.open-meteo.com/v1/forecast?latitude=-7.54&longitude=110.446&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,temperature_2m&hourly=wind_speed_10m,wind_direction_10m,precipitation&forecast_days=1&past_days=1&timezone=GMT`
- Sample (Merapi):
  ```
  "elevation":2863.0, "latitude":-7.5571, "longitude":110.4163
  "current_units":{"wind_speed_10m":"km/h","wind_direction_10m":"°","precipitation":"mm"}
  "current":{"time":"2026-10-13T06:45","interval":900,"wind_speed_10m":12.2,"wind_direction_10m":197,"wind_gusts_10m":31.7,"precipitation":0.00}
  07:00 pressure levels: "wind_direction_700hPa":46,"wind_speed_700hPa":18.0,"wind_direction_500hPa":56,"wind_speed_500hPa":38.9
  ```
- Mapping: a new `ModelledContext` (or `WindSummary` with `basis: 'modelled'`, `stationCount: 0`, `consistency` not applicable). Direction is degrees FROM, the same convention as NEA. Convert km/h to knots (÷ 1.852) or request `wind_speed_unit=kn`.
- Caveats: times are UTC without `Z` when `timezone=GMT`, so append `Z`. Multi-location requests take comma-separated lat/lon and count one call per location. Terms: https://open-meteo.com/en/terms (non-commercial free tier, CC BY 4.0; commercial use needs a paid key).

### Open-Meteo Air Quality API
- Endpoint: `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=0.5&longitude=102.55&current=pm2_5,pm10,aerosol_optical_depth,dust,carbon_monoxide,us_aqi&hourly=pm2_5,pm10,aerosol_optical_depth&forecast_days=1&past_days=1&timezone=GMT`
- Sample (Riau):
  ```
  "latitude":0.5,"longitude":102.5
  "current_units":{"pm2_5":"μg/m³","aerosol_optical_depth":"","us_aqi":"USAQI"}
  "current":{"time":"2026-10-13T06:00","interval":3600,"pm2_5":50.9,"pm10":53.2,"aerosol_optical_depth":2.27,"dust":0.0,"carbon_monoxide":1387.0,"us_aqi":131}
  ```
- Mapping: a new `ModelledHaze` alongside `HazeReading` (which is NEA-shaped: PSI by region). Do not put modelled values into `HazeReading`.
- Caveats: per the provider's docs, Asia uses CAMS global (0.4°, 3-hourly, run every 12 h, 5-day forecast); Open-Meteo serves it hourly. The 11 km product is Europe-only. The docs require attribution to CAMS. Docs: https://open-meteo.com/en/docs/air-quality-api.

### Open-Meteo Flood API (GloFAS)
- Endpoint: `https://flood-api.open-meteo.com/v1/flood?latitude=14.35&longitude=100.56&daily=river_discharge,river_discharge_mean,river_discharge_max,river_discharge_median,river_discharge_p75&past_days=7&forecast_days=14`
- Sample:
  ```
  requested 14.35,100.56 -> cell 14.325,100.575: "river_discharge":[1.81,2.48,1.90,...]  (m³/s, a minor channel)
  5x5 grid, best cell 14.275,100.525: river_discharge [4314.19, 4082.19]
  Mekong, best cell 11.525,104.925: [28247.82, 27924.45]
  "daily_units":{"river_discharge":"m³/s"}
  ```
- Mapping: new context type `discharge` (m³/s), basis modelled. Do not use it as Observation evidence.
- Caveats: GloFAS v4 is 0.05°, daily, with a 30-day forecast updated daily and reanalysis from 1984. Parameters include `cell_selection` and `ensemble=true` (50 members). Licence and attribution per the docs page: https://open-meteo.com/en/docs/flood-api. Small urban rivers (Marikina, Ciliwung) are poorly resolved.

### Open-Meteo Historical (ERA5)
- `https://archive-api.open-meteo.com/v1/archive?latitude=-6.2&longitude=106.85&start_date=2026-10-01&end_date=2026-10-07&daily=precipitation_sum,wind_direction_10m_dominant&timezone=GMT` → `"precipitation_sum":[7.90,11.40,0.40,3.30,7.50,0.90,1.60]`. Reanalysis, so modelled. Useful for "rain in the last week" context in briefs.

### data.gov.sg (PUB flood alerts, NEA rainfall, 2-hour forecast)
- `https://api-open.data.gov.sg/v2/real-time/api/weather/flood-alerts` (the path `/v2/real-time/api/flood-alerts` is 404):
  ```
  {"datetime":"2026-10-13T14:46:54+08:00","item":{"type":"observation","readings":[],"isStationData":false},"updatedTimestamp":"2026-10-13T14:49:32+08:00"}
  25 records per page, "paginationToken":"b2Zmc2V0PTI1"
  ```
- `https://api-open.data.gov.sg/v2/real-time/api/rainfall`:
  ```
  "readingType":"TB1 Rainfall 5 Minute Total F","readingUnit":"mm", 89 stations
  {"timestamp":"2026-10-13T14:40:00+08:00","data":[{"stationId":"S218","value":0},...,{"stationId":"S40","value":0.2}]}
  ```
- `.../two-hr-forecast` also works (area forecasts).
- No PUB drain water-level endpoint was found (`/v2/real-time/api/water-level` is 404).
- Mapping: rainfall becomes Observation category `rainfall` (mm per 5 min), OBSERVED. Flood alerts become `OfficialWarning`.
- Rate limits: lower when not logged in, with 10-second windows (https://guide.data.gov.sg/developer-guide/api-overview/api-rate-limits). Licence: Singapore Open Data Licence.

### ThaiWater (HII)
- `https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load` (also `.../public/thailand_main`, 10.7 MB, too big; and `.../public/waterlevel_graph?...`).
- Sample (C.35 Ayutthaya):
  ```
  "waterlevel_datetime":"2026-10-13 12:00","waterlevel_msl":"4.96","waterlevel_msl_previous":"4.97","discharge":"1333.00","storage_percent":"104.49","situation_level":5
  "station":{"tele_station_oldcode":"C.35","tele_station_lat":14.3691,"tele_station_long":100.528732,"min_bank":4.35,"left_bank":5.06,"right_bank":6.209,"qmax":1159}
  "agency":{"agency_shortname":{"en":"RID"}},"basin":{"basin_name":{"en":"Chao Phraya Basin"}},"diff_wl_bank":"0.61"
  scale: >100 % red "overflowing bank" (level 5), >70 blue (4), >30 green (3), >10 yellow (2), ≤10 (1)
  graph: {"datetime":"2026-10-10 01:00","value":5.34,"discharge":1462}
  ```
- Mapping: new Observation category `water_level` (m MSL) for flood incidents, plus `GaugeReading` context with thresholds.
- Caveats: undocumented "public" API; no licence page found; ask HII or attribute "ThaiWater / Hydro-Informatics Institute". It echoes any `Origin` with `Allow-Credentials: true`, which works but is a lenient policy that could be tightened without notice, so keep a snapshot fallback. Field names mix Thai and English. Some stations carry `waterlevel_m` (local datum) instead of MSL.

### Jakarta DSDA Posko Banjir
- `https://poskobanjir.dsdadki.web.id/xmldata.xml`
  ```
  <NAMA_PINTU_AIR>Bendung. Cibalok - Gadog 1</NAMA_PINTU_AIR><LOKASI>Ciliwung</LOKASI>
  <SIAGA1>2100</SIAGA1><SIAGA2>1600</SIAGA2><SIAGA3>900</SIAGA3><SIAGA4>1</SIAGA4>
  <LATITUDE>-6.653375</LATITUDE><LONGITUDE>106.869567</LONGITUDE>
  <TANGGAL>2026-10-13T13:40:00+07:00</TANGGAL><TINGGI_AIR>-70</TINGGI_AIR><TINGGI_AIR_SEBELUMNYA>-85</TINGGI_AIR_SEBELUMNYA>
  <STATUS_SIAGA>Status : Normal</STATUS_SIAGA>
  ```
- Mapping: `water_level` Observation and `GaugeReading` with four thresholds plus `officialStatus`.
- Caveats: unit inferred as mm (see Top 5 #5); negative readings exist and mean below the gauge zero. Terms not stated. Treat as public information from Dinas Sumber Daya Air DKI Jakarta and attribute it.

### Malaysia Public Info Banjir (JPS)
- `https://publicinfobanjir.water.gov.my/aras-air/data-paras-air/aras-air-data/?state=KEL&district=ALL&station=ALL&lang=en` (HTML)
  ```
  Sg. Lebir di Kuala Koh (F1) | Gua Musang | Sungai Kelantan | Sg. Lebir | 13/10/2026 12:45 | 63.17 | 62.00 | 67.00 | 71.00 | 75.00
  Sg. Galas di Dabong (F1) | Kuala Krai | Sungai Kelantan | Sg. Galas | 13/10/2026 14:15 | 29.66 | 28.00 | 35.00 | 37.00 | 38.00
  Legend: Normal | Alert | Warning | Danger — "Danger Level: River level caused considerable flooding, evacuation to be initiated."
  ```
- Caveats: no CORS. The page loads a reCAPTCHA script (for login). The data table did not require it, but do not automate beyond a polite build-time snapshot. The page offers JSON/XLS/CSV export buttons, not tested.

### PAGASA Pasig-Marikina-Tullahan FFWS
- `POST https://pasig-marikina-tullahanffws.pagasa.dost.gov.ph/water/table_list.do` with body `ymdhm=YYYYMMDDhhmm` (GET returns 405)
  ```
  {"obscd":"11102203","obsnm":"Burgos","wl":"27.28","wl30m":"27.29","wl1h":"27.28","wl2h":"27.28","alertwl":"27.40","alarmwl":"27.90","criticalwl":"28.40"}
  {"obsnm":"Angono","wl":"12.04(*)","alertwl":null,...}   ("(*)" suffix meaning undocumented)
  ```
- Caveats: undocumented, no CORS, timezone of `ymdhm` assumed PHT. Reference or snapshot only.

### MRC Mekong
- `https://api.mrcmekong.org/` returns 401 (`application/problem+json`), so it needs credentials. `https://ffw.mrcmekong.org/` is HTML (station pages, bulletins).
- **Integrity note:** at test time the FFW page HTML contained links to unrelated third-party commercial sites, which is consistent with injected spam. Do not embed or fetch it from the app. Link users to `https://monitoring.mrcmekong.org/` or mrcmekong.org instead.

### BoM (Australia)
- KiWIS `http://www.bom.gov.au/waterdata/services?service=kisters&...` and `http://www.bom.gov.au/fwo/IDZ00056.warnings_qld.xml` both returned **403** to our scripted request. BoM is known to block non-browser clients. Do not work around it. Avoid for the hackathon; link to bom.gov.au warnings.

### data.gov.my (MET Malaysia)
- `https://api.data.gov.my/weather/warning`:
  ```
  {"warning_issue":{"issued":"2026-10-13T13:40:00","title_en":"Strong Winds and Rough Seas Warning"},
   "valid_from":"2026-10-10T00:00:00","valid_to":"2026-10-14T00:00:00",
   "text_en":"... THUNDERSTORMS WARNING Thunderstorms, heavy rain and strong winds are expected over the waters of ... Kelantan ... until 6:00 PM; Tuesday, 13 October 2026 ..."}
  ```
- `https://api.data.gov.my/weather/forecast?contains=Kota%20Bharu@location__location_name` returns Malay text forecasts.
- Caveats: timestamps have no offset (MYT, UTC+8). Areas are free text, so matching them to incidents needs a keyword list (state names). 4 requests/min (https://developer.data.gov.my/rate-limit). CC BY 4.0 (https://developer.data.gov.my/faq).

### BMKG
- Forecast: `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=31.71.03.1001`
  ```
  "lokasi":{"desa":"Kemayoran","lat":-6.1647,"lon":106.8454,"timezone":"Asia/Jakarta"}
  {"datetime":"2026-10-13T07:00:00Z","t":33,"tp":0.3,"weather_desc_en":"Sunny","wd_deg":31,"wd":"N","wd_to":"S","ws":12.7,"hu":52,"analysis_date":"2026-10-13T00:00:00"}
  ```
  It needs a Kemendagri adm4 village code (no lat/lon query), and BMKG must be credited (https://data.bmkg.go.id/prakiraan-cuaca/; 60 requests/min/IP). Confirm the `ws` unit against BMKG's docs before display.
- Nowcast warnings: RSS `https://www.bmkg.go.id/alerts/nowcast/id/rss.xml` → CAP, e.g. `https://www.bmkg.go.id/alerts/nowcast/id/CPD20261013002_alert.xml`:
  ```
  <identifier>2.49.0.1.360.0.2026.10.13.06.96.002</identifier><sent>2026-10-13T15:30:00+09:00</sent>
  <event>Hujan Lebat dan Petir</event><urgency>Immediate</urgency><severity>Moderate</severity><certainty>Observed</certainty>
  <effective>2026-10-13T16:00:00+09:00</effective><expires>2026-10-13T19:00:00+09:00</expires>
  <areaDesc>Papua Barat Daya</areaDesc><polygon>-0.880,131.756 -0.888,131.747 ...</polygon>
  ```
  No CORS; `Cache-Control: max-age=60`. Indonesian-language text. CAP polygons use `lat,lon` pairs.

### WMO SWIC
- `https://severeweather.wmo.int/v2/json/wmo_all.json` (515 KB, 1,024 items, `lastUpdated` 06:53 UTC):
  ```
  {"id":"urn:oid:2.49.0.1.702.0.2026.10.13.13.23.0","event":"Heavy Rain","headline":"HEAVY RAIN WARNING","sent":"2026-10-13 05:23:00","expires":"2026-10-13 07:00:00","areaDesc":"northern, western and central area(s) of Singapore","url":"sg-mss-en/2026/10/13/05/51/...xml"}
  {"id":"2.49.0.1.360.0.2026.10.13.06.21.003","event":"Hujan Lebat dan Petir","headline":"Hujan Lebat disertai Petir di Kep. Riau","expires":"2026-10-13 08:30:00","areaDesc":"Kep. Riau","capURL":"id-inatews-id/..."}
  ```
- Caveats: no CORS. The base URL for the relative CAP paths was not confirmed (`/v2/cap-alerts/...` returned 404). Good for a snapshot of "what official CAP warnings existed in the region at capture time".

### GDACS
- `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL,TC&fromDate=2026-09-13&toDate=2026-10-13&alertlevel=Green;Orange;Red`
  ```
  {"eventtype":"FL","eventid":1104225,"alertlevel":"Green","country":"Nepal","fromdate":"2026-10-11T01:00:00","todate":"2026-10-13T01:00:00","source":"GLOFAS",
   "url":{"geometry":"https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=FL&eventid=1104225&episodeid=1","report":"https://www.gdacs.org/report.aspx?..."}}
  ```
- Caveats: FL alerts are model-derived. Label them "automatic". Times have no offset (UTC per GDACS convention; confirm).

### JMA bosai
- `https://www.jma.go.jp/bosai/amedas/data/latest_time.txt` → `2026-10-13T15:40:00+09:00`; `.../amedas/data/map/20261013154000.json` (1,286 stations):
  ```
  "11001":{"temp":[18.0,0],"precipitation1h":[0.0,0],"windDirection":[10,0],"wind":[2.5,0]}
  ```
  `windDirection` is a 16-point code (multiply by 22.5° for degrees; 0 = calm). `wind` is in m/s. The second element is a quality flag. Station metadata: `.../amedas/const/amedastable.json`. Warnings: `.../warning/data/warning/130000.json`.
- Caveats: undocumented but stable endpoints. Japan only.

### HKO
- `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=en` (CORS `*`): `"rainfall":{"data":[{"unit":"mm","place":"Central & Western District","max":0}]}`. `dataType=warnsum` returned `{}` (no warnings in force).
- `https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv` (no CORS): `202610131440,Central Pier,Northwest,12,16` (compass point, km/h, gust).

### NASA GIBS
- WMS GetMap (Johor box): `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=0.6,103.2,2.2,104.6&WIDTH=560&HEIGHT=640&LAYERS=VIIRS_NOAA20_CorrectedReflectance_TrueColor&FORMAT=image/jpeg&TIME=2026-10-12` → 200, 20.7 KB JPEG, CORS `*`.
- Capabilities (5.3 MB, do not fetch in the app): `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml`.
  ```
  Himawari_AHI_Band13_Clean_Infrared  TileMatrixSet 2km  default 2026-10-13T06:10:00Z  PT10M
  Himawari_AHI_Band3_Red_Visible_1km  TileMatrixSet 1km  default 2026-10-13T06:10:00Z  PT10M
  VIIRS_NOAA20_CorrectedReflectance_TrueColor  250m  image/jpeg  default 2026-10-12  P1D
  MODIS_Combined_Value_Added_AOD  2km  default 2026-10-12
  ```
- WMTS REST template: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{row}/{col}.{jpg|png}`. One guessed tile index returned 400, so use WMS for simple bbox crops. Use the `epsg3857` endpoint if the map ever moves to Web Mercator.
- Attribution: NASA GIBS / ESDIS; Himawari data © JMA. NASA data policy: https://www.earthdata.nasa.gov/engage/open-data-services-software-policies

### NASA FIRMS, ASMC, WAQI, OpenAQ, NASA POWER
- FIRMS: `https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_SouthEast_Asia_24h.csv` (no key; no CORS; 670 KB). Header: `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight`. The area API needs a MAP_KEY, which was not requested.
- ASMC: see section 6. Sample: `Satellite: NOAA20 / Date & Time: 2026/10/12 06:55:00 / Total Hotspot Count: 142 (Daytime High Confidence) / 1  105.7154  -4.5084`.
- WAQI: `https://api.waqi.info/feed/geo:0.5;102.55/` → `{"status":"error","data":"Invalid key"}`. A token is needed.
- OpenAQ v3: `https://api.openaq.org/v3/locations?...` → 401 "A valid API key must be provided in the X-API-Key header."
- NASA POWER: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,WS10M,WD10M&...` → `WD10M` values like `-92700.0` (invalid) and a fill value `-999` for the latest day. Do not use it for wind.

---

## 8. Schema implications (proposal for the lead; `src/types.ts` is not edited here)

- **Add a basis field, orthogonal to `DataMode`:** `type ValueBasis = 'observed' | 'modelled' | 'forecast' | 'satellite_image' | 'satellite_detection' | 'official_warning'`. Every context object carries one, and the UI badge reads from it.
- **New Observation categories, flood incidents only:** `water_level` (m, with datum in `qualityNote`) and `rainfall` (mm over a stated period). Both are observed only. Modelled discharge, CAMS PM2.5 and model wind must stay **context**, never Observation evidence. `deriveReview` should not count them.
- **New context types:**
  - `GaugeReading { stationId, name, river, lat, lon, observedAt, levelM, datum, thresholds: {label, valueM, meaning}[], officialStatus: string | null, agency, sourceUrl, basis: 'observed' }`
  - `OfficialWarning { id, agency, event, severity, urgency, certainty, headline, areaDesc, polygons?: [lat, lon][][], sentAt, effectiveAt, expiresAt, guidanceText, officialUrl, language, format: 'CAP1.2' | 'json' | 'xml' | 'html' }`
  - `ModelledPointContext { basis: 'modelled' | 'forecast', provider, model, gridKm, validAt, windLevel: '10m' | '700hPa' | '500hPa', windFromDeg, windSpeedKnots, pm25?, aod?, dischargeM3s?, attribution }`
  - `SatelliteImageRef { layer, acquiredAt, bbox, url, attribution, basis: 'satellite_image' }`
- **Generalise `DriftAssessment`** from Singapore-only to downwind-from-incident plus named-place checks, with the wind source and level recorded.

---

## 9. Gaps and risks

- **No open, browser-callable official feed** for Malaysian river levels (PIB), Metro Manila (PAGASA), the Mekong main stem (MRC) or Malaysian station air quality (APIMS). The demo has to use snapshots or links for these, labelled as such.
- **Undocumented endpoints** (ThaiWater, JMA bosai, DSDA XML, PAGASA FFWS) can change or tighten CORS without notice. Every adapter needs a timeout and a bundled snapshot fallback, which is the existing NEA pattern.
- **Licence clarity:** ThaiWater, DSDA Jakarta, PIB, PAGASA and SWIC terms were not found or not reviewed. Attribute the agency on screen and do not redistribute bulk data. Open-Meteo's free tier is **non-commercial**. If ASEAN Watch becomes commercial, a paid key or self-hosting is required.
- **Modelled versus observed disagreement is large:** GloFAS at Ayutthaya was about 3× the RID gauge, and CAMS at about 45 km cannot resolve a peat-fire plume. Labels must make that obvious, and the UI must never colour a modelled value with an official band such as PSI or Siaga.
- **Wrong wind level is a real failure mode:** at Merapi, surface and summit-level winds were roughly opposite.
- **Timezones:** ThaiWater (ICT, no offset), MET Malaysia (MYT, no offset), PAGASA (assumed PHT), BMKG CAP (`+09:00` for a WIT region) and GDACS (no offset) all need explicit normalisation to UTC `Z`. Test each.
- **Rate limits:** data.gov.my is 4/min, BMKG 60/min/IP, Open-Meteo 600/min with each grid point counted, and data.gov.sg is lower when not logged in. Fetch once per session and cache.
- **Expired warnings:** CAP `expires` must be enforced. SWIC and snapshots will contain expired items.
- **Integrity:** the MRC FFW page contained injected-looking third-party links at test time. Do not embed it. All fetched text is untrusted: render it as text, never as HTML.
- **Not covered by a live test in this pass:** NASA GPM IMERG (needs Earthdata login), Japan MLIT river data, DFO archive, Copernicus GFM data endpoints (account), the populated PUB alert schema, and the MSS Singapore CAP feed URL.
