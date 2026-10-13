# UX review: ASEAN Watch demo

Owner: UI/UX orchestrator. Phase 1 (read-only review) written against the code as of 13 October 2026. At that point `App.tsx` was a placeholder, `App.css` did not exist, and every panel component was written but unstyled. `RegionMap.tsx` and `RegionMap.css` were built but without the NEA props. `NeaContextCard.tsx` existed, and `src/lib/nea.ts` was still a stub. Phase 2 results go in section 7.

## 0. Top principle: make it straightforward

Jenson's direction: **make it straight forward.** This rule overrides any other item in this file.

- **One obvious path through the demo:** select Merapi → **Next step** → **Next step** → **Why this state?** → record inspector → **Generate brief** → **Download .txt** → **Reset**. Each control sits where the previous step leaves the eye: left (select), top (replay), right column top to bottom (state, why, evidence, brief), then top again (Reset). The NEA beat at the end is one click: select Riau.
- **Plain, short labels.** The control labels from the docs are fixed: "Next step", "Play", "Reset", "Why this state?", "Generate brief", "Download .txt". Everything else says what it is in a few words. No jargon on screen ("deterministic", "fixture"), and no explanatory paragraphs where a label will do.
- **Fewest elements on screen at once.** On the main screen: state, what changed, the evidence list, and the next action. Secondary detail goes behind a disclosure or into the inspector: full record fields, quality notes, rule text, derivation lines, scenario window, roadmap, and the incident's long summary.
- **No decorative extras.** If an element does not help a judge follow the four-minute script, cut it or collapse it. That includes animation: nothing pulses.
- **Honesty labels stay visible:** the DEMO REPLAY banner; SIMULATED on every scenario record; "Scenario clock (fictional)"; one line next to the state saying it is not an official alert level; and, on the NEA layer, LIVE or HISTORICAL SNAPSHOT with the reading time, plus "not a dispersion model" on the drift cone. These carry information, so they are not clutter.

## 1. Target screen and constraints

**Projector viewport.** A 1366×768 display in a windowed Chrome on Windows leaves about **1366×630 to 660 CSS px** of viewport (48 px taskbar plus about 85 px of browser chrome). In F11 full screen it is 1366×768. Design for the worst case: **every element on the demo path is visible at 1366×650 without page scroll.** Columns may scroll internally. Also check 1536×730 (a 1920×1080 laptop at 125 % scaling), the most common Windows laptop setting.

**Recommended layout.** The components already fit this. Only `App.tsx` and `App.css` arrange them.

```
┌ Header, about 44 px: [mark] ASEAN Watch · Environment     DEMO REPLAY · simulated incidents · not an official warning ┐
├ Replay bar, about 52 px, sticky: Baseline → Thermal observation → Gas observation │ Step 2 of 3 · Scenario clock (fictional) … │ [Next step] [Play] [Reset] ┤
├──────────── Map (dominant, about 58 % width, fills height) ────────┬──── Selected incident (about 42 %) ─────────────┤
│                                     ┌ zoomed inset ┐              │ Merapi volcanic observations                   │
│     ASEAN map, markers always        │ (NEA layer   │              │ Central Java, Indonesia · 7.54° S, 110.446° E  │
│     labelled with name and state     │  for Riau)   │              │ Smithsonian GVP 263250 ↗                       │
│                                      └──────────────┘              │ [ REVIEW NEEDED ]  Thermal + Gas               │
│                                                                   │ Workflow state, not an official alert level.   │
│                                                                   │ ▸ Why this state?                              │
├──── Incident queue: 3 compact cards in a row ─────────────────────┤ (Riau only: NEA context card, compact)         │
│ [Merapi …] [Riau …] [Ayutthaya …]                ▸ Roadmap        │ Evidence, newest first (scrolls)               │
│                                                                   │ [Generate brief]  [Download .txt]  (pinned)    │
└───────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────┘
```

