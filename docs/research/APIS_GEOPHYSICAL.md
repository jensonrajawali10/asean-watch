# Geophysical hazard APIs: volcano, earthquake, tsunami, sea level

Research for expanding ASEAN Watch beyond the simulated Merapi replay to the Pacific Ring of Fire and wider Asia-Pacific. Floods, river levels, wind and air quality are covered in a separate document.

**Method.** Every endpoint below was requested live with `curl` on 2026-10-13 between 06:49 and 07:04 UTC, with the header `Origin: http://localhost:5173`. "CORS yes" means the response carried `Access-Control-Allow-Origin: *`, so a browser can call it with no proxy. Raw samples (trimmed to 20 KB or less) are saved outside the repo in the session scratchpad under `api-research/geo/`. No accounts, keys or credentials were used. Where a source needed one, or blocked the request, the row says so.

**Design stance (from Jenson).** ASEAN Watch relays official warnings. It never issues its own evacuation call or alert level. Sources that publish authoritative warnings are ranked highest, and their messages should be shown verbatim with the issuer, issue time and a link to the official channel.

---

## 1. Summary table

Verdicts: **Integrate now** = browser-callable, no key, stable machine format. **Proxy/key** = useful, but needs a tiny proxy (no CORS), a key, or a build-time snapshot. **Reference only** = link out, do not ingest. **Avoid** = not worth the effort or the terms risk.

