# UX v3: one map for the public, one workspace for analysts

Decided 2026-10-15 from Jenson's review of v2:

> "your UI UX is really clunky... very confusing whenever I even press around"
> "when I press like Merapi, it should not be as detailed as the backend, because it's a world eye view"
> "the main concept is for you to know where the haze is coming from, the projections forward... you can see the haze, you can see if a volcano erupts how it will affect us... wind"
> "if you want a report, you can go to the side of it, like maybe add a taskbar. Then you can intentionally make it complex... wordy... helpful for the analysts making reports for the environment association"
> "the light version isn't as good"; "HazeView's map was really, really fun"; add Copernicus Fire Emissions Watch-style fire features.

The rules in `docs/CONTRACT.md` still hold:
- real data only;
- MEASURED, MODELLED and OFFICIAL kept visibly apart;
- official warnings relayed verbatim in the reserved red style, and we never issue our own;
- absence is never an all-clear.

## 1. Two modes, one map

| | **Map** (default, anyone) | **Analyst workspace** (side taskbar) |
|---|---|---|
| Question | Where is the smoke coming from, where is it going in the next 48 h, and what would a volcano eruption do to us? | What exactly do the data say, how sure are we, and what goes in my report? |
| Density | Calm. A few big, readable things. One sentence per card. | Dense and wordy on purpose: tables, charts, methods, caveats, citations, export. |
| Interaction | Click a thing → a small card (3 facts, 1 plain sentence, 1 "Open report" link) | Sections in a wide drawer; selecting on the map syncs the drawer |

The map is always the product. The workspace opens beside it. It never replaces the map.

## 2. Map mode (what a first-time visitor sees)

**The screen, top to bottom:**

- **Top-left: brand and headline sentence.** "ASEAN Watch" plus one live sentence generated from data, for example: "Now: haze is worst over Palangka Raya (604 µg/m³, modelled). Low-level winds carry smoke north-west toward Singapore." Include the time and a freshness chip (LIVE / SNAPSHOT <time>).
- **Top-right: Official alerts pill.** It shows the count of active official messages in the region and turns red when any is a tsunami warning or evacuation-level message. Clicking it opens the workspace's Official warnings section. Also here: the theme toggle and a "Workspace" button.
- **Left edge: the taskbar.** A slim icon rail, always visible, with tooltips: Map, Situation, Haze, Fires, Volcanoes, Warnings, Tsunami (the Tsunami & floods section; was "Water" until round 6), Report, Sources. Clicking an icon opens that workspace section in the drawer; clicking Map closes the drawer.
- **Bottom: one time scrubber** (−24 h … now … +48 h, 3-hourly) with play. It has HazeView-style bars showing the worst city for each step, a compact PM2.5 colour scale, and the MODELLED label. It drives the haze, the wind particles, the city circles and the eruption scenario.
- **Above the scrubber: layer chips,** at most six: Haze, Wind, Fires, Volcanoes, Warnings, Satellite. Every other layer (tide gauges, rivers, quake detail, BMKG tsunami areas, Himawari IR, 3D buildings…) lives in the workspace's Layers list.

**On the map (the fun part, inspired by HazeView; deck.gl and MapLibre):**

- **Cities** are big glowing circles sized and coloured by modelled PM2.5, each labelled with its value. The worst city pulses gently.
- **Haze** is a soft, animated cloud with warm amber to purple tones. It plays with the scrubber.
- **Wind** shows as thousands of particle trails at 925 hPa, the smoke-transport level.
- **Fires** are a glowing FRP heat grid. At regional zoom they collapse to cluster badges such as "Riau · 312 hotspots".
- **Volcanoes** are triangles ringed in the colour of their official MAGMA or PHIVOLCS level, with that level shown verbatim on hover.
- **Ash scenario:** "If it erupted now". An animated plume runs along the forecast upper winds and plays with the scrubber. It is labelled MODELLED SCENARIO, not a prediction.
- **Official warnings** are red pins in the reserved style.
- **Smooth transitions:** fly-to on select, fading layers, and no layout jumps.

**Cards (small, the same anatomy everywhere):**

- Header: icon, name, and the layer type label (MODELLED / MEASURED / OFFICIAL).
- Up to three key facts, with big numbers.
- One plain sentence of meaning.
- Footer: "Open in workspace →", plus the source in small text.