- Main area height is `100dvh` minus header and replay bar. The map container gets a definite height (`flex: 1; min-height: 0`); `RegionMap` already letterboxes with `preserveAspectRatio="xMidYMid meet"` and container queries.
- The right column is a single scroll container: detail head, then Why, then the NEA card (Riau only), then the timeline, with the brief actions pinned at its bottom edge.
- DOM order matches visual order (header, replay, map, queue, detail, timeline, brief), so Tab order follows the demo path.
- Below about 1100 px, the map and queue stack above the detail column. At 375 px everything is one column, and the header and replay bar stay sticky in a compact form of at most about 110 px.

**Scales (proposed).** Token names in `index.css` are contract, so add tokens or change values, but never rename.

| Scale | Values |
|---|---|
| Type | 13 px for meta, labels and badges (minimum; map labels may go to 12 px) · 14 px secondary · **15 px body** · 17 px panel titles · 20 px incident title · **20 to 22 px large state badge** · `font-variant-numeric: tabular-nums` on times and values · weights 400 and 600 (no 800) |
| Space | 4, 8, 12, 16, 24, 32 px only |
| Radius | 6 px for panels, buttons, dialogs and map overlays · 4 px for badges and tags · no fully rounded pills except the step number dot |
| Border | 1 px `--border`, darkened to about `#c4cad3`, because light borders disappear on projectors · selected = 3 px accent left bar plus 1 px accent border |
| Shadow | Dialogs and map overlays only; panels use borders |

**Badge system.** These must never be confused with each other:

| Badge | Meaning | Style |
|---|---|---|
| SIMULATED | Scenario record or incident made up for the demo | Filled purple tint, uppercase text |
| HISTORICAL / HISTORICAL SNAPSHOT | Real data from the past (the NEA bundled snapshot) | Outlined neutral or green, uppercase text, always followed by the reading time |
| LIVE | Real data fetched this session (NEA only) | Outlined dark ink with a **static** dot, uppercase text, always followed by the reading time. Not red, because red reads as an alarm and competes with Review needed |
| Monitoring / Check observation / Review needed | Workflow state (never an alert level) | Neutral → amber outline → solid amber, text always present |
| Counted / Not counted | Rule treatment of one record | Small text tag, neutral |

## 2. Demo storyboard (what must be on screen, legible from the back of the room)

Legible from the back means: state labels at 20 px or more, controls at 15 px or more with high contrast, and nothing that depends on a light tint alone.