| # | Source | Hazard | Coverage | Key? | CORS? | Format | Latency (observed) | Licence / terms | Verified (UTC) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | BMKG InaTEWS tsunami warnings (`last30tsunamievent.xml`) | Tsunami warning (official) | Indonesia | No | Yes | XML in CAP 1.2 namespace, BMKG profile | As issued; files are rewritten within minutes | Cite BMKG as data source (required) | 200, 07:00 | **Integrate now** |
| 2 | BMKG InaTEWS quake feeds (`datagempa.json`, `lastQL.json`, `live30event.xml`, `last30event.xml`) | Earthquake (official), tsunami potential | Indonesia and surroundings | No | Yes | JSON, GeoJSON, XML (CAP-shaped) | `lastQL`: ~2 min after origin; `datagempa`: ~5 min | Cite BMKG | 200, 06:51 to 07:00 | **Integrate now** |
| 3 | BMKG Data Terbuka (`data.bmkg.go.id/DataMKG/TEWS/*.json`) | Earthquake (official) | Indonesia | No | Yes | JSON, XML | Updated per event; `max-age=60` | Cite BMKG and display it in the app; 60 requests/min/IP | 200, 06:51 | **Integrate now** |
| 4 | JMA bosai JSON (`quake`, `tsunami`, `volcano`) | Tsunami warning, volcano warning, earthquake (official) | Japan coasts and volcanoes; distant quakes listed | No | Yes | JSON | Minutes; `max-age=60` | JMA Public Data License v1.0, cite source | 200, 06:57 | **Integrate now** |
| 5 | JMA XML Atom feed (`eqvol.xml`) | Same, plus ashfall forecasts | Japan | No | Yes | Atom + JMA XML | Minutes | JMA Public Data License v1.0 | 200, 06:56 | Integrate later (Japanese text) |
| 6 | USGS Earthquake GeoJSON feeds and FDSN event API | Earthquake | Global | No | Yes | GeoJSON | Feed refreshed every minute; event below last updated 15 min after origin | US Government, public domain | 200, 06:50 | **Integrate now** |
| 7 | EMSC FDSN event API (`seismicportal.eu`) | Earthquake | Global | No | Yes | GeoJSON | Minutes; `max-age=15` | Licence page not verified (404 on guessed URL) | 200, 06:51 | Integrate now (secondary) |
| 8 | GeoNet NZ (`/volcano/val`, `/quake`, CAP quake Atom) | Volcano alert level (official), earthquake | New Zealand, Kermadecs | No | Yes | GeoJSON, CAP Atom | `max-age=10`; VAL has no timestamp | CC BY 3.0 NZ | 200, 06:52 | **Integrate now** |
| 9 | PTWC / NTWC (tsunami.gov Atom, CAP, event JSON, text bulletins) | Tsunami threat messages (official for US; advisory to national authorities elsewhere) | Pacific-wide (PTWC), US/Canada (NTWC) | No | **No** | Atom, CAP 1.2, JSON, text | As issued | US Government | 200, 06:54 to 07:03 | **Proxy/key** (proxy) |
| 10 | NWS alerts API (`api.weather.gov/alerts`) | Tsunami warnings for US states and territories | Includes Guam, CNMI, American Samoa, Hawaii | No | Yes | CAP as GeoJSON | Seconds; `max-age=5` | US Government | 200 (0 active), 07:00 | Integrate now (narrow coverage) |
| 11 | MAGMA Indonesia / PVMBG | Volcano alert level (official), VONA, 6-hourly reports | Indonesia (69 volcanoes listed) | API: **token required** (401) | HTML: Yes | HTML only for public; JSON API needs token | Reports every 6 h | Footer: "All Rights Reserved. MAGMA Indonesia" | 200 HTML / 401 API, 06:53 to 07:04 | **Reference only** (link out; ask PVMBG before scraping) |
| 12 | PHIVOLCS (earthquake, volcano bulletins, tsunami info) | Volcano alert level, earthquake, tsunami info (official) | Philippines | No | **No** | HTML only | As issued | Not checked | 200 HTML, 06:58 | **Reference only** |
| 13 | USGS HANS (`getElevatedVolcanoes`, `getCapElevated`) | Volcano alert level + aviation colour code (official) | US volcanoes incl. Northern Mariana Islands | No | Yes | JSON with CAP fields | As issued (daily updates) | US Government | 200, 07:01 | Integrate now (narrow APAC coverage) |
| 14 | KVERT (Kamchatka) | Aviation colour code (official) | Kamchatka, Kurils | No | **No** | HTML | Weekly / as issued | Not checked | 200 HTML (http), 07:01 | Reference only |
| 15 | Smithsonian GVP WFS (GeoServer) | Volcano catalogue (static) | Global | No | **No** | GeoJSON | Static | Terms page blocked (403) | 200, 06:58 | **Proxy/key** (snapshot at build time) |
| 16 | Smithsonian GVP Weekly Report RSS / CAP | Volcano activity reports | Global | — | — | — | — | — | **Blocked (HTTP 403 bot check)**, 06:58 | Avoid |
| 17 | Tokyo VAAC advisories | Volcanic ash advisory (official, aviation) | Japan, Philippines, Kamchatka, N. Pacific | No | Yes | HTML list + ICAO text advisories | As issued (`max-age=600`) | JMA Public Data License v1.0 | 200, 06:54 | Integrate now (parse text) |
| 18 | Darwin VAAC (Bureau of Meteorology) | Volcanic ash advisory (official, aviation) | Indonesia, PNG, Philippines (south), N. Australia | — | — | — | — | — | **Blocked (HTTP 403 Access Denied, Akamai)**, 06:53 | Reference only |
| 19 | NOAA AWC international SIGMET API (`hazard=va`) | Volcanic ash SIGMETs (aviation) | Global, incl. Indonesian FIRs | No | **No** (also no CORS on preflight) | JSON | `max-age=180` | US Government | 200, 06:53 | Proxy/key (proxy) |
| 20 | GDACS events API (`gdacsapi/.../geteventlist`) | Cross-hazard alert level (Green/Orange/Red impact estimate) | Global | No | Yes | GeoJSON | Earthquakes within ~1 h | RSS says "public domain"; CAP says "Copyright, GDACS" | 200, 06:55 | **Integrate now** |
| 21 | GDACS RSS / CAP files | Same | Global | No | **No** | RSS (762 KB), CAP RSS (7.3 MB, 10.6 s) | Same | Same | 200, 06:55 | Avoid (use the JSON API) |
| 22 | NASA EONET v3 (`category=volcanoes`) | Volcano events | Global | No | Yes | JSON (served as `application/rss+xml`) | **Stale**: newest volcano geometry 2026-06-15 | NASA open data | 200, 06:56 | Reference only |
| 23 | ReliefWeb API v2 | Disaster reports | Global | **Requires approved appname** (registration) | Yes | JSON | — | — | 403, 06:56 | Proxy/key (registration) |
| 24 | Pacific Disaster Center (`hpxml.pdc.org/public.xml`) | Cross-hazard, PDC's own severity | Global (752 active items) | No | Yes | XML (1.7 MB) | Minutes | Terms page blocked (403); unclear | 200, 06:57 | Reference only (until terms are clear) |
| 25 | IOC Sea Level Station Monitoring Facility (`service.php`) | Tide gauge water level | Global; 128 Indonesian sensor rows | No | Yes | JSON | ~6 to 11 min | Cite VLIZ/IOC (DOI 10.14284/482); no QC | 200, 06:55 | **Integrate now** |
| 26 | NOAA CO-OPS data API | Tide gauge water level | US incl. Guam, Pacific territories | No | Yes | JSON | ~9 min (Guam) | US Government | 200, 06:57 | Integrate now (narrow coverage) |
| 27 | NOAA NDBC DART (`realtime2/*.dart`) | Deep-ocean tsunami buoy | Pacific and Indian Ocean (40 APAC DARTs listed) | No | **No** | Fixed-width text | Standard mode: 15-min samples, ~35 min+ | US Government | 200, 06:58 | Proxy/key (proxy) |
| 28 | UHSLC ERDDAP fast delivery | Hourly sea level | Global | No | **No** | JSON | **~6 weeks** (newest 2026-08-31) | Not checked | 200, 06:57 | Reference only for tsunami |
| 29 | NASA FIRMS | Thermal hotspots (VIIRS/MODIS) | Global; SE Asia regional file | API: **requires MAP_KEY**; regional CSV: no key | **No** | CSV | Under 3 h; file modified 06:43 | NASA open data | CSV 200 / API 400, 07:00 | Proxy/key |
| 30 | Copernicus Data Space catalogue (Sentinel-5P SO2) | SO2 (satellite) | Global | Catalogue: no; download: account | Yes (catalogue) | OData JSON; data in NetCDF | ~1 h (NRTI) | Copernicus free and open | 200, 07:02 | Reference only |
| 31 | MIROVA | Volcanic thermal (MODIS/VIIRS) | Global | No | **No** | HTML / images | Hours | Not checked | 200 HTML, 07:00 | Reference only |
| 32 | MOUNTS | SO2, thermal, InSAR per volcano | Global (incl. Merapi 263250) | No | **No**, HTTP only | HTML with embedded Plotly JSON | Days | Not checked | 200 HTML, 07:00 | Reference only |

---

## 2. Official warnings for evacuation awareness

These are the feeds whose messages may legitimately tell people to move. ASEAN Watch should show them as an **OfficialNotice** context layer: issuer name, verbatim level and instruction text, issue time, expiry, and a link to the official channel. They must never enter `deriveReview` and must never be restyled into our own review states (Monitoring / Check observation / Review needed). Absence of a message must never be shown as an all-clear.

