# Design system and redesign plan: ASEAN Watch

Owner: UI redesign lead. Written 13 October 2026 against commit 4a9d0af, after the "real data only" decision (docs/CONTRACT.md, last section) and the official-warnings relay decision. Phase A (this document) was written read-only; phase B implements it. Measurements quoted here come from headless-Chrome runs of the demo path at 1366×680, 1024×700 and 375×812 (`scratchpad/aw-shots/before/`).

Jenson's direction: **make it straightforward; focus on the core.** The core is one path: select a watch area → Next step through the last seven days → Why this state? → inspect a record → Generate brief → Download .txt → Reset. The official agency warning for the same place must be visible at the same time, verbatim, and impossible to confuse with our own workflow state.

## 1. Direction

### What I looked at (taste library, compressed)

Captured at 1366 px with headless Chrome (`scratchpad/aw-shots/refs/`):

| Reference | What it does | What I took | What I rejected |
|---|---|---|---|
| **NOAA / NWS tsunami.gov** | The authoritative warning product. One bordered block at the top with the current message, then a map and a message table. | The official message is a plain, bordered, labelled block in the issuer's own words. Authority comes from the issuer's name and verbatim text, not from styling. | The green "No Tsunami Warning…" banner: an "all clear" is exactly what our contract forbids when a feed is empty or unreachable. |
| **MAGMA Indonesia (PVMBG) VONA page** | Level colour codes as filled rectangular chips whose text *is* the level word (Green, Yellow, Orange). | An official level is a hard-cornered chip containing the verbatim level. Our own states must look different: sentence case, soft fill, a dot, rounded. | Colour-coding levels ourselves. Levels are verbatim; our one reserved official colour means "issuer statement", never severity. |
| **NEA haze.gov.sg** | PSI band in words ("24-hr PSI Forecast: Unhealthy"), a dark header block for the situation update. | Relay NEA's band word verbatim next to the value, with source and time. | Hero photography, marketing chrome. |
| **NASA Worldview** | Dark ops console: layer rail on the left, big imagery, a time slider docked at the bottom. | Rail + dominant map + docked time control is the right skeleton for an ops console; the replay bar is our time control. | Dark chrome (washes out on projectors), icon-heavy toolbars. |
| **Zoom Earth** | Country labels as letter-spaced uppercase, place labels medium weight with a halo; chrome kept to a few rounded panels. | Label typography on the map. | Dark theme, satellite imagery. |
| **Windy** | Data colour is reserved for data; UI chrome is neutral; translucent overlays. | Neutral chrome; colour only where it carries meaning. | Rainbow scales, animated particles. |

| **Palantir Gotham** (product UI on palantir.com/platforms/gotham) | A dense object list on the left (id, type, status chip, classification string in mono), a map/globe canvas in the centre, mono coordinate readouts in the corners, square corners, 1 px hairlines, a near-monochrome palette with tiny status dots. | The skeleton and the discipline (section "From Palantir" below). | The dark canvas, the name and marks, any imitation of its exact UI. |
| **Palantir Foundry / AIP** pages | Light grey canvas, hairline rules, small mono eyebrow labels ("LAYER / 01"), tabular rows, medium-weight headlines. | Mono eyebrows for provenance, hairlines instead of shadows, calm density. | Gradient headline text. |

GDACS timed out in the capture; from its public design: red/orange/green event levels in tables. Those are *impact estimates* from an aggregator and get a visibly non-warning style here.

### From Palantir: interaction ideas and visual discipline (not branding)

Jenson's test is **intuitive**: a judge who has never seen the app finds select → step through days → why → brief → download without being told. Five things from Gotham/Foundry serve that, and each maps to a concrete element here:

1. **Map-centric operations canvas with layer toggles.** The map is the largest element and the first thing read. A small *Layers* control on the map (three labelled checkboxes: Watch areas · Official warnings · NEA wind and haze) shows that the map is composed of sources, and lets the presenter declutter. No other map chrome.
2. **Object-centric selection.** Every object on the canvas is clickable and opens the same kind of view: a watch area opens the review column (properties, state, linked evidence, sources); an official warning opens the drawer inspector (verbatim fields, per-area levels, instruction, feed, source URL); a record opens the record inspector. One pattern, learned once. Selection is marked the same way everywhere: a 3 px ink bar on the left and a static ring on the map.
3. **Timeline across the bottom driving the replay.** The seven-day strip sits at the bottom edge of the workspace, full width, with the day cells, the current day in words, and the three controls at its right end. It reads as a time scrubber (Worldview and Windy dock their time controls there too), which is why Next step is found without a label hunt.
4. **Dense but calm.** Hairlines, not shadows; one accent; square corners (4 px panels, 3 px badges, 0 px official chips); 13 px mono for every id, time, coordinate and PSI value; sentence-case labels; no icons except the three hazard glyphs and the marker shapes.
5. **Provenance on every object.** The mono provenance line (section 1) on every record, card, warning and the header.

Dark canvas: considered and rejected for this demo. On a 1366×768 projector, dark surfaces turn muddy and 13–15 px light-on-dark text loses its edges; a light canvas with a dark header and a dark bottom timeline keeps Gotham's framing with projector-safe contrast. If Jenson wants the dark canvas later, section 2 lists the token set to re-validate (every ratio recomputed against `#1a1f27`), and the layout does not change.

Intuitive-by-affordance rules: one filled primary button per moment (Open Merapi on the overview; Next step while replaying; Generate brief in the review column; Download .txt in the preview). Secondary actions are outlined. Disclosures show a chevron and a question ("Why this state?"). Every clickable row has a hover border and a cursor; nothing clickable looks like text, and nothing that looks like a button is inert.

### Options considered

1. **Dark console** (Worldview, Windy). Looks like an ops centre. Rejected: dark surfaces wash out on a 1366×768 projector, small light-on-dark text loses legibility, and amber on dark reads as an alarm panel. The plan also asks for a light theme.
2. **Paper situation report**: warm paper, ink rules, monospace times, like the `.txt` brief it exports. Calm and projector-friendly, but it reads as a document, and the map becomes an illustration instead of the workspace.
3. **Situation board** (chosen): light, cool-neutral chrome; one ink-blue for actions and links; amber reserved for "Review needed"; a reserved red-ink *official* style for relayed agency warnings; hard 1 px borders that survive a washed-out projector; monospace tabular figures for every time, coordinate and id. Skeleton from Worldview (rail, dominant map, docked time control), label typography from Zoom Earth, the official block from tsunami.gov and MAGMA.