| Time | Beat | Must be on screen at 1366×650 | Must be legible from the back |
|---|---|---|---|
| 0:00–0:35 | Regional overview | DEMO REPLAY banner. Full ASEAN map with country boundaries and three **always-visible** marker labels (Merapi · Monitoring, Riau · Check observation, Ayutthaya · Monitoring). Queue with three incidents, each with a state badge and SIMULATED. The detail column says "Select an incident on the map or in the queue" with one primary button, **Open Merapi volcanic observations**. The replay bar is visible but disabled, with the short note "Select Merapi to replay." | DEMO REPLAY; map shape; the three marker labels; queue titles |
| 0:35–1:05 | Select Merapi (marker click; the queue entry works the same) | Selected marker highlighted with a static ring and a callout (name, coordinates, state). Locator inset around Merapi. Queue card selected (left bar, not only a tint). Detail: title, "Central Java, Indonesia · 7.54° S, 110.446° E", Smithsonian catalog link, large **Monitoring** badge. The timeline shows 3 baseline records, each with Observed and Ingested on one labelled line, SIMULATED, and its source. Replay bar: "Baseline · Step 1 of 3 · Scenario clock (fictional) 2026-10-01 10:00 UTC". **Next step** enabled and primary. No NEA card and no "no coverage" box in the detail column | Monitoring; Merapi title; Next step |
| 1:05–1:35 | Next step → Thermal observation | Badge becomes **Check observation**. Two thermal records at the top of the timeline, tagged **New**. The first says **Counted**; the second says **Not counted: Same category as an earlier anomaly; not independent corroboration**, visible without opening anything (the backup recording holds on it). The map marker's ring style and label text change | Check observation; Counted / Not counted |
| 1:35–2:00 | Next step → Gas observation | Badge becomes **Review needed** (amber, the strongest visual state on screen), with "Thermal + Gas" next to it and "Workflow state, not an official alert level." directly under it. The new gas record is tagged New and Counted. The marker is amber with a text label | Review needed; Thermal + Gas |
| 2:00–2:50 | **Why this state?**, then the record inspector | One click opens Why in place: the rule in one sentence, then one line per visible record (Counted / Not counted, record name, reason). One click on the gas record opens the inspector, with **value, Observed, Ingested, SIMULATED, source name and link, quality note, review treatment** all visible without scrolling the drawer. DEMO REPLAY stays readable behind a light backdrop | Rule sentence; Observed vs Ingested; SIMULATED |
| 2:50–3:25 | **Generate brief** → **Download .txt** | Preview dialog with the brief in monospace at 13 px or more, wrapped (no horizontal scroll). **Download .txt** sits in the dialog header and is never pushed off-screen by long lines. After the click, the status reads "Download started: asean-watch-brief_inc-merapi-demo_step-2.txt" | Download .txt; the status line |
| 3:25–3:40 | **Reset** | Replay back to Baseline, state Monitoring, brief cleared ("No brief yet") | Monitoring |
| 3:40–4:00 | **Select Riau** → zoomed view with NEA wind and haze | Riau selected. The zoomed inset (around Riau, with Singapore in frame) shows: the simulated hotspot marker; a **wind arrow** pointing downwind, labelled "Wind from SW (226°), 4.1 kn"; an **illustrative drift cone** from the hotspot, labelled on the map "Illustrative drift, not a dispersion model"; a **Singapore PSI chip** ("24-h PSI 52–60, Moderate · NEA"); and a **LIVE** or **HISTORICAL SNAPSHOT** tag with the reading time. The detail column shows the Riau incident (SIMULATED, Check observation) and the compact NEA context card with "Context only; does not change the review state." Replay controls disabled with "Replay applies to Merapi." | LIVE or HISTORICAL SNAPSHOT; the wind arrow; "not a dispersion model"; the PSI value |

The last two rows change the timing in `docs/DEMO_SCRIPT.md` (owned by docs). Suggested words for 3:40–4:00: "The haze example sits next to real NEA readings from Singapore: wind and PSI, live if we have network, otherwise a saved real snapshot, and the tag says which. The drift cone is illustrative, not a dispersion model, and it never changes the review state. Next we would validate a live adapter with a local observatory."

## 3. UX acceptance checklist

Run in phase 2 at 1366×650 (windowed), 1366×768 (F11), 1536×730, about 1024 px and 375 px, plus keyboard only, plus once with the network off.

**Straightforward**
- [ ] The demo path in section 0 works with the mouse alone, without scrolling the page at 1366×650.
- [ ] At most one primary (filled) button is visible per region: Next step in the replay bar, Generate brief in the brief area, and Download .txt in the preview dialog.
- [ ] No paragraph on the main screen is longer than two lines. Longer text lives in a disclosure, the inspector or the brief.
- [ ] Each fact appears once on the main screen (no repeated coordinates, no repeated replay step, no per-category cards that repeat the timeline).
- [ ] Incidents out of NEA range (Merapi, Ayutthaya) add at most one muted line about NEA coverage, and never a card.

**Hierarchy**
- [ ] The map is the largest element on screen at desktop widths (at least 50 % of the main area).
- [ ] The review state badge is the most prominent text in the detail column.
- [ ] The replay bar and the DEMO REPLAY label are visible at all times, including while the right column scrolls. On narrow screens they stay sticky in a compact form.
- [ ] State badges always carry their text label (Monitoring, Check observation, Review needed); colour and shape are secondary. Map markers carry the same text in an always-visible label, and the legend repeats it.
- [ ] Review needed is amber and Monitoring is neutral. Check observation does not use the link or accent blue (today it does; see P1-3).
- [ ] SIMULATED appears on every scenario record (timeline, inspector, queue). Source badges are prominent and say "Modelled on …", so a simulated record never reads as the measured product.
- [ ] Observed and Ingested are separate, labelled times on every record, and every scenario time is marked as fictional.

