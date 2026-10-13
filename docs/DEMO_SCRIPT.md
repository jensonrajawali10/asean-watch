# Demo script

Four minutes of demo, up to four minutes of questions, two minutes of buffer. One presenter drives the app and speaks.

**Live site:** https://asean-watch.vercel.app

**Control names.** These labels are fixed: **Next step**, **Play** (Pause while playing), **Reset**, **Why this state?**, **Generate brief**, **Download .txt**, **All APAC**, **Layers**. Other on-screen names come from `docs/DESIGN.md` sections 8a and 8b. Check them against the final build before rehearsal.

**Read the screen, not the script.** The data is real and changes with every refresh. The spoken lines below assume the snapshot of 2026-10-13 07:26 UTC. If the refreshed data gives a different state, a different gauge, or no Level III notice, say what the screen shows, and never claim anything that is not on it.

## Timed script

| Time | On-screen action | Words |
|---|---|---|
| 0:00–0:25 | Fresh launch. Point to the header recency line (**Real data · data as of … UTC**), the five watch areas on the map and in **Watch areas (5)**, and the **Official warnings · APAC (n)** panel. | "ASEAN Watch uses real public data only. On the left are five watch areas in Indonesia: four volcanoes and the Riau peatlands. Next to them are official warnings from agencies across Asia-Pacific, relayed word for word. The header shows how old the satellite data is. This is not a warning service; it points you to the agencies that issue the warnings." |
| 0:25–0:55 | Click **Merapi** on the map or in **Watch areas (5)**. The map flies to it, with distance rings at 3, 5, 10 and 15 km labelled "not an official hazard zone". The review column opens on day 1 of 7, with the location, the Smithsonian catalog link and the workflow state. Scroll to zoom and drag to pan; **+** and **−** do the same; **All APAC** resets. | "Merapi, north of Yogyakarta, located from the Smithsonian catalog. Selecting a watch flies the map to it, and you can zoom and pan freely. The rings are distances from the summit: 3, 5, 10 and 15 kilometres. These are distances, not an official hazard zone. The official danger zone comes from PVMBG; follow their link. We replay the last seven real days, one UTC day at a time." |
| 0:55–1:25 | Click **Next step** twice. Each step adds that day's records to **Evidence · n records, newest first**, and the timeline line shows the running count. Then **Play** to run to day 7. | "Each step adds a real day. These are NASA FIRMS satellite hotspots within five kilometres of the summit, each with its satellite, its observation time, and when NASA last updated the file it came from. The evidence builds up day by day. The state is Check observation every day this week: thermal evidence only." |
| 1:25–1:50 | Open **Why this state?**. Read the stated watch rule and one counted and one not-counted reason. Optionally click a record to open the **Record** drawer. | "Here's why. The rule is written out: a confident hotspot near the summit counts as thermal evidence. Review needed would require a second, independent category. No USGS or BMKG earthquake fell within 30 kilometres this week, and there is no open sulfur dioxide feed, so that category never arrives. That is the honest result, and we don't fake one. The rule is illustrative, not an official threshold." |
| 1:50–2:10 | Point to the **OFFICIAL** block in the review column, which shows PVMBG MAGMA Level III (Siaga). Click **Details** to open the warning inspector: the issuer, the HISTORICAL label with its recorded time, and **Follow PVMBG MAGMA**. | "This is the official level from Indonesia's volcano agency, PVMBG, through MAGMA: Level III, Siaga. It sits in its own style, separate from our state. We never derive it or override it. It is a recorded copy from 13 October, because MAGMA's data feed needs a token. The link goes to MAGMA for the current level." |
| 2:10–2:45 | Select the **Riau peatlands** watch area in **Watch areas (5)**. Point to the daily hotspot totals. With the wind and haze layer on (**Layers**), point to the wind arrows and the 48-hour haze paths, labelled MODELLED and "not a dispersion model". Scroll to zoom into Singapore: point to the PSI shading, then to the **Context: NEA Singapore (real readings)** card. | "Riau is a haze watch: confident hotspots are totalled per satellite per day. The arrows are modelled wind from Open-Meteo. The paths are an illustrative 48-hour trace from these hotspots along that wind. This is not a dispersion model. Zoomed into Singapore, the shading is NEA's measured 24-hour PSI by region. It is real NEA data, LIVE or a snapshot, as the mode label says. The context never changes our state." |
| 2:45–3:10 | Click **All APAC** or press Esc, so **Official warnings · APAC (n)** lists the APAC-wide items. Open the ThaiWater item for gauge **C.35** in Phra Nakhon Si Ayutthaya. Point to the GDACS item, labelled as an estimate, and to the **Feeds:** status line. | "This panel is why the product exists: it makes people aware of potential evacuations, by relaying what the authorities say. ThaiWater reports this Chao Phraya gauge at Ayutthaya at overflowing bank, in its own words. That is a gauge reading, not an evacuation order, so the link goes to the issuer. GDACS is labelled as an estimate. If a feed fails, we say so. An empty list is never an all-clear." |
| 3:10–3:35 | Select Merapi again, and use **Play** to reach day 7 if the replay has restarted. Click **Generate brief**, scroll the preview briefly, then click **Download .txt**. | "Everything we've just seen becomes a plain-text brief: the snapshot time, the day, the state and its rule, every record with its source, the official notices relayed separately and verbatim, the status of every feed, the limitations, and questions for an analyst. The next step it suggests is to consult the observatory." |
| 3:35–4:00 | Click **Reset**. | "Reset replays the same real week. Next, we would add scheduled ingestion and a proper agreement with MAGMA, and test the brief with analysts before claiming anything about accuracy. The live site is asean-watch.vercel.app." |

