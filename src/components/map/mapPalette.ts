// Theme-aware overlay colours for the map: the one place the map's deck.gl and MapLibre overlays get
// their colours from (docs/UX_V3.md section 4). UI chrome uses the CSS tokens in src/index.css instead.
//
// DARK (default) sits on CARTO Dark Matter: light marks on a near-black map, additive glows, cream ink
// with dark halos. These values reproduce the colours the map drew before this module existed.
// LIGHT sits on CARTO Positron as tuned by basemap.ts: dark marks on a near-white map. It is designed,
// not inverted:
//   - wind particles are dark slate ink, normally blended (additive blending would wash out to white);
//   - haze is a brown-amber smoke whose stops were picked so that ordinary alpha compositing looks like a
//     multiply: a deep brown at low alpha darkens the paper-white land and the blue-grey sea alike;
//   - city circles keep the PM2.5 band fill (it matches the legend and the scrubber) and get a dark ink
//     outline, because pale fills (moderate yellow is 1.6:1 on white) cannot carry the boundary alone;
//   - labels are ink with a white halo.
//
// Contrast rule (WCAG 2.x relative luminance, see contrastRatio below): every mark, line, outline and
// label is >= 3:1 against the basemap surfaces it can sit on, checked against BOTH the land and the sea
// (`basemap` below; the sea is the darker surface in light, the lighter one in dark). Alpha marks are
// checked as composited over that surface. Area fills (haze, ash plume, tsunami fills, ring fills) are
// context under labelled marks; their meaning is carried by the outline, the number or the label. The
// haze ramp is ordered by luminance and its top stops still reach 3:1 against land on their own.
// mapPalette.test.ts asserts these ratios, so a colour change that breaks one fails the tests.
//
// Red is reserved: the `official` family (relayed agency warnings) and the issuers' own top levels
// (BMKG "Awas", a MAGMA Level IV ring) use it; nothing of ours (fires, quakes, PM2.5) does.
import { PM25_BANDS, pm25Band } from '../../lib/airQuality';
import type { Pm25Band } from '../../lib/airQuality';

export type MapTheme = 'dark' | 'light';
export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];
/** How a layer should be blended in deck.gl: additive glows on dark, ordinary alpha on light. */
export type BlendHint = 'normal' | 'additive';
/**
 * How the haze reads. Both are drawn with ordinary alpha compositing: the haze lives on its own deck.gl
 * canvas above the map canvas, so a true multiply or screen against the basemap is not available.
 * 'screen-like': pale smoke over a dark map. 'multiply-like': dark brown at low alpha over a light map.
 */
export type HazeBlendHint = 'screen-like' | 'multiply-like';

/** A ramp stop: value → colour and alpha (0..1); interpolated on a log scale between stops. */
export interface RampStop {
  v: number;
  c: Rgb;
  a: number;
}

export type Pm25BandKey = Pm25Band['key'];

export interface CityBandStyle {
  /** Circle fill: the PM2.5 band colour, the same in both themes (legend, scrubber and cards match). */
  fill: Rgb;
  /** Soft glow under the circle (band colour); `city.glowBlend` says how to blend it. */
  glow: Rgba;
  outline: Rgba;
  label: Rgba;
  halo: Rgba;
}

/** Issuer colour codes for an official volcano level ring (MAGMA Level I–IV = green, yellow, orange, red). */
export type VolcanoLevelColour = 'green' | 'yellow' | 'orange' | 'red' | 'unknown';
export type AshLevelKey = '700' | '500' | '300';
export type QuakeDepthKey = 'shallow' | 'intermediate' | 'deep' | 'unknown';
/** BMKG InaTEWS tsunami area levels, keyed by the issuer's own words. */
export type TsunamiLevelKey = 'awas' | 'siaga' | 'waspada' | 'unknown';

/** FRP heat-grid colours: the same shape as fireLayers.ts FirePalette, so fireLayers can read it from here. */
export interface FireGridColours {
  /** Colour stops by summed FRP per cell (MW), ascending; interpolated on a log scale. */
  ramp: readonly (readonly [number, readonly [number, number, number]])[];
  /** Alpha (0–255) of the last 24 h glow and squares. */
  glow24h: number;
  cell24h: number;
  /** Alpha (0–255) of the older glow and squares before the recency fade. */
  glowOlder: number;
  cellOlder: number;
  /** Fade per period 0–6 (multiplies alpha); period 0 is the last 24 h. */
  recency: readonly number[];
  highlight: Rgba;
  selected: Rgba;
  badgeText: Rgba;
  badgeBg: Rgba;
  badgeBorder: Rgba;
  regionBadgeText: Rgba;
  regionBadgeBg: Rgba;
  blend: BlendHint;
}

