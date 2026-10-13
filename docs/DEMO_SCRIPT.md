# Demo script

Four minutes of demo, up to four minutes of questions, two minutes of buffer. One presenter drives the app and speaks.

**Control names.** These labels are fixed: **Next step**, **Play** (Pause while playing), **Reset**, **Why this state?**, **Generate brief**, **Download .txt**. The redesign is still in progress, so every other on-screen name below is a working name taken from `docs/DESIGN.md` and marked **[confirm against UI]**. Before rehearsal, replace each marked name with the label in the final build.

**Read the screen, not the script.** The data is real and changes with every refresh. The spoken lines below assume the snapshot of 2026-10-13 07:26 UTC. If the refreshed data gives a different state, a different gauge, or no Level III notice, say what the screen shows, and never claim anything that is not on it.

## Timed script

| Time | On-screen action | Words |
|---|---|---|
| 0:00–0:30 | Fresh launch. Point to the header recency line [confirm against UI], the five watch areas on the map and in the **Watch areas** list [confirm against UI], and the **Official warnings · APAC** panel [confirm against UI]. | "ASEAN Watch uses real public data only. On the left are five places we watch in Indonesia: four volcanoes and the Riau peatlands. Next to them are official warnings from agencies across the Asia-Pacific, relayed word for word. The header tells you how old the satellite data is. This is not a warning service; it points you to the agencies that are." |
| 0:30–0:50 | Click Merapi on the map or in the list. The review column opens on day 1 of 7, with the location, the Smithsonian catalog link and the workflow state. | "Merapi, north of Yogyakarta, located from the Smithsonian catalog. We replay the last seven real days, one UTC day at a time. Nothing here is simulated or staged." |
| 0:50–1:35 | **Next step** twice, narrating the new records (each new row is marked as new [confirm against UI]). Then **Play** to run to day 7. | "Each step adds a real day. These are NASA FIRMS satellite hotspots within five kilometres of the summit, each with its satellite, its observation time, and when NASA last updated the file it came from. The evidence builds up day by day. The state is Check observation every day this week: thermal evidence only." |
| 1:35–2:05 | Open **Why this state?** Read the stated watch rule and one counted and one not-counted reason. Optionally click a record to open the **record inspector** [confirm against UI]. | "Here's why. The rule is written out: a confident hotspot near the summit counts as thermal evidence. Review needed would require a second, independent category. No USGS or BMKG earthquake fell within 30 kilometres this week, and there is no open sulfur dioxide feed, so the second category never arrives. That is the honest result, and we don't fake one. The rule is illustrative, not an official threshold." |
| 2:05–2:25 | Point to the official cross-reference line in the review column, **OFFICIAL · PVMBG MAGMA · LEVEL III (SIAGA)** [confirm against UI]. Open it in the drawer [confirm against UI] to show the issuer, the HISTORICAL label with its recorded time, and **Follow PVMBG MAGMA** [confirm against UI]. | "This is the official level from Indonesia's volcano agency, PVMBG, through MAGMA: Level III, Siaga. It sits in its own style, separate from our state, and we never derive it or override it. It is a recorded copy from 13 October, because MAGMA's data feed needs a token. The link goes to MAGMA for the current level." |
| 2:25–2:55 | Select **Riau peatland hotspots** [confirm against UI]. Point to the daily hotspot totals, then the **NEA Singapore context card** [confirm against UI] and the map overlay: wind arrow, drift cone, PSI chip [confirm against UI]. | "Riau is a haze watch: confident hotspots are totalled per satellite per day. Because it's within range of Singapore, we add NEA's own station wind and the 24-hour PSI, in NEA's band words, with the reading time. The drift cone is illustrative, not a dispersion model, and the context never changes our state." |
| 2:55–3:25 | Clear the selection so the panel lists APAC-wide warnings [confirm against UI: how to return to the overview]. Open the ThaiWater item for gauge **C.35** in Phra Nakhon Si Ayutthaya [confirm against UI]. Point to the GDACS impact-estimate style and the feed status footer [confirm against UI]. | "This panel is why the product exists: awareness of potential evacuation, by relaying what the authorities say. ThaiWater reports this Chao Phraya gauge at Ayutthaya at overflowing bank, in its own words. That is a gauge situation, not an evacuation order, so the link goes to the issuer. GDACS is labelled as an estimate. If a feed fails, we say so and tell you to check the issuer. An empty list is never an all-clear." |
| 3:25–3:50 | Select Merapi again (move to day 7 with **Play** if the replay restarted [confirm against UI]). Click **Generate brief**, scroll the preview briefly, then click **Download .txt**. | "Everything we've just seen becomes a plain-text brief: the snapshot time, the day, the state and its rule, every record with its source, the official notices relayed separately and verbatim, the status of every feed, the limitations, and questions for an analyst. The next step it suggests is to consult the observatory." |
| 3:50–4:00 | Click **Reset**. | "Reset, and it replays the same real week. Next, we would add scheduled ingestion and a proper agreement with MAGMA, and test the brief with analysts before claiming anything about accuracy." |

Presenter notes:

