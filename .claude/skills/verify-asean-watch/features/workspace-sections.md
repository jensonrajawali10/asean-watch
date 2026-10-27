# Workspace sections

The analyst workspace: a dense panel for people writing reports, opened from the rail on the left (a bottom bar on phones). Nine sections: Situation, Haze, Fires, Volcanoes, Warnings, Tsunami, Report, Sources and Layers. On desktop it is a side panel next to the map; on a phone it is a full-screen sheet.

## Sub-features

- `ws-open` each rail button opens its section, sets `#ws=<id>` and shows its title in `#ws-drawer-title`.
- `ws-tabs` inside the panel, a "Sections" tab row switches between sections.
- `ws-close` "Close the workspace (Esc)" closes it.
- `ws-link` a link with `#ws=<id>` opens the section directly.

Section ids and titles: `situation` Situation, `haze` Haze & air, `fires` Fires, `volcanoes` Volcanoes, `warnings` Official warnings, `water` Tsunami & floods, `report` Report, `sources` Sources & methods, `layers` Layers.

## How to get to it (user POV)

- Click a button in the rail (navigation "Workspace sections"). The Warnings button's name carries the message count: "Warnings (40 active official messages)".
- Card actions such as "Open in workspace" and the "More layers" chip.
- A shared link with `#ws=fires`.

## Driving it with aw-verify

Preconditions:

- Baseline.

- **Open each section.** Run `npm run verify -- run --journey workspace`. One step per rail button, `workspace-<name>`: click it, wait for `.app[data-drawer="open"]`, record `saw.drawerTitle`, `saw.hash` (`#ws=<id>`) and `saw.chars` (text length), screenshot `<viewport>-<nn>-ws-<name>.png`.
- **No broken section.** Same steps fail if the panel shows "could not be shown", the wording of the app's error boundaries ("This part could not be shown (...)").
- **Close.** Each step ends with "Close the workspace (Esc)" and waits for `.app[data-drawer="closed"]`.
- **Link.** Run `npm run verify -- open --hash "ws=warnings" --viewport phone`. `drawer` is "Official warnings".

## Gotchas

- The Tsunami button opens section id `water` (`#ws=water`), titled "Tsunami & floods".
- On a phone the sheet covers the map and the cards. Any section action that should show something on the map must close the sheet on phones (the ash scenario does).
- Sections fill in from live feeds after they open; the step waits for network idle up to 5 s, then screenshots what is there.
- Warnings text is copied word for word from the agencies, in their languages. Never assert translated wording.