**NEA context layer**
- [ ] Shown only for incidents within NEA range (Riau). It never appears inside the evidence timeline, the Why panel or the review state block, and it never changes a state.
- [ ] Exactly one data-mode tag, LIVE or HISTORICAL SNAPSHOT, followed by the reading time. It never says SIMULATED, and it never sits next to a SIMULATED badge without its own label. A judge can tell in one glance that the hotspot is simulated and the wind is real.
- [ ] The wind arrow points **downwind** (the direction the wind blows toward), and its label states "from" in words: "Wind from SW (226°), 4.1 kn". Variable wind is said in words, not shown as a confident arrow.
- [ ] The drift cone has the text "Illustrative drift, not a dispersion model" on the map itself, not only in the card. No gradient plume, no time marks along the cone, no distance rings: nothing that looks like a model output or a forecast.
- [ ] The PSI chip shows "24-h PSI" with its value range, NEA's own band word, "NEA", and the time. It is neutral in colour, not red or amber, so it is not confused with review states.
- [ ] Wind and PSI are labelled as measured at NEA Singapore stations; the drift text says Singapore wind is applied to a location about 170 km away.
- [ ] Source link and Singapore Open Data Licence attribution are present (small text is fine).
- [ ] While loading, a reserved-height line says "Loading NEA context…", so the layout does not jump. With the network off, the snapshot appears within the 5 s timeout, the tag reads HISTORICAL SNAPSHOT, and the "Live NEA feed unavailable; showing saved snapshot." line is visible.
- [ ] There is no auto-refresh, no ticking clock and no pulse. LIVE means "fetched at page load", and the reading time shows how old it is.

**Reach**
- [ ] "Why this state?" opens in one click from the detail column.
- [ ] The record inspector opens in one click from any timeline record, and from any record line inside Why.
- [ ] Generate brief opens the preview; Download .txt is one more click.
- [ ] Riau's NEA view needs one click (select Riau on the map or in the queue); there is no separate zoom control to find.

**Keyboard, focus, contrast, motion**
- [ ] Every control, including each map marker, is reachable by Tab and operable with Enter or Space. Focus is always visible (2 px outline with offset).
- [ ] Dialogs: focus moves in on open, Esc closes, and focus returns to the opener.
- [ ] Keyboard shortcuts (→ for next step, R for reset) do nothing while a dialog is open, while focus is in a text field or the brief preview, or while a modifier key is held.
- [ ] Text contrast is at least 4.5:1 on every background it sits on, including badge tints and map overlays; large state text at least 3:1. Borders that separate regions stay visible on a washed-out projector.
- [ ] `prefers-reduced-motion: reduce` removes the "New" highlight animation, smooth scrolling and marker transitions. Nothing pulses or blinks in any mode, because a pulse reads as a live alarm (today the selected marker pulses; see P1-5).

