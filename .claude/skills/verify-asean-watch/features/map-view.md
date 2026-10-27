# Map view

The first screen: a full-screen map of the region with the haze forecast, wind streaks, fires, volcano triangles and official warning pins, a header card with one plain sentence about the worst haze right now, the official-alerts button, and the layer chips and forecast bar at the bottom.

## Sub-features

- `map-ready` the map draws and the "Loading the map..." text goes away.
- `map-headline` the header shows "ASEAN Watch" and the worst-haze sentence.
- `map-alerts` the header has the official-alerts button with its count (wording in its `title`).
- `map-markers` the volcano triangles and warning pins are on the map as buttons.
- `map-fit` the page never scrolls sideways at desktop or phone width.

## How to get to it (user POV)

- Open the site with no `#` in the address.
- A shared link with `#ws=...` or `#sel=...` opens the same map with a section or card already open.

## Driving it with aw-verify

Preconditions:

- Baseline (see README). Nothing else.

- **Load.** Open the site. Run `npm run verify -- run --journey map`. Step `map-load` passes when `.mv-overlay[data-ready="true"]` appears and "Loading the map" is gone.
- **Header.** Same step. `saw.headline` is "ASEAN Watch" and `saw.alertsButton` reads like "40 official alerts in force: volcanoes, floods, earthquake. Open the official warnings."
- **Markers.** Same step. `saw.volcanoMarkers` is 4 (Merapi, Semeru, Anak Krakatau, Sinabung) and `saw.warningPins` is the number of official messages drawn.
- **Fit.** Same step. `saw.layout.scrollWidth` equals `saw.layout.innerWidth` at both viewports.
- **Proof.** Screenshot `<viewport>-01-map.png`, plus `open` for an ARIA snapshot: `npm run verify -- open --viewport phone`.

## Gotchas

- The map needs WebGL. Headless Chrome provides it through software rendering; a first load can take 5-10 s.
- The alerts count and the worst-haze city come from live feeds and change between runs. Assert they exist, not their values.
- On phones the header is taller and covers the top third of the map; the chips row scrolls sideways (Satellite is off screen until scrolled).
- A live feed being down shows up under `network` in `report.json`, never as a page error. The app shows its snapshot instead and must never read an empty feed as an all-clear.
