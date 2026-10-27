# Volcano card

Each watched volcano (Merapi, Semeru, Anak Krakatau, Sinabung) is a triangle ringed in the colour of its official MAGMA alert level. Clicking it flies the map in and opens a card with the official level word for word, who issued it and when, and a "Play ash scenario" button.

## Sub-features

- `volcano-open` clicking a triangle opens its card and sets `#sel=watch-<name>`.
- `volcano-level` the card shows the official level verbatim with its issuer (PVMBG via MAGMA Indonesia).
- `volcano-close` the card's close button (or Esc) closes it and clears `sel`.
- `volcano-link` a link with `#sel=watch-merapi` opens the same card.

## How to get to it (user POV)

- Click a triangle on the map. Its accessible name starts with the volcano name, e.g. "Merapi, volcano. Official level: Level III (Siaga) ...".
- Volcanoes section: rail button "Volcanoes" (rows select a watch area).
- A shared link with `#sel=watch-merapi`.

## Driving it with aw-verify

Preconditions:

- Baseline: the regional view, nothing selected (the journey reloads to it).

- **Click a triangle.** Run `npm run verify -- run --journey cards`. Step `card-volcano` clicks the first of Merapi, Semeru, Anak Krakatau, Sinabung whose triangle is not under another marker's name tag, and records the ones it passed over in `saw.tried`.
- **Card.** Same step. `section.mcard` appears on top, its title contains the volcano clicked, and the hash is `#sel=watch-<name>`. Screenshot `<viewport>-<nn>-volcano-card.png`.
- **Close.** Same step. The card's "Close ..." button removes `section.mcard`.
- **Link.** Run `npm run verify -- open --hash "sel=watch-merapi"`. `card.title` is "Merapi" and `cardOnTop` is `true`.

## Gotchas

- On a phone at the regional view, Merapi's triangle sits under Semeru's name tag, so the phone run opens Semeru (see `saw.tried`). That is the honest user experience at that size, not a harness fault.
- The card flies the map in to Java. Anything after it that needs the regional view must reload.
- The level text is Indonesian and verbatim ("Level III (Siaga)"). Never assert a translated or reworded level.