/** Scenario plume colours (grey-violet: never the warm smoke, never the official red). */
export interface PlumeColours {
  /** Puff colour per height (~3, ~5.5, ~9 km). */
  level: Readonly<Record<AshLevelKey, Rgb>>;
  /** Target alpha (0..1) where puffs of one height overlap. */
  puffAlpha: number;
  /** Soft halo around each puff: alpha factor and radius factor. */
  haloAlpha: number;
  haloScale: number;
  /** Alpha (0..255) of the ash-front trail lines (level colour). */
  trailAlpha: number;
  footprint: Rgba;
  placeFill: Rgba;
  placeLine: Rgba;
  text: Rgba;
  textOutline: Rgba;
}

export interface MapPalette {
  theme: MapTheme;
  /** Reference basemap surfaces every overlay colour is checked against (after basemap.ts tweaks). */
  basemap: {
    land: Rgb;
    /** Land under the basemap's landcover tint (forest, residential): the other land extreme. */
    landTint: Rgb;
    water: Rgb;
    /** 3D building extrusions (MapLibre paint wants CSS strings). */
    buildings: { color: string; opacity: number };
  };
  /** 925 hPa wind particles (MODELLED). `trail` = trail segments per particle. */
  particles: { color: Rgb; alpha: number; width: number; trail: number; blend: BlendHint; streakAlpha: number };
  /** Modelled PM2.5 haze: stops in µg/m³. Transparent at or below the first stop. */
  haze: { stops: readonly RampStop[]; blend: HazeBlendHint };
  city: {
    bands: Readonly<Record<Pm25BandKey, CityBandStyle>>;
    /** No band (missing or invalid value). */
    unknown: CityBandStyle;
    glowBlend: BlendHint;
    /** Glow alpha (0..255) for a resting and a focused (hovered or selected) city. */
    glowAlpha: { rest: number; focus: number };
    /** Outline of a fire-prone-area marker (drawn 2 px). */
    fireAreaOutline: Rgba;
    /** NEA MEASURED ring around Singapore and its chip. */
    neaRing: Rgba;
    neaChip: { text: Rgba; bg: Rgba };
  };
  /** Map label text (SDF) and its halo; `haloWidth` is deck.gl's TextLayer outlineWidth. */
  label: { text: Rgba; halo: Rgba; haloWidth: number };
  volcano: { fill: Rgba; outline: Rgba; levelRing: Readonly<Record<VolcanoLevelColour, Rgba>> };
  /** Reference distance rings around a summit (distance only, not a hazard zone). */
  rings: { line: Rgba; halo: Rgba; fill: Rgba; label: Rgba };
  /**
   * Ash: the "If it erupted now" plume (MODELLED SCENARIO; same shape as plumeLayers.ts PlumePalette, so
   * plumeLayers can read it from here), a simple core/edge pair for single-path plume bodies (MapView's
   * scenario body), and the per-height ash-drift lines with their halo.
   */
  ash: { plume: PlumeColours; plumeCore: Rgba; plumeEdge: Rgba; lines: Readonly<Record<AshLevelKey, Rgb>>; halo: Rgba };
  /** Fire radiative power heat grid: stops in MW. FIRMS hotspot dots use `hotspot`. */
  fire: { stops: readonly RampStop[]; blend: BlendHint; hotspot: Rgb; halo: Rgba; cluster: { bg: Rgba; text: Rgba; border: Rgba } };
  /** The FIRMS FRP heat grid and its badges, in fireLayers.ts's FirePalette shape (drop-in for FIRE_COLORS). */
  fireGrid: FireGridColours;
  /** Reserved for relayed official warnings (pins, rails). Mirrors --official / --official-fill. */
  official: { fill: Rgba; stroke: Rgba; onFill: Rgba; halo: Rgba };
  /** BMKG tsunami warning areas: the issuer's level colours (fill is context, stroke carries the edge). */
  tsunami: Readonly<Record<TsunamiLevelKey, { fill: Rgba; stroke: Rgba }>>;
  /** IOC tide gauges (raw sea level, not a warning). */
  tide: { fill: Rgba; stroke: Rgba };
  /** GloFAS river points (MODELLED, the violet modelled family). */
  river: { fill: Rgba; stroke: Rgba };
  /** Earthquake depth colours (USGS discs, BMKG rings). */
  quake: Readonly<Record<QuakeDepthKey, Rgb>>;
  /** Modelled transport: illustrative haze paths and 10 m wind arrows. */
  modelled: { path: Rgb; arrow: Rgba };
  /** NEA Singapore context: PSI haze shading tint, station wind arrow and the illustrative drift cone. */
  nea: { psiSmoke: Rgb; psiAlphaScale: number; windInk: Rgb; driftFill: Rgba; driftLine: Rgba };
  /** Selected object on the map (city, volcano, fire cluster, warning). */
  selection: { ring: Rgba; halo: Rgba; width: number };
  /** Generic halo/ink pair for marks that need one (ticks, arrow halos). */
  ink: Rgb;
  halo: Rgb;
}

