# Roadmap

The prototype shows one complete pattern on real data. It replays watch-area evidence through stated rules into an analyst workflow state, places relayed official warnings beside that state but separate from it, and exports a traceable brief. New hazards reuse the same pattern: real records with source and time, stated illustrative rules, verbatim relay of the issuer with authority, and the rule that absence is never an all-clear.

## By hazard: what exists, what comes next

| Hazard | In this build | First useful next step |
|---|---|---|
| Volcanoes | Four Indonesian volcanoes at MAGMA Level III, with FIRMS hotspots and USGS and BMKG earthquakes. MAGMA levels are a recorded copy; JMA and GeoNet volcano levels are relayed. | Agree access with PVMBG so MAGMA levels and reports are relayed live. Add the Tokyo VAAC ash advisories, which are open. Add an SO2 source once one can be ingested without hand processing. Link PHIVOLCS. |
| Wildfire and haze | Riau peatland box with daily FIRMS totals per sensor; NEA Singapore wind and PSI as context; illustrative drift. | Add ASMC hotspot files and more haze boxes (Kalimantan, Peninsular Malaysia). Add modelled air quality as clearly labelled MODELLED context, never evidence. Keep hotspots distinct from confirmed fires. |
| Flooding | Relays ThaiWater gauges at "overflowing bank", Jakarta DSDA Siaga levels and PUB flood alerts. | Add flood watch areas with observed gauge records. Snapshot Malaysia's Public Info Banjir and the PAGASA Pasig-Marikina gauges, which have no browser access. Keep observed levels separate from modelled discharge. |
| Tsunami and earthquakes | Relays BMKG InaTEWS, JMA and US NWS. | Relay PTWC through a small proxy. Show raw tide-gauge levels near a selected coast as context only, never as a warning. |
| Deforestation | Not started | Review land-cover change over time, with cloud masking and analyst verification. |
| Marine pollution | Not started | Review reports and possible satellite anomalies with maritime context; require confirmation of suspected spills. |

## Post-sprint priorities

### 1. Reliable ingestion

- **Scheduled ingestion** to replace the manual `npm run refresh:all`. This needs a small backend that also proxies feeds browsers cannot call (PTWC, FIRMS).
- **Stored provenance and history.** Keep every snapshot and every relayed message with its retrieval time and original metadata, rather than overwriting them. `data/real/meta.json` already records this for the current snapshot.
- **Stale-data handling.** Flag evidence older than each source's expected update interval, and alert when an official feed goes quiet. Warning feeds already report their status.
- **Human acknowledgement.** An analyst acknowledges each workflow prompt, recorded with the evidence that triggered it.

### 2. Access and terms

- A data-sharing agreement with PVMBG for MAGMA levels and reports.
- Confirmed terms for ThaiWater, Jakarta DSDA, GDACS and the Smithsonian GVP catalog.
- Keyed or proxied access where browser access is not possible.

### 3. Measure before claiming accuracy

- Time for an analyst to produce a correct brief, with and without the tool.
- Rate of misleading prompts: prompts that experts judge unwarranted, and relevant changes the rules missed.
- Relay fidelity and delay: whether every relayed message matches the issuer's page, and how long after issue it appears.

No accuracy or performance claim is made until these have been measured with domain experts.

### 4. Controls before shared or sensitive use

- **Permissions** for who can view, acknowledge and export.
- **Audit history** of ingestion, rule changes, acknowledgements and exported briefs.

Both are required before the tool supports multiple organisations or sensitive operational data.

## Not planned

- Issuing our own warnings, alert levels or evacuation advice.
- Predicting eruptions, fires or floods.
- Re-scoring, merging or machine-translating official messages.
- Presenting modelled values as observations.
- Facial recognition, or a general chat assistant.

Warnings and evacuation decisions remain with the issuing agencies. The tool directs people to them.
