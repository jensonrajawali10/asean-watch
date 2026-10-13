# Demo script

Four minutes of demo, up to four minutes of questions, two minutes of buffer. One presenter drives the app and speaks. Control names below match the contract and acceptance checklist; if a label differs slightly in the final build, follow the behaviour described.

## Timed script

| Time | On-screen action | Words |
|---|---|---|
| 0:00–0:35 | App open on the regional view. Point to the DEMO REPLAY banner, the ASEAN map, and the incident queue. | "Environmental evidence for Southeast Asia sits in separate satellite feeds and agency reports. ASEAN Watch brings it into one incident review workflow. Everything you see today is a labelled demo replay." |
| 0:35–1:05 | Click the Merapi marker on the map (or its queue entry). The detail panel shows location, coordinates, catalog source, the baseline records, and **Monitoring**. | "This is a simulated scenario at a real volcano: Merapi, in Central Java, located from the Smithsonian catalog. Every record shows its source, when it was observed, and when we received it. At baseline nothing is flagged, so the state is Monitoring." |
| 1:05–1:35 | Replay bar: **Next step** to step 1, Thermal observation. New thermal records appear in the timeline; the state becomes **Check observation**. | "A thermal anomaly arrives, and a second one from another sensor. One signal category asks for a check. The second thermal record is shown but not counted: a repeat from the same category is not independent corroboration." |
| 1:35–2:00 | **Next step** to step 2, Gas observation. A sulfur dioxide record appears; the state becomes **Review needed** and the map marker updates. | "Now a sulfur dioxide anomaly. Two different categories, thermal and gas, prompt review. These are demo rules for directing an analyst's attention. They are not an eruption prediction and not an official alert level." |
| 2:00–2:50 | Open **Why this state?** and read the rule and the counted / not counted reasons. Then select the gas record to open the **record inspector**: source link, observed time, ingested time, SIMULATED label, quality note. | "Every statement traces to a record. Here is the rule, and why each record did or did not count. The inspector shows the source, observation time separately from ingestion time, the data mode, and the quality note. Analysts can see what is missing and how reliable a source is before drawing conclusions." |
| 2:50–3:30 | Click **Generate brief**. Scroll the preview past the evidence references, limitations, and analyst questions. Click **Download .txt**. | "The current evidence becomes a portable text brief for human review: incident and location, replay step, review state and rule, each evidence reference with its source, the limitations, and questions for an analyst. The suggested next step is to consult the volcano observatory and ground measurements. It never gives a date, a probability, or an evacuation zone." |
| 3:30–4:00 | Click **Reset**: step returns to Baseline, state to Monitoring, the brief clears. Point to the wildfire and haze and flood examples in the queue. | "Reset returns to baseline, so the replay is repeatable. The same evidence model already holds the wildfire and haze and flood examples, and later deforestation and marine pollution. Our next step is a live data adapter validated with a local observatory." |

Notes for the presenter:

- **Play** runs the remaining replay steps in sequence. Use **Next step** in the live demo so each state change can be narrated; use Play only if time is short.
- Replay controls apply to Merapi only. The secondary examples are static.
- If asked to repeat, Reset and run the same steps; the result is identical.

## Pre-demo checklist

Complete in order, no more than 15 minutes before presenting.

- [ ] App built with `npm run build` and served with `npm run preview`, then opened in a fresh browser tab (fresh launch: Baseline, no brief generated).
- [ ] Network-off test passed: Wi-Fi off, page reloaded, full sequence (select, Next step twice, Why this state?, inspector, Generate brief, Download .txt, Reset) completed without errors. Network may be restored afterwards; the demo does not need it.
- [ ] Final-step brief downloaded in advance (for example `asean-watch-brief_inc-merapi-demo_step-2.txt`) and opened once in a text editor to confirm it reads correctly. Keep the editor window ready.
- [ ] Backup recording saved locally, played once from the presentation machine with the network off.
- [ ] Browser zoom at 100 percent.
- [ ] Display at 1366 × 768 or larger; projector mirroring checked.
- [ ] Notifications off; unrelated tabs and windows closed; download location known.
- [ ] Terminal running `npm run preview` left open in the background, in case a restart is needed.

