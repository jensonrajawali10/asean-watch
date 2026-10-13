# Demo acceptance checklist

The single scope list. If a request is not on this list, it waits until after the demo. Real data only; the honest result is whatever the data shows.

## Workflow (what the demo must show)

- [ ] Open the APAC view: map, five watch areas (Merapi, Semeru, Anak Krakatau, Sinabung, Riau peatlands), the data-recency banner ("Data as of <time> UTC"), and the official warnings panel.
- [ ] Select Merapi from the map or the watch list: both selections show the same watch, and nearby markers (Semeru, Krakatau) never steal the click.
- [ ] Step through the real 7 days with Next step (or Play): FIRMS overpass records appear day by day with real UTC times and sources; the workflow state matches the data (currently Check observation, thermal only).
- [ ] Open "Why this state?": it states the watch rule (illustrative, not an official threshold) and why each record was or was not counted.
- [ ] Inspect a record: source, observed and ingested times, data mode, quality note, and the individual hotspots of that overpass.
- [ ] See the official context apart from our state: MAGMA Level III (Siaga) for the volcano, verbatim, with its retrieval time and a "Follow MAGMA" link.
- [ ] Select Riau: NEA Singapore wind and PSI context with LIVE or HISTORICAL SNAPSHOT tags and the "not a dispersion model" caveat.
- [ ] Official warnings panel: verbatim issuer levels, issue and expiry or ENDED/EXPIRED, feed statuses; GDACS shown as an impact estimate.
- [ ] Generate brief and Download .txt: the text matches the selected watch and day, includes sources, official warnings near the watch (or the checked feeds and "not an all-clear"), and opens correctly.
- [ ] Reset returns to day 1 and clears the brief; the sequence repeats with the same result.

## Acceptance checks before rehearsal

- [ ] **Fresh data:** `npm run refresh:all` 30–60 minutes before presenting, then `npm run build`; check MAGMA's public level list by hand (MAGMA notices are recorded, not refreshed).
- [ ] **Fresh launch:** `npm run preview` (or `npm run dev`) opens without secrets or manual edits.
- [ ] **Offline:** with networking off, the map, watches, replay, warnings snapshot, NEA snapshot and brief all work; live feeds show their snapshot or "Official feed unavailable: check <issuer> directly", never "no warnings".
- [ ] **Data rules:** `npm test` passes (validation, watch rules, overpass grouping, review states, warnings parsers, NEA, brief).
- [ ] **Transparency:** every value names its real source and time; snapshot data says HISTORICAL with "data as of"; nothing says SIMULATED, "demo replay", or "fictional"; our states never look like official levels.
- [ ] **Layout:** no overlapping controls at 1366 × 768 (windowed, ~650 px tall) or at 375 px; keyboard-only path works.

## Out of scope for the sprint

Authentication, multi-user features, a database, raw satellite processing, issuing our own evacuation advice or alerts, predicted eruption dates or probabilities, modelled values presented as observations, facial recognition, a general chat assistant, empty navigation pages.

## Cut points

- If a live feed misbehaves during rehearsal, present from the snapshot (it is real, timestamped data).
- If the redesign is incomplete at the freeze, ship the last committed working UI.
- After the freeze, fix only bugs that break the demonstrated workflow.