**Narrow widths**
- [ ] At about 1024 px: no overlapping controls; replay buttons stay on one row or wrap cleanly; map overlays (legend, inset, callout) do not cover the selected marker.
- [ ] At 375 px: single column, no horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`). Long ids, source URLs, brief lines and raw JSON wrap (`overflow-wrap: anywhere`, `white-space: pre-wrap`).

**Claims**
- [ ] Nothing on screen implies a forecast: no "predicted", "risk of eruption", probability, countdown, trend arrow or modelled plume.
- [ ] Nothing implies an official alert level: no level numbers, and no "Alert", "Warning" or "Watch" used as a state name. States are workflow labels. NEA's PSI band appears only as NEA's own descriptor, with its source and time.
- [ ] The only live element is the NEA context, labelled LIVE with its reading time. Nothing else implies a live feed: no other LIVE badge, no pulsing dot, no "real-time", no "updated just now". Play shows step progress only.

## 4. Vibecoded-tells audit list

Adapted from the `design-directions` audit for an operations dashboard. Status reflects the code as of phase 1. Panel CSS does not exist yet, so most panel tells are marked "check in phase 2".

| Tell | What to look for here | Phase 1 status |
|---|---|---|
| Default favicon | `public/favicon.svg` is still the Vite purple lightning bolt, visible in the browser tab on the projector | **Present** (P2-1) |
| Pulsing or radar animation | An infinite pulse on map markers reads as a live alarm feed | **Present:** `.region-map__pulse` on the selected marker (P1-5) |
| Generic gradients | Gradient backgrounds, gradient text, glow behind the map or header, gradient haze plume | Check in phase 2, especially the drift cone |
| Emoji and icon confetti | Emoji as icons; an icon on every heading | None so far. The ↗ and → text glyphs and the three hazard glyphs on the markers are fine |
| Oversized hero type | A big "Regional overview" headline. The overview should be one line plus one button | **Risk:** the overview has a title, lead, paragraph, count list, button and two notes (P2-3) |
| Glassmorphism | Blurred translucent panels; `backdrop-filter` on the header, dialogs or map overlays | None so far. The map legend uses a 92 % opaque panel without blur, which is fine |
| Decorative noise | Grain, dot grids, radar sweeps, animated borders | None so far |
| Inconsistent radii and spacing | Mixed 3, 4, 6, 8, 12 and 999 px radii; padding values outside the scale | **Mild:** the map uses 3, 4, 6 and 999 px. Panels are not yet styled. Single `--radius` token exists |
| Everything centred | Centred panel text, centred empty states, centred headings | Check in phase 2. Panels should be left-aligned |
| Low-information cards | Cards repeating what another panel already shows | **Present:** per-category "Evidence summary" cards repeat the timeline; the overview's state-count list repeats the queue (P1-1) |
| Badge and pill soup | Five or more chips per row | **Risk:** a timeline record can carry New, category, value, SIMULATED, source, Counted and an anomaly line (P1-2) |
| Eyebrow on every heading | Small caps label above most titles | **Mild:** "Scenario replay", "Record inspector", "Read-only preview" eyebrows (P2-4) |
| Shadows everywhere | `--shadow` on every panel | Map overlays use it (fine). Check panels in phase 2: borders on panels, shadows on dialogs and overlays only |
| Hover scale and fade-ups | Cards that grow on hover; sections that fade in | **Mild:** map markers scale 1.08 on hover. It is acceptable as a map affordance; keep it small |
| Tiny text | Labels under 12 px that nobody can read on a projector | **Present:** map labels at 9.5 to 11 px (P1-6) |
| Jargon or filler copy | "deterministic", "fixture", "seamless", "powered by" | **Present:** "Plain text · deterministic" panel meta; "Anomaly flag (fixture)" (P2-5) |
| Repeated boilerplate | The same disclaimer in five places | **Present:** "not official" appears in the banner, overview, state block, rule text, inspector footer and map legend (P2-6) |
| Default font | System UI stack | **Constrained:** no external fonts are allowed offline. Mitigate with a deliberate stack (`"Segoe UI Variable Text", "Segoe UI", system-ui`), weight 600 for emphasis, and tabular numbers |
| Tailwind default palette | `#6366f1`, `slate-900` and similar | Not present; the tokens are custom |

## 5. Phase 2 punch list

P0 breaks the demo. P1 hurts legibility or trust. P2 is polish. "Straightforward" items are P1 unless they break the path.

### P0: breaks the demo