| Issuer and product | Threat level in message? | Affected coasts / zones? | Evacuation guidance? | Message time and expiry | Machine format | Browser-callable? | Official public channel |
|---|---|---|---|---|---|---|---|
| **BMKG InaTEWS** tsunami warning (stages PD-1 to PD-4) | Yes: `AWAS`, `SIAGA`, `WASPADA` per district | Yes: `<wzarea>` with province, district, level, estimated time; `<obsarea>` with observed heights at gauges | Yes: `instruction1..3` map each level to an action ("Awas": full evacuation; "Siaga": evacuation; "Waspada": stay away from beaches and riverbanks) | `sent` in local time with a `WIB` suffix (non-ISO, UTC+7). No `<expires>`; the end is announced by a PD-4 message ("dinyatakan telah berakhir") | XML in CAP 1.2 namespace with BMKG-specific elements | Yes | https://inatews.bmkg.go.id/ and https://www.bmkg.go.id/ |
| **BMKG** earthquake info (`autogempa`, `datagempa.json`) | Tsunami potential as text (`Potensi`), e.g. "Tidak berpotensi tsunami" | Felt intensity by district (`Dirasakan`) | `instruction` text (e.g. aftershock caution) | ISO UTC `DateTime` plus WIB local; no expiry | JSON / XML | Yes | https://www.bmkg.go.id/ |
| **PTWC** Pacific threat message (`WEPA40 PHEB`) and Guam/CNMI statements | Yes: forecast bands (>3 m, 1–3 m, 0.3–1 m, <0.3 m) by country | Yes: countries per band and an ETA table by coastal point | Advises "government agencies responsible for threatened coastal areas" to act; persons should follow national and local authorities. Explicitly "meant for national authorities" | CAP `<sent>`, `<onset>`, `<expires>` (information statement: onset + 1 h) | CAP 1.2, Atom, JSON, text | **No** (proxy) | https://www.tsunami.gov/ |
| **JMA** tsunami warning / advisory / forecast | Yes: per coastal forecast area, `Category.Kind` with English `enName` (Major Tsunami Warning, Tsunami Warning, Tsunami Advisory, Tsunami Forecast) | Yes: forecast areas with English names and `MaxHeight` | Not in this product; Japan's evacuation orders come from municipalities | `ReportDateTime`, `ValidDateTime` (expiry for forecasts), `+09:00` | JSON | Yes | https://www.jma.go.jp/bosai/map.html (English: https://www.jma.go.jp/jma/indexe.html) |
| **JMA** volcano warnings (`volcano/data/warning.json`) | Yes: e.g. "レベル２（火口周辺規制）" (Level 2, restrict crater area), codes 11–15 = Levels 1–5 | Yes: target municipalities | Yes, implicitly: Level 4 = elderly evacuate, Level 5 = evacuate (JMA level definitions); municipal response text per item | `reportDatetime` `+09:00`; in force until replaced | JSON (Japanese names only; English names via `volcano_list.json`) | Yes | https://www.jma.go.jp/bosai/map.html |
| **PVMBG / MAGMA** volcano level | Yes: Level I Normal, II Waspada, III Siaga, IV Awas | Per volcano; the report page names the districts (e.g. Merapi: Sleman, Magelang, Boyolali, Klaten) | Recommendations section exists on report pages but rendered empty in server HTML | 6-hourly report periods in WIB; list page has no per-volcano change date | HTML (open), JSON API token-only | HTML only (CORS open, fragile) | https://magma.esdm.go.id/ |
| **GeoNet** Volcanic Alert Level | Yes: level 0–5 and aviation colour code | Per volcano | No (NZ evacuation advice comes from civil defence) | **No timestamp** in `/volcano/val` | GeoJSON | Yes | https://www.geonet.org.nz/volcano |
| **PHIVOLCS** volcano alert level, tsunami information | Yes: alert level per volcano (seen in page header: Taal 1, Kanlaon 2, Bulusan 1, Pinatubo 0, Mayon 2) | Bulletins (not parsed in this session) | Not verified | HTML dates in PST | HTML only | **No** | https://www.phivolcs.dost.gov.ph/, https://tsunami.phivolcs.dost.gov.ph/ |
| **USGS HANS** (incl. Northern Mariana Islands Observatory) | Yes: alert level (ADVISORY/WATCH/WARNING) + colour code | Per volcano | No | `sent_utc`, CAP-style `cap_expires` | JSON | Yes | `notice_url` per item, e.g. https://volcanoes.usgs.gov/hans-public/notice/... |
| **NWS** CAP alerts (Guam, CNMI, American Samoa, Hawaii) | Yes (CAP event, severity) | Yes (`areaDesc`, zones) | Yes when issued (`instruction`) | `sent`, `expires` | CAP GeoJSON | Yes | https://www.weather.gov/ |
| **Tokyo VAAC** volcanic ash advisory | No public threat level; aviation product | Ash cloud area and forecasts at +6/+12/+18 h | No (aviation) | `DTG`, `NXT ADVISORY` | ICAO text in HTML | Yes | https://www.data.jma.go.jp/vaac/data/vaac_list.html |
| **GDACS** | Green/Orange/Red, an impact estimate, **not an official warning** | Country and ISO3 | No | `fromdate`, `todate`, `datemodified` | GeoJSON | Yes | https://www.gdacs.org/ |

**Ordering for relay, per hazard and country.** For a coast in Indonesia, BMKG is the authority and PTWC is advisory context. For Japan, JMA. For the Philippines, PHIVOLCS (link only, no feed). For US Pacific territories, NWS/PTWC. For New Zealand, GeoNet for volcanoes and NEMA/civil defence for tsunami (no NZ tsunami warning feed was tested). GDACS and PDC are aggregators and should be labelled as such.

---

## 3. Per-source notes

### 3.1 BMKG InaTEWS (tsunami and earthquake), Indonesia

Endpoints that worked (all `Access-Control-Allow-Origin: *`, Google Cloud Storage, `Cache-Control: no-cache`):

- `https://bmkg-content-inatews.storage.googleapis.com/last30tsunamievent.xml` — tsunami warning history (one `<alert>`, 30 `<info>` blocks, 359 `<wzarea>`, 157 `<obsarea>` in the sample).
- `https://bmkg-content-inatews.storage.googleapis.com/datagempa.json` — latest felt or significant quake as CAP-shaped JSON.
- `https://bmkg-content-inatews.storage.googleapis.com/lastQL.json` — latest automatic location as GeoJSON (string-typed numbers).
- `https://bmkg-content-inatews.storage.googleapis.com/live30event.xml`, `last30event.xml`, `last30feltevent.xml`.
- Tested and refused: `warningshake.json` (403 AccessDenied).

Sample (`last30tsunamievent.xml`, the 15 Aug 2026 M7.7 Flores Sea event):