## If the app fails during the presentation

Do not debug on stage. The goal is to show the workflow and be clear about what is real.

1. **Small fault, under 15 seconds to recover** (for example a stuck view): reload the tab, or click Reset and continue from the current script line.
2. **Preview server stopped:** restart `npm run preview` in the prepared terminal and reload, only if it takes under 15 seconds. Otherwise go to step 3.
3. **App unusable:** say "I'll switch to a recording of the same build," play the backup recording, and narrate it with the same script lines.
4. **Download blocked or failing:** show the brief preview in the app if it is visible, then open the pre-downloaded `.txt` file.
5. **Close honestly:** state which parts are functional (map, selection, validation, review rules, explanation, inspector, brief export, offline operation) and which inputs are simulated (all observation values, timestamps, anomaly flags, and scenario dates).

## Backup recording shot list (60–90 seconds)

Record once after verification passes, at 1366 × 768 or 1920 × 1080, browser zoom 100 percent, cursor visible, notifications off. Silent recording is fine; the presenter narrates live. Save as a local video file and confirm it plays offline.

| Approx. time | Shot |
|---|---|
| 0–8 s | Regional view on fresh launch: DEMO REPLAY banner, map, incident queue. |
| 8–18 s | Select Merapi on the map. Detail panel at Baseline, Monitoring. |
| 18–30 s | Next step: thermal records appear, Check observation. Hold briefly on the second thermal record's "not counted" reason. |
| 30–42 s | Next step: gas record appears, Review needed, map marker changes. |
| 42–55 s | Why this state? open. Then the record inspector on the gas record showing SIMULATED, observed time, and ingested time. |
| 55–70 s | Generate brief, Download .txt, open the downloaded file. |
| 70–80 s | Reset: Baseline, Monitoring, brief cleared. |
| 80–90 s | Hold on the queue showing the static wildfire and haze and flood examples. |

## Judging questions

**Does it use AI?**
No. The prototype uses transparent rules over anomaly flags that are set in the fixtures, and the brief is a deterministic template: the same input always gives the same text. AI could later help extract structured claims from agency reports, with each claim linked to its source and checked by an analyst.

**Can it predict eruptions?**
No, and it does not try to. A satellite anomaly alone does not establish that an eruption will occur, and a hotspot can have other causes. Prediction needs expert validation, ground instruments, and additional measurements. The tool suggests what an analyst should look at next and documents the evidence.

**How would it scale?**
By proving one reliable incident workflow first, then adding source adapters that produce the same normalized observation records, plus persistence, scheduled ingestion, and monitoring of the pipeline itself. A new adapter does not change the interface contract.

**Where does the data come from?**
Merapi's identity and coordinates come from the Smithsonian Global Volcanism Program, and the boundaries from Natural Earth. Every observation is a simulated fixture modelled on a public product type (satellite thermal detections as distributed by NASA FIRMS, Sentinel-5P sulfur dioxide, Sentinel-1 radar). Each record links to the product's public description page, not to a specific scene, and no acquisition identifiers were invented.

**Why rules instead of machine learning?**
An analyst can see exactly why a state changed, and the rules are tested. There is no labelled training data for this workflow, and a model's output would need validation that has not been done. The rules are explicitly illustrative; real criteria would be set with observatory scientists.

**What is real and what is simulated?**
Real: the volcano's identity and location, the country boundaries, and the software (validation, review logic, replay, explanation, inspector, brief export, offline operation, unit tests). Simulated: every observation value, timestamp, and anomaly flag, and the scenario dates. The interface labels each record SIMULATED and keeps the DEMO REPLAY banner on screen.

**What is the path to operational use?**
One source adapter with scheduled ingestion and stored provenance, stale-data handling, and analyst acknowledgement of review prompts. Then calibration against local observatory data, expert review of the rules, and explicit uncertainty handling. Before any accuracy claim, measure how long analysts take to produce a correct brief and how often review prompts mislead. Permissions and audit history come before any multi-organisation use. Official alert levels would only appear with their issuing agency and publication time. See [ROADMAP.md](ROADMAP.md) and [DATA_AND_LIMITATIONS.md](DATA_AND_LIMITATIONS.md).