// ---------------------------------------------------------------------------------------------
// Colour helpers (pure; used by the tests and the contrast table in docs/DESIGN.md)

export function hexRgb(hex: string): Rgb {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.replace(/(.)/g, '$1$1') : s;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance. */
export function luminance(rgb: readonly number[]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 2.x contrast ratio (1..21). */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Ordinary alpha compositing of `fg` at `alpha` (0..1) over an opaque `bg`. */
export function compositeOver(fg: readonly number[], alpha: number, bg: readonly number[]): Rgb {
  const a = Math.max(0, Math.min(1, alpha));
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) as Rgb;
}

/** CSS colour string for MapLibre paint or inline styles: rgb() or rgba() (alpha 0..255). */
export function rgbCss(c: Rgb | Rgba): string {
  return c.length === 4 ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.round((c[3] / 255) * 1000) / 1000})` : `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Colour at `v` on a ramp, interpolated on a log scale between stops (alpha 0..255). At or below the
 * first stop: the first stop. At or above the last: the last. Non-finite values are transparent.
 */
export function rampRgba(stops: readonly RampStop[], v: number): Rgba {
  const first = stops[0];
  if (!Number.isFinite(v)) return [first.c[0], first.c[1], first.c[2], 0];
  if (!(v > first.v)) return [first.c[0], first.c[1], first.c[2], Math.round(first.a * 255)];
  const last = stops[stops.length - 1];
  if (v >= last.v) return [last.c[0], last.c[1], last.c[2], Math.round(last.a * 255)];
  let k = 1;
  while (v > stops[k].v) k += 1;
  const s0 = stops[k - 1];
  const s1 = stops[k];
  const lo = Math.log(Math.max(s0.v, 1e-6));
  const t = (Math.log(v) - lo) / (Math.log(s1.v) - lo);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return [mix(s0.c[0], s1.c[0]), mix(s0.c[1], s1.c[1]), mix(s0.c[2], s1.c[2]), Math.round((s0.a + (s1.a - s0.a) * t) * 255)];
}

/** Accepts the older `dark: boolean` flag or a theme name; undefined means dark (the default). */
export function themeOf(theme: MapTheme | boolean | undefined): MapTheme {
  if (theme === undefined) return 'dark';
  if (typeof theme === 'boolean') return theme ? 'dark' : 'light';
  return theme === 'light' ? 'light' : 'dark';
}