```xml
<subject>Warning Tsunami PD-3.4</subject>
<wzarea><province>NTT</province><district>MANGGARAI BAGIAN UTARA</district><level>SIAGA</level><date>15-08-2026</date><time>05:02:23 WIB</time></wzarea>
<obsarea><location>BAKALANG-ALOR</location><loclatitude>-8.26</loclatitude><loclongitude>124.23</loclongitude><height>0.14</height><time>05:41 WIB</time></obsarea>
<instruction1>Pemerintah Propinsi/Kab/Kota yang berada pada status "Awas" ... evakuasi menyeluruh</instruction1>
```

Mapping: each message → `OfficialNotice` (issuer "BMKG InaTEWS", product = `subject`, `areas` from `wzarea`). Each `obsarea` → a `sea_level` observation with `value` = height (m), `unit` "m", `dataMode` "historical" or "live", `sourceName` "BMKG InaTEWS observed tsunami height", and the note that BMKG measured it, not us.

Caveats: timestamps are `2026-08-15T07:31:30WIB` and `DD-MM-YYYY HH:MM WIB`; normalise with +07:00. The element names are BMKG's own and do not follow strict CAP (no `<area>`, no `<expires>`). Different BMKG products give different magnitudes for the same event during the first minutes (06:42:29 UTC event: `live30event.xml` said M4.7 Sumbawa Region; `datagempa.json` said M4.1, Sumba Barat Daya), so always label which product a value came from. `lastQL.json` is automatic and preliminary.

### 3.2 BMKG Data Terbuka, earthquakes

- `https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json` (latest), `gempaterkini.json` (latest 15 M5.0+), `gempadirasakan.json` (latest 15 felt); XML twins exist (`autogempa.xml` checked).
- Terms on https://data.bmkg.go.id/gempabumi/: BMKG must be credited as the data source and shown in the app; access limit 60 requests per minute per IP.

```json
{"Tanggal":"13 Okt 2026","Jam":"11:00:21 WIB","DateTime":"2026-10-13T04:00:21+00:00",
 "Coordinates":"-9.45,113.95","Magnitude":"4.9","Kedalaman":"12 km",
 "Wilayah":"Pusat gempa berada di laut 141 km barat daya Jembrana",
 "Potensi":"Gempa ini dirasakan untuk diteruskan pada masyarakat","Dirasakan":"III Jember, II - III Kuta Selatan, ..."}
```

Mapping: new category `seismic` (`value` magnitude as number, `unit` "M", magnitude type unknown), or keep as a context layer. `Potensi` is the authoritative tsunami-potential statement and belongs in an `OfficialNotice`. Numbers are strings; `Coordinates` is "lat,lon" (note the order differs from GeoJSON).

### 3.3 JMA bosai JSON (Japan)

- Earthquakes: `https://www.jma.go.jp/bosai/quake/data/list.json` (255 KB).
- Tsunami list: `https://www.jma.go.jp/bosai/tsunami/data/list.json`; each item's `json` field names the detail file under `https://www.jma.go.jp/bosai/tsunami/data/`.
- Volcano warnings in force: `https://www.jma.go.jp/bosai/volcano/data/warning.json` (14 items at test time); volcano coordinates and English names: `https://www.jma.go.jp/bosai/volcano/const/volcano_list.json` (120 volcanoes). Join on volcano code.
- `volcano/data/list.json` returned 404.

Tsunami detail sample (10 Oct 2026 Central America M8.0, forecast for Japan):

```json
"Head":{"Title":"津波予報","ReportDateTime":"2026-10-10T03:37:00+09:00","ValidDateTime":"2026-10-11T20:00:00+09:00","enTitle":"Tsunami Forecast"},
"Item":[{"Area":{"Name":"北海道太平洋沿岸東部","Code":"100","enName":"EASTERN PART OF PACIFIC COAST OF HOKKAIDO"},
 "Category":{"Kind":{"Name":"津波予報（若干の海面変動）","Code":"71","enName":"Tsunami Forecast"}},"MaxHeight":{"TsunamiHeight":"<0.2"}}]
```

Volcano warning sample: `{"reportDatetime":"2021-03-08T14:00:00+09:00","eventId":"508","volcanoInfos":[{"type":"噴火警報・予報（対象火山）","items":[{"name":"レベル２（火口周辺規制）","code":"12",...}]}]}`.

Mapping: tsunami and volcano warnings → `OfficialNotice`. Earthquakes → `seismic` (`cod` packs lat/lon/depth as "+32.3+130.5+0/"; `mag` is a string). Caveats: volcano level names are Japanese only; show the JMA text with a fixed, reviewed English gloss for codes 11–15 only. JMA's terms require "Source: Japan Meteorological Agency website (URL)". Japan restricts third-party warnings, which is another reason to relay verbatim only.

### 3.4 JMA XML Atom feed

`https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml` (CORS open). At test time it held 26 scheduled ashfall forecasts (降灰予報（定時）), e.g. Tokachidake at Volcanic Alert Level 3 and Aso at Level 2, plus one hypocentre/intensity report. Each entry links to a full JMA XML document. Useful later; the bosai JSON above is easier for a hackathon.

### 3.5 USGS earthquakes

- `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson` (242 events, `max-age=60`).
- `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=-15&maxlatitude=25&minlongitude=90&maxlongitude=145&minmagnitude=4&orderby=time&limit=20`

```json
{"mag":5.1,"place":"119 km SSW of Gambiran Satu, Indonesia","time":1791864015768,"updated":1791864946040,
 "status":"reviewed","tsunami":0,"alert":null,"sig":400,"magType":"mb","url":"https://earthquake.usgs.gov/earthquakes/eventpage/us6000u1ye"}
geometry: [113.8887,-9.4473,10]   id: us6000u1ye
```

Mapping: `seismic`, `value` = mag, `unit` = "M" + `magType`, `observedAt` from `time` (ms epoch), `ingestedAt` from fetch time, `sourceUrl` = `url`. Caveats: `tsunami: 1` only means the event is large and in an oceanic region; it is **not** a tsunami warning. `alert` is the PAGER impact level, not an evacuation signal. The same event was reported by BMKG at 04:00:21 UTC as M4.9 and by USGS as M5.1 mb; show both with their sources rather than merging.

