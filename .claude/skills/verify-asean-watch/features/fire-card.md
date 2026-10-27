# Fire card

Fires are NASA FIRMS satellite heat detections, labelled MEASURED. A fire card shows a country, region or cluster: hotspots in the last 24 hours, fire power, the change on the day before, and a 7-day bar chart. The detections are not confirmed fires, and the card says so.

## Sub-features

- `fire-badge` in the details view, fire-count badges ("Papua New Guinea · 4,067 hotspots ...") sit on the map; clicking one opens that country's or region's card.
- `fire-list` the Fires section lists the top fire clusters; "Fly to" on a row flies the map there and opens the cluster's card.
- `fire-visible` the card is visible on top, on a phone too.
- `fire-link` a link with `#sel=fire:24h-1` (cluster) or `#sel=fire:region-badge:<ISO3>` opens the card.

## How to get to it (user POV)

- Click "Show details" in the header ("Details" on phones), then a fire-count badge on the map. Badge names read "<place> · <n> hotspots in the last 24 hours (NASA FIRMS satellite detections, not confirmed fires)".
- Rail button "Fires", then "Fly to" on a row of the "Top fire clusters" list.
- Rail button "Fires", then a country, Indonesian province or Malaysian state row's fly button (title "Fly to <name>"). It flies the map only; no card opens. Not driven yet.
- Click an orange fire square on the map (canvas; not driven yet, see Gotchas).
- A shared link with `#sel=fire:24h-1`, or `#ws=fires&sel=fire:24h-1` to open the Fires section too.

## Driving it with aw-verify

Preconditions:

- Baseline. The Fires chip is on (default).

- **Badge.** Run `npm run verify -- run --journey cards`. Step `card-fire` clicks "Show details" ("Details" on phones), clicks the first badge not covered by another control, checks the card, then clicks "Simple view" ("Simple" on phones) to go back. Screenshot `<viewport>-<nn>-fire-card-map.png`; `saw.badge` names the badge.
- **List.** Same run, step `card-fire-list`: rail "Fires", then the first `ol.fires-clusters button.fires-fly`. The card must be on top and the hash must contain `sel=fire:`. Screenshot `<viewport>-<nn>-fire-card-list.png`.
- **Link.** Run `npm run verify -- open --hash "sel=fire:24h-1" --viewport phone`. `card.title` is the top cluster ("Pulang Pisau, Central Kalimantan ...") and `cardOnTop` is `true`. With `ws=fires&` in front, the phone shows the Fires sheet over the card and `cardOnTop` names the workspace sheet: that is the link asking for the section, not a bug.

## Gotchas

- The label planner drops badges it cannot fit beside the header and dock. Before 27 Oct's shorter phone header none fitted at 375 px; if that happens again, `card-fire` reports `skip` on the phone and the Fires section is the way in.
- On a phone the workspace is a full-screen sheet, so "Fly to" closes it to show the map and the card. If it ever leaves the sheet open, the card opens behind it and the user sees nothing change; `card-fire-list` then fails with "covered by the workspace sheet". On desktop the workspace is a side panel and the card shows beside it.
- At the regional view the biggest clusters (Central Kalimantan) sit under Palangka Raya's city circle, so a canvas click there opens the city card. That is why the canvas path is not driven.
- Counts and fire power come from the FIRMS snapshot or relay and change between runs.
