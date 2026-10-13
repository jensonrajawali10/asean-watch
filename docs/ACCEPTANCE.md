# Demo acceptance checklist

The single scope list for the sprint. If a request is not on this list, it waits until after the demo.

## Workflow (what the demo must show)

- [ ] Open the regional view: ASEAN map, Merapi marker, incident queue, persistent **DEMO REPLAY** banner.
- [ ] Select Merapi from the map or the queue: both selections show the same incident in the detail panel.
- [ ] Replay step 0, **Baseline**: state is **Monitoring**.
- [ ] Replay step 1, **Thermal observation**: a new thermal record appears and the state becomes **Check observation**.
- [ ] Replay step 2, **Gas observation**: a new gas record appears and the state becomes **Review needed** because two distinct anomaly categories are present.
- [ ] Open the explanation: it states the rule and why each record was or was not counted.
- [ ] Inspect the underlying records: source, observation time, ingestion time, data mode, and quality note for each.
- [ ] Generate and download the brief as `.txt`.
- [ ] Reset: replay returns to Baseline, state returns to Monitoring, and the brief is cleared.
- [ ] Repeat the same sequence with the same result.

## Acceptance checks before rehearsal

- [ ] **Fresh launch:** `npm install && npm run dev` (or `npm run build && npm run preview`) opens without secrets, unavailable services, or manual data edits.
- [ ] **Selection:** choosing Merapi updates both location and evidence; other examples do not inherit its records.
- [ ] **Replay:** baseline is Monitoring, the first anomaly is Check observation, and the second distinct category is Review needed. Reset restores baseline and clears the brief.
- [ ] **Data rules:** duplicate ids do not duplicate evidence; two records from one category do not trigger two-category review; invalid timestamps or values produce a readable message. Covered by `npm test`.
- [ ] **Transparency:** every synthetic value says SIMULATED, historical samples keep their acquisition times, and the banner stays visible.
- [ ] **Export:** downloaded text matches the selected incident and current replay step, includes sources, and opens correctly.
- [ ] **Reliability:** the bundled map and fixtures work offline; external source links open separately; no controls overlap at 1366 × 768 or at a narrow width.

## Out of scope for the sprint

Authentication, multi-user features, a database, raw satellite processing, automated evacuation advice, facial recognition, a general chat assistant, empty navigation pages, predicted eruption dates or probabilities, and official alert levels.

## Cut points

- Minute 25: drop remote data integration if fixtures are not ready.
- Minute 75: if replay is incomplete, remove secondary incidents and finish Merapi only.
- Minute 115: if export is incomplete, ship a plain-text download with deterministic content.
- Minute 130: freeze everything except bugs that break the demonstrated workflow.
