# ASEAN Watch verification map

This directory is the maintained source for verifying what a user of ASEAN Watch can see and do. Read this index before driving the app, then use the matching feature file as the recipe. The harness is `aw-verify` (`npm run verify -- <command>`), described in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- `npm ci` has run in this checkout.
- `npm run verify -- doctor` reports `ok: true` (a browser starts; any recorded server is alive, ours and from this checkout).
- The map starts at its regional view (South-east Asia) with nothing selected: open the bare URL, no `#` hash. Every card journey reloads to this state first.
- Data comes from the bundled snapshots in `data/` plus live public feeds. Nothing is seeded or mocked. Values change between runs.
- Never drive an instance this run did not start, unless it was passed with `--url` on purpose.

## Driving conventions

- Prefer accessible names and the app's own attributes (`aria-pressed`, `aria-label`, `data-lon`/`data-lat`, the URL hash) over CSS position or tab order.
- Desktop is 1366 x 768. Phone is 375 x 812, touch, device scale 2. The layout switches to the phone sheet below 768 px.
- The app keeps view state in the hash: `#ws=<section>` (open workspace section) and `#sel=<selection>` (open card). Read it after each action as a second view of the state.
- Opening a card flies the map in. Reload (journeys do this) before the next card.

## Proof and skip reporting

- A step proves the user action and the resulting state: what was clicked, the card or drawer title, the URL hash, and a screenshot.
- A card is open only if the point under its middle belongs to the card (not the workspace sheet or another panel).
- Uncaught exceptions and `console.error` fail the step. Network failures are listed and reported, not failed.
- A `skip` names the missing entry point and the size it is missing at. Do not report a skipped entry point as verified through a different path.
- Record the feature file and the entry point used with every proof you report.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behaviour. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with aw-verify`, `Gotchas`.

## Features

- [Map view](./map-view.md) covers the first screen: map, header sentence, alerts button, map key, and no sideways scroll.
- [Layer chips](./layer-chips.md) covers the six map-layer toggles and the "More layers" chip.
- [Volcano card](./volcano-card.md) covers clicking a volcano triangle and its card.
- [City card](./city-card.md) covers clicking a city's haze circle and its card.
- [Fire card](./fire-card.md) covers fire-count badges, the Fires section's "Fly to" rows, and their card.
- [Workspace sections](./workspace-sections.md) covers the left rail (bottom bar on phones) and all nine sections.

## Not mapped yet

These are real user paths with no journey yet. A change to one of them needs a manual proof (built-in browser or a scratch Playwright script) until someone adds it here and to `aw-verify`:

- Haze forecast scrubber and the Play button (bottom dock).
- "Play ash scenario" on a volcano card.
- Official warning pins on the map and the alerts button opening the Warnings section.
- Dark / light theme buttons in the details view.
- Report section: compose and download.
- Tide gauge and earthquake charts (pins drawn on the canvas).
- Clicking fire squares on the canvas (city circles sit on top of the biggest clusters at the regional view).
- The other workspace rows that move the map: Fires section country, province and state rows ("Fly to <name>"), Haze section city rows ("Show this place on the map", which also opens the city card) and smoke-path rows ("Fly the map to this cluster"). On a phone each must leave the map in view, like the clusters list does.
