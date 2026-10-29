# Data and limitations

What ASEAN Watch shows, where each item comes from, how it is labelled, what it cannot tell you, and what an operational service would need. Bracketed numbers refer to the [references](#references). Record-level provenance and field mapping are in [`data/SOURCES.md`](../data/SOURCES.md).

Everything shown is real. The earlier simulated Merapi scenario and the Ayutthaya flood example were removed on 13 October 2026.

## Four layers, kept apart

| Layer | What it is | Can it change a workflow state? |
|---|---|---|
| **Evidence** | Satellite hotspots and earthquake reports near a watch area, from the bundled snapshot | Yes, through the stated watch rules |
| **Workflow state** | Monitoring, Check observation or Review needed, derived from the evidence | It is the state, and it is an analyst prompt, not an alert level |
| **Official warnings** | Agency messages relayed verbatim | No. Shown in a separate, reserved style |
| **Context** | NEA Singapore wind and haze | No. Labelled "context only" |

## Watch areas

| Watch area | Centre | Area | Source of the centre |
|---|---|---|---|
| Merapi | -7.54, 110.446 | 5 km thermal and 30 km seismic radius | Smithsonian GVP 263250 [4] |
| Semeru | -8.108, 112.922 | same | GVP 263300 |
| Anak Krakatau | -6.1009, 105.4233 | same | GVP 262000 (Krakatau). The GVP catalogs Anak Krakatau under Krakatau; the watch uses that entry's point, which may not mark the active cone exactly. |
| Sinabung | 3.17, 98.392 | same | GVP 261080 |
| Riau peatland hotspots | 0.50, 102.55 (Siak-Kampar peatlands) | Box: latitude -0.5 to 1.6, longitude 101.0 to 103.2 | Chosen to exclude Malaysian and Singapore land. It approximates the Riau mainland; province boundaries were not checked. |

The four volcanoes were chosen because MAGMA Indonesia listed them at Level III (Siaga) on 13 October 2026.

## Satellite and ground signals

USGS identifies four principal types of satellite observation for volcanoes: deformation, gas emissions, thermal anomalies and ash plumes [1]. This build uses only those with an open, keyless, machine-readable source.

| Signal | Candidate source | This build |
|---|---|---|
| Thermal anomaly | NASA FIRMS VIIRS 375 m (Suomi NPP, NOAA-20, NOAA-21) and MODIS 1 km [6] | **Used.** 7-day South East Asia CSVs, filtered to the watch areas. |
| Earthquakes (category `seismic`) | USGS ComCat; BMKG Data Terbuka and InaTEWS lists | **Used.** No event fell within range of any watch area in the current snapshot. |
| Volcanic gas (SO2) | Sentinel-5P [5] | **Not shown.** There is no open, keyless numeric feed; Copernicus downloads need an account and NetCDF processing. Each volcano links to MOUNTS (independent research, not official). It is never filled with modelled values. |
| Ground deformation | Sentinel-1 radar and InSAR [2][3] | **Not shown.** MOUNTS link only. |
| Ash | Volcanic Ash Advisory Centres | **Not evidence.** Tokyo VAAC advisories are relayed as official aviation messages (see Official warnings), never as watch-area evidence. VAAC Darwin, which covers the four watched volcanoes, is linked only. |

## The snapshot

| | |
|---|---|
| Retrieved | 2026-10-13T07:26:44Z |
| Window | 2026-10-07T00:00Z to the retrieval time: the last 7 UTC days, with the final day incomplete |
| Replay | One step per UTC day, oldest first. Records accumulate from day to day. |
| Refresh | `npm run refresh:data`, or `npm run refresh:all` for every snapshot. Rebuild afterwards. |

- **Collection vs rule.** The refresh keeps hotspots within 10 km and earthquakes within 50 km, then the watch rules apply the tighter 5 km and 30 km radii.
- **All or nothing.** `refresh:data` and `refresh:nea` write nothing unless every source succeeds. `refresh:warnings` keeps the previous entry for any feed that fails, and writes nothing (exit code 1) if every feed fails. Every capture script writes through a temporary file and a rename, so an interrupted run never leaves a half-written snapshot.
- **Times.** `observedAt` is the provider's own observation time, converted to UTC. `ingestedAt` is the Last-Modified time of the file or response the record came from (when the provider last wrote it), falling back to the retrieval time. Both are shown separately.
- **Identifiers.** Record ids come from the provider's event id, or from watch, source, time and coordinates. No granule, scene or orbit identifier is invented. `sourceUrl` points to the product page or the event's own page.

## Watch rules

Defined in `src/lib/watchRules.ts`. The rule text travels with each flagged record and appears in "Why this state?" and the brief. Every rule is **an illustrative watch rule, not an official threshold**.

- **Thermal, volcano:** a FIRMS hotspot within 5 km of the GVP summit point with VIIRS confidence nominal or high, or MODIS confidence 50 or more. Low-confidence hotspots are shown but not flagged.
- **Thermal, haze box:** hotspots inside the box are totalled per sensor per UTC day. A day with 10 or more confident hotspots from one sensor is flagged.
- **Seismic:** a USGS or BMKG earthquake within 30 km of the summit (or inside the box) is shown; M 3.0 or more is flagged, and smaller events are context. Reports of one event from different agencies or products are each shown and never merged or averaged.

**Workflow state.** The state counts the distinct categories among flagged records visible up to the current day. None gives Monitoring, one gives Check observation, and two or more give Review needed. A later record from an already counted category is shown with the reason that it is not independent corroboration.

**Current result.** In the 13 October snapshot, every watch area reads Check observation on every day, from thermal evidence alone. Records accumulate over the replay, so a flagged hotspot early in the week keeps the state. Merapi, for example, has qualifying hotspots on 7 to 11 October and none on 12 or 13 October; Sinabung only on 7 and 8 October. Review needed would require a second category. No earthquake fell within range, and no gas feed exists, so it does not occur. Nothing is staged, and a refresh can change the result.

## Official warnings (evacuation awareness)

ASEAN Watch exists to make people aware of potential evacuation. It does this **only by relaying official warnings** from the agencies with authority, and never by issuing its own.

| Issuer | Product | How it arrives |
|---|---|---|
| BMKG InaTEWS (Indonesia) | Tsunami warnings; earthquake information | Live in the browser, snapshot fallback |
| Japan Meteorological Agency | Tsunami and volcano warnings | Live, snapshot fallback |
| GeoNet (GNS Science, New Zealand) | Volcanic alert levels | Live, snapshot fallback |
| US National Weather Service | Tsunami alerts for Hawaii, Guam, CNMI, American Samoa | Live, snapshot fallback |
| ThaiWater (Hydro-Informatics Institute; RID gauges) | River gauges at situation level 5 ("overflowing bank") | Live, snapshot fallback |
| Dinas Sumber Daya Air DKI Jakarta | Floodgate levels and Siaga status | Live, snapshot fallback |
| PUB Singapore (via data.gov.sg) | Flood alerts | Live, snapshot fallback |
| PVMBG via MAGMA Indonesia | Volcano activity level (Level III Siaga for the four volcanoes) | Bundled record from the public level list, retrieved 2026-10-13T06:52:03Z. The API is token-only, and no refresh updates it. |
| GDACS | Cross-hazard impact estimates | Live, snapshot fallback. An **aggregator**, labelled as an estimate, not a warning |
| Tokyo VAAC (Japan Meteorological Agency) | Volcanic Ash Advisories for aviation: Japan, the northern Philippines, the Kuril Islands and Kamchatka | Live through the relay `/api/vaac` (10-minute cache), snapshot fallback. The newest advisory per volcano issued in the last 24 hours, text word for word. An **aviation product**, not a public warning |
| VAAC Darwin (Bureau of Meteorology) | Volcanic Ash Advisories for aviation: Indonesia, Papua New Guinea, the southern Philippines | **Linked only**, on each volcano card, in the Warnings section and in Sources. See "Volcanic ash advisories" below |

Relay rules:

- **Verbatim.** Issuer, level, headline, affected area, issue time, expiry and any instruction are copied from the message, with only outer whitespace trimmed. Each item links to the issuer ("Follow <issuer>").
- **No re-scoring.** Levels are never ranked against each other, merged, translated on the fly, or restyled as workflow states. A fixed, reviewed gloss explains an unfamiliar scale. For example, MAGMA Level III is "Level 3 of 4 (Alert)", and DSDA's Siaga 1 is its most severe level.
- **Absence is not safety.** A failed feed reads "Official feed unavailable: check <issuer> directly". An empty list says "This is not an all-clear". Expired or ended messages are labelled with their time.
- **Mode.** LIVE means fetched in this session. HISTORICAL means a bundled snapshot with its original times, and it must never look current.
- **Near a watch area** means within 150 km. With nothing selected, the panel lists every relayed item in the Asia-Pacific.

### Volcanic ash advisories

A Volcanic Ash Advisory (VAA) is an aviation product of the ICAO International Airways Volcano Watch. It tells pilots and airlines where volcanic ash is, or is forecast, in the air. It is not a public warning and gives no instruction to people on the ground. Every advisory shown carries that note.

- **Tokyo VAAC is relayed.** Source: the advisory list <https://www.data.jma.go.jp/vaac/data/vaac_list.html> (HTML, about 170 KB, about two months of advisories) and the text page each row links, e.g. `TextData/2026/20261029_28208001_0332_Text.html`. Both answer browser calls (`Access-Control-Allow-Origin: *`) and are cached for ten minutes (`max-age=600`). Terms: JMA Website Terms of Use, Public Data License (Version 1.0), compatible with CC BY 4.0, source cited.
- **Why a relay, although CORS is open:** one advisory takes two downloads, and every open tab would repeat them every five minutes. `/api/vaac` builds the set once and keeps it at the Vercel CDN for ten minutes, like JMA's own cache.
- **What is shown:** the newest advisory per volcano issued in the last 24 hours, judged again on the visitor's clock, so a saved copy never looks current. Earlier advisories in a series are superseded. The whole text is shown as issued, with the issuing VAAC, the issue time (`DTG`) and a link to the advisory's page. An advisory whose `NXT ADVISORY` line says `NO FURTHER ADVISORIES` is labelled ENDED; nothing else ends one. Only texts that say `VAAC: TOKYO` are relayed.
- **Where:** in the Warnings section under "Volcanic ash advisories (aviation)", Southeast Asia when the advisory's `AREA` is an ASEAN country (the Philippines), otherwise the wider Asia-Pacific; and on a volcano card when an advisory names that volcano by its Smithsonian number. Advisories are never drawn as warning pins on the map, never counted as a volcano's alert level, and never change a workflow state. They do count in the alerts button's number of official messages in force.
- **VAAC Darwin is linked only** (checked 14 and 30 October 2026). Darwin covers Indonesia, including Merapi, Semeru, Anak Krakatau and Sinabung. Its advisory page <https://www.bom.gov.au/aviation/volcanic-ash/darwin-va-advisory.shtml> fills its list from an internal endpoint; to a script that names itself, the Bureau answers that its website "does not support web scraping" and blocks it. The Bureau's copyright notice <https://www.bom.gov.au/copyright> forbids scraping and, where no other terms are stated, allows personal or in-house use only, "You must not supply it to any other person". The advisory page states no other terms and says the information is "produced solely for use by the aviation industry". The anonymous FTP has only the graphical advisories, not the text, and the Registered User service is paid. Copies on JMA's "Darwin VAAC Backup" page and NOAA's tgftp server carry Darwin's own text, which is still the Bureau's.
- **None shown is not an all-clear.** In particular, no Tokyo advisory says nothing about Indonesia.

Example from the bundled snapshot: ThaiWater gauge C.35 (Ban Pom, Phra Nakhon Si Ayutthaya, Chao Phraya basin) read 4.97 m MSL, at 104.56% of bank capacity, at 13:00 ICT on 13 October 2026, situation level 5, "overflowing bank". A ThaiWater situation level is a gauge category, not an evacuation order.

## NEA Singapore context

- **Source:** NEA wind direction, wind speed, PSI and PM2.5 from data.gov.sg (18 wind stations). Fetched live, falling back to the bundled snapshot.
- **Role:** context only. It never enters the workflow state.
- **Coverage:** shown only for watch areas within 600 km of Singapore. In this build, that means Riau.
- **Drift:** distance, bearing and downwind direction from Riau, plus whether Singapore lies within ±45° of downwind. Labelled "Illustrative haze drift using Singapore station wind, not a dispersion model".
- **PSI:** shown with NEA's own band words, source and reading time.

## Label policy

- **Header recency line:** "Real data · satellite snapshot <time> UTC · official warnings relayed verbatim · not an official warning service".
- **Mode labels in text, never colour alone:** HISTORICAL SNAPSHOT (with its time), LIVE (with the reading time), and MODELLED (reserved; no modelled data is used).
- **Workflow states** always carry the note "not an official alert level" and never say "evacuate".
- **Official items** use a reserved style that our own states never use. GDACS uses a separate dashed "impact estimate" style.
- **Provenance:** every record, card and warning shows its source and time.

## Expected update intervals

Each source has an expected update interval. When its data is older than that interval plus an allowance, the app says so in plain words: "Older than expected: last update 9 h ago, usually hourly." An official feed that has not answered for an hour reads "Feed quiet for N h: no update has reached this page, so messages may be missing. Check <issuer> directly." Neither is ever an all-clear.

The flag appears in four places: each row of Sources & methods, the Sources summary figures, the Overview's "Data freshness and gaps", and the header chip beside the forecast time when the map's air-quality forecast is past its interval. When the forecast is past its interval, the headline says "Older model run" and the scrubber says "older run", never "now". The official warnings panel's feed list also names quiet feeds.

Ages are measured against the page clock (`src/lib/useNowMs.ts`), which ticks every 5 minutes, when the tab becomes visible and when the browser comes back online. An age is flagged only when it is strictly past the interval plus the allowance. Times slightly ahead of the page clock (up to 5 minutes) count as age zero. Times further ahead are not judged.

A feed counts as quiet from the last time it answered on this page. One failed refresh therefore does not read as days of silence: the panel already says the feed fell back to its saved copy. A feed being asked again is not called quiet until the answer is in. An unavailable feed keeps its own sentence, "Official feed unavailable: check <issuer> directly".

The table lives in `src/lib/staleness.ts` (`UPDATE_INTERVALS`). A test checks that every row below matches it.

| Id | Source | Usually | Flagged after | Time checked | Why | Provider's page |
|---|---|---|---|---|---|---|
| `nea-haze` | NEA Singapore PSI and PM2.5 (data.gov.sg) | hourly | 2 h | NEA's own reading time | data.gov.sg updates the PSI and PM2.5 readings hourly from NEA; its feeds refresh every 15 min. The extra hour covers a late reading. This page reads NEA once per visit, so a tab left open also ages. | https://guide.data.gov.sg/developer-guide/real-time-apis |
| `cams-pm25` | CAMS PM2.5 forecast (Open-Meteo Air Quality API) | every 12 h | 15 h | when the model run was fetched from Open-Meteo | CAMS runs its global forecast every 12 h, so a copy fetched more than 12 h ago has missed at least one run. The 3 h allowance covers this site's 2 h relay cache and a run published late. | https://open-meteo.com/en/docs/air-quality-api |
| `open-meteo-wind` | Wind grids and summit winds (Open-Meteo Forecast API) | every 6 h | 9 h | when the model run was fetched from Open-Meteo | Open-Meteo lists ECMWF IFS and GFS as updated every 6 h, and ICON and JMA every 3 h. It gives no cadence for its best-match blend, so the slower 6 h is used. The 3 h allowance covers the relay cache and a run published late. | https://open-meteo.com/en/docs |
| `glofas` | GloFAS river discharge (Open-Meteo Flood API) | daily | 36 h | when the discharge series was fetched | GloFAS issues one forecast a day. The 12 h allowance covers this site's 6 h relay cache and a late daily run. | https://open-meteo.com/en/docs/flood-api |
| `fires-relay` | Regional fire view (NASA FIRMS, through `/api/fires`) | every 3 h | 4.5 h | when the relay built its copy from FIRMS | The relay rebuilds every 3 h, and FIRMS makes global detections available within 3 h of each pass. The 90 min allowance covers the hour the CDN may keep the previous build and the tab's 30-minute re-ask. The newest detection is not used as the clock: FIRMS sees most places about twice a day, so on a normal day it can be 12 h old. | https://www.earthdata.nasa.gov/data/tools/firms/faq |
| `watch-relay` | Watch-area evidence (FIRMS, USGS and BMKG, through `/api/watch`) | every 3 h | 4.5 h | when the relay built its copy | Same relay cadence and allowance as the regional fire view; both relays share `src/lib/buildRelay.ts`. | https://www.earthdata.nasa.gov/data/tools/firms/faq |
| `usgs-quakes` | USGS earthquakes (FDSN event service) | every minute | 1 h | when this page fetched the list | USGS updates its earthquake feeds every minute. This page fetches the list once per visit, so it is flagged after an hour, when a newer earthquake may be missing from the map. | https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php |
| `bmkg-quakes` | BMKG earthquake lists (data.bmkg.go.id) | within minutes of each earthquake | 1 h | when this page fetched the list | BMKG updates its lists whenever an earthquake occurs. The once-per-visit fetch and one-hour allowance are the same as for USGS. | https://data.bmkg.go.id/gempabumi/ |
| `official-feed` | Official warning feeds and GDACS (every feed in the official warnings panel: BMKG, JMA, GeoNet, NWS, PTWC, ThaiWater, DSDA, PUB, GDACS, and any feed added later) | every 5 min | 1 h | the last time the feed answered this page | Issuers publish when they have a message, so weeks without a new message are normal and say nothing about the feed. What is checked is that the feed answers. This page asks every 5 min, so an hour without an answer is about twelve missed asks in a row. Issuers' own rates, for context: JMA's high-frequency XML feeds update every minute, GDACS's main feeds every 6 min, and BMKG's when an earthquake occurs. GeoNet and NWS publish no cadence. | none (event-driven) |
| `vaac-tokyo` | Tokyo VAAC volcanic ash advisories (through `/api/vaac`) | every 5 min | 1 h | when the relay built its copy from the Tokyo VAAC pages | Tokyo VAAC issues an advisory when there is ash, so days without one are normal. What is checked is that the relay answers with a fresh build. It rebuilds from JMA's pages every 10 min (JMA caches them for 10 min too), and this page asks every 5 min, so an hour is several missed rebuilds in a row. While JMA fails, the relay serves its last build for up to 6 h, and that build ages here. | none (event-driven) |
| `magma-copy` | PVMBG MAGMA Indonesia volcano levels (recorded copy) | every 6 h | 12 h | when the copy was recorded | MAGMA reports on each volcano for every 6-hour period, and a level can change in any report. Its API is token-only, so the copy is never refreshed here. After 12 h it is flagged and points to MAGMA. | https://magma.esdm.go.id/ |

Sources with no expected update are not flagged:

- links (ASMC, NUS CRISP, VAAC Darwin);
- map tiles (GIBS imagery, basemaps);
- bundled reference data (the GVP catalogue, geoBoundaries, Natural Earth, the IOC station list);
- values computed in the browser (the smoke-transport paths).

Issuers' cadence pages:

- JMA: https://xml.kishou.go.jp/xmlpull.html
- GDACS: https://www.gdacs.org/feed_reference.aspx
- NWS, which asks clients to poll no more than every 30 seconds: https://www.weather.gov/documentation/services-web-alerts

## Limitations

- **A hotspot is not an eruption or a confirmed fire.** Near a volcano it can be volcanic heat, a vegetation fire or other hot ground. In the haze box it can be a fire, a gas flare or other hot ground. Every hotspot needs contextual review [6]. Satellite anomalies alone do not establish that an eruption will occur [1].
- **Missing detections are not evidence of no heat.** Cloud and thick smoke hide hotspots, so daily counts are lower bounds. FIRMS near-real-time data are preliminary and can change. Each satellite is counted separately, so one fire seen by two satellites appears in two daily totals.
- **Earthquake coverage is partial.** BMKG's lists are rolling (the latest 15, or about 200, events), so small unfelt events before the list's start are missing. PVMBG's own volcano-seismic network, which records small volcano-tectonic events, has no open feed. Magnitudes differ between agencies and products.
- **No gas, deformation or ash evidence.** As a result, a watch area cannot reach Review needed unless an earthquake of M 3.0 or more occurs within range. Relayed ash advisories are official messages, not evidence.
- **Optical and radar caveats.** Optical and thermal views are lost under cloud. Radar works through cloud and at night [2], and InSAR measures change between acquisitions but can contain atmospheric artefacts [3]. Revisit time, resolution and product latency differ between satellites.
- **The snapshot ages.** Satellite and earthquake data are only as fresh as the last refresh, and nothing refreshes automatically. The header shows the time.
- **Official items can be stale or incomplete.** Live feeds can fail, change format or tighten browser access without notice. GeoNet's alert level carries no timestamp. The MAGMA levels are a copy from 13 October 2026. PHIVOLCS, PTWC and Malaysian and Philippine flood feeds are not relayed: they have no browser-callable feed, or need a proxy.
- **Jakarta DSDA is HISTORICAL for now.** Since about 8 October 2026, `poskobanjir.dsdadki.web.id` has presented a certificate signed by its own Fortinet firewall, which browsers and Node reject. The app reads DSDA through its own relay (`/api/dsda`) with TLS verification left on, so it shows the bundled snapshot with the reason until DSDA fixes the certificate. We never relay data we cannot authenticate.
- **Units and terms are inferred in places.** DSDA publishes millimetres, which the app shows as centimetres, as DSDA's own page does. ThaiWater, DSDA and Smithsonian GVP terms pages were not found, or blocked scripted access.
- **Languages.** BMKG and MAGMA text is Indonesian, and JMA volcano levels are Japanese. They are shown as issued, with fixed glosses, never machine-translated.
- **Illustrative rules.** The watch rules ignore trend, signal strength and source reliability, and they carry no uncertainty model.
- **Drift is not dispersion.** The NEA drift cone uses surface wind at Singapore stations, not at the fire, and models no transport.

## What operational use would require

- **Agreements and access:** data-sharing with PVMBG (MAGMA) and the other issuers, and confirmed licences for every relayed feed.
- **Scheduled ingestion with stored history and provenance**, so that the evidence and the relayed messages are archived rather than overwritten.
- **Freshness handling:** stale-data flags on evidence, and alarms when an official feed goes quiet.
- **Calibration and expert review:** rules set with the volcano observatory and the haze and flood agencies, using their ground data.
- **Uncertainty handling:** cloud cover, detection limits and missing coverage shown explicitly.
- **Validation:** measure how often prompts mislead, and how long analysts take to produce a correct brief, before any accuracy claim. Check relay fidelity and latency against the issuers' own pages.
- **Clear authority:** warnings and evacuation decisions stay with the issuing agencies. The tool directs people to them.

## Attribution and licences

- **NASA FIRMS:** "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) and NASA's Earth Science Data and Information System (ESDIS)." NASA open data.
- **USGS:** U.S. Geological Survey, Earthquake Hazards Program. Public domain.
- **BMKG:** "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)". Must be credited in the app; 60 requests per minute per IP.
- **Smithsonian GVP:** Global Volcanism Program, Volcanoes of the World, Smithsonian Institution (terms page blocked to scripts).
- **MAGMA Indonesia (PVMBG):** the site states all rights reserved. The app shows four recorded levels with a link, and does not ingest bulk data.
- **JMA:** Public Data License v1.0. Tokyo VAAC advisories: "Source: Japan Meteorological Agency website (https://www.data.jma.go.jp/vaac/data/vaac_list.html)". **GeoNet:** CC BY 3.0 NZ. **US NWS:** US Government work. **GDACS:** terms ambiguous (its feeds say both "public domain" and "Copyright, GDACS").
- **ThaiWater (HII)** and **Dinas Sumber Daya Air DKI Jakarta:** attributed on screen; terms not found.
- **NEA and PUB via data.gov.sg:** Singapore Open Data Licence v1.0.
- **Bureau of Meteorology (VAAC Darwin):** © Commonwealth of Australia. Linked only; nothing is copied.
- **Boundaries:** Natural Earth (public domain) via the `world-atlas` package.

## References

Background references, accessed 13 October 2026:

1. USGS. *Forecasting, detecting, and tracking volcanic eruptions from space.* <https://www.usgs.gov/publications/forecasting-detecting-and-tracking-volcanic-eruptions-space>
2. ESA. *Earth's most active volcanoes on satellite watch.* <https://www.esa.int/Applications/Observing_the_Earth/Earth_s_most_active_volcanoes_on_satellite_watch>
3. USGS Hawaiian Volcano Observatory, Volcano Watch. *Inflating volcanoes or cloudy data? Discerning deformation from noise with InSAR.* <https://www.usgs.gov/observatories/hvo/news/volcano-watch-inflating-volcanoes-or-cloudy-data-discerning-deformation>
4. Smithsonian Institution Global Volcanism Program. *Merapi.* <https://volcano.si.edu/volcano.cfm?vn=263250>
5. Copernicus Data Space Ecosystem. *Browser documentation.* <https://documentation.dataspace.copernicus.eu/Applications/Browser.html>
6. NASA FIRMS. *Active fire data.* <https://firms.modaps.eosdis.nasa.gov/content/active_fire/>

Data sources and issuer pages (exact download URLs are in `data/real/meta.json` and `src/lib/warnings.ts`):

- NASA FIRMS VIIRS 375 m product page: <https://www.earthdata.nasa.gov/data/instruments/viirs/viirs-i-band-375-m-active-fire-data>
- USGS earthquake catalog (FDSN): <https://earthquake.usgs.gov/fdsnws/event/1/>
- BMKG: <https://data.bmkg.go.id/gempabumi/> and <https://inatews.bmkg.go.id/>
- MAGMA Indonesia volcano levels: <https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas>
- JMA: <https://www.jma.go.jp/bosai/map.html>
- Tokyo VAAC advisory list: <https://www.data.jma.go.jp/vaac/data/vaac_list.html>; JMA terms <https://www.jma.go.jp/jma/en/copyright.html>
- VAAC Darwin advisories (linked only): <https://www.bom.gov.au/aviation/volcanic-ash/darwin-va-advisory.shtml>; Bureau of Meteorology copyright <https://www.bom.gov.au/copyright>
- GeoNet: <https://www.geonet.org.nz/volcano>
- US National Weather Service: <https://www.weather.gov/>
- GDACS: <https://www.gdacs.org/>
- ThaiWater: <https://www.thaiwater.net/>
- Jakarta DSDA Posko Banjir: <https://poskobanjir.dsdadki.web.id/>
- PUB: <https://www.pub.gov.sg/>
- NEA via data.gov.sg: <https://data.gov.sg/datasets/d_534cf203023b51f51f879145ccc56ff9/view>; licence <https://data.gov.sg/open-data-licence>
- MOUNTS (independent research, not official): <http://www.mounts-project.com/>
- Natural Earth: <https://www.naturalearthdata.com/>