### 3.6 EMSC

`https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minlat=-15&maxlat=25&minlon=90&maxlon=145&minmag=4&limit=10&orderby=time` returns GeoJSON with `time`, `lastupdate`, `flynn_region`, `mag`, `magtype`, `unid`. Example: M4.8 mb Babuyan Islands, Philippines, 06:01:23 UTC, updated 06:27. Good second opinion for the Philippines where PHIVOLCS has no feed. Licence wording not verified this session.

### 3.7 GeoNet (New Zealand)

- `https://api.geonet.org.nz/volcano/val` — 12 volcanoes. At test time White Island (Whakaari) was level 2 (Yellow, "Moderate to heightened volcanic unrest"), Ruapehu level 1.
- `https://api.geonet.org.nz/quake?MMI=3` — GeoJSON with `publicID`, `time`, `magnitude`, `mmi`, `locality`, `quality`.
- `https://api.geonet.org.nz/cap/1.2/GPA1.0/feed/atom1.0/quake` — CAP Atom (CORS open).
- `https://api.geonet.org.nz/news/geonet` (JSON, `Accept: application/json`) for bulletins.

```json
{"acc":"Yellow","activity":"Moderate to heightened volcanic unrest.","hazards":"Volcanic unrest hazards, potential for eruption hazards.","level":2,"volcanoID":"whiteisland","volcanoTitle":"White Island"}
```

Mapping: VAL → `OfficialNotice` (level text verbatim). Caveat: VAL has **no issue time**, so show "retrieved at" and link to GeoNet bulletins. Licence CC BY 3.0 NZ, attribution "GeoNet".

### 3.8 PTWC / NTWC (tsunami.gov)

- `https://www.tsunami.gov/events/xml/PHEBAtom.xml` (PTWC) and `PAAQAtom.xml` (NTWC). Each Atom feed holds **only the latest product** (one entry). `PHEBrss.xml` is 404.
- Each entry links a CAP document, e.g. `https://www.tsunami.gov/events/PHEB/2026/10/09/26282001/1/WEGM42/PHEBCAP.xml`, an event JSON (`PHEB.json`) and a text bulletin.
- Pacific threat message text verified at `https://www.tsunami.gov/events/PHEB/2026/10/09/26282000/1/WEPA40/WEPA40.txt`.
- No `Access-Control-Allow-Origin` on any tsunami.gov response.

```
...PTWC TSUNAMI THREAT MESSAGE...
 THIS MESSAGE IS ISSUED FOR INFORMATION ONLY ... MEANT FOR NATIONAL AUTHORITIES IN EACH COUNTRY OF THAT SYSTEM.
  * TSUNAMI WAVES REACHING 1 TO 3 METERS ABOVE THE TIDE LEVEL ARE POSSIBLE ALONG SOME COASTS OF PANAMA.
    PUNTA MALA       PANAMA             7.5N  80.0W   1820 10/09
```

CAP fields: `identifier` PHEB-1-26282001, `sent`, `onset`, `expires`, `event` "Tsunami Information", `severity`, `urgency`, `certainty`, `area/circle`. Mapping: `OfficialNotice`. Caveats: needs a proxy or a build-time fetch; because the Atom feed keeps only the latest item, a poller must store each message or it will miss threat messages superseded by a later statement (that happened here: the M8.0 threat message was replaced in the feed by a Guam/CNMI information statement for a later M6.9). For APAC countries, PTWC advises national authorities; the public warning comes from BMKG, PHIVOLCS, JMA and others.

### 3.9 NWS alerts API

`https://api.weather.gov/alerts?event=Tsunami%20Warning,Tsunami%20Advisory,Tsunami%20Watch&limit=5` — 200, CORS open, CAP as GeoJSON, zero active alerts at test time. Covers Guam, CNMI, American Samoa and Hawaii. Use it for those territories only.

### 3.10 MAGMA Indonesia / PVMBG

- Level list (HTML): `https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas`. At test time: Level IV none; **Level III (Siaga): Anak Krakatau, Merapi, Semeru, Sinabung**; 23 at Level II; 42 at Level I.
- Merapi 6-hourly report (HTML, signed link from the list page): "Laporan Aktivitas Level III (Siaga) Merapi, Selasa - 13 Oktober 2026, periode 06:00 - 12:00 WIB", with visual observations and seismic counts (e.g. 19 rockfall events, 11 hybrid events).
- VONA (HTML): `https://magma.esdm.go.id/vona`.
- JSON API `https://magma.esdm.go.id/api/v1/...` → 401 `{"message": "Token not provided"}`. `/v1/vona/rss` → 403.

Caveats: the HTML is CORS-open, so a browser could parse it, but the footer reads "Copyright 2026 © All Rights Reserved. MAGMA Indonesia", there are no per-volcano timestamps on the list page, and report links carry signatures. Recommendation: link to MAGMA from the Merapi incident ("Official status: see PVMBG/MAGMA") and ask PVMBG about API access before ingesting. Showing a real Level III next to a simulated scenario also risks confusing viewers; if shown, it needs its own clearly separated, attributed box.

### 3.11 PHIVOLCS

`https://earthquake.phivolcs.dost.gov.ph/`, `https://wovodat.phivolcs.dost.gov.ph/bulletin/list-of-bulletin`, `https://tsunami.phivolcs.dost.gov.ph/` all return HTML only, gzip-encoded, no CORS. The bulletin page header lists alert levels; the tsunami page lists events with PHIVOLCS advisories (e.g. "Panama Tsunami Information # 1"). Link out only.

### 3.12 Smithsonian GVP