Presenter notes:

- Evidence accumulates across the replay. In the 13 October snapshot, Merapi gets new qualifying hotspots on 7 to 11 October and none on 12 or 13 October, so the last two Next steps add nothing new. The state stays Check observation because the earlier records still count. If asked, say exactly that.
- If the replay day labels or the state differ after a refresh, change the Next step and Why this state lines to match. Never say "Review needed" unless the screen shows it.
- If the wind layer or the NEA PSI is missing, skip the matching lines and say what the screen shows. Do not describe haze paths or shading that are not on screen.
- The distance rings and haze paths are not hazard zones or forecasts. If asked, say so and point to the PVMBG link for the official zone.
- If the app is online, the warnings panel may show LIVE items that differ from rehearsal. Read the issuer's words as shown. If C.35 is no longer at overflowing bank, use whichever relayed item is on screen, or say the gauge has dropped.
- Do not call any of our states an alert, and do not say "evacuate" in your own voice. Only an issuer's words may.

## Pre-demo checklist

**30 to 60 minutes before presenting** (needs internet):

- [ ] Run `npm run refresh:all`. Read the output. If `refresh:data` fails, nothing is written, the previous snapshot stays, and the chain stops; run `npm run refresh:warnings` and `npm run refresh:nea` on their own. Present with the older snapshot if needed. The header shows its time, so say so.
- [ ] Run `npm run build`, then `npm run preview`. Snapshots are bundled at build time, so a refresh without a rebuild changes nothing in the preview.
- [ ] Optional: `npm test` passes.
- [ ] Check the story against the refreshed data:
  - Step through Merapi's seven days and note the state on each.
  - Check Riau's NEA context card, the haze paths and the Singapore PSI shading.
  - Find the ThaiWater C.35 item in the APAC list, or choose a replacement item.
  - Check the distance rings and their label on Merapi.
  - Note the header time.
- [ ] Open MAGMA's public level list (https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas) in a browser. The app's MAGMA records were recorded at 2026-10-13 06:52 UTC and are not updated by any refresh script. If a level has changed, say so during the demo.
- [ ] Network-off check: turn Wi-Fi off and reload. The app should load, the feeds should fall back to HISTORICAL snapshots, the feed footer should show snapshot or unavailable status, no screen should say "no warnings" or "all clear", and the full path (select, zoom, Next step, Play, Why this state?, inspector, Generate brief, Download .txt, Reset) should complete without errors.
- [ ] Decide whether to present online or offline, and present in the mode you rehearsed. Offline guarantees that the warnings match rehearsal. Online may show LIVE items that differ.
- [ ] Download the day-7 Merapi brief in advance (`asean-watch-brief_watch-merapi_day-7.txt`) and open it once in a text editor. Keep the editor ready.
- [ ] Record the backup video after the refresh, so it matches today's data. Play it once offline.

**At the venue:**

- [ ] Browser zoom at 100 percent; display at 1366 × 768 or larger; projector mirroring checked.
- [ ] Notifications off; unrelated tabs closed; the terminal running `npm run preview` left open in the background.
- [ ] App open on a fresh launch, with nothing selected and no brief.

## If the app fails during the presentation

Do not debug on stage.