- Evidence accumulates across the replay. In the 13 October snapshot, Merapi gets new qualifying hotspots on 7 to 11 October and none on 12 or 13 October, so the last two Next steps add nothing new. The state stays Check observation because the earlier records still count. If asked, say exactly that.
- If the replay day labels or the state differ after a refresh, change the 0:50 and 1:35 lines to match. Never say "Review needed" unless the screen shows it.
- If the app is online, the warnings panel may show LIVE items that differ from rehearsal. Read the issuer's words as shown. If C.35 is no longer at overflowing bank, use whichever relayed item is on screen, or say the gauge has dropped.
- Do not call any of our states an alert, and do not say "evacuate" in your own voice. Only an issuer's words may.

## Pre-demo checklist

**30 to 60 minutes before presenting** (needs internet):

- [ ] Run `npm run refresh:all`. Read the output. If `refresh:data` fails, nothing is written, the previous snapshot stays, and the chain stops; run `npm run refresh:warnings` and `npm run refresh:nea` on their own. Present with the older snapshot if needed. The header shows its time, so say so.
- [ ] Run `npm run build`, then `npm run preview`. Snapshots are bundled at build time, so a refresh without a rebuild changes nothing in the preview.
- [ ] Optional: `npm test` passes.
- [ ] Check the story against the refreshed data:
  - Step through Merapi's seven days and note the state on each.
  - Check Riau's NEA card and drift label.
  - Find the ThaiWater C.35 item in the APAC list, or choose a replacement item.
  - Note the header time.
- [ ] Open MAGMA's public level list (https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas) in a browser. The app's MAGMA records were recorded at 2026-10-13 06:52 UTC and are not updated by any refresh script. If a level has changed, say so during the demo.
- [ ] Network-off check: turn Wi-Fi off and reload. The app should load, the feeds should fall back to HISTORICAL snapshots, the feed footer should show snapshot or unavailable status, no screen should say "no warnings" or "all clear", and the full path (select, Next step, Play, Why this state?, inspector, Generate brief, Download .txt, Reset) should complete without errors.
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

## Backup recording shot list (60–90 seconds)

Record after the refresh, at 1366 × 768 or 1920 × 1080, browser zoom 100 percent, cursor visible, notifications off. A silent recording is fine because the presenter narrates live.

| Approx. time | Shot |
|---|---|
| 0–8 s | Fresh launch: header recency line, map with five watch areas, APAC official-warnings panel. |
| 8–16 s | Select Merapi: day 1 of 7, workflow state, catalog link. |
| 16–34 s | Next step twice, then Play to day 7. Evidence rows accumulate. |
| 34–46 s | Why this state? open, showing the watch rule and the counted and not-counted reasons. |
| 46–54 s | The official MAGMA Level III line, and the drawer showing the HISTORICAL label and the Follow link. |
| 54–66 s | Riau: daily totals, NEA context card, drift cone and PSI chip on the map. |
| 66–78 s | APAC warnings list: the ThaiWater C.35 item opened, then the GDACS estimate style and the feed footer. |
| 78–90 s | Merapi day 7: Generate brief, Download .txt, open the file; then Reset. |

## Judging questions

**Does it use AI?**
No. Watch rules and workflow states are plain, stated rules, and the brief is a fixed template: the same data gives the same text. There is no model API. AI could later help extract structured claims from agency bulletins, with each claim linked to its source and checked by an analyst.

**Does it tell people to evacuate?**
No. It makes people aware of potential evacuation by relaying the official warnings, verbatim, from the agencies with authority, with a link to follow them. Our own states never say "evacuate". If a feed is down or empty, we say "check the issuer directly", never "all clear".

**Can it predict eruptions?**
No, and it does not try to. A hotspot shows heat at a place and time. It can come from the volcano, a vegetation fire or other hot ground, and it does not show what happens next. Forecasting is the observatory's job, using ground instruments such as PVMBG's seismic network, which has no open feed.

**Why is everything "Check observation" all week?**
Because that is what the real data shows. The thermal rule fires on summit hotspots. No USGS or BMKG earthquake fell within 30 km of any summit in this window, and there is no open, keyless SO2 feed, so no second category exists. We could have staged a Review needed. We chose not to.

**Where does the data come from?**
Hotspots come from NASA FIRMS (VIIRS on three satellites, and MODIS); earthquakes from USGS and BMKG; volcano locations from the Smithsonian Global Volcanism Program. Official warnings come from BMKG, JMA, GeoNet, the US National Weather Service, ThaiWater, Jakarta's water agency, PUB and MAGMA, plus GDACS as an aggregator. NEA Singapore provides wind and haze context. Every record keeps its original time and links to its source. No identifier is invented. The full list is in `data/SOURCES.md`.

**Why rules instead of machine learning?**
An analyst can see exactly why a state changed, and the rules are tested. There is no labelled training data for this workflow, and a model would need validation we have not done. The rules are explicitly illustrative; real criteria would be set with observatory and agency experts.

**Why is the MAGMA level a recorded copy?**
MAGMA's data feed needs a token, and its site reserves all rights. So we show a recorded copy of the public level list, labelled HISTORICAL with its time, and link to MAGMA for the current level. Proper access needs an agreement with PVMBG.

**What is the path to operational use?**
Scheduled ingestion with stored history, in place of a manual refresh. Then data-sharing agreements (MAGMA first), stale-data flags on evidence, analyst acknowledgement of prompts, and calibration of the rules with the agencies. Before any accuracy claim, we would measure how long analysts take to produce a correct brief and how often prompts mislead. Permissions and audit history come before any multi-organisation use. See [ROADMAP.md](ROADMAP.md).