- WFS works: `https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json&count=5&CQL_FILTER=Country='Indonesia'` → `Volcano_Number`, `Volcano_Name`, `Primary_Volcano_Type`, `Last_Eruption_Year`, `Region`, point geometry. No CORS. Use a build-time script (like `scripts/build-region.mjs`) to snapshot an APAC catalogue into `data/`.
- Weekly Volcanic Activity Report RSS and CAP: **blocked (HTTP 403, "Smithsonian request verification" bot check)**. Not attempted further.

### 3.13 USGS HANS

`https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes` and `getCapElevated`. Four elevated volcanoes at test time, including **Ahyi Seamount (Northern Mariana Islands), ADVISORY / YELLOW**, sent 2026-10-08 23:31 UTC. CAP-style fields include `cap_severity`, `cap_urgency`, `cap_expires`, `notice_url`.

### 3.14 Volcanic ash advisories (VAAC)

- **Tokyo VAAC**, CORS open: list `https://www.data.jma.go.jp/vaac/data/vaac_list.html`; each advisory text at e.g. `https://www.data.jma.go.jp/vaac/data/TextData/2026/20261011_27202000_0264_Text.html`.

```
DTG: 20261011/2201Z  VAAC: TOKYO  VOLCANO: KANLAON 272020  PSN: N1025 E12308  AREA: PHILIPPINES
INFO SOURCE: HIMAWARI-9 PHIVOLCS  ERUPTION DETAILS: ERUPTION AT 20261011/2145Z FL090 EXTD NW REPORTED
OBS VA CLD: VA NOT IDENTIFIABLE FM SATELLITE DATA ...  NXT ADVISORY: NO FURTHER ADVISORIES=
```

  Mapping: fits the existing `ash` category as a qualitative record (`value` text, `unit` null). The volcano number after the name (272020) is the GVP number, so it joins our `Volcano.gvpNumber`. Parse the ICAO text fields by label.
- **Darwin VAAC** (covers Indonesia, including Merapi): **blocked (HTTP 403 Access Denied, Akamai)** at `http://www.bom.gov.au/aviation/volcanic-ash/`.
- **AWC international SIGMETs**: `https://aviationweather.gov/api/data/isigmet?format=json&hazard=va` returned VA SIGMETs for the Ujung Pandang FIR (Ibu, Dukono, Semeru) with polygons, flight level tops and validity. No CORS (not even on preflight). Needs a proxy. Aviation product, not a public warning.

### 3.15 GDACS

- `https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP` (current, 100 items, 135 KB).
- `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;VO;TS&fromDate=2026-09-13&toDate=2026-10-13&alertlevel=green;orange;red`

```json
{"eventtype":"EQ","alertlevel":"Orange","alertscore":2,"country":"Vanuatu","fromdate":"2026-10-08T09:00:07",
 "severitydata":{"severitytext":"Magnitude 6.3M, Depth:10km"},"url":{"report":"https://www.gdacs.org/report.aspx?eventid=1570077&episodeid=1738390&eventtype=EQ"}}
```

Caveats: alert level is a modelled humanitarian impact estimate. No volcano (`VO`) or tsunami (`TS`) events appeared in the last 30 days, so volcano coverage is thin. Timestamps have no zone suffix (treat as UTC, but confirm). Use the JSON API, not the 7.3 MB CAP file.

### 3.16 NASA EONET

`https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=20` works (CORS, `X-RateLimit-Limit: 60`), but the newest volcano geometry date was 2026-06-15. Its volcano source is the Smithsonian weekly report, whose feed is now behind a bot check. Treat as reference only.

### 3.17 ReliefWeb

`https://api.reliefweb.int/v2/disasters?appname=...` → 403 "You are not using an approved appname". Needs registration; not done.

### 3.18 Pacific Disaster Center

`https://hpxml.pdc.org/public.xml` (CORS open, 1.7 MB). Fields: `type_ID` (VOLCANO, EARTHQUAKE, TSUNAMI...), `severity_ID` (WARNING/WATCH/ADVISORY/INFORMATION), `latitude`, `longitude`, `hazard_Name`, `create_Date`, `last_Update`, `end_Date`. At test time it carried VOLCANO WARNING items for Semeru, Dukono, Ibu, Mayon, Taal and Aira. Caveats: the severity is PDC's own classification, not the observatory's; the non-`_hst` timestamps look like UTC values with a wrong `-10:00` suffix (e.g. `create_Date_hst` 2026-10-12T14:16:26-10:00 vs `create_Date` 2026-10-13T00:16:26-10:00); the terms page returned 403. Reference only.

### 3.19 Satellite thermal and SO2

- **FIRMS**: the open regional CSV `https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_24h.csv` (834 KB, no key, no CORS) has `latitude, longitude, bright_ti4, acq_date, acq_time, confidence, frp, daynight`. The area API needs a MAP_KEY (`Invalid MAP_KEY.`, 400). Maps to existing `thermal` (`frp` in MW). Needs a proxy or a build-time filter to a box around each volcano.
- **Copernicus Data Space catalogue** (CORS open): newest Sentinel-5P NRTI SO2 granule sensed 05:49–05:54 UTC, published 06:54 UTC. Data are NetCDF granules and downloads need an account. Reference only; it does confirm a real ~1 h latency for the `gas` story.
- **MIROVA** and **MOUNTS**: HTML only, no CORS; MOUNTS is HTTP only (mixed-content blocked on an HTTPS site) and embeds Plotly JSON with SO2 mass and thermal pixel counts for Merapi (263250). Link out from the Merapi incident as "independent satellite monitoring".

### 3.20 Sea level (see section 5 for the tsunami answer)

- **IOC SLSMF**: station list `https://www.ioc-sealevelmonitoring.org/service.php?query=stationlist&showall=all` (2.4 MB, 9.8 s, 2,392 rows, one row per sensor); data `https://www.ioc-sealevelmonitoring.org/service.php?query=data&code=cili&timestart=2026-10-13T06:00:00&timestop=2026-10-13T07:00:00&format=json&includesensors[]=rad`.