| Id | Issue | Where | Fix |
|---|---|---|---|
| P0-1 | The dashboard is not assembled: `App.tsx` is a placeholder and there is no `App.css`, so every panel renders unstyled | `App.tsx`, `App.css` | The UI shell builder is finishing these. Phase 2 verifies the layout in section 1 and fixes whatever does not match |
| P0-2 | Global shortcuts can fire under a modal. A `keydown` listener on `window` still receives keys while the brief preview or inspector is open. Pressing → to scroll the preview would advance the step, which clears the brief and closes the preview mid-demo | `App.tsx` (the shortcut handler, not written yet) | Ignore the key when any `dialog[open]` exists; when the target is an input, textarea, select, contenteditable or `pre`; when a modifier key is held; or when the event was already handled |
| P0-3 | The brief preview `<pre>` can stretch the dialog. Brief lines include long source names and URLs, so with the default `white-space: pre` the dialog widens: **Download .txt** in its header can be pushed off-screen at 1366 px, and the page scrolls sideways at 375 px | `BriefPanel` styles | `white-space: pre-wrap; overflow-wrap: anywhere;` on `.brief-preview`. Dialog `max-width: min(880px, 100vw - 32px)`. Header actions never wrap out of view |
| P0-4 | The map and the queue must select the same incident | `App.tsx` | Verify in the browser. The markers are already real `<button>`s with `aria-pressed` and an `aria-label` that includes the state (good) |
| P0-5 | The replay bar and DEMO REPLAY must stay visible at 1366×650 through the whole script | `App.css` | Sticky header plus replay bar; the right column scrolls internally. Verify by screenshot at each beat |
| P0-6 | The NEA fetch must never block or break the core demo | `App.tsx` | Call `loadNeaContext()` once, after first render, without awaiting it before anything else renders. The Merapi path never waits on it. Verify with the network off: everything works, and Riau shows HISTORICAL SNAPSHOT |

### P1: hurts legibility or trust

