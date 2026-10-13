# Roadmap

The hackathon build demonstrates one complete environmental workflow: volcano observations at Merapi, replayed from simulated fixtures, reviewed with transparent rules, and exported as a brief. Later modules reuse the same evidence model: normalized observation records with source, observation and ingestion times, data mode, and quality notes; rule-based review states with a reason for every record; and a deterministic brief.

## Environmental modules after the hackathon

| Module | First useful workflow |
|---|---|
| Wildfire and haze | Review satellite thermal detections alongside weather and air quality observations, and keep detected hotspots separate from confirmed fires. |
| Flooding | Compare mapped inundation and rainfall with roads and critical facilities, and keep forecast extent separate from observed extent. |
| Deforestation | Review land cover change over time, with cloud masking and analyst verification before any change is reported. |
| Marine pollution | Review reports and possible satellite anomalies together with maritime context, and require confirmation before treating a suspected spill as real. |
| Volcano operations | Bring in observatory reports and quality-controlled satellite products, then validate alert routing with domain experts. |

The wildfire and haze and flood examples in the current queue are static, simulated placeholders that show the queue and rules working on other hazards. They are not working modules.

## Post-sprint priorities

### 1. One reliable source adapter

- **Scheduled ingestion** from one public source, producing the same normalized observation records the fixtures use, so the interface does not change.
- **Stored provenance** for every record: original product metadata, retrieval time, and attribution.
- **Stale-data handling**: compare each source's latest observation with its expected update interval, and show stale or missing data explicitly.
- **Human acknowledgement**: an analyst acknowledges each review prompt, and the acknowledgement is recorded with the evidence that triggered it.

### 2. Measure before claiming accuracy

- Time for an analyst to produce a correct brief, with and without the tool.
- Rate of misleading review prompts: prompts an expert judges unwarranted, and relevant changes the rules missed.

No accuracy or performance claim is made until these are measured with domain experts.

### 3. Controls before shared or sensitive use

- **Permissions** for who can view, acknowledge, and export incidents.
- **Audit history** of ingestion, rule changes, acknowledgements, and exported briefs.

Both are required before the tool supports multiple organisations or sensitive operational data.

## Not planned

Predicted eruption dates or probabilities, evacuation boundaries or advice, issuing official alert levels, facial recognition, and a general chat assistant. Official alerts remain with the responsible agencies; any alert level shown in future would carry its issuing agency and publication time.