```json
[{"slevel":2.953,"stime":"2026-10-13 06:00:00","sensor":"rad"},{"slevel":2.945,"stime":"2026-10-13 06:01:00","sensor":"rad"}, ...]
station list row: {"Code":"cili","Location":"Cilacap","country":"IDN","Lat":-7.75,"Lon":109,"sensor":"rad","lasttime":"2026-10-13 06:44:00.000","lastvalue":2.754,"lastupdate":"2026-10-13 06:50:33.787"}
```

- **NOAA CO-OPS**: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=1630000&product=one_minute_water_level&datum=MSL&units=metric&time_zone=gmt&format=json&range=1&application=asean_watch_research` → Apra Harbor, Guam, 1-min data to MSL.
- **NOAA NDBC DART**: `https://www.ndbc.noaa.gov/data/realtime2/52406.dart` → `2026 10 13 06 00 00 1 1777.806` (year, month, day, hour, minute, second, type 1 = 15-min sample, water column height in m). Station list `https://www.ndbc.noaa.gov/activestations.xml`. Realtime files exist for 52401, 52402, 52404, 52405, 52406, 21416, 21418, 21419, 55012, 55015, 56001, 23401; 404 for 52403, 23461 and 54401.
- **UHSLC** ERDDAP `global_hourly_fast`: newest Cilacap and Prigi rows were 2026-08-31. Not real-time.

Mapping for all: new category `sea_level`, `value` metres, `unit` "m", and a `qualityNote` naming the datum ("station datum, raw, not quality controlled" for IOC; "MSL" for CO-OPS; "water column height" for DART).

---

## 4. Top 5 for the hackathon

Criteria: browser-callable without a proxy, no key, APAC coverage, highest demo value, with authoritative warnings first. All five follow the NEA pattern already in `src/lib/nea.ts`: try live with a 5 s timeout, fall back to a bundled real snapshot labelled HISTORICAL, never throw, and never feed `deriveReview`.

**1. BMKG InaTEWS and BMKG Data Terbuka (Indonesia tsunami warnings and earthquakes).** The only browser-callable, keyless feed found that carries an official tsunami warning with per-district levels, estimated arrival times, observed wave heights and evacuation instructions, and it covers the flagship country. Adapter: `loadBmkgContext()` fetches `last30tsunamievent.xml` and `datagempa.json` (plus `gempaterkini.json` for the map). Parse XML with `DOMParser`; convert `WIB` times to UTC `Z`. Output `OfficialNotice[]` (one per `<info>`, keeping `subject`, `headline`, `instruction1..3` verbatim and `wzarea` as areas) and `seismic` context points. Map layer: Indonesian districts under an active notice coloured by BMKG's own level words; a banner "Official BMKG InaTEWS message, issued HH:MM UTC, see inatews.bmkg.go.id". Bundle the 15 Aug 2026 Flores message as the historical fallback, which also makes a strong replay. Credit "Sumber data: BMKG" on screen as BMKG requires.

**2. JMA bosai JSON (Japan tsunami and volcano warnings).** Official, CORS-open, English area names in tsunami messages, and an explicit validity time. Adapter: fetch `tsunami/data/list.json`; for items newer than N days, fetch the `json` detail; output `OfficialNotice` per forecast area with `enName`, `Category.Kind.enName`, `MaxHeight`, `ReportDateTime` → `issuedAt`, `ValidDateTime` → `expiresAt`. For volcanoes, join `volcano/data/warning.json` to `volcano/const/volcano_list.json` on code to place markers; show the Japanese level name with a reviewed gloss for codes 11–15. Map layer: Japanese coasts and volcanoes in the zoomed Japan view.

**3. IOC Sea Level Station Monitoring Facility (tide gauges).** Directly answers Jenson's water-level question across Indonesia, the Philippines, Japan and the Pacific, CORS-open and keyless. Adapter: at build time, snapshot an APAC subset of the station list (code, name, lat, lon, sensor, status) into `data/` because the full list is 2.4 MB; at runtime, for the selected incident pick the nearest 1–3 stations whose `lasttime` is within 1 h, then fetch the last 3–6 h with `includesensors[]` set to the water-level sensor (exclude `bat`, `sw1`, `sw2`). Output `sea_level` observations (dataMode `live`) and a small sparkline in the detail panel labelled "Raw tide gauge, not quality controlled, includes the normal tide". For Merapi the nearest live gauges are Cilacap (`cili`) and Prigi (`prig`).

**4. USGS earthquake GeoJSON (Ring of Fire seismic layer).** The most reliable, public-domain, CORS-open quake source with consistent fields across all of APAC. Adapter: FDSN query with a bounding box for the current map view, `minmagnitude=4.5`, last 7 days. Output `seismic` points (`value` mag, `unit` "M " + magType, `sourceUrl` event page). Map layer: circles sized by magnitude. Show BMKG's value alongside for Indonesian events instead of merging. Never treat `tsunami: 1` as a warning.

**5. GDACS events API (APAC cross-hazard alert layer).** Gives one CORS-open feed covering countries with no machine-readable national feed (Philippines, PNG, Vanuatu) and a familiar Green/Orange/Red scale. Adapter: `geteventlist/SEARCH` for EQ, VO and TS over the last 30 days, filtered to an APAC box; output map markers with `alertlevel`, `severitytext` and the GDACS report link, labelled "GDACS impact estimate, not an official warning". Context only.

Next in line, all CORS-open: GeoNet VAL (official, NZ; no timestamp), USGS HANS (Ahyi Seamount, CNMI), Tokyo VAAC text (fits our existing `ash` category and joins on GVP number), NOAA CO-OPS (Guam and US Pacific gauges), NWS CAP alerts (US territories).

---

## 5. Tsunami: can we show live water levels near a selected APAC location?

**Yes, for tide gauges; only through a proxy for DART buoys.**