| Id | Issue | Where | Fix |
|---|---|---|---|
| P1-1 | Too much on the detail panel at once. Today it shows an eyebrow, title, location, a state block with a long disclaimer, Why, a six-row facts list (coordinates and replay step repeat other places), per-category evidence cards (repeating the timeline), a quality-notes list (repeating the timeline and inspector), and the long incident summary | `IncidentDetail.tsx` | Keep: title, one location line with coordinates, the catalog link, the large state badge with "Thermal + Gas", one short disclaimer line, Why, and two facts (observations visible, latest observation). Remove the evidence summary cards. Put quality notes, the scenario window and "About this example" in one collapsed "Details" disclosure. Remove the "Replay" fact, because the replay bar shows it |
| P1-2 | Timeline record cards are about 200 px tall, so only two or three fit, and each carries up to seven chips and lines | `EvidenceTimeline.tsx` | Compact record. Line 1: New tag, category, value, Counted / Not counted. Line 2: the record summary (the inspector button). Line 3: "Observed … · Ingested …". Line 4: SIMULATED plus the "Modelled on …" source. Line 5: the short counted reason. Move the anomaly reason and the quality note to the inspector |
| P1-3 | Check observation uses the accent blue, which is also the link, focus and selection colour, so it reads as "selected" rather than as a step up in attention. The map inherits the same tokens | `index.css` state tokens, `Badges` | Neutral grey (Monitoring) → amber outline on light amber (Check observation) → solid amber with dark text (Review needed). The badge dot is hollow for Check and filled for Review, so the step is visible without colour. Change token values only; the map's dashed and bold rings already give a shape cue |
| P1-4 | The rule appears twice in Why: `RULE_TEXT` under "Rule", then `explanation[0]`, which is `RULE_SUMMARY`, the same rule in different words. The explanation lines also show raw ISO timestamps and quoted ids | `IncidentDetail.tsx` (UI only; no lib change) | Show `RULE_TEXT` once, then the per-record Counted / Not counted list. Put the remaining explanation lines (`explanation.slice(1)` when line 0 equals `RULE_SUMMARY`) in a nested "Full derivation" disclosure |
| P1-5 | The selected map marker pulses forever (`.region-map__pulse`, 1.8 s infinite). On an operations map, a pulse reads as a live alarm, which is exactly the wrong claim for a simulated replay | `RegionMap.tsx`, `RegionMap.css` | Remove the pulse. The static select ring, the 1.15 scale and the callout already mark the selection |
| P1-6 | Map text is too small for a projector: country labels 10 px, marker tags 11 px, callout 10.5 to 12.5 px, legend 10 to 11 px, attribution 9.5 to 10 px | `RegionMap.css` | Marker tags and legend at least 12 px, callout title 14 px, callout state 12 px semibold, country labels 11 px, attribution 11 px |
| P1-7 | Unselected marker names (`.region-map__tag`) appear only on hover or focus, so the overview shows three anonymous symbols. Beat 1 needs "Merapi", "Riau" and "Ayutthaya" readable at a glance | `RegionMap.css` | Always show the tag (name and state) for unselected markers. Check collisions with the Singapore point and the legend at 1024 px |
| P1-8 | ASEAN land (`#f8f6f1`) is almost the panel white and will wash out on a projector; coastlines are thin | `index.css` map tokens | Darken ASEAN land slightly, keep non-ASEAN land greyer, and keep a 1 px coastline. Token values only |
| P1-9 | Step chips are buttons, which adds a second way to move through the replay and three Tab stops before Next step | `ReplayBar.tsx` | Show the chips as a progress indicator (`ol` with `aria-current="step"`), not buttons. Next step, Play and Reset stay the only replay controls. Drop the visible "Keys:" hint; the shortcuts stay |
| P1-10 | Source names are long ("Simulated fixture modelled on NASA FIRMS VIIRS 375 m active fire detections"), which turns the "prominent source badge" into a sentence | `Badges.tsx` `SourceBadge` | Display "Modelled on NASA FIRMS VIIRS 375 m active fire detections" next to the SIMULATED badge, with the full string in the inspector and in `title`. Never strip "Modelled on", because without it the badge would read as the real product |
| P1-11 | The inspector puts the five fields the script needs among 17 rows, several of them duplicated as raw values | `RecordInspector.tsx` | Top block: value, Observed (scenario time), Ingested (scenario time), data mode, source (name and link), quality note, review treatment. Everything else, plus the raw JSON, goes under "All fields" |
| P1-12 | Modals dim the banner. The DEMO REPLAY label must stay readable while the inspector or preview is open | `Dialog` styles, `RecordInspector`, `BriefPanel` | `::backdrop` at no more than about 30 % dark. The inspector drawer starts below the header, so the banner stays uncovered. Both dialog headers show SIMULATED |
| P1-13 | The projection type scale: a 14 px base and small meta text will not read from the back | `index.css` | Apply the scale in section 1: 15 px body, 13 px minimum, 20 to 22 px state badge, tabular numbers |
| P1-14 | The NEA layer can be confused with the scenario. The LIVE badge reuses the red `--mode-live` tokens (alarm colour, next to an amber Review needed), and "simulated data" in the banner is no longer true for the NEA readings | `NeaContextCard.tsx`, `index.css` mode tokens, `AppHeader.tsx` | LIVE: dark ink outline with a static dot. HISTORICAL SNAPSHOT: neutral outline. Both are followed by the reading time. Banner: "DEMO REPLAY · simulated incidents · not an official warning". Card heading: "Context: NEA Singapore (real readings)" |
| P1-15 | The NEA drawing on the map (pending the map build): the wind arrow must point downwind with "from" stated in words; the drift cone must carry "Illustrative drift, not a dispersion model" on the map; and the PSI chip must be neutral, with its value, NEA's band word, "NEA" and the time | `RegionMap.*` | Neutral ink arrow (not a state colour). Cone: light neutral fill with a dashed outline, no gradient, no time marks. The chip sits near Singapore in the zoomed inset. Check every label at 12 px or more |
| P1-16 | The drift sentence must say that the hotspot is simulated and the wind is real, measured about 170 km away | `NeaContextCard.tsx` (copy from `assessDrift` in lib) | If the `drift.text` from lib does not say this, report it to the lead. The UI adds only "Hotspot: SIMULATED example · Wind: NEA Singapore stations" as two labelled lines |
| P1-17 | Out-of-range incidents: the contract has Merapi and Ayutthaya show "No NEA station coverage here". As a card or box, it adds an element to every beat of the Merapi path | `App.tsx`, `RegionMap` | At most one muted line, in the inset caption or the Details disclosure. Nothing in the main detail column |
| P1-18 | Data copy: the incident title "Ayutthaya flood watch" reads like an official warning product ("Flood Watch" is an official product name in some agencies) | `data/incidents.json` (data owner) | Request to lead: rename to "Ayutthaya flood observations" or similar. The UI will not override fixture text |
| P1-19 | Narrow widths: long ids, URLs, `pre` blocks and the header demo label | All panels | `overflow-wrap: anywhere` on ids and URLs, `pre-wrap` on every `pre`. The header label wraps under the brand at 375 px, and the replay buttons wrap as a group |