1. **Small fault, under 15 seconds to recover:** reload the tab, or click Reset and continue from the current script line.
2. **Preview server stopped:** restart `npm run preview` in the prepared terminal, but only if that takes under 15 seconds. Otherwise go to step 3.
3. **App unusable:** say "I'll switch to a recording of the same build," play the backup video, and narrate it with the same lines.
4. **A live feed misbehaves:** go offline (Wi-Fi off) and reload. The app falls back to the bundled snapshots.
5. **Download fails:** show the brief preview in the app, then open the pre-downloaded `.txt` file.
6. **Close honestly:** everything shown is real data with its source and time. The workflow states come from our illustrative rules. Official levels and warnings are the issuers' own words, and the MAGMA levels are a recorded copy from 13 October.

## Backup recording shot list (about 100 seconds)

Record after the refresh, at 1366 × 768 or 1920 × 1080, browser zoom 100 percent, cursor visible, notifications off. A silent recording is fine because the presenter narrates live.

| Approx. time | Shot |
|---|---|
| 0–8 s | Fresh launch: header recency line, map with five watch areas, APAC official-warnings panel. |
| 8–20 s | Select Merapi: map flies to it, distance rings with their label, day 1 of 7, workflow state, catalog link. |
| 20–38 s | Next step twice, then Play to day 7. Evidence rows accumulate. |
| 38–50 s | Why this state? open, showing the watch rule and the counted and not-counted reasons. |
| 50–60 s | The OFFICIAL block (MAGMA Level III), and the warning inspector showing the HISTORICAL label and the Follow link. |
| 60–76 s | Riau: daily totals, wind arrows and haze paths, then zoom to Singapore for the PSI shading and the NEA context card. |
| 76–86 s | APAC warnings list: the ThaiWater C.35 item opened, the GDACS estimate label, and the Feeds footer. |
| 86–100 s | Merapi day 7: Generate brief, Download .txt, open the file; then Reset. |

## Judging questions

**Does it use AI?**
No. Watch rules and workflow states are plain, stated rules, and the brief is a fixed template: the same data gives the same text. There is no model API. AI could later help extract structured claims from agency bulletins, with each claim linked to its source and checked by an analyst.

**Does it tell people to evacuate?**
No. It makes people aware of potential evacuation by relaying the official warnings, verbatim, from the agencies with authority, with a link to follow them. Our own states never say "evacuate". If a feed is down or empty, we say "check the issuer directly", never "all clear".

**Can it predict eruptions?**
No, and it does not try to. A hotspot shows heat at a place and time. It can come from the volcano, a vegetation fire or other hot ground, and it does not show what happens next. The distance rings are only distances, and the haze paths are illustrative 48-hour traces, not forecasts. Forecasting is the observatory's job, using ground instruments such as PVMBG's seismic network, which has no open feed.

**Why is everything "Check observation" all week?**
Because that is what the real data shows. The thermal rule fires on summit hotspots. No USGS or BMKG earthquake fell within 30 km of any summit in this window, and there is no open, keyless SO2 feed, so no second category exists. We could have staged a Review needed. We chose not to.

**Where does the data come from?**
Hotspots come from NASA FIRMS (VIIRS on three satellites, and MODIS); earthquakes from USGS and BMKG; volcano locations from the Smithsonian Global Volcanism Program. Official warnings come from BMKG, JMA, GeoNet, the US National Weather Service, ThaiWater, Jakarta's water agency, PUB and MAGMA, plus GDACS as an aggregator. NEA Singapore provides the measured 24-hour PSI and station wind for the Singapore context. Open-Meteo provides the modelled wind for the haze paths. Every record keeps its original time and links to its source. No identifier is invented. The full list is in `data/SOURCES.md`.

**Why rules instead of machine learning?**
An analyst can see exactly why a state changed, and the rules are tested. There is no labelled training data for this workflow, and a model would need validation we have not done. The rules are explicitly illustrative; real criteria would be set with observatory and agency experts.

**Why is the MAGMA level a recorded copy?**
MAGMA's data feed needs a token, and its site reserves all rights. So we show a recorded copy of the public level list, labelled HISTORICAL with its time, and link to MAGMA for the current level. Proper access needs an agreement with PVMBG.

**What is the path to operational use?**
Scheduled ingestion with stored history, in place of a manual refresh. Then data-sharing agreements (MAGMA first), stale-data flags on evidence, analyst acknowledgement of prompts, and calibration of the rules with the agencies. Before any accuracy claim, we would measure how long analysts take to produce a correct brief and how often prompts mislead. Permissions and audit history come before any multi-organisation use. See [ROADMAP.md](ROADMAP.md).