**What each card shows:**

- **City:** PM2.5 now (modelled), its band, the multiple of the WHO 24-hour guideline, and its peak in the next 48 h with the time. Where the air is coming from, e.g. "Air arriving from the south-east: Central Kalimantan fires" (from trajectories). Then the national agency to check.
- **Volcano:**
  - the official level, verbatim, with the issuer;
  - "If it erupted now, ash at 5–10 km would drift toward <compass> (modelled)";
  - the nearest affected cities with arrival times;
  - a "Play ash scenario" button.
  - Distance rings are labelled "distance only; the agency's hazard map is the authority", with a link to it.
  - No evidence records, watch rules or day replay: those are workspace material.
- **Fire cluster:**
  - hotspots in the last 24 h and 7 days;
  - total FRP (MW);
  - the trend against the previous days;
  - "Smoke from here is heading toward <place> (modelled)".
- **Official warning:** the verbatim headline and level, the issuer, the issued time, and "Follow <issuer>".

## 3. Analyst workspace (the drawer)

The drawer is 480–560 px on desktop and a full-height sheet on mobile. It has a sticky section header and section tabs, and uses dense typography. Every number cites its source and time, and every model output carries MODELLED. Sections:

1. **Situation.** An auto-generated situation report (deterministic text) and a key-figures table: worst cities, biggest fire regions, volcano levels, active official warnings.
2. **Haze & air.**
   - A city table: now, 24 h peak and time, WHO multiple, and the trend.
   - NEA Singapore measured PSI and PM2.5 beside the modelled figure.
   - Smoke transport toward Singapore from fire clusters (trajectories, with caveats).
   - Links to the regional authority (ASMC) and to NUS CRISP satellite imagery.
3. **Fires** (Copernicus Fire Emissions Watch style).
   - Hotspot counts and summed FRP by country and by Indonesian province, with 7 daily bars each.
   - Top clusters, with a "fly to" action.
   - Week-over-week change.
   - The FIRMS sensor mix and a methods note: FRP is a proxy for emissions, and CAMS GFAS converts FRP to emissions.
   - A deep link to Fire Emissions Watch.
4. **Volcanoes.**
   - The watch areas (four volcanoes, two haze boxes).
   - The existing seven-day evidence replay: queue, detail, evidence timeline, replay bar, record inspector, and "Why this state?".
   - Ash-drift numbers for each pressure level.
   - The official level, verbatim.
5. **Warnings.** The full official-warnings list, verbatim, with feed status, and GDACS labelled as an aggregator.
6. **Tsunami & floods** (rail label "Tsunami"). Tide gauges, GloFAS river flow (modelled), PTWC, BMKG tsunami areas, and the flood gauge relays.
7. **Report.**
   - A brief composer: pick the sections, then download .md or .txt, or copy.
   - Every figure carries its citation.
8. **Sources & methods.** Every feed with its licence, retrieval time and mode, plus the limitations.
9. **Layers.** The full layer list with explanations: every toggle that is not a map chip.

## 4. Visual system

- Dark is the default. Light must be designed, not inverted:
  - a light basemap;
  - overlays recoloured for contrast on light, e.g. dark particles, multiply-blended haze, and city circles with dark outlines;
  - panels using light surfaces with real shadows;
  - WCAG AA text in both themes.
- Colour tokens live only in `src/index.css`. Components use tokens; they never use hex. Map overlay colours come from one theme-aware palette module.
- Typography:
  - map mode uses large numbers and short labels;
  - the workspace uses compact 13 px body text, tabular numbers and table rules.
- Motion is purposeful: particles, haze play, the pulse on the worst city, the plume animation, and the drawer slide. `prefers-reduced-motion` disables pulses and particles and slows playback.

## 5. Acceptance (what the reviewer checks)

- A first-time visitor can answer "where is the haze worst, where is it coming from, and where is it going" within 10 seconds without opening anything.
- Clicking Merapi shows a small card, never the evidence machinery, and "Play ash scenario" animates a plume.
- The taskbar opens each workspace section. The workspace has real depth: tables, charts, methods, export.
- Light theme screenshots look intentional at 1366 px and 390 px.
- No console errors. Typecheck, tests and build pass.
