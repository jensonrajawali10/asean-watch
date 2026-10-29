# Map view

The first screen: a full-screen map of the region with the haze forecast, wind streaks, fires, volcano triangles and official warning pins. Above it, a header card with one plain sentence about the worst haze and the official-messages button; below it, the map key ("What's on the map"), the layer chips and the forecast bar.

## Sub-features

- `map-ready` the map draws and the "Loading the map..." text goes away.
- `map-headline` the header shows "ASEAN Watch" and the worst-haze sentence.
- `map-messages` the header has the official-messages button with its count (wording in its `title`, e.g. "41 official messages in force: volcanoes, floods, earthquake. Open the official warnings.").
- `map-markers` the volcano triangles and warning pins are on the map as buttons.
- `map-fit` the page never scrolls sideways at desktop or phone width.
- `map-fires-live` `/api/fires` answers, and the map key's fire line matches the data's age: "in the last 24 hours" for data under 12 hours old, otherwise a named day ("in the 24 h to 24 Oct"). A failed relay is never read as "no fires".
- `map-vaac-live` `/api/vaac` answers, and every advisory it relays says `VAAC: TOKYO` (VAAC Darwin's text is never relayed). Ash advisories are aviation products and are never drawn as warning pins.

## How to get to it (user POV)

- Open the site with no `#` in the address.
- A shared link with `#ws=...` or `#sel=...` opens the same map with a section or card already open.
- The map key opens and closes with its "What's on the map" button. It starts open on desktop and folded on phones.

## Driving it with aw-verify

Preconditions:

- Baseline (see README). Nothing else.

- **Load.** Open the site. Run `npm run verify -- run --journey map`. Step `map-load` passes when `.mv-overlay[data-ready="true"]` appears and "Loading the map" is gone.
- **Header.** Same step. `saw.headline` is "ASEAN Watch" and `saw.alertsButton` holds the messages button's `title`.
- **Markers.** Same step. `saw.volcanoMarkers` is 4 (Merapi, Semeru, Anak Krakatau, Sinabung) and `saw.warningPins` is the number of official messages drawn.
- **Fit.** Same step. `saw.layout.scrollWidth` equals `saw.layout.innerWidth` at both viewports.
- **Live fires.** Same run, step `fires-live`: `GET /api/fires` must answer HTTP 200. `saw.available`, `saw.reference` (the data's time) and `saw.keyShouldSay` say what the key must read. The step opens the key if folded, reads the fire line (`saw.keyFires`) and fails if it claims "the last 24 hours" for older data, or misses it for fresh data. Screenshot `<viewport>-<nn>-map-key-fires.png`.
- **Ash advisories.** Same run, step `vaac-live`: `GET /api/vaac` must answer HTTP 200. `saw.advisories` lists what it relays (often empty: the last 24 hours only). It fails on any text not issued by Tokyo, and reports `skip` when the relay answers `{ "available": false }` (the page then shows its saved copy).
- **Proof.** Screenshot `<viewport>-01-map.png`, plus `open` for an ARIA snapshot: `npm run verify -- open --viewport phone`.

## Gotchas

- The map needs WebGL. Headless Chrome provides it through software rendering; a first load can take 5-15 s.
- The message count, the worst-haze city and the fire data come from live feeds and change between runs. Assert they exist and agree, not their values.
- On phones the map key shows only its first two rows (circles and pins; a `max-width: 767px` rule hides the rest), so `fires-live` reports `skip` there after checking the relay answered. Desktop carries the key-wording proof.
- The relay builds from NASA's files on its first request (about 5 s, longer cold). Until it answers, the page shows its bundled copy, dated. The step waits up to 60 s for the live wording.
- When the relay answers `{ "available": false }`, the step passes only if the key names a day and does not say "the last 24 hours". Report the `saw.reason` either way.
- First-time visitors also see a tip by the rail ("These buttons open the full data", "Got it"). It sits over part of the key on desktop. Every run starts as a first-time visitor.
- A live feed being down shows up under `network` in `report.json`, never as a page error. The app shows its snapshot instead ("SNAPSHOT · saved ..." in the header) and must never read an empty feed as an all-clear.