### P2: polish

| Id | Issue | Fix |
|---|---|---|
| P2-1 | Default Vite favicon | Replace `public/favicon.svg` with the BrandMark circles in the ink colour |
| P2-2 | The locator inset uses its 28 % width well; keep it as the NEA zoomed view for Riau | Keep "Locator, ±2.5°" as the caption for Merapi. For Riau, caption "Zoomed: Riau and Singapore". Not focusable |
| P2-3 | The overview state is wordy | One line ("Select an incident on the map or in the queue."), the primary **Open Merapi volcanic observations** button, and one muted line on what the states mean. Drop the state-count list, because the queue already shows states |
| P2-4 | Eyebrows on most headings | Keep an eyebrow only where it names a dialog's context ("Record inspector"); use plain headings elsewhere |
| P2-5 | Jargon in UI copy | "Plain text · deterministic" → "Plain text". "Anomaly flag (fixture)" → "Anomaly flag (demo data)". Fixture text stays as written |
| P2-6 | The disclaimer is repeated six times | Keep the banner, one line under the state badge, the rule text and the map legend note. Remove the overview and inspector-footer repeats, or shorten them to one clause |
| P2-7 | The brief status sentence is long ("No brief generated for the current step. It clears when…") | "No brief yet." / "Brief ready for Gas observation, step 3 of 3." |
| P2-8 | A backdrop click closes the dialog when the click lands on dialog padding | Dialog `padding: 0`, with an inner wrapper that fills it |
| P2-9 | The roadmap panel takes space the script does not use | Collapse it to a "Roadmap (not built)" disclosure under the queue |
| P2-10 | Empty and error states | Short, left-aligned, one sentence plus the one action that fixes it. Verify the ErrorBoundary fallback styling |
| P2-11 | NEA times in UTC only, in front of a Singapore audience | Optional: add local time in the NEA card ("06:00 UTC, 14:00 SGT"). This is a display format, not new data; skip it if time is short |
| P2-12 | Map radii mix 3, 4, 6 and 999 px | Overlays at 6 px, tags at 4 px; pill radius only for the callout state chip, or none |

## 6. What I need from the lead

1. Relay **P0-2** (shortcut guard), **P0-3** (`pre-wrap` on the brief preview) and **P0-6** (non-blocking NEA load) to the UI shell builder now, so they are built in rather than patched later.
2. Relay **P1-5** (remove the pulse), **P1-6** and **P1-7** (map text size, always-visible marker tags) and **P1-15** (NEA arrow, cone and chip labels) to the map builder while the NEA drawing is in progress.
3. Data and lib requests (I will not edit these): rename "Ayutthaya flood watch" (P1-18); confirm that `assessDrift().text` names the hotspot as simulated and the wind as measured at Singapore (P1-16).
4. Docs: `docs/DEMO_SCRIPT.md` needs the 3:25–4:00 split for the Riau and NEA beat (section 2).
5. Confirm the presentation mode: F11 full screen (768 px tall) or windowed (about 650 px tall). I will design for windowed either way.

## 7. Phase 2 log

Filled in during phase 2: screenshots, changes per file, verification results, remaining issues.