/** MAGMA level number (1–4, from "Level III (Siaga)") to the issuer's colour code. */
export function volcanoLevelColour(levelNumber: number | null | undefined): VolcanoLevelColour {
  switch (levelNumber) {
    case 1:
      return 'green';
    case 2:
      return 'yellow';
    case 3:
      return 'orange';
    case 4:
      return 'red';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------------------------
// The two palettes

const rgba = (c: Rgb, a: number): Rgba => [c[0], c[1], c[2], a];

function cityBands(outline: Rgba, label: Rgba, halo: Rgba, glowAlpha: number): Record<Pm25BandKey, CityBandStyle> {
  const out = {} as Record<Pm25BandKey, CityBandStyle>;
  for (const b of PM25_BANDS) {
    const fill = hexRgb(b.color);
    out[b.key] = { fill, glow: rgba(fill, glowAlpha), outline, label, halo };
  }
  return out;
}

// DARK: CARTO Dark Matter. Land #0e0e0e, water #2c353c. Light marks; ratios are against both.
const DARK_INK: Rgb = [236, 228, 214];
const DARK_HALO: Rgb = [10, 18, 24];
const DARK_LABEL: Rgba = [243, 234, 216, 255];
const DARK_LABEL_HALO: Rgba = [8, 10, 14, 235];
const DARK_OUTLINE: Rgba = [10, 12, 16, 230];

const DARK: MapPalette = {
  theme: 'dark',
  basemap: {
    land: [14, 14, 14],
    landTint: [14, 14, 14],
    water: [44, 53, 60],
    buildings: { color: '#2b2f35', opacity: 0.85 },
  },
  // Cream trails, additive (overlaps brighten). 0.5 head alpha on #0e0e0e composites to about 9.6:1.
  particles: { color: [246, 239, 222], alpha: 0.5, width: 1.1, trail: 6, blend: 'additive', streakAlpha: 170 / 255 },
  // A warm tan smoke around #c9a675, never above 0.55 opacity (the map stays readable underneath).
  haze: {
    stops: [
      { v: 12, c: [201, 166, 117], a: 0 },
      { v: 25, c: [201, 166, 117], a: 0.14 },
      { v: 55, c: [201, 166, 117], a: 0.27 },
      { v: 150, c: [196, 156, 104], a: 0.42 },
      { v: 400, c: [188, 142, 92], a: 0.55 },
    ],
    blend: 'screen-like',
  },
  city: {
    bands: cityBands(DARK_OUTLINE, DARK_LABEL, DARK_LABEL_HALO, 170),
    unknown: { fill: [150, 150, 150], glow: [150, 150, 150, 170], outline: DARK_OUTLINE, label: DARK_LABEL, halo: DARK_LABEL_HALO },
    glowBlend: 'additive',
    glowAlpha: { rest: 170, focus: 230 },
    fireAreaOutline: [255, 176, 96, 255],
    neaRing: [255, 210, 122, 255],
    neaChip: { text: [20, 26, 34, 255], bg: [255, 210, 122, 245] },
  },
  label: { text: DARK_LABEL, halo: DARK_LABEL_HALO, haloWidth: 0.32 },
  volcano: {
    fill: [236, 228, 214, 255],
    outline: [10, 12, 16, 235],
    // The issuer's colour code, lifted for a dark map; red is the official family's readable red.
    levelRing: {
      green: [111, 190, 120, 255],
      yellow: [236, 204, 92, 255],
      orange: [240, 150, 70, 255],
      red: [229, 103, 95, 255],
      unknown: [169, 161, 147, 255],
    },
  },
  rings: { line: rgba(DARK_INK, 230), halo: rgba(DARK_HALO, 150), fill: rgba(DARK_INK, 14), label: DARK_LABEL },
  ash: {
    // Pale grey-violet puffs (the eruption agent's plumeLayers values): never the warm tan smoke.
    plume: {
      level: { '700': [206, 200, 222], '500': [184, 172, 224], '300': [160, 144, 218] },
      puffAlpha: 0.36,
      haloAlpha: 0.32,
      haloScale: 1.3,
      trailAlpha: 120,
      footprint: [228, 220, 250, 205],
      placeFill: [26, 24, 38, 235],
      placeLine: [228, 220, 250, 255],
      text: [238, 234, 252, 255],
      textOutline: [18, 16, 28, 235],
    },
    // Plume body as one path: a cool pale grey core with a soft edge.
    plumeCore: [206, 210, 216, 150],
    plumeEdge: [206, 210, 216, 50],
    lines: { '700': [247, 239, 222], '500': [226, 196, 148], '300': [190, 152, 102] },
    halo: rgba(DARK_HALO, 190),
  },
  // Additive glow from ember orange to white-hot; hue stays 25–45°, away from the official red.
  fire: {
    stops: [
      { v: 1, c: [255, 128, 32], a: 0.35 },
      { v: 10, c: [255, 128, 32], a: 0.55 },
      { v: 50, c: [255, 156, 52], a: 0.75 },
      { v: 200, c: [255, 192, 96], a: 0.9 },
      { v: 1000, c: [255, 232, 176], a: 1 },
    ],
    blend: 'additive',
    hotspot: [196, 78, 18],
    halo: rgba(DARK_HALO, 255),
    cluster: { bg: [14, 18, 22, 235], text: [243, 234, 216, 255], border: [255, 156, 52, 255] },
  },
  // The fire agent's retuned dark FRP grid (FIRE_COLORS.dark in fireLayers.ts, after its render test),
  // additive: ember to white-hot. Stops follow the real spread of daily FRP per 0.25° cell (snapshot
  // 2026-10-15: median ~15 MW, 90th percentile ~250 MW, 97th ~850 MW, max ~20,000 MW), so most cells
  // stay red to orange and dense areas no longer wash out to white.
  fireGrid: {
    ramp: [
      [1, [110, 20, 12]],
      [30, [186, 40, 18]],
      [150, [232, 88, 28]],
      [800, [255, 148, 44]],
      [3000, [255, 204, 98]],
      [12000, [255, 240, 192]],
    ],
    glow24h: 150,
    cell24h: 200,
    glowOlder: 80,
    cellOlder: 120,
    recency: [1, 0.62, 0.5, 0.42, 0.35, 0.29, 0.24],
    highlight: [255, 244, 214, 200],
    selected: [255, 236, 190, 255],
    badgeText: [255, 240, 222, 255],
    badgeBg: [52, 18, 10, 236],
    badgeBorder: [255, 132, 52, 255],
    regionBadgeText: [255, 226, 196, 255],
    regionBadgeBg: [24, 16, 14, 222],
    blend: 'additive',
  },
  official: { fill: [158, 43, 35, 255], stroke: [229, 103, 95, 255], onFill: [255, 255, 255, 255], halo: rgba(DARK_HALO, 235) },
  tsunami: {
    awas: { fill: [229, 103, 95, 70], stroke: [229, 103, 95, 255] },
    siaga: { fill: [240, 150, 70, 64], stroke: [240, 150, 70, 255] },
    waspada: { fill: [236, 204, 92, 56], stroke: [236, 204, 92, 255] },
    unknown: { fill: [169, 161, 147, 48], stroke: [169, 161, 147, 255] },
  },
  tide: { fill: [150, 200, 235, 230], stroke: rgba(DARK_HALO, 230) },
  river: { fill: [205, 191, 240, 230], stroke: rgba(DARK_HALO, 230) },
  quake: {
    shallow: [242, 176, 64],
    intermediate: [64, 168, 190],
    deep: [150, 118, 214],
    unknown: [150, 150, 150],
  },
  modelled: { path: [255, 200, 120], arrow: [255, 200, 120, 165] },
  nea: { psiSmoke: [210, 180, 140], psiAlphaScale: 1.2, windInk: DARK_INK, driftFill: [236, 228, 214, 34], driftLine: [236, 228, 214, 140] },
  selection: { ring: [255, 210, 122, 255], halo: rgba(DARK_HALO, 230), width: 2 },
  ink: DARK_INK,
  halo: DARK_HALO,
};

// LIGHT: CARTO Positron tuned by basemap.ts. Land #fafaf8 (#f2f6f1 under the landcover tint), water
// #c8d3d9 (1.5:1 against land so coastlines read). Every ratio quoted is the worse of land and water.
const LIGHT_INK: Rgb = [21, 24, 28]; // --text
const LIGHT_HALO: Rgb = [255, 255, 255];
const LIGHT_LABEL: Rgba = [21, 24, 28, 255]; // 11.7:1 on water, 17:1 on land; the white halo makes it 18:1
const LIGHT_LABEL_HALO: Rgba = [255, 255, 255, 240];
const LIGHT_OUTLINE: Rgba = [24, 30, 38, 255]; // 11:1 on water: the band fill no longer has to carry the edge

const LIGHT: MapPalette = {
  theme: 'light',
  basemap: {
    land: [250, 250, 248],
    landTint: [242, 246, 241],
    water: [200, 211, 217],
    buildings: { color: '#d9d6cf', opacity: 0.8 },
  },
  // Deep slate-navy ink (cool, against the warm haze), normal blending. Head alpha 0.66: 4.3:1 on water
  // and tinted land, 3.5:1 over unhealthy haze, 2.6:1 over the densest (400+) haze; the trail fades
  // behind the head on purpose.
  particles: { color: [24, 34, 52], alpha: 0.66, width: 1.3, trail: 6, blend: 'normal', streakAlpha: 190 / 255 },
  // Amber at moderate, burnt sienna at unhealthy, deep umber with a plum cast at hazardous. Composited
  // on land: 25 µg/m³ 1.1:1 (a tint), 55 1.3:1, 150 1.8:1, 250 2.5:1, 400 3.7:1 (3.1:1 on water). The
  // first stops stay faint so background air over the sea does not paint the model grid's box on a white map.
  haze: {
    stops: [
      { v: 12, c: [200, 146, 66], a: 0 },
      { v: 25, c: [200, 146, 66], a: 0.08 },
      { v: 55, c: [184, 118, 48], a: 0.22 },
      { v: 150, c: [146, 82, 40], a: 0.38 },
      { v: 250, c: [116, 62, 42], a: 0.5 },
      { v: 400, c: [88, 46, 50], a: 0.62 },
    ],
    blend: 'multiply-like',
  },
  city: {
    bands: cityBands(LIGHT_OUTLINE, LIGHT_LABEL, LIGHT_LABEL_HALO, 110),
    unknown: { fill: [150, 150, 150], glow: [150, 150, 150, 110], outline: LIGHT_OUTLINE, label: LIGHT_LABEL, halo: LIGHT_LABEL_HALO },
    // A band-tinted aura, normally blended (additive glows vanish on white).
    glowBlend: 'normal',
    glowAlpha: { rest: 110, focus: 160 },
    fireAreaOutline: [110, 52, 18, 255], // 8.6:1 on water
    neaRing: [20, 26, 34, 255],
    neaChip: { text: [255, 210, 122, 255], bg: [20, 26, 34, 242] },
  },
  label: { text: LIGHT_LABEL, halo: LIGHT_LABEL_HALO, haloWidth: 0.34 },
  volcano: {
    fill: [58, 52, 46, 255], // dark warm ink triangle: 8.1:1 on water
    outline: [255, 255, 255, 235],
    // The issuer's colour code, deepened until each ring is >= 3:1 on water (yellow 3.2, orange 3.3).
    levelRing: {
      green: [40, 116, 62, 255],
      yellow: [140, 110, 0, 255],
      orange: [180, 84, 10, 255],
      red: [138, 31, 31, 255],
      unknown: [96, 102, 110, 255],
    },
  },
  rings: { line: [51, 71, 91, 235], halo: rgba(LIGHT_HALO, 140), fill: [51, 71, 91, 20], label: LIGHT_LABEL },
  ash: {
    // Deeper grey-violet puffs (smoke is warm brown). Puffs are a translucent field; the footprint
    // outline (11:1 on water) and the labelled place chips carry the edge and the meaning.
    plume: {
      level: { '700': [112, 104, 136], '500': [94, 82, 132], '300': [76, 62, 124] },
      puffAlpha: 0.3,
      haloAlpha: 0.3,
      haloScale: 1.3,
      trailAlpha: 150,
      footprint: [62, 50, 104, 220],
      placeFill: [255, 255, 255, 240],
      placeLine: [62, 50, 104, 255],
      text: [38, 30, 68, 255],
      textOutline: [255, 255, 255, 235],
    },
    // Plume body as one path: a cool slate core (2.6:1 on land at its alpha) with a soft edge; labelled.
    plumeCore: [66, 72, 82, 150],
    plumeEdge: [66, 72, 82, 60],
    // Per-height drift lines: cool greys, 3.4:1 (700 hPa) to 7.1:1 (300 hPa) on water.
    lines: { '700': [104, 110, 120], '500': [84, 90, 100], '300': [56, 60, 68] },
    halo: rgba(LIGHT_HALO, 210),
  },
  // Normal blending (additive would vanish on white): amber to burnt orange to deep brown, hue 18–36°,
  // kept away from the official red. From 50 MW every cell is >= 3.5:1 on water and 4.8:1 on land; the
  // faint first stops are weak detections inside clusters that carry a text badge.
  fire: {
    stops: [
      { v: 1, c: [222, 150, 40], a: 0.55 },
      { v: 10, c: [204, 104, 20], a: 0.8 },
      { v: 50, c: [184, 70, 14], a: 0.92 },
      { v: 200, c: [146, 58, 14], a: 1 },
      { v: 1000, c: [100, 40, 14], a: 1 },
    ],
    blend: 'normal',
    hotspot: [184, 70, 14], // 3.5:1 on water, 4.9:1 on land
    halo: rgba(LIGHT_HALO, 255),
    cluster: { bg: [255, 255, 255, 245], text: [21, 24, 28, 255], border: [146, 58, 14, 255] },
  },
  // Light FRP grid: the fire agent's structure and alphas, with the ramp moved off the official red. Their
  // top stops (132,18,12) and (92,10,10) were hue 0–3°, the family of --official #8a1f1f; these run amber
  // to burnt orange to deep brown, hue 16–34°. Cells at 220 alpha: 120 MW 3.9:1 on land, 600 MW and up
  // >= 4:1 on the sea. The badge is a deep brown (white text 9.1:1), not a red.
  fireGrid: {
    ramp: [
      [1, [236, 156, 52]],
      [20, [218, 112, 30]],
      [120, [190, 74, 16]],
      [600, [150, 52, 14]],
      [2500, [112, 40, 14]],
      [8000, [80, 32, 14]],
    ],
    glow24h: 92,
    cell24h: 220,
    glowOlder: 56,
    cellOlder: 150,
    recency: [1, 0.6, 0.48, 0.4, 0.33, 0.28, 0.24],
    highlight: [20, 26, 34, 140],
    selected: [20, 26, 34, 255],
    badgeText: [255, 255, 255, 255],
    badgeBg: [120, 52, 20, 240],
    badgeBorder: [80, 32, 14, 255],
    regionBadgeText: [40, 22, 16, 255],
    regionBadgeBg: [255, 247, 240, 242],
    blend: 'normal',
  },
  official: { fill: [138, 31, 31, 255], stroke: [138, 31, 31, 255], onFill: [255, 255, 255, 255], halo: rgba(LIGHT_HALO, 240) },
  tsunami: {
    awas: { fill: [138, 31, 31, 56], stroke: [138, 31, 31, 255] },
    siaga: { fill: [196, 104, 0, 56], stroke: [166, 84, 0, 255] },
    waspada: { fill: [214, 180, 40, 64], stroke: [124, 100, 0, 255] },
    unknown: { fill: [96, 102, 110, 40], stroke: [96, 102, 110, 255] },
  },
  tide: { fill: [24, 88, 140, 235], stroke: rgba(LIGHT_HALO, 235) }, // 4.9:1 on water
  river: { fill: [74, 47, 141, 235], stroke: rgba(LIGHT_HALO, 235) }, // MODELLED violet, 6.6:1 on water
  // Deepened for a light map: >= 3.5:1 on water and 4.9:1 on land; never the official red.
  quake: {
    shallow: [158, 90, 0],
    intermediate: [0, 108, 128],
    deep: [104, 70, 172],
    unknown: [96, 102, 110],
  },
  modelled: { path: [74, 47, 141], arrow: [74, 47, 141, 165] },
  nea: { psiSmoke: [122, 92, 58], psiAlphaScale: 1, windInk: LIGHT_INK, driftFill: [78, 89, 103, 42], driftLine: [78, 89, 103, 150] },
  // The accent teal (--accent) with a white halo: 4.2:1 on water, 5.8:1 on land.
  selection: { ring: [13, 106, 108, 255], halo: rgba(LIGHT_HALO, 235), width: 2 },
  ink: LIGHT_INK,
  halo: LIGHT_HALO,
};

const PALETTES: Readonly<Record<MapTheme, MapPalette>> = { dark: DARK, light: LIGHT };

/** Every overlay colour the map draws, for one theme (defaults to dark, the app default). */
export function getMapPalette(theme: MapTheme | boolean = 'dark'): MapPalette {
  return PALETTES[themeOf(theme)];
}

/** Style for a city circle at a PM2.5 value (the band's style, or the grey "unknown" style). */
export function cityBandStyle(palette: MapPalette, pm25: number): CityBandStyle {
  const band = pm25Band(pm25);
  return band ? palette.city.bands[band.key] : palette.city.unknown;
}