**Signature device:** every claim on screen carries a one-line **provenance line** in monospace: `HISTORICAL SNAPSHOT · as of 2026-10-13 06:00 UTC · NASA FIRMS VIIRS 375 m NRT (NOAA-20)`. Records, context cards, official warnings and the banner all use it. It is the product's point (traceability) made visible, and it is the one typographic flourish; everything else is restrained.

### Guardrails (always on)

No emoji, no gradients, no glassmorphism or `backdrop-filter`, no pulse or radar animation, no external fonts or CDNs, no "all clear", no forecast language, no colour-only meaning, no official-looking style on our own states, at most one filled primary button per region.

## 2. Design tokens (light theme)

The light theme is the designed daylight counterpart to the dark default (`data-theme="light"`). Revised 15 October 2026 (UX v3, "the light version isn't as good"): a warm paper canvas, white panels with real shadows, crisp ink, a deep-teal accent that complements the amber haze, a light basemap with overlays recoloured for it (section 2b), and AQ colours that are safe as text. It is designed, not inverted.

Token names already in `src/index.css` are contract: values change, names stay. Contrast ratios are WCAG 2.x relative luminance, measured with a node script over the values in `src/index.css` (the dataviz skill's `contrast()` formula). Text must be ≥ 4.5:1; control borders, state and mode borders and focus rings ≥ 3:1 against their surface. Only the 1 px panel hairline `--border` is decorative (panels also carry `--shadow`).

### Surfaces, ink, action

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--bg` | `#f3f2ee` | page plane: warm paper | — |
| `--panel` | `#ffffff` | panels, cards, dialogs | — |
| `--panel-2` | `#f7f6f2` | nested surfaces | — |
| `--panel-glass` | `rgba(255,255,255,0.95)` | floating panels over the map; no blur | text 17.3:1 over the sea, 16.8:1 over the densest haze |
| `--border` | `#d5d1c8` | 1 px hairline, warm grey | 1.5:1 on white; decorative (the shadow carries the edge) |
| `--border-strong` | `#837d71` | button borders, pills | 4.1 / 3.8 / 3.6 on panel / panel-2 / bg |
| `--text` | `#16191d` | primary ink | 17.6 / 16.3 / 15.7 on panel / panel-2 / bg |
| `--text-muted` | `#545a62` | secondary ink, labels | 7.0 / 6.4 / 6.2 / 6.1 on panel / panel-2 / bg / selected row; 6.8 on glass over the sea |
| `--accent` | `#0d6a6c` | links, primary buttons, selection bar. Deep teal, the complement of the amber haze, so actions never read as data | 6.4 / 5.9 / 5.7 / 5.6 on panel / panel-2 / bg / selected row |
| `--accent-strong` | `#08504f` | primary hover | `--on-accent` (white) on it 9.2:1; on `--accent` 6.4:1 |
| `--focus` | `#0d6a6c` | 2 px focus ring, 2 px offset | 6.4 / 5.9 / 5.7 on panel / panel-2 / bg |
| `--link-underline` | `#8fc4c1` | link underline (decorative; the ink carries the link) | — |
| `--selected-bg` / `--new-row` | `#e7f2f1` / `#eaf4f3` | selected row, newly revealed record (with a 3 px accent bar) | muted 6.1:1, accent 5.6:1 on it |
| `--banner-bg` / `--banner-fg` | `#16191d` / `#ffd27a` | the ink frame (header, timeline) | 12.4:1; `--on-dark` 15.8:1, `--on-dark-muted` 10.4:1 |
| `--on-dark-control` / `--accent-edge` | `#8d887d` / `#5fb6b2` | button edges on the ink frame | 5.0:1; 7.4:1 on banner, 5.6:1 on a done day cell |
| `--shadow` | `0 1px 2px rgba(28,24,18,.07), 0 4px 14px rgba(28,24,18,.10)` | panels and floating map overlays: white panels lift off the light map | — |
| `--shadow-drawer` / `--shadow-dialog` | `-10px 0 32px` at .16 / `0 18px 50px` at .24, warm ink | drawer, dialogs | — |
| `--backdrop` | `rgba(22,25,29,0.32)` | dialog backdrop | — |
| `--header-h` / `--header-offset` | `40px` / measured | the header's literal minimum height; the measured height AppHeader publishes for the drawer inset. The header never reads `--header-offset` back (a measured value fed into `min-height` locks in an unstyled first-paint height) | — |

### Review states (workflow urgency; never an alert level; always with text)

| State | `-bg` | `-fg` | border | Dot / ring cue | Contrast |
|---|---|---|---|---|---|
| Monitoring | `#ebe9e3` | `#3d4249` | `#8c877b` | no dot; thin ring | 8.3:1; border 3.6:1 on white (was 2.0:1 before this revision) |
| Check observation | `#fff3d6` | `#7a4a00` | `#b97a0e` (`--state-check-border`) | hollow dot; dashed ring | 6.8:1; border 3.6:1 on white |
| Review needed | `#f2a43a` (`--state-review-bg`) | `#241500` | `#a35c00` (`--state-review-strong`) | filled dot; bold ring + "!" | 8.6:1 text; border 5.1:1 on white |

The amber fill is 2.1:1 against white, below the 3:1 non-text mark on purpose: a fill dark enough to pass would not hold 4.5:1 text. The 5.1:1 border carries the boundary and the word carries the meaning. CVD check (dataviz validator, all pairs): Check-border vs Review-fill ΔE 7.4 protan / 8.1 normal, in the "floor" band, which is legal only with secondary encoding; the hollow/filled dot and dashed/bold ring are that encoding, and every badge carries its label. No red is used for any of our states.

### Data modes (text carries the meaning)

| Badge | Values | Style |
|---|---|---|
| **HISTORICAL SNAPSHOT** · `as of <time> UTC` | `--mode-historical-bg #e3f1ea`, `-fg #1a5e44`, border `#528e76` | uppercase, green tint, always followed by the snapshot time (6.6:1; border 3.8:1) |
| **LIVE** · `<reading time> UTC` | `--mode-live-fg #16191d`, border `#16191d`, white fill, static 6 px dot | outlined ink; never red, never animated (17.6:1) |
| **MODELLED** | `--mode-modelled-bg #ece6f9`, `-fg #4a2f8d`, border `#8a72c6` | uppercase, violet tint; context only, never evidence (8.3:1; border 4.0:1). The same values sit under the old `--mode-simulated-*` names for compatibility |
| **OFFICIAL** | reserved, see below | only for relayed agency warnings |
| Counted / Not counted | `--counted-bg #16191d` on white / dashed outline | small text pills, neutral (17.6:1) |

Mode borders were raised to ≥ 3:1 in this revision (they were 1.7–1.9:1), matching the dark theme. Validator (all pairs, light): modelled-violet vs historical-green vs live-ink: CVD ΔE 16.2, normal 21.0, all ≥ 3:1. Pass.

### Official warnings (reserved; never used for our states)

| Token | Value | Use |
|---|---|---|
| `--official` / `--official-fill` | `#8a1f1f` | 4 px left rail, verbatim level chip fill, "OFFICIAL" word, "Follow <issuer>" link ink (9.1:1 on white, 8.3:1 on `--official-bg`; white on it 9.1:1) |
| `--official-bg` | `#fdf2f2` | item surface (ink on it 16:1) |
| `--official-border` | `#c27474` | item hairline (3.5:1 on white, 3.2:1 on `--official-bg`; was 2.2:1) |
| `--estimate` | `#5d6168` | GDACS "Impact estimate" rail and label (6.2:1); dashed rail |
| `--ended` | `--text-muted` | ENDED chip, outlined |

Why red-ink here and nowhere else: red is the universal warning colour and these *are* the warnings. One colour for every official item regardless of level, because the level is verbatim and we do not rank issuers' levels. Separation from Review needed: different hue (red-brown vs amber, 4.4:1 between them), different shape (square corners, uppercase verbatim text, issuer prefix) and different words ("OFFICIAL · PVMBG MAGMA" vs "Workflow state, not an official alert level").

### Air-quality scale (`--aq-*`)

Used for legend fills and for the big PM2.5 numbers on map cards (`MapCard.css`), so both themes keep them text-safe. Light deepens the EPA hues; dark keeps the earlier desaturated values except the two that failed as text.

| Token | Light | on panel / panel-2 | Dark | on panel / panel-2 |
|---|---|---|---|---|
| `--aq-good` | `#2f7a45` | 5.3 / 4.9 | `#6f9a6a` | 5.8 / 5.4 |
| `--aq-moderate` | `#806600` | 5.5 / 5.1 | `#c8b25a` | 8.9 / 8.2 |
| `--aq-sensitive` | `#a95511` | 5.3 / 4.9 | `#c98648` | 6.3 / 5.8 |
| `--aq-unhealthy` | `#ad3f2f` | 6.0 / 5.5 | `#d9776c` (was `#b5544a`, 3.9:1) | 6.1 / 5.6 |
| `--aq-very-unhealthy` | `#764a9c` | 6.5 / 6.0 | `#b294cc` (was `#84609a`, 3.7:1) | 7.2 / 6.6 |

Light unhealthy is a brick red kept apart from the official red by lightness (1.5:1) and, as always, by its band word. Before this revision both themes shared one set of values, so moderate (`#c8b25a`) was 2.1:1 as text on a white card.

### Map (CSS tokens for the offline fallback map and the legacy RegionMap)

| Token | Value | Note |
|---|---|---|
| `--map-water` | `#c8d3d9` | the same sea as the tuned light basemap (section 2b) |
| `--map-land` | `#ecebe6` | context countries |
| `--map-land-asean` | `#fafaf8` | ASEAN members: Positron's land |
| `--map-stroke` | `#b8b6b0` | context coastlines, 0.7 px |
| `--map-stroke-asean` | `#6f6a5e` | member coastlines, 1 px (5.2:1 on member land) |
| `--map-marker` | `#2f3640` | default marker ink (11.7:1 on land, 8.0:1 on the sea) |
| overlay surface | `--panel-glass` | no blur |

### Type scale

Font stack stays local: `'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif`; mono `ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace`. Weights 400 and 600 only (no 700/800). `font-variant-numeric: tabular-nums` on every time, coordinate, count and PSI value; `letter-spacing: 0.04em` on uppercase badges only.

| Role | Size / line | Weight |
|---|---|---|
| Large state badge (detail column) | 22 / 28 px | 600 |
| Watch-area title (detail) | 20 / 26 px | 600 |
| Panel and dialog titles | 17 / 24 px | 600 |
| Body, buttons | 15 / 22 px | 400 / 600 |
| Secondary (record titles, rows) | 14 / 20 px | 400 / 600 |
| Meta, badges, pills, provenance lines, map tags, legend | 13 / 18 px | 400 / 600 (mono for provenance) |
| Map country labels | 12 px uppercase, 0.1em tracking | 600 |
| Absolute minimum anywhere | 12 px | — |

### Spacing, radii, borders, elevation

- Space: 4, 8, 12, 16, 24, 32 px. Column gap 12 px (`--gap`).
- Radius (near-square, console discipline): 4 px panels, buttons, dialogs, map overlays (`--radius`); 3 px badges, pills, tags, day cells (`--radius-sm`); **0 px for the official level chip** (reserved cue); 50 % only for marker rings and dots.
- Borders: 1 px `--border` on panels; selected row = 3 px `--accent` left bar + `--selected-bg`; new record = 3 px `--accent` left bar + `--new-row`; official item = 4 px `--official` left bar; impact estimate = 4 px dashed `--estimate` bar.
- Elevation: dark keeps `--shadow` for dialogs and floating map overlays (panels use borders). Light gives every floating panel `--shadow` too: white panels over a light map need a real shadow to lift, and the hairline is only decorative.

## 2a. Dark theme (default)

Since 14 October 2026 the app opens in a dark, map-first theme (cinematic: near-black canvas, cream ink, warm-grey hairlines, a tan "smoke" accent, translucent panels over a dark basemap). The light theme in section 2 stays as the alternative for bright projector rooms.

**Mechanism.** `src/index.css` keeps the light values on `:root` and overrides the same token names under `:root[data-theme='dark']`; no token was renamed. An inline script in `index.html` sets `<html data-theme>` before first paint from `localStorage['aw-theme']` (default `dark`; storage errors fall back to dark), and two inline background rules stop a light flash before the stylesheet loads. The header has a **Dark / Light** toggle (two buttons, `aria-pressed`) that writes the attribute, persists it in a try/catch and fires `aw:themechange` on `window`. The attribute is always present (`dark` or `light`); the map reads it for the basemap.

**New token names (both themes).** `--on-accent`, `--official-fill`, `--on-official`, `--panel-glass`, `--panel-filter` (`blur(6px)` in dark, `none` in light), `--link-underline`, `--track`, `--hairline-on-fill`, `--on-dark-control`, `--on-dark-hover`, `--accent-edge(-hover)`, `--day-done-bg/-border`, `--day-current-bg/-fg`, `--day-count-bg`, `--nea-chip-bg/-fg`, `--shadow-drawer`, `--shadow-dialog`, and an air-quality scale `--aq-good #6f9a6a`, `--aq-moderate #c8b25a`, `--aq-sensitive #c98648`, `--aq-unhealthy #b5544a`, `--aq-very-unhealthy #84609a` (desaturated, always labelled). On 15 October 2026 the light values were redesigned (section 2) and the AQ scale became text-safe in both themes: map cards print PM2.5 values in these colours, so dark now overrides `--aq-*` itself, with unhealthy and very unhealthy lifted to `#d9776c` and `#b294cc` (they were 3.9:1 and 3.7:1 as text).

| Token | Dark value | Note |
|---|---|---|
| `--bg` / `--map-water` | `#0a1218` | the sea and page plane |
| `--map-land` / `--map-land-asean` | `#25221d` / `#2f2b24` | warm near-black land |
| `--panel` / `--panel-2` | `#0e1216` / `#161b20` | opaque surfaces (dialogs, drawer) |
| `--panel-glass` | `rgba(14,18,22,0.95)`; no blur | floating panels and the map hint |
| `--border` / `--border-strong` | `#4a443b` / `#857c6d` | hairline (decorative) / control edges |
| `--text` / `--text-muted` | `#ece4d6` / `#a9a193` | cream ink |
| `--accent` / `--accent-strong` / `--focus` | `#c9a675` / `#dcbf92` / `#d8b680` | tan smoke; primary buttons carry `--on-accent #16120c` |
| States | Monitoring `#c4bcad` on `#1b1f24`, border `#736c5e`; Check `#f2c46e` on `#2a2012`, border `#c48a2a`; Review `#1d1200` on `#eea443`, strong `#f5bd66` | neutral → amber outline → solid amber; never red |
| Modes | MODELLED `#cdbff0` on `#221d31` / `#6c5ca3`; HISTORICAL `#9dd3b9` on `#13231c` / `#4f7f69`; LIVE cream outline | the uppercase word carries the meaning |
| Official (reserved) | ink and rail `#e5675f`, surface `#2b1110`, hairline `#b04a40`, chip `#ffffff` on `#9e2b23` | deep-red family; used only for relayed official warnings |

**Contrast (WCAG 2.x, computed with a node script using the dataviz `contrast()` formula).** Text ≥ 4.5:1; control borders, state borders and focus ≥ 3:1. The 1 px panel hairline `--border` is decorative in both themes (light 1.5:1, dark 2.0:1); every control, badge and focus ring carries its own ≥ 3:1 edge.

| Pair (dark) | Ratio |
|---|---|
| `--text` on panel / panel-2 / glass over white street tiles | 14.9 / 13.7 / 10.1 |
| `--text-muted` on panel / panel-2 / selected row / glass over white tiles | 7.3 / 6.8 / 6.0 / 5.0 |
| `--accent` links on panel / panel-2 | 8.2 / 7.6 |
| `--on-accent` on accent / accent-strong | 8.2 / 10.6 |
| `--banner-fg` / `--on-dark-muted` on banner | 10.1 / 7.5 |
| Monitoring / Check observation / Review needed (fg on bg) | 8.8 / 9.8 / 8.8 |
| MODELLED / HISTORICAL SNAPSHOT / LIVE | 9.6 / 9.7 / 14.9 |
| `--official` ink on panel / on official-bg; chip text on fill | 5.8 / 5.4; 7.4 |
| `--estimate`, `--ok-fg`, `--danger-fg` on panel | 6.5, 10.4, 8.6 |
| Timeline current day; NEA chip; toggle pressed | 14.9; 9.9; 15.2 |
| `--border-strong` vs panel / panel-2; `--on-dark-control` vs banner | 4.6 / 4.2; 4.7 |
| `--focus` vs panel / bg / banner | 9.8 / 9.8 / 10.0 |
| State borders: Monitoring (panel / panel-2), Check, Review | 3.6 / 3.3, 6.3, 11.1 |
| Mode borders: MODELLED (panel / panel-2), HISTORICAL, NEA snapshot | 3.3 / 3.1, 4.1, 4.0 |
| `--official-border` vs panel / official-bg | 3.5 / 3.3 |
| `--map-stroke-asean` vs member land | 3.6 |
| `--aq-*` on panel (good, moderate, sensitive, unhealthy, very unhealthy) | 5.8, 8.9, 6.3, 6.1, 7.2 |

Scrubber and popover (`.is-dark` variants, translucent over the densest tan smoke, about `#1e1e1e` composited): text 13.2:1, muted 6.5:1, control edge 4.1:1.

**Separation rules in dark.** Official red (`#e5675f`, hue about 3°) and the Review amber (`#eea443`, hue about 35°) are close in luminance (1.6:1), so they are kept apart by hue, shape and words, exactly as in light: square uppercase verbatim chip on a deep-red fill with the "OFFICIAL · issuer" prefix, versus a rounded state badge with a dot and the words "Workflow state, not an official alert level". No workflow state uses red in either theme.

## 2b. Map basemaps and overlay palette (both themes)

Decided 15 October 2026. Overlay colours are not CSS tokens: every colour the map draws (deck.gl and MapLibre) comes from one module, `src/components/map/mapPalette.ts` (`getMapPalette(theme)`), and the basemap from `src/components/map/basemap.ts`. `mapPalette.test.ts` asserts the ratios below, so a colour change that breaks one fails the tests.

**Basemaps.** Dark: CARTO Dark Matter, unchanged. Light: **CARTO Positron GL**, tuned by `transformStyle`. Compared against OpenFreeMap positron (the previous light map) and OpenFreeMap bright:

- Positron's labels are muted blue-grey (`#697b89` places, `#8a99a4` countries), so they sit under the haze, fires and particles. OpenFreeMap positron prints place and country names in black from zoom 3, the loudest thing on the map after the overlays.
- OpenFreeMap bright draws roads in yellow and orange and parks in green: the hues of the fire ramp and the PM2.5 bands. Rejected.
- CARTO Positron uses the same vector tiles, source id (`carto`) and layer set as Dark Matter, so the theme toggle changes colours only, the same places are labelled at the same zooms, and the 3D building extrusion (source `carto`, source-layer `building`, `render_height`) works on both themes with no code change. Checked at zoom 15.8 over the Singapore CBD.
- Licence: the same CARTO basemap terms as the Dark Matter style already in use (attribution "© CARTO, © OpenStreetMap contributors", carried by the style's source). Nothing new to agree to.

`transformStyle(style, 'light')` matches layers by source-layer and type (the OpenMapTiles schema), never by id: the sea goes from `#d4dadc` to `#c8d3d9` (1.4:1 → 1.5:1 against `#fafaf8` land, so islands read at the regional zoom), waterways follow, thin border lines turn neutral grey (Positron's pink borders were a faint red cue), and village/hamlet/suburb labels start one zoom later and POIs at 16 so the haze city labels own zooms 6–10. It is pure and wrapped by `safeTransformStyle`, which returns the style as fetched on any error. MapView applies it through MapLibre's own hook: `map.setStyle(basemapStyleFor(theme), basemapStyleOptions(theme))`.

**Light overlays: designed, not inverted.**

- Wind particles: deep slate-navy ink `[24,34,52]` at 0.66, normally blended (additive blending washes out on white).
- Haze: amber → burnt sienna → deep umber with a plum cast, chosen so ordinary alpha compositing reads like a multiply (dark colour, low alpha). The haze has its own deck.gl canvas above the map canvas, so a true multiply against the basemap is not possible.
- City circles keep the PM2.5 band fill (it matches the legend, scrubber and cards) and gain a 1.5 px ink outline: pale fills (moderate yellow is 1.6:1 on white) cannot carry the edge. The glow becomes a normally blended band-tinted aura. Labels are ink with a white SDF halo in both themes (no boxed labels).
- Fires: a normally blended ramp from amber to deep brown, hue 18–36°, away from the official red. Quakes, tide gauges, level rings and tsunami strokes are deepened until each is ≥ 3:1 on the sea. Ash is grey-violet (plume) and cool grey (drift lines), so it never reads as the warm smoke. The selection ring is the accent teal.

**Measured ratios (light).** Each mark is composited at its alpha over Positron land `#fafaf8` / land under the landcover tint `#f2f6f1` / the tuned sea `#c8d3d9`.

| Mark | Land / tinted land / sea |
|---|---|
| Particle head (alpha 0.66) | 5.1 / 5.0 / 4.3 (3.5 over unhealthy haze, 2.6 over 400 µg/m³ haze) |
| Haze 25 / 55 / 150 / 250 / 400 µg/m³ (area fill, context) | 1.1 / 1.3 / 1.8 / 2.5 / 3.7 on land; 3.1 on the sea at 400 |
| City outline (ink) | 16.0 / 15.4 / 11.0 |
| City label ink; on its white halo | 17.0 / 16.3 / 11.7; 17.8 |
| Fire-prone-area outline | 9.3 / 8.9 / 6.4 |
| Volcano triangle | 11.7 / 11.2 / 8.1 |
| Level ring green / yellow / orange / red (issuer's colour code) | 5.5 / 4.6 / 4.8 / 8.8 on land; 3.8 / 3.2 / 3.3 / 6.0 on the sea |
| Distance ring | 7.4 / 7.1 / 5.3 |
| Ash drift lines 700 / 500 / 300 hPa | 4.9 / 6.6 / 10.6 on land; 3.4 / 4.6 / 7.3 on the sea |
| Plume footprint outline | 7.3 / 7.0 / 5.4 |
| Fire ramp 1 / 10 / 50 / 200 / 1000 MW | 1.6 / 2.8 / 4.5 / 7.1 / 10.9 on land; 3.2 on the sea from 50 MW (weak cells are context inside labelled clusters) |
| FIRMS hotspot | 5.1 / 4.9 / 3.5 |
| Official pin (reserved red) | 8.8 / 8.4 / 6.0 |
| Tsunami strokes Awas / Siaga / Waspada | 8.8 / 5.2 / 5.5 on land; 6.0 / 3.5 / 3.7 on the sea |
| Tide gauge; river point (MODELLED violet) | 5.9 / 5.7 / 4.2; 7.8 / 7.5 / 5.6 |
| Quakes shallow / intermediate / deep / unknown | 5.1 / 5.8 / 6.6 / 5.5 on land; 3.5 / 4.0 / 4.5 / 3.8 on the sea |
| Modelled haze path | 9.6 / 9.2 / 6.6 |
| Selection ring (accent teal) | 6.1 / 5.8 / 4.2 |

**Dark overlays** reproduce the colours the map drew before (a test pins them). Against Dark Matter land `#0e0e0e` / sea `#2c353c`: particle head 4.8 / 4.0, city labels 16.2 / 10.4, selection ring 13.6 / 8.8, quakes ≥ 5.4 / 3.5, fire ramp from 50 MW ≥ 5.6 / 4.0. In dark the band fill carries the circle edge (the outline is a dark separator).

## 3. Badge system (must never be confused)

| Family | Members | Shape and case | Colour | Always accompanied by |
|---|---|---|---|---|
| Review state | Monitoring · Check observation · Review needed | rounded 4 px, sentence case, dot cue | neutral → amber outline → amber fill | the line "Workflow state, not an official alert level" in the detail block; legend text on the map |
| Data mode | HISTORICAL SNAPSHOT · LIVE · MODELLED | rounded 4 px, uppercase, tinted or outlined | green / ink outline / violet | the reading or snapshot time, and the source name |
| Rule treatment | Counted · Not counted | small pill | ink / dashed neutral | the reason sentence |
| Official | `OFFICIAL · <issuer>` label; verbatim level chip; ENDED | **square** chip, uppercase verbatim, 4 px red-ink rail | `--official` only | issuer name, issued time, "Follow <issuer> ↗" |
| Impact estimate | `IMPACT ESTIMATE · GDACS (aggregator)` | dashed grey rail, no chip fill | `--estimate` | "not a warning" in the label |
| Context | NEA Singapore readings | plain card with a neutral 3 px rail | neutral | "Context only; does not change the review state" |
| Age (2026-10-30) | OLDER THAN EXPECTED · FEED QUIET | rounded 4 px, **dashed** outline, ink text (the "Not counted" cue) | none of its own: `--text` and `--border-strong` | the sentence with the age and the usual interval; for feeds, "Check <issuer> directly" (`src/lib/staleness.ts`) |

Test for confusion: cover the colours. Each family is still identifiable by shape (rounded vs square), case (sentence vs uppercase vs verbatim) and the words next to it.

## 4. Layout

### Desktop, ≥ 1100 px (designed at 1366×650, checked at 1366×768, 1536×730)

Three columns between a one-row header and a bottom timeline. Nothing on the demo path needs page scroll; columns scroll internally.

```
┌ Header 40 px: ASEAN Watch │ Environment      Real data · satellite snapshot 2026-10-13 06:00 UTC · official warnings relayed verbatim · not an official warning service ┐
├─ Rail 248 px ─────┬─ Map (fills) ─────────────────────────────┬─ Review column 488 px ────────────┤
│ WATCH AREAS (5)   │ Layers ☑ Watch areas ☑ Official ☑ NEA     │ Merapi                           │
│ ▌Merapi  Check    │ legend          ┌ zoomed inset ┐          │ Central Java, Indonesia · 7.54° S… │
│  Semeru  Check    │                 └──────────────┘          │ OFFICIAL · PVMBG MAGMA  [LEVEL III (SIAGA)] Follow ↗ │
│  Anak Krakatau …  │   markers with always-visible name·state   │ ┌ Check observation · Thermal ┐   │
│  Sinabung …       │   ◇ official warning markers              │ │ Workflow state, not an official alert level │
│  Riau peatlands … │                                           │ ▸ Why this state?                │
│ OFFICIAL WARNINGS │                                           │ Evidence · 4 records · newest first│
│ near Merapi (1)   │                                           │ [NEW] THERMAL 12.4 MW   Counted  │
│ ▌PVMBG MAGMA …    │                                           │  … compact rows …                │
│ Feeds: 5 live …   │                           Natural Earth   │ [Generate brief] [Download .txt] │
├ Timeline 52 px (dark): [7 Oct][8][9][10][11][12][13 Oct]  Day 7 of 7 · 13 Oct 2026 (UTC)   [Next step] [Play] [Reset] ┤
└───────────────────┴───────────────────────────────────────────┴──────────────────────────────────┘
```

- Grid: `grid-template-columns: 248px minmax(0, 1fr) minmax(440px, 488px)`; `gap: 12px; padding: 12px`. Main area at 1366×650 is 1342×534 (650 − 40 header − 52 timeline − 24 padding); the map is about 570×534 (46 % of the area, the largest element; it was 43 % and only 405 px tall before).
- The bottom timeline is the replay bar: dark ink surface like the header (the "dark frame"), seven day cells (done = filled muted, current = filled white with ink text, todo = outlined), the status in words, and the three controls at the right end. It is `position: sticky; bottom: 0` at narrow widths so Next step stays on screen while the page scrolls.
- Rail = two stacked panels: **Watch areas** (five 34 px rows: name, hazard glyph, state badge; selected row has the 3 px bar) and **Official warnings** (fills the rest, scrolls internally, feed footer pinned).
- Review column = one internal scroll region (title, official cross-reference line, state block, Why, context card for Riau, evidence timeline, Details disclosure) with the brief bar pinned at the bottom.
- DOM order = rail, map, review column, so Tab order follows the path; map markers are buttons inside the map.
- At 1240–1100 px the rail narrows to 216 px and the review column to 420 px.

### 900–1100 px

Two rows: rail becomes a horizontal strip (watch areas as a row of 5 compact chips; official warnings collapse to a one-line summary that expands), the map takes 340 px of height, the review column goes full width below. Page scrolls; the top chrome stays sticky.

### Below 900 px, down to 375 px

Single column in workflow order: header (36 px: brand + a short recency chip "Real data · as of 06:00 UTC · not an official warning service" on one line, "Environment" hidden), replay bar (≤ 70 px: seven small day cells + one status line, then the three buttons as one full-width row), watch areas (horizontal chips), map (300 px), official warnings (collapsed summary, expand to list), detail, evidence, brief bar **sticky at the bottom** so Generate brief stays reachable. Target: sticky top chrome ≤ 110 px at 375 px (it is 153–171 px now). No horizontal scroll: `overflow-wrap: anywhere` on ids, URLs, headlines; `white-space: pre-wrap` on every `pre`.

## 5. Map styling

- **Basemap:** water `#c9d7e2`; context land `#e4e1d9` with 0.7 px `#b3ab9d` stroke; ASEAN members `#f7f4eb` with 1 px `#6f6756` stroke; graticule at 10° in `--map-stroke` at 25 % opacity; Singapore always drawn as a point.
- **Country labels:** 12 px uppercase, 0.1 em tracking, `--text-muted`, light halo in the land colour; hidden below 600 px container width (the names are then in the rail and marker tags).
- **Markers:** 36 px buttons; 32 px symbol with a 2 px ring in the state colour and the hazard glyph (volcano, flame, waves) in state ink; Monitoring thin ring, Check dashed 3 px ring with a hollow dot, Review bold 3.5 px ring with an "!" disc. Every unselected marker carries an always-visible tag `Merapi · Check observation` (13 px, name 600). The selected marker gets a static 1.75 px ink select ring and 1.15 scale; **no pulse**. With five watch areas on Java and Sumatra the greedy tag placement must be re-checked at the real map sizes this layout produces (~570×538 at 1366, 1004×340 at 1024, 355×300 at 375): the collision model's reference frame changes from 700×420 to the measured stage size.
- **Callout:** 14 px name, 13 px location, mono 13 px coordinates, state chip in the state colours; 3 px rail in the state colour; placed away from the inset and legend.
- **Legend:** top-left, 13 px, three state swatches with text, the note "Workflow states, not official alert levels", an NEA row when active, and an "Official warning" row (square symbol) when official markers are drawn.
- **Inset / zoom:** top-right, 28 % width (locator ±2.5° with the caption "Locator, ±2.5°"); for Riau the NEA zoom (incident and Singapore in frame, 44 % width) with: the hotspot marker; a **wind arrow** in ink pointing downwind, 2.2 px with a white halo, dashed and lighter when stations disagree; the **drift cone** as a 16 % neutral fill with a dashed outline and no gradient or time marks, labelled on the map "Illustrative drift, not a dispersion model"; the **PSI chip** (neutral white, ink border): `Singapore 24-hr PSI 121–172 · Unhealthy (NEA)`; a small NEA strip under the inset with LIVE or HISTORICAL SNAPSHOT and the reading time. Below 600 px container width the strip docks at the bottom and must not cover the Riau marker (reported gap 5): dock it top-left under the legend instead, or shrink the inset to 36 % and keep the strip inside the inset's frame.
- **Official warning markers (optional, reserved style):** 12 px **squares** rotated 45° (diamonds), white fill, 2 px `--official` stroke; unlabelled, with an accessible name `Official warning: <issuer> · <level> · <area>`; shown for warnings near the selected watch area (or all with a location when nothing is selected), capped at 40; hover/focus shows a callout with issuer and verbatim level. Distinct from round incident markers by shape alone.
- **Attribution:** bottom-right, 12 px, "Boundaries: Natural Earth (public domain)"; the NEA licence stays in the context card (reported gap 7, keep).

## 6. Motion policy

- No animation that implies liveness: no pulse, blink, radar sweep, ticking clock or auto-refresh indicator. LIVE means "fetched this session" and shows its reading time.
- Allowed: 120 ms ease-out on button hover/active colour, marker hover scale 1.08, dialog open (none; native `<dialog>` appears immediately), details disclosure (instant).
- "New" records are highlighted statically (bar + tint + NEW tag); there is no flash.
- `prefers-reduced-motion: reduce` sets every transition and animation duration to 0.01 ms and removes marker hover scale and smooth scrolling. Nothing in the demo depends on motion.

## 7. Copy (ux-copy pass)

Fixed control labels stay: **Next step**, **Play** (Pause while playing), **Reset**, **Why this state?**, **Generate brief**, **Download .txt**, Record inspector.

| Place | Copy |
|---|---|
| Header recency line | `Real data · satellite snapshot <YYYY-MM-DD HH:MM> UTC · official warnings relayed verbatim · not an official warning service` (narrow: `Real data · as of <HH:MM> UTC · not an official warning service`) |
| Replay status | `Day 3 of 7 · 9 Oct 2026 (UTC)`; disabled: `Select a watch area to replay the last 7 days.` |
| Rail headings | `Watch areas (5)` · `Official warnings near Merapi (1)` / `Official warnings · APAC (12)` |
| Official empty state | `No official warnings retrieved from the feeds below. This is not an all-clear.` |
| Feed unavailable | `Official feed unavailable: check <issuer> directly` |
| Feed footer summary | `Feeds: 5 live · 1 snapshot · 1 unavailable` (expands to one line per feed with its retrieved time) |
| No issue time | `No issue time published · retrieved <time> UTC` |
| Ended | `ENDED <time> UTC` chip; `Expires <time> UTC` otherwise; `No expiry given` when null |
| Follow link | `Follow <issuer> ↗` |
| GDACS label | `IMPACT ESTIMATE · GDACS (aggregator, not a warning)` |
| Flood gauge line | `<gauge name> · water level <value> <unit> · <situation verbatim>` with the issuer's threshold words kept verbatim (e.g. "overflowing bank", "Siaga 1") |
| State note | `Workflow state, not an official alert level.` |
| Official cross-reference in the detail head | `OFFICIAL · PVMBG MAGMA · LEVEL III (SIAGA)` + `Follow PVMBG MAGMA ↗`, only when an official item is near the selected area |
| Overview empty state | `Select a watch area on the map or in the list.` + primary `Open Merapi` |
| Evidence empty | `No records on this day yet. Use Next step to reveal the next day.` |
| Context card | `Context: NEA Singapore (real readings)` … `Context only; does not change the review state.` |
| Brief status | `No brief yet.` / `Brief ready for 13 Oct, day 7 of 7.` / `Download started: <file>` / `Download failed (<reason>). The preview shows the full text.` |
| Error boundary | `This part could not be shown (<reason>). Try another watch area or Reset.` |
| Record row, not counted | `Not counted: <reason>` on its own line; counted rows show only the pill (the reason is in Why and the inspector) |

Banned words on screen: predicted, forecast, probability, risk of eruption, all clear, no warnings, real-time, updated just now, seamless, deterministic, fixture.

## 8. Component-by-component change list (phase B)

Reported gaps from the builders are tagged G1–G7; real-data items R1–R6; official warnings W1–W5.

| File | Change |
|---|---|
| `src/index.css` | Tokens from section 2 (values updated, names kept, new `--mode-modelled-*`, `--official*`, `--estimate`, `--rail-w`, `--review-w`). Body 15/22. Reduced-motion block kept. |
| `src/App.css` | Three-column grid (section 4), rail panels, compact replay bar with seven day cells, compact timeline rows (≤ 100 px; G2), sticky bottom brief bar at narrow widths, header ≤ 110 px sticky at 375 (G1), official panel styles, drawer and brief dialog kept (`pre-wrap`, Download .txt in the header). |
| `src/App.tsx` | Layout wiring; call `loadOfficialWarnings()` once (non-blocking, like NEA) and pass `warningsNear(...)` to the rail, the detail cross-reference and the map (W1); clear the brief when NEA or warnings change for the selected area (G4); shortcuts only while focus is inside the replay bar (G3); overview text for watch areas. |
| `src/components/AppHeader.tsx` | DEMO REPLAY → recency line built from the snapshot `retrievedAt` (R1); short form at narrow widths; publishes `--header-h`. |
| `src/components/ReplayBar.tsx` | Becomes the bottom timeline: seven day cells as an `ol` with `aria-current="step"`, status `Day n of 7 · <label> (UTC)`, buttons unchanged at the right end; keyboard shortcuts (→, R) only while focus is inside the bar (G3). |
| `src/components/RegionMap.tsx` (layers) | A *Layers* control (three checkboxes) toggling watch-area markers, official markers and the NEA overlay; state owned by the map, default all on. |
| `src/components/RecordInspector.tsx` → shared drawer | The drawer also inspects an official warning (verbatim fields, per-area levels, instruction, source URL, feed status) so selection behaves the same for every object. |
| `src/components/IncidentQueue.tsx` → rail list | Renamed heading "Watch areas"; compact rows (name, hazard, state badge, count); roadmap disclosure dropped from the head (kept as a collapsed line under the list). |
| `src/components/OfficialWarnings.tsx` + `.css` (new) | Panel with nearby/APAC lists, item layout from section 3 and 7, instruction collapsed, flood gauge line, GDACS estimate style, ENDED, LIVE/HISTORICAL tags, feed-status footer (W1–W4). Empty state never says "no warnings". |
| `src/components/IncidentDetail.tsx` | Title, one location line, catalog link, **official cross-reference line** (W3), state block with the 22 px badge, Why with per-record rule treatment **and the stated watch rule** `anomalyReason` (R5), Details disclosure. No mode badge on the title line (R1). |
| `src/components/EvidenceTimeline.tsx` | Compact rows: line 1 NEW · CATEGORY · value · Counted pill; line 2 title; line 3 mono provenance (observed, ingested, mode badge, source link); line 4 only when not counted (G2). Empty copy for days. |
| `src/components/RecordInspector.tsx` | Top block: value, observed, ingested, data mode with time, source name + link, quality note, review treatment, **watch rule** (R5). "All fields" unchanged. Header shows the mode badge, not SIMULATED. |
| `src/components/Badges.tsx` | `ModeBadge` renders HISTORICAL SNAPSHOT / LIVE / MODELLED (+ optional time); `NeaModeBadge` kept; new `OfficialLevelChip`, `OfficialTag`, `EstimateTag` (reserved styles); `SourceBadge` shows the real source name in full. |
| `src/components/NeaContextCard.tsx` | Neutral 3 px rail, provenance line, same content; "Context only…" kept. |
| `src/components/BriefPanel.tsx` | Status copy; dialog header keeps Download .txt; no SIMULATED badge (shows the snapshot badge instead). |
| `src/components/RegionMap.tsx` / `.css` | Tokens; always-visible tags at 13 px; collision reference frame measured from the container (G6); narrow NEA strip never covers the marker (G5); labels kept where room allows at ≤ 600 px; official diamond markers + legend row (W5, optional); no pulse. |
| `src/components/format.ts` | Keep the `seismic` label; add `formatDay` for the replay labels if the data gives ISO dates. |
| `index.html` | Title "ASEAN Watch · Environment"; `theme-color` meta `#141a22`. |
| `public/favicon.svg` | Keep the ink/amber mark (already replaced the Vite bolt). |
| `docs/UX_REVIEW.md` | Section 7 phase-2 log: screenshots, results, remaining issues. |

### Not changed (ask the lead)

`src/lib/*`, `data/*`, `src/types.ts`. If `OfficialWarning` gains a gauge field, the panel reads it; until then flood gauge values are rendered from `headline`/`areaDescription` verbatim.

## 8a. As built (phase B notes)

Deviations from the plan above, with the reason:

- **No simulated data anywhere.** The DEMO REPLAY banner became the recency line ("Real data · data as of <time> UTC · …"), and the data-mode family is HISTORICAL SNAPSHOT (with its time) · LIVE · MODELLED. The header would say "Demo data · simulated records" only if a simulated record were ever loaded again.
- **Every watch replays.** The seven day cells apply to whichever watch is selected; each cell shows that watch's record count for the day and the status says "n records so far", so the replay reads as evidence accumulating, not escalating.
- **Stale brief instead of a cleared brief.** Clearing the brief when the NEA reading or the official feeds arrive unmounted an open preview mid-demo (the live feeds can land seconds after page load). The brief now carries the context key it was built from; when the context changes, the bar says "Context data updated since this brief; generate it again" and disables Download .txt, while an open preview stays readable with the same notice. The downloadable brief is therefore never silently stale.
- **"All APAC" and Esc** clear the selection (the Ayutthaya C.35 gauge warning is only in the APAC-wide list).
- **Reference links** are labelled "Also see" with "(official)" or "(not official)" per link, because the list mixes the official MAGMA page with independent monitoring (MOUNTS, ASMC).
- **Control and panel names (for the demo script):** header "ASEAN Watch · Environment"; rail panels "Watch areas (5)" and "Official warnings near <name> (n)" / "Official warnings · APAC (n)" with "All APAC", "Elsewhere in APAC (n)", "Feeds: …", "Details", "Follow <issuer>"; map "Layers" (Watch areas · Official warnings · NEA wind and haze) and the legend; review column: the watch title, "Also see", the OFFICIAL block, the state badge, "Why this state?", "Context: NEA Singapore (real readings)", "Evidence · n records, newest first", "Details"; brief bar "Generate brief" / "Download .txt" with "Brief preview"; bottom timeline "Step n of 7 · <day> · <clock> · n records so far" with "Next step" / "Play" (Pause) / "Reset"; drawers "Record" and the warning inspector.

## 8b. Map zoom and pan (13 October 2026, late)

Jenson: "I can't zoom in to the map." The main map now has free zoom and pan; the three-column layout is unchanged (the full map-first floating-panel layout was cut for time).

- **Controls (on the map, bottom-left):** `+` (Zoom in), `−` (Zoom out), **All APAC** (clears the selection and returns to the regional view). Mouse wheel / trackpad zooms around the cursor; drag pans; double-click zooms in (Shift + double-click zooms out); two-finger pinch zooms and one-finger drag pans on touch. With the map focused (it is a tab stop): `+` / `−` zoom, arrow keys pan.
- **Range:** from the regional view (scale 1) to about 0.2° of longitude across the frame; the view centre stays over the APAC frame (±160 viewBox units).
- **Selection zooms:** selecting a watch area (map, list or `#incident=` link) animates to ±1.5° around a summit, or the watch box plus 0.3° for Riau; clicking the selected marker again re-fits; Esc and All APAC return to APAC. 360 ms log-zoom, instant under `prefers-reduced-motion`.
- **Constant pixel size:** only the basemap group is transformed (non-scaling strokes); markers, tags, callouts, labels, warning and gauge symbols are HTML overlays positioned from transformed coordinates, so text and hit areas keep their size at any zoom. A press that moves less than 4 px (mouse) or 8 px (touch) stays a click, so dragging never selects a marker and clicking still does.
- **Known limits:** Natural Earth 1:50m coastlines look coarse at deep zoom (no 10m swap yet); the corner locator inset is kept; the map takes touch gestures, so on phones the page scrolls from outside the map.

## 9. Verification plan (phase B exit)

Headless-Chrome tour (`scratchpad/aw-shots/tour.mjs`) at 1366×680, 1024×700, 375×812, plus a network-blocked run (`--offline`) and a keyboard-only run: every control reachable by Tab in path order, Enter/Space activates, Esc closes dialogs and returns focus, no page scroll at 1366×650 on the demo path, no horizontal overflow at 375, sticky chrome ≤ 110 px at 375, timeline rows ≤ 100 px, console errors 0. Then `npx tsc -b`, `npx vite build`, `npm test`. Then the vibecoded-tells audit and the accessibility table in `docs/UX_REVIEW.md` section 7.
