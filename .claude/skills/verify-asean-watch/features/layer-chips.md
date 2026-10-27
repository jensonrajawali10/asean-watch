# Layer chips

A row of chips under the map turns map layers on and off: Haze, Wind, Fires, Volcanoes, Warnings and Satellite. A seventh chip, "More layers", opens the Layers section of the workspace with every other layer and an explanation of each.

## Sub-features

- `chip-toggle` each chip flips its layer and its `aria-pressed` state, and flips back on a second click.
- `chip-defaults` Haze, Wind, Fires, Volcanoes and Warnings start on; Satellite starts off.
- `chip-more` "More layers" (or "+N more on" when extra layers are on) opens the Layers section (`#ws=layers`).

## How to get to it (user POV)

- Click a chip in the row at the bottom of the map (group "Map layers").
- On a phone, swipe the chip row sideways to reach Satellite and More layers.
- The Layers section lists the same layers and more: rail button "Layers", or `#ws=layers`.

## Driving it with aw-verify

Preconditions:

- Baseline. Run `npm run verify -- doctor` if the chips are missing.

- **Toggle every chip.** Click each chip twice. Run `npm run verify -- run --journey layers`. Step `layers-chips` records, per chip, `before`, `toggledTo` and `restored` from `aria-pressed`, with one screenshot of the toggled state (`<viewport>-<nn>-chip-<label>-<on|off>.png`).
- **Defaults.** Same step. `saw.chips[].before` is `true` for Haze, Wind, Fires, Volcanoes, Warnings and `false` for Satellite.
- **More layers.** Click "More layers". Same run, step `layers-more`. The workspace opens with title "Layers" and the hash contains `ws=layers`.
- **Proof.** Compare a chip's `-off` screenshot with `<viewport>-01-map.png`: the layer is gone from the map (for example no orange squares with Fires off).

## Gotchas

- Chips are found by `role=group[name="Map layers"] button[aria-pressed]`. "More layers" has no `aria-pressed`; it is `button.mv-chip--more`.
- Turning Volcanoes off removes the triangles, so card journeys must not run in the middle of this one (they reload first anyway).
- The Satellite layer loads Himawari imagery from NASA GIBS. When GIBS is slow its screenshot may show the map before the image arrives.
- Layer state is not in the URL hash; a reload resets it.
