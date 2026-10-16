// Fire layers for the map (deck.gl 9.4, @deck.gl/layers only: aggregation-layers is not installed).
// The look (docs/UX_V3.md section 2): a glowing heat grid of FIRMS fire radiative power. The last 24 h are
// bright; the six days before are dim and fade with age. At regional zoom the fires also carry badges.
//
// Layers, bottom to top (ids all start with "fires-"):
//   fires-glow-older-*   soft radial glow under each 0.25° cell with detections in periods 1–6 (dim)
//   fires-cells-older-*  GridCellLayer squares for the same cells (dim; pickable)
//   fires-glow-24h-*     glow for the last 24 h (bright)
//   fires-cells-24h-*    GridCellLayer squares for the last 24 h (bright; pickable)
//   fires-selected       ring around the selected cluster
//   fires-badges         TextLayer badges (pickable):
//                          zoom < regionalZoom: province, state and country badges ("Central Kalimantan · 11,960 hotspots")
//                          regionalZoom ≤ zoom < badgeMaxZoom: top 24 h cluster badges ("Ogan Komering Ilir · 2,550")
//                          zoom ≥ badgeMaxZoom: no badges (the grid itself is readable)
// Badges are a deck.gl TextLayer (not HTML) so they move with the map in the same frame and are pickable
// through the same overlay; a simple greedy spacing pass drops badges that would overlap at the zoom.
//
// Blending: on the dark theme everything is additive (overlapping glows brighten toward white, like fire).
// Additive light would vanish on the light basemap, so the light theme uses normal alpha blending with a
// darker ramp (amber to deep brown, never the reserved official red), and draws its squares at every zoom
// because a normally blended glow alone is too faint on paper-white land.
//
// Colour is by summed FRP per cell per day (a log ramp from ember red to pale yellow on dark; amber to
// deep brown on light); the older layer uses its average daily FRP over the six days so both layers
// share one ramp. The glow fades as you zoom in. FIRE_COLORS holds the palette per theme (light from
// mapPalette.ts fireGrid).
//
// Data: the bundled snapshot through src/lib/fires.ts. All MEASURED (FIRMS detections); the layers never
// imply emissions. A cell without colour is not "no fire" (the cards and workspace say so).
import { GridCellLayer, IconLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { fireCells, formatCount, regionalBadges, topClusters } from '../../lib/fires';
import type { FireBadge, FireCell, FireCluster, FireSnapshot } from '../../lib/fires';
import { getMapPalette } from './mapPalette';

export type FireTheme = 'dark' | 'light';
export type Rgba = [number, number, number, number];

export interface FirePalette {
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
  /** Hover highlight on cells. */
  highlight: Rgba;
  /** Ring around the selected cluster. */
  selected: Rgba;
  badgeText: Rgba;
  badgeBg: Rgba;
  badgeBorder: Rgba;
  /** Province/country badges at regional zoom (a quieter background). */
  regionBadgeText: Rgba;
  regionBadgeBg: Rgba;
  blend: 'additive' | 'normal';
}

/**
 * One palette per theme. Light is mapPalette.ts `fireGrid` (the theme module owns it). Dark is kept here
 * because it was retuned after a render test (the first-pass values, still copied in mapPalette's dark
 * fireGrid, washed dense areas out to white under additive blending); once mapPalette's dark fireGrid
 * carries these values, dark can come from there too.
 */
export const FIRE_COLORS: Readonly<Record<FireTheme, FirePalette>> = {
  dark: {
    // Stops follow the real spread of daily FRP per 0.25° cell (snapshot 2026-10-15: median ~15 MW,
    // 90th percentile ~250 MW, 97th ~850 MW, max ~20,000 MW), so most cells stay red to orange.
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
  // Light comes from the theme module: amber to burnt orange to deep brown (hue 16–34°), never the reserved
  // official red (#8a1f1f), with contrast checked in mapPalette.test.ts.
  light: getMapPalette('light').fireGrid,
};

/** Colour for a cell's summed FRP (MW) on a theme, alpha scaled by `alpha` (0–255). */
export function fireColor(frp: number, theme: FireTheme, alpha: number): Rgba {
  const ramp = FIRE_COLORS[theme].ramp;
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  const x = Math.log10(Math.max(frp, ramp[0][0]));
  if (x <= Math.log10(ramp[0][0])) return [...ramp[0][1], a] as Rgba;
  for (let i = 1; i < ramp.length; i += 1) {
    const x1 = Math.log10(ramp[i][0]);
    if (x <= x1) {
      const x0 = Math.log10(ramp[i - 1][0]);
      const t = (x - x0) / (x1 - x0);
      const c0 = ramp[i - 1][1];
      const c1 = ramp[i][1];
      return [Math.round(c0[0] + (c1[0] - c0[0]) * t), Math.round(c0[1] + (c1[1] - c0[1]) * t), Math.round(c0[2] + (c1[2] - c0[2]) * t), a];
    }
  }
  return [...ramp[ramp.length - 1][1], a] as Rgba;
}

// ---------------------------------------------------------------------------
// Picking

/** What a click or hover on a fire layer returns. */
export type FirePick =
  /** A 0.25° grid cell; `recent` when it is from the last-24 h layer (its values are then the last 24 h only). */
  | { kind: 'fire-cell'; cell: FireCell; recent: boolean }
  /** A cluster badge (from the 24 h top list). */
  | { kind: 'fire-cluster'; cluster: FireCluster }
  /** A province, state or country badge at regional zoom. */
  | { kind: 'fire-region'; badge: FireBadge };

export const FIRE_LAYER_PREFIX = 'fires-';
export const isFireLayerId = (id: string | undefined | null): boolean => typeof id === 'string' && id.startsWith(FIRE_LAYER_PREFIX);

interface BadgeDatum {
  id: string;
  text: string;
  lat: number;
  lon: number;
  regional: boolean;
  /** Placed under its point instead of above (set by the spacing pass). */
  below: boolean;
  cluster: FireCluster | null;
  badge: FireBadge | null;
}

/** Turn a deck.gl picking result into a typed FirePick; null when it is not a fire object. */
export function firePickFromInfo(info: Pick<PickingInfo, 'layer' | 'object'> | null | undefined): FirePick | null {
  const id = info?.layer?.id;
  const obj: unknown = info?.object;
  if (!isFireLayerId(id) || obj === null || obj === undefined) return null;
  if (id!.startsWith('fires-cells-')) return { kind: 'fire-cell', cell: obj as FireCell, recent: id!.startsWith('fires-cells-24h') };
  if (id === 'fires-badges') {
    const b = obj as BadgeDatum;
    if (b.cluster) return { kind: 'fire-cluster', cluster: b.cluster };
    if (b.badge) return { kind: 'fire-region', badge: b.badge };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Layer building

export interface FireLayerOptions {
  snapshot: FireSnapshot | null;
  theme: FireTheme;
  /** Current map zoom (badges and square visibility depend on it). */
  zoom: number;
  /** Default true. When false, returns []. */
  visible?: boolean;
  /** "7d" (default): last 24 h bright plus the six days before, dim. "24h": the last 24 h only. */
  window?: '24h' | '7d';
  selectedClusterId?: string | null;
  /** Below this zoom, badges are provinces, states and countries (default 5.2). */
  regionalZoom?: number;
  /** At or above this zoom, no badges (default 7.5). */
  badgeMaxZoom?: number;
  /** Most badges at once before spacing (default 8). */
  maxBadges?: number;
  /** Default true. */
  showBadges?: boolean;
  /** Below this zoom the squares are hidden and only the glow shows (default 4.5 on dark, 0 on light). */
  cellsMinZoom?: number;
  onClick?: (pick: FirePick, info: PickingInfo) => void;
  onHover?: (pick: FirePick | null, info: PickingInfo) => void;
}

const ADDITIVE = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const;

const NORMAL = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const;

const M_PER_DEG = 111_320;
const FONT = "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif";

const GLOW_PX = 64;
let glowUrl: string | null = null;
/** White radial-gradient sprite (data URL), tinted per cell with mask: true. Null without a DOM. */
function glowSprite(): string | null {
  if (glowUrl) return glowUrl;
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = GLOW_PX;
    c.height = GLOW_PX;
    const g = c.getContext('2d');
    if (!g) return null;
    const r = GLOW_PX / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_PX, GLOW_PX);
    glowUrl = c.toDataURL('image/png');
    return glowUrl;
  } catch {
    return null;
  }
}

interface CellSets {
  recent: FireCell[];
  older: FireCell[];
}
const cellCache = new WeakMap<FireSnapshot, CellSets>();

/** Decoded cells per snapshot (cached: building layers on every zoom step stays cheap). */
function cellsFor(s: FireSnapshot): CellSets {
  let sets = cellCache.get(s);
  if (!sets) {
    sets = { recent: fireCells(s, '24h'), older: fireCells(s, 'before24h') };
    cellCache.set(s, sets);
  }
  return sets;
}

function byCellDeg(cells: readonly FireCell[]): Map<number, FireCell[]> {
  const m = new Map<number, FireCell[]>();
  for (const c of cells) {
    const list = m.get(c.cellDeg);
    if (list) list.push(c);
    else m.set(c.cellDeg, [c]);
  }
  return m;
}

/** Glow diameter in metres: 1.2× the cell for a small fire up to 2.2× for the strongest. */
function glowMetres(c: FireCell): number {
  const t = Math.max(0, Math.min(1, Math.log10(c.frp + 1) / Math.log10(12000)));
  return c.cellDeg * M_PER_DEG * (1.2 + 1.0 * t);
}

/** The glow is for the regional view; it fades as you zoom in so the squares stay readable. */
function glowZoomFactor(zoom: number): number {
  // Stepped (0.1) so zooming recomputes the glow colours only a few times.
  return Math.round(Math.max(0.3, Math.min(1, 1 - (zoom - 5) * 0.3)) * 10) / 10;
}

/** Older cells are coloured by their average daily FRP over periods 1 to 6, so they share the daily ramp. */
const OLDER_DAYS = 6;

const BADGE_H = 22;
const BADGE_GAP = 12;

/**
 * Greedy spacing in approximate screen pixels (Web Mercator, 512 px world at zoom 0, as deck.gl and
 * MapLibre use): each badge, in priority order, goes above its point, else below it, else is dropped.
 */
function spaceBadges(list: BadgeDatum[], zoom: number, max: number): BadgeDatum[] {
  const scale = (512 * 2 ** zoom) / 360;
  const mercY = (lat: number) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const boxes: Box[] = [];
  const kept: BadgeDatum[] = [];
  for (const b of list) {
    if (kept.length >= max) break;
    const x = b.lon * scale;
    const y = -mercY(b.lat) * scale;
    const halfW = (b.text.length * 6.4 + 14) / 2;
    const above: Box = { x0: x - halfW, x1: x + halfW, y0: y - BADGE_GAP - BADGE_H, y1: y - BADGE_GAP };
    const below: Box = { x0: x - halfW, x1: x + halfW, y0: y + BADGE_GAP, y1: y + BADGE_GAP + BADGE_H };
    const free = (bx: Box) => !boxes.some((o) => bx.x0 < o.x1 && bx.x1 > o.x0 && bx.y0 < o.y1 && bx.y1 > o.y0);
    if (free(above)) {
      boxes.push(above);
      kept.push({ ...b, below: false });
    } else if (free(below)) {
      boxes.push(below);
      kept.push({ ...b, below: true });
    }
  }
  return kept;
}

function badgeData(s: FireSnapshot, zoom: number, regionalZoom: number, max: number): BadgeDatum[] {
  if (zoom < regionalZoom) {
    const list = regionalBadges(s, '24h', max * 2).map((b) => ({ id: b.id, text: b.text, lat: b.lat, lon: b.lon, regional: true, below: false, cluster: null, badge: b }));
    return spaceBadges(list, zoom, max);
  }
  const list = topClusters(s, '24h', max * 2).map((c) => ({
    id: c.id,
    text: `${c.badge} · ${formatCount(c.last24h.count)}`,
    lat: c.lat,
    lon: c.lon,
    regional: false,
    below: false,
    cluster: c,
    badge: null,
  }));
  return spaceBadges(list, zoom, max);
}

/**
 * The fire layers for the current snapshot, theme and zoom. Pure apart from a per-snapshot decode cache
 * and the lazily drawn glow sprite. Returns [] when hidden or when there is no snapshot.
 */
export function buildFireLayers(opts: FireLayerOptions): Layer[] {
  const s = opts.snapshot;
  if (!s || opts.visible === false) return [];
  const theme = opts.theme;
  const pal = FIRE_COLORS[theme];
  const parameters = pal.blend === 'additive' ? ADDITIVE : NORMAL;
  const zoom = Number.isFinite(opts.zoom) ? opts.zoom : 4;
  const showCells = zoom >= (opts.cellsMinZoom ?? (theme === 'light' ? 0 : 4.5));
  const { recent, older } = cellsFor(s);
  const sprite = glowSprite();
  const layers: Layer[] = [];

  const onClick = opts.onClick
    ? (info: PickingInfo) => {
        const pick = firePickFromInfo(info);
        if (pick) opts.onClick?.(pick, info);
        return Boolean(pick);
      }
    : undefined;
  const onHover = opts.onHover ? (info: PickingInfo) => opts.onHover?.(firePickFromInfo(info), info) : undefined;

  const glowFade = glowZoomFactor(zoom);
  const glowLayer = (id: string, data: FireCell[], alpha: (c: FireCell) => number, minPx: number, days: number) =>
    sprite
      ? new IconLayer<FireCell>({
          id,
          data,
          iconAtlas: sprite,
          iconMapping: { glow: { x: 0, y: 0, width: GLOW_PX, height: GLOW_PX, mask: true } },
          getIcon: () => 'glow',
          getPosition: (c) => [c.lon, c.lat],
          sizeUnits: 'meters',
          getSize: glowMetres,
          sizeMinPixels: minPx,
          sizeMaxPixels: 96,
          getColor: (c) => fireColor(c.frp / days, theme, alpha(c)),
          parameters,
          pickable: false,
          updateTriggers: { getColor: [theme, glowFade] },
        })
      : new ScatterplotLayer<FireCell>({
          id,
          data,
          getPosition: (c) => [c.lon, c.lat],
          radiusUnits: 'meters',
          getRadius: (c) => glowMetres(c) / 2,
          radiusMinPixels: minPx / 2,
          radiusMaxPixels: 48,
          getFillColor: (c) => fireColor(c.frp / days, theme, alpha(c) * 0.5),
          parameters,
          pickable: false,
          updateTriggers: { getFillColor: [theme, glowFade] },
        });

  const cellLayers = (prefix: string, data: FireCell[], alpha: (c: FireCell) => number, recentLayer: boolean, days: number) =>
    [...byCellDeg(data).entries()].map(
      ([cellDeg, cells]) =>
        new GridCellLayer<FireCell>({
          id: `${prefix}-${cellDeg}`,
          data: cells,
          extruded: false,
          // GridCellLayer places the cell by its south-west corner (offset [1, 1]).
          getPosition: (c) => [c.west, c.south],
          cellSize: cellDeg * M_PER_DEG,
          coverage: 0.9,
          getFillColor: (c) => fireColor(c.frp / days, theme, alpha(c)),
          parameters,
          pickable: true,
          autoHighlight: true,
          highlightColor: pal.highlight,
          onClick,
          onHover,
          updateTriggers: { getFillColor: [theme, recentLayer] },
        }),
    );

  if (opts.window !== '24h' && older.length) {
    const fade = (c: FireCell) => pal.recency[Math.min(c.latestPeriod, pal.recency.length - 1)];
    layers.push(glowLayer('fires-glow-older', older, (c) => pal.glowOlder * glowFade * fade(c), 3, OLDER_DAYS));
    if (showCells) layers.push(...cellLayers('fires-cells-older', older, (c) => pal.cellOlder * fade(c), false, OLDER_DAYS));
  }
  if (recent.length) {
    layers.push(glowLayer('fires-glow-24h', recent, () => pal.glow24h * glowFade, 6, 1));
    if (showCells) layers.push(...cellLayers('fires-cells-24h', recent, () => pal.cell24h, true, 1));
  }

  const selected = opts.selectedClusterId ? [...s.clusters24h, ...s.clusters7d].find((c) => c.id === opts.selectedClusterId) : undefined;
  if (selected) {
    const [south, west, north, east] = selected.bbox;
    const radius = (Math.hypot((north - south) * M_PER_DEG, (east - west) * M_PER_DEG * Math.cos((selected.lat * Math.PI) / 180)) / 2) * 1.15;
    layers.push(
      new ScatterplotLayer<FireCluster>({
        id: 'fires-selected',
        data: [selected],
        getPosition: (c) => [c.lon, c.lat],
        radiusUnits: 'meters',
        getRadius: radius,
        radiusMinPixels: 14,
        filled: false,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        getLineColor: pal.selected,
        pickable: false,
        updateTriggers: { getLineColor: [theme], getRadius: [selected.id] },
      }),
    );
  }

  const badgeMaxZoom = opts.badgeMaxZoom ?? 7.5;
  if (opts.showBadges !== false && zoom < badgeMaxZoom) {
    const data = badgeData(s, zoom, opts.regionalZoom ?? 5.2, opts.maxBadges ?? 8);
    if (data.length) {
      layers.push(
        new TextLayer<BadgeDatum>({
          id: 'fires-badges',
          data,
          characterSet: 'auto',
          fontFamily: FONT,
          fontWeight: 600,
          getPosition: (b) => [b.lon, b.lat],
          getText: (b) => b.text,
          getSize: (b) => (b.regional ? 12.5 : 12),
          getTextAnchor: 'middle',
          getAlignmentBaseline: (b) => (b.below ? 'top' : 'bottom'),
          getPixelOffset: (b) => [0, b.below ? BADGE_GAP : -BADGE_GAP],
          getColor: (b) => (b.regional ? pal.regionBadgeText : pal.badgeText),
          background: true,
          getBackgroundColor: (b) => (b.regional ? pal.regionBadgeBg : pal.badgeBg),
          getBorderColor: pal.badgeBorder,
          getBorderWidth: 1,
          backgroundPadding: [6, 3],
          backgroundBorderRadius: 6,
          pickable: true,
          onClick,
          onHover,
          updateTriggers: { getColor: [theme], getBackgroundColor: [theme], getBorderColor: [theme] },
        }),
      );
    }
  }
  return layers;
}
