# City card

Cities are coloured circles sized by their modelled fine-smoke (PM2.5) level. Clicking one opens a card with the forecast value, how many times the WHO daily guideline it is, the worst hour in the next 48 hours, where the air is arriving from, and a 48-hour chart. Every figure is labelled MODELLED.

## Sub-features

- `city-open` clicking a city circle opens its card and sets `#sel=city:<id>`.
- `city-modelled` the card carries the MODELLED tag and says it is a forecast, not a measurement.
- `city-close` the close button (or Esc) closes it.
- `city-link` a link with `#sel=city:<id>` opens the same card.

## How to get to it (user POV)

- Click a circle on the map (canvas, no button). City ids are the `id` values in `data/aq-snapshot.json` `places` with `kind: "city"`, e.g. `palangka-raya`, `singapore`.
- Haze section: rail button "Haze", then a row in the city table.
- A shared link with `#sel=city:singapore`.

## Driving it with aw-verify

Preconditions:

- Baseline. The Haze chip is on (default): the circles belong to the Haze layer.

- **Click a circle.** Run `npm run verify -- run --journey cards`. Step `card-city` reads the map projection from the overlay buttons (`saw.projection.anchors`, `residualPx` under 2), then clicks the first city in Palangka Raya, Pekanbaru, Jambi, Kuching, Pontianak, Singapore, Kuala Lumpur, Bangkok whose centre is on screen and on the canvas.
- **Card.** Same step. `section.mcard.city-card` appears on top, its title is the city, and the hash is `#sel=city:<id>`. Screenshot `<viewport>-<nn>-city-card.png`.
- **Close.** Same step. The card closes.
- **Link.** Run `npm run verify -- open --hash "sel=city:singapore" --viewport phone`. `card.title` is "Singapore", `cardOnTop` is `true`.

## Gotchas

- Circles are drawn on the canvas, so there is no accessible name to click. The projection fit refuses to click when the map is rotated or pitched (residual over 2 px): reset north first.
- At the regional view a city circle can sit on top of a fire cluster, so clicking a fire's position may open a city instead.
- The PM2.5 value, the worst hour and the wind direction are live forecasts. Assert that they are present and tagged MODELLED, never their numbers.