- **Source.** IOC SLSMF is the practical choice. It is CORS-open, keyless, and has dense coverage where we need it (128 Indonesian sensor rows, plus the Philippines, Japan, Taiwan, Australia, New Zealand and Pacific islands). NOAA CO-OPS adds US Pacific stations (Guam verified) with MSL datum and also allows browser calls.
- **Latency.** Cilacap radar gauge: last sample 06:44 UTC, ingested by IOC at 06:50:33, fetched by us at 06:55, so about 6 min from measurement to IOC and about 11 min end to end. Cilacap and several other Indonesian gauges report 1-minute samples. Guam (CO-OPS): sample 06:48 UTC, fetched about 06:57, about 9 min.
- **DART.** NDBC realtime files are not CORS-open, so they need a proxy. In normal mode they give 15-minute samples of water column height (about 1,778 m at 52406); the 06:00 UTC sample appeared in a file modified at 06:35. A tsunami shows as a few centimetres in that number, and buoys switch to 15-second and 1-minute samples only after a trigger. The nearest DARTs to Southeast Asia are in the Philippine Sea (52404, 52405), the Bay of Bengal (23401, 600 NM WNW of Phuket) and off north-west Australia (56001, 56003). IOC also lists some DARTs (sensor `prt`), but the two near Indonesia and Thailand were stale (last data 2013 and 2026-08-05).
- **Authoritative observed heights.** For Indonesia, BMKG's own warning messages already include observed tsunami heights at named gauges (`<obsarea>`), which is better for relaying than our own reading of raw gauges.

**Caveats to show in the UI and the brief:**

1. IOC data are raw and unchecked; IOC's disclaimer says data are "provided as received" and accepts no liability. Values sit on each station's own datum and include the normal tide (Cilacap fell about 0.5 m in 1 h 44 min from tide alone), so a plain line chart can look alarming. Label it as raw and do not compute anomalies from it.
2. Station status changes often. Many listed Indonesian stations are stale (Sadeng 2023, Pangandaran 2023), `lastvalue` uses -999 as a no-data sentinel, and some codes report only battery voltage (`bat`, unit V). Filter by `lasttime` and sensor.
3. Gauges confirm a tsunami; they do not warn ahead of it. A tsunami from a nearby source can arrive before the next gauge sample reaches IOC. The app must never infer a tsunami, or the absence of one, from gauge data. The only valid signal to people is the official warning from BMKG, JMA, PTWC (via national authorities), PHIVOLCS or NWS.
4. Citation: "Flanders Marine Institute (VLIZ); Intergovernmental Oceanographic Commission (IOC) (2026): Sea level station monitoring facility. Accessed at https://www.ioc-sealevelmonitoring.org on <date> at VLIZ. DOI: 10.14284/482".

---

## 6. Schema implications (for the lead)

The current contract has no runtime network calls apart from the NEA layer, and five categories (thermal, gas, deformation, ash, report). Proposed, for the lead to decide:

- New observation categories: `seismic` (value magnitude, unit "M" plus type) and `sea_level` (metres, with the datum in `qualityNote`). Ash advisories and FIRMS hotspots fit existing `ash` and `thermal`.
- A separate `OfficialNotice` context type, not an `Observation`: `id` (issuer's id), `issuer`, `hazard`, `product`, `levelText` (verbatim), `areas[]` (name, level text, ETA), `issuedAt`, `expiresAt | null`, `instructionText | null` (verbatim), `officialUrl`, `sourceUrl`, `retrievedAt`, `dataMode` (`live` | `historical`). Like `NeaContext`, it never enters `deriveReview`.
- Every loader follows `loadNeaContext()`: live with a timeout, then a bundled real snapshot, never throws.

---

## 7. Gaps and risks

1. **Liability and staleness.** Relaying warnings means a cached or failed fetch can show an out-of-date message. Always show issue time, age and expiry; when a fetch fails, say "could not reach BMKG, check inatews.bmkg.go.id" rather than showing nothing. Never show "no active warnings" as an all-clear.
2. **PTWC/NTWC need a proxy**, and their Atom feeds keep only the latest product, so a poller must store each message. Without a backend this is a build-time snapshot at best.
3. **No machine-readable feed for PHIVOLCS**, and MAGMA's API needs a token while its HTML says "All Rights Reserved". The two most relevant ASEAN volcano authorities are link-only for now. Merapi's real status (Level III Siaga at test time) can only be linked, not ingested, without PVMBG's agreement.
4. **Darwin VAAC is blocked** (Akamai 403), and it is the VAAC for Indonesia. AWC VA SIGMETs cover Indonesian FIRs but need a proxy.
5. **Smithsonian weekly reports are behind a bot check**, which also leaves NASA EONET's volcano stream stale.
6. **Timestamp traps:** BMKG `...WIB` suffixes (UTC+7) and `DD-MM-YYYY`; JMA `+09:00`; PHIVOLCS PST (UTC+8); PDC UTC values with a `-10:00` suffix; GDACS times without a zone; GeoNet VAL with no time at all. `validateObservations` rejects non-UTC timestamps, so every loader must normalise.
7. **Conflicting numbers between agencies** (USGS M5.1 vs BMKG M4.9; BMKG M4.7 vs M4.1 for the same event across products). Show each with its source; never average.
8. **Language.** JMA volcano levels are Japanese only; BMKG messages are Indonesian. Show the original text and a fixed, reviewed gloss; do not machine-translate warnings on the fly.
9. **Terms not confirmed:** EMSC (licence page not found), GVP (terms page 403), PDC (terms page 403), MIROVA and MOUNTS (not checked), GDACS (feeds say both "public domain" and "Copyright, GDACS").
10. **CORS results are a snapshot.** They were taken with `Origin: http://localhost:5173`; a deployed origin should be re-tested. Rate limits: BMKG 60 requests/min/IP; EONET advertises `X-RateLimit-Limit: 60`; CO-OPS asks for an `application` parameter.
11. **Large payloads:** IOC station list 2.4 MB, GDACS CAP 7.3 MB, PDC 1.7 MB, FIRMS SE Asia CSV 834 KB. Snapshot or filter at build time.
12. **Mixing real and simulated data.** A live real alert next to the simulated Merapi replay could be read as part of the scenario. Keep official notices in a visually separate, clearly attributed panel with LIVE or HISTORICAL labels.
