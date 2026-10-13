// Regional map: locally bundled Natural Earth boundaries (data/region.geojson), drawn as
// pure SVG with d3-geo. No tiles and no network requests. Watch-area markers, their name tags,
// the selected-area callout, official warning and water-level gauge markers, the legend, the
// layers control and the zoomed inset are HTML overlays positioned in viewBox percentages, so
// text and hit areas keep a fixed pixel size at any container width.
//
// Overlay placement (marker declutter, tags, callout, country labels) runs a small collision
// model in stage pixels. The stage is measured with a ResizeObserver, so the model follows the
// real map size (about 570×365 inside the 1366 layout, 531×340 at 1024, 355×227 at 375); before
// the first measurement it assumes the historical 656×420 stage. Below 600 px container width a
// compact arrangement applies (name-only tags, compact callout, layers card bottom-left).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react';
import { geoBounds, geoGraticule, geoMercator, geoPath } from 'd3-geo';
import type { GeoProjection } from 'd3-geo';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import regionRaw from '../../data/region.geojson?raw';
import type {
  DriftAssessment,
  HazardType,
  Incident,
  NeaContext,
  OfficialWarning,
  ReviewLabel,
  ReviewState,
} from '../types';
import type { GaugeReading } from '../lib/warnings';
import './RegionMap.css';

export interface RegionMapProps {
  incidents: Incident[];
  selectedId: string | null;
  /** Review state per incident id, for marker styling. */
  states: Record<string, ReviewState>;
  onSelect: (incidentId: string) => void;
  /** Optional NEA Singapore context (live or bundled snapshot). Drawn only with a matching `drift`. */
  nea?: NeaContext | null;
  /** Optional drift assessment. When `drift.incidentId === selectedId`, the zoomed view shows wind and haze. */
  drift?: DriftAssessment | null;
  /**
   * Optional short place name per incident id for labels, e.g. the volcano name ("Merapi").
   * Without it the name is derived from the incident title.
   */
  placeNames?: Record<string, string>;
  /** Optional extra class on the root element. */
  className?: string;
  /**
   * Official warnings relayed verbatim. Every warning with a `location` is drawn: official ones
   * as diamonds (dashed when ended), aggregator impact estimates as hollow dashed circles.
   */
  warnings?: OfficialWarning[] | null;
  /** The warning open in the inspector; its marker gets the static select ring. */
  selectedWarningId?: string | null;
  onSelectWarning?: (id: string) => void;
  /**
   * Water-level gauges. Drawn as squares only when the reading is at or above the issuer's lowest
   * threshold (or, without thresholds, when the issuer gives a situation and a drawn warning cites
   * the gauge), so routine gauges never clutter the map.
   */
  gauges?: GaugeReading[] | null;
  /** Clears the selection; the map's All APAC control calls it and returns to the regional view. */
  onClearSelection?: () => void;
}

// ---------------------------------------------------------------------------------------------
// Free zoom and pan. The view is a transform in viewBox units: base point (bx, by) is drawn at
// (x + k·bx, y + k·by). The basemap group takes the transform (strokes are non-scaling); every
// overlay is positioned from transformed coordinates, so markers, labels and hit areas keep
// their pixel size at any zoom.

interface View {
  k: number;
  x: number;
  y: number;
}
const HOME_VIEW: View = { k: 1, x: 0, y: 0 };
/** Deepest zoom: about 0.2° of longitude across the map frame. */
const MIN_SPAN_DEG = 0.2;
/** The view centre stays over the base frame plus this margin (viewBox units). */
const PAN_MARGIN = 160;
/** Selection fits: ±1.5° around a summit; a watch box with a 0.3° margin. */
const SUMMIT_FIT_HALF_DEG = 1.5;
const BOX_FIT_MARGIN_DEG = 0.3;
/** Fit region inside the frame, clear of the top-left legend and the top-right inset column. */
const FIT_FRAME = { x0: 0.1, x1: 0.66, y0: 0.14, y1: 0.92 };
const ANIM_MS = 360;
const WHEEL_STEP = 0.003;
const DRAG_THRESHOLD_MOUSE = 4;
const DRAG_THRESHOLD_TOUCH = 8;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry (parsed and projected once per page load)

interface RegionProperties {
  name: string;
  /** ISO 3166-1 numeric code. */
  iso_n3: string | null;
  asean: boolean;
}
type RegionFeature = Feature<Polygon | MultiPolygon, RegionProperties>;
type RegionCollection = FeatureCollection<Polygon | MultiPolygon, RegionProperties> & {
  attribution: string;
  source: string;
};

const REGION = JSON.parse(regionRaw) as RegionCollection;

type LonLat = [number, number];
type Point = [number, number];
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Size {
  w: number;
  h: number;
}

/** Fixed frame. scripts/build-region.mjs mirrors these numbers to choose context countries. */
const VIEW_W = 1000;
const VIEW_H = 640;
const VIEW_PAD = 28;
/** Stage pixels per viewBox unit before the first measurement (the historical ~656×420 stage). */
const FALLBACK_PX = 0.656;
/** Container width at or below which the compact arrangement applies (mirrors the CSS container query). */
const NARROW_MAX = 520;

/** NEA reference point for Singapore (also used for the main-map dot). */
const SINGAPORE: LonLat = [103.8198, 1.3521];

/** Locator inset: about ±2.5° around the selected incident. */
const INSET_LOCATOR = { w: 300, h: 220 };
const INSET_HALF_SPAN = 2.5;
/** NEA zoom: frames the incident and Singapore together. */
const INSET_NEA = { w: 300, h: 200 };
const NEA_INCIDENT_MARGIN = 1.15;
const NEA_SINGAPORE_MARGIN = 0.85;
const NEA_PAD = 8;
const DRIFT_LENGTH_DEG = 1.0;
const DRIFT_HALF_ANGLE_DEG = 15;
const WIND_HALF_LENGTH_DEG = 0.32;

const MAX_WARNING_MARKERS = 60;
const MAX_GAUGE_MARKERS = 40;

interface CountryShape {
  key: string;
  feature: RegionFeature;
  asean: boolean;
  d: string;
  bounds: [LonLat, LonLat];
}

interface Basemap {
  projection: GeoProjection;
  context: CountryShape[];
  members: CountryShape[];
  graticule: string;
  /** Singapore is tiny at this scale: always draw a point so it reads. */
  singapore: Point;
  hasSingaporePolygon: boolean;
}

let basemapCache: Basemap | null = null;

function project(projection: GeoProjection, lonLat: LonLat): Point {
  return projection(lonLat) ?? [Number.NaN, Number.NaN];
}

function getBasemap(): Basemap {
  if (basemapCache) return basemapCache;
  const memberFeatures: FeatureCollection<Polygon | MultiPolygon, RegionProperties> = {
    type: 'FeatureCollection',
    features: REGION.features.filter((f) => f.properties.asean),
  };
  const projection = geoMercator().fitExtent(
    [
      [VIEW_PAD, VIEW_PAD],
      [VIEW_W - VIEW_PAD, VIEW_H - VIEW_PAD],
    ],
    memberFeatures,
  );
  const path = geoPath(projection);
  const shapes: CountryShape[] = REGION.features.map((feature, i) => ({
    key: `${feature.properties.iso_n3 ?? 'na'}-${i}`,
    feature,
    asean: feature.properties.asean,
    d: path(feature) ?? '',
    bounds: geoBounds(feature),
  }));
  const graticule =
    path(
      geoGraticule()
        .extent([
          [60, -50],
          [180, 60],
        ])
        .step([10, 10])(),
    ) ?? '';
  basemapCache = {
    projection,
    context: shapes.filter((s) => !s.asean),
    members: shapes.filter((s) => s.asean),
    graticule,
    singapore: project(projection, SINGAPORE),
    hasSingaporePolygon: REGION.features.some((f) => f.properties.iso_n3 === '702'),
  };
  return basemapCache;
}

// ---------------------------------------------------------------------------------------------
// Zoomed inset (memoised per location and mode, so re-renders never re-project it)

interface InsetView {
  w: number;
  h: number;
  countries: { key: string; asean: boolean; d: string }[];
  graticule: string;
  /** The inset window drawn as a dashed box on the main map, in main viewBox units. */
  locator: Rect;
  incident: Point;
  /** Set in NEA mode only. */
  singapore: Point | null;
  /** Inset units per degree of great-circle distance near the incident and near Singapore. */
  unitsPerDegIncident: number;
  unitsPerDegSingapore: number;
}

const insetCache = new Map<string, InsetView>();

function getInset(lon: number, lat: number, withSingapore: boolean): InsetView {
  const key = `${lon},${lat},${withSingapore ? 'nea' : 'locator'}`;
  let view = insetCache.get(key);
  if (!view) {
    view = buildInset(lon, lat, withSingapore);
    insetCache.set(key, view);
  }
  return view;
}

function buildInset(lon: number, lat: number, withSingapore: boolean): InsetView {
  const basemap = getBasemap();
  const { w, h } = withSingapore ? INSET_NEA : INSET_LOCATOR;
  const [west, east, south, north] = withSingapore
    ? [
        Math.min(lon - NEA_INCIDENT_MARGIN, SINGAPORE[0] - NEA_SINGAPORE_MARGIN),
        Math.max(lon + NEA_INCIDENT_MARGIN, SINGAPORE[0] + NEA_SINGAPORE_MARGIN),
        Math.min(lat - NEA_INCIDENT_MARGIN, SINGAPORE[1] - NEA_SINGAPORE_MARGIN),
        Math.max(lat + NEA_INCIDENT_MARGIN, SINGAPORE[1] + NEA_SINGAPORE_MARGIN),
      ]
    : [lon - INSET_HALF_SPAN, lon + INSET_HALF_SPAN, lat - INSET_HALF_SPAN, lat + INSET_HALF_SPAN];
  const pad = withSingapore ? NEA_PAD : 0;

  const projection = geoMercator().scale(1).translate([0, 0]);
  const a = project(projection, [west, north]);
  const b = project(projection, [east, south]);
  const k = Math.min((w - 2 * pad) / (b[0] - a[0]), (h - 2 * pad) / (b[1] - a[1]));
  projection.scale(k);
  let focus: Point;
  if (withSingapore) {
    const p = project(projection, [west, north]);
    const q = project(projection, [east, south]);
    focus = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  } else {
    focus = project(projection, [lon, lat]);
  }
  projection.translate([w / 2 - focus[0], h / 2 - focus[1]]).clipExtent([
    [-2, -2],
    [w + 2, h + 2],
  ]);

  const nw = (projection.invert?.([0, 0]) ?? [west, north]) as LonLat;
  const se = (projection.invert?.([w, h]) ?? [east, south]) as LonLat;
  const path = geoPath(projection);
  const countries = [...basemap.context, ...basemap.members]
    .filter(({ bounds: [[bw, bs], [be, bn]] }) => be >= nw[0] && bw <= se[0] && bn >= se[1] && bs <= nw[1])
    .map((shape) => ({ key: shape.key, asean: shape.asean, d: path(shape.feature) ?? '' }))
    .filter((shape) => shape.d !== '');
  const graticule =
    path(
      geoGraticule()
        .extent([
          [Math.floor(nw[0]), Math.floor(se[1])],
          [Math.ceil(se[0]) + 1e-6, Math.ceil(nw[1]) + 1e-6],
        ])
        .step([1, 1])(),
    ) ?? '';
  const [x0, y0] = project(basemap.projection, nw);
  const [x1, y1] = project(basemap.projection, se);
  const perDeg = (phi: number) => (k * Math.PI) / 180 / Math.cos((phi * Math.PI) / 180);
  return {
    w,
    h,
    countries,
    graticule,
    locator: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    incident: project(projection, [lon, lat]),
    singapore: withSingapore ? project(projection, SINGAPORE) : null,
    unitsPerDegIncident: perDeg(lat),
    unitsPerDegSingapore: perDeg(SINGAPORE[1]),
  };
}

// ---------------------------------------------------------------------------------------------
// NEA drawing inside the zoomed inset (cheap vector maths, computed per render)

/** Unit vector on screen for a compass bearing (Mercator is conformal, so angles hold). */
function bearingVector(deg: number): Point {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

const add = (p: Point, v: Point, s: number): Point => [p[0] + v[0] * s, p[1] + v[1] * s];
const fmt = (p: Point) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

const COMPASS: Point[] = [0, 45, 90, 135, 180, 225, 270, 315].map(bearingVector);

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Greedy label placement: try 8 directions around the anchor and keep the least-overlapping box. */
function placeBox(
  anchor: Point,
  size: Size,
  gap: number,
  bounds: Size,
  obstacles: { points: Point[]; rects: Rect[] },
  axis: Point | null,
): Rect {
  let best: Rect = { x: 0, y: 0, ...size };
  let bestScore = Number.POSITIVE_INFINITY;
  for (const dir of COMPASS) {
    const [ax, ay] = add(anchor, dir, gap);
    const rawX = dir[0] > 0.35 ? ax : dir[0] < -0.35 ? ax - size.w : ax - size.w / 2;
    const rawY = dir[1] > 0.35 ? ay : dir[1] < -0.35 ? ay - size.h : ay - size.h / 2;
    const x = clamp(rawX, 4, bounds.w - size.w - 4);
    const y = clamp(rawY, 4, bounds.h - size.h - 4);
    const rect = { x, y, w: size.w, h: size.h };
    let score = Math.hypot(x - rawX, y - rawY) * 0.6;
    for (const [px, py] of obstacles.points) {
      if (px >= x - 3 && px <= x + size.w + 3 && py >= y - 3 && py <= y + size.h + 3) score += 60;
    }
    for (const r of obstacles.rects) score += overlapArea(rect, r);
    if (axis) score += Math.abs(dir[0] * axis[0] + dir[1] * axis[1]) * 25;
    if (score < bestScore) {
      bestScore = score;
      best = rect;
    }
  }
  return best;
}

interface NeaDrawing {
  cone: string | null;
  arrow: { tail: Point; head: Point; tip: string } | null;
  chip: Rect;
  driftLabel: Rect | null;
}

/** Inset units. At the 1366 layout the NEA inset is about 221 px for 300 units, so the PSI chip
    ("Singapore 24-hr PSI 121–172 · Unhealthy (NEA)", 12 px) wraps to two lines in 215 units. */
const CHIP_SIZE = { w: 215, h: 54 };
const DRIFT_LABEL_SIZE = { w: 160, h: 46 };

function drawNea(view: InsetView, downwindDeg: number | null): NeaDrawing | null {
  const sg = view.singapore;
  if (!sg) return null;
  const apex = view.incident;
  const markerRect: Rect = { x: apex[0] - 17, y: apex[1] - 17, w: 34, h: 34 };
  const sgRect: Rect = { x: sg[0] - 5, y: sg[1] - 5, w: 10, h: 10 };
  const bounds = { w: view.w, h: view.h };

  if (downwindDeg === null || !Number.isFinite(downwindDeg)) {
    const chip = placeBox(sg, CHIP_SIZE, 9, bounds, { points: [], rects: [markerRect, sgRect] }, null);
    return { cone: null, arrow: null, chip, driftLabel: null };
  }

  const v = bearingVector(downwindDeg);
  const length = DRIFT_LENGTH_DEG * view.unitsPerDegIncident;
  const e1 = bearingVector(downwindDeg - DRIFT_HALF_ANGLE_DEG);
  const e2 = bearingVector(downwindDeg + DRIFT_HALF_ANGLE_DEG);
  const p1 = add(apex, e1, length);
  const p2 = add(apex, e2, length);
  const cone = `M${fmt(apex)} L${fmt(p1)} A${length.toFixed(1)} ${length.toFixed(1)} 0 0 1 ${fmt(p2)} Z`;

  const half = WIND_HALF_LENGTH_DEG * view.unitsPerDegSingapore;
  const tail = add(sg, v, -half);
  const head = add(sg, v, half);
  const perp: Point = [-v[1], v[0]];
  const tipPoint = add(head, v, 9);
  const tip = `M${fmt(tipPoint)} L${fmt(add(head, perp, 5.5))} L${fmt(add(head, perp, -5.5))} Z`;

  const conePoints: Point[] = [];
  for (const r of [0.15, 0.35, 0.55, 0.75, 0.95]) {
    for (const off of [-DRIFT_HALF_ANGLE_DEG, -7.5, 0, 7.5, DRIFT_HALF_ANGLE_DEG]) {
      conePoints.push(add(apex, bearingVector(downwindDeg + off), length * r));
    }
  }
  const arrowPoints: Point[] = [0, 0.25, 0.5, 0.75, 1].map((t) => add(tail, v, 2 * half * t + 9 * t));

  const obstacles = { points: [...conePoints, ...arrowPoints], rects: [markerRect, sgRect] };
  const chip = placeBox(sg, CHIP_SIZE, 10, bounds, obstacles, v);
  const mid = add(apex, v, length * 0.55);
  const driftLabel = placeBox(
    mid,
    DRIFT_LABEL_SIZE,
    length * 0.55 * Math.tan((DRIFT_HALF_ANGLE_DEG * Math.PI) / 180) + 8,
    bounds,
    { points: obstacles.points, rects: [...obstacles.rects, chip] },
    v,
  );
  return { cone, arrow: { tail, head, tip }, chip, driftLabel };
}

// ---------------------------------------------------------------------------------------------
// Labels, names and formatting

const STATE_LABEL: Record<ReviewState, ReviewLabel> = {
  monitoring: 'Monitoring',
  check: 'Check observation',
  review: 'Review needed',
};
const LEGEND_STATES: ReviewState[] = ['monitoring', 'check', 'review'];
const NO_STATE_LABEL = 'Review state unavailable';

interface CountryLabel {
  text: string;
  lon: number;
  lat: number;
  /** Minor labels only show on roomier maps. */
  minor?: boolean;
}

// Myanmar is left unlabelled: its label would sit under the top-left legend.
const COUNTRY_LABELS: CountryLabel[] = [
  { text: 'Thailand', lon: 101.0, lat: 15.5 },
  { text: 'Laos', lon: 103.3, lat: 18.9, minor: true },
  { text: 'Vietnam', lon: 105.8, lat: 21.5 },
  { text: 'Cambodia', lon: 104.9, lat: 12.7, minor: true },
  { text: 'Philippines', lon: 122.3, lat: 12.4 },
  { text: 'Malaysia', lon: 113.3, lat: 2.3 },
  { text: 'Indonesia', lon: 113.6, lat: -1.0 },
];

const HAZARD_WORD =
  '(?:volcanic|volcano|eruption|wildfires?|fires?|haze|smoke|hotspots?|peatlands?|floods?|flooding|flash|river|observations?)';
const TRAILING_HAZARD = new RegExp(`\\s+${HAZARD_WORD}\\b.*$`, 'i');
const LEADING_HAZARD = new RegExp(`^${HAZARD_WORD}\\b`, 'i');
const TRAILING_CONNECTOR = /\b(?:and|of|in|near|at|the|&)$/i;

/** "Merapi volcanic observations" → "Merapi". Falls back to the full title. */
function placeName(incident: Incident, placeNames?: Record<string, string>): string {
  const given = placeNames?.[incident.id]?.trim();
  if (given) return given;
  const stripped = incident.title.replace(TRAILING_HAZARD, '').trim();
  const usable =
    stripped !== '' &&
    stripped !== incident.title &&
    stripped.split(/\s+/).length <= 3 &&
    !LEADING_HAZARD.test(stripped) &&
    !TRAILING_CONNECTOR.test(stripped);
  return usable ? stripped : incident.title;
}

/** Avoid "Riau · Riau, Indonesia": drop the name from the front of the location. */
function locationRest(name: string, locationName: string): string {
  const loc = locationName.trim();
  if (loc.toLowerCase().startsWith(name.toLowerCase())) {
    return loc.slice(name.length).replace(/^[\s,·–-]+/, '');
  }
  return loc;
}

function formatCoordinate(value: number, positive: string, negative: string): string {
  const magnitude = Number(Math.abs(value).toFixed(4));
  return `${magnitude}° ${value < 0 ? negative : positive}`;
}

function formatLatLon(lat: number, lon: number): string {
  return `${formatCoordinate(lat, 'N', 'S')}, ${formatCoordinate(lon, 'E', 'W')}`;
}

/** "2026-10-13T06:40:00Z" → "2026-10-13 06:40 UTC" (deterministic, no locale). */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : String(value);
}

function psiChipText(nea: NeaContext): string | null {
  if (!nea.haze) return null;
  const values = Object.values(nea.haze.psi24h).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = min === max ? `${min}` : `${min}–${max}`;
  return `Singapore 24-hr PSI ${range} · ${nea.haze.psiBand} (NEA)`;
}

function windLine(nea: NeaContext): string {
  const label = nea.wind.label.trim() || 'No usable wind reading';
  const variable = nea.wind.consistency < 0.5 && !/variable/i.test(label) ? ', variable' : '';
  return `${label}${variable}`;
}

/** BCP 47 tag for an issuer's verbatim text, so screen readers switch voice; undefined when unknown. */
function issuerLang(issuer: string): string | undefined {
  if (/thaiwater|hydro-informatics/i.test(issuer)) return 'th';
  if (/dsda|dinas|magma|pvmbg|bmkg/i.test(issuer)) return 'id';
  return undefined;
}

const pct = (value: number, total: number) => `${((value / total) * 100).toFixed(3)}%`;

// ---------------------------------------------------------------------------------------------
// Marker symbols (shared by markers, inset and legend)

const GLYPHS: Record<HazardType, () => ReactElement> = {
  volcano: () => (
    <g className="region-map__glyph-fill">
      <path d="M2 21 9 9.5l1.6 1.1L12 9.4l1.4 1.2L15 9.5 22 21Z" />
      <circle cx="10.4" cy="6" r="1.5" />
      <circle cx="13.7" cy="4.4" r="1.9" />
    </g>
  ),
  wildfire: () => (
    <path
      className="region-map__glyph-fill"
      d="M12.5 2.5c.7 3.5 5 5.5 5 11.1a5.5 5.5 0 0 1-11 0c0-3 1.7-4.8 2.9-6.2.2 2.2 1.2 3.5 2.3 3.9-.7-3-.3-6.1.8-8.8Z"
    />
  ),
  flood: () => (
    <g className="region-map__glyph-stroke">
      <path d="M2.5 7.5q2.4-2.6 4.75 0t4.75 0 4.75 0 4.75 0" />
      <path d="M2.5 12.5q2.4-2.6 4.75 0t4.75 0 4.75 0 4.75 0" />
      <path d="M2.5 17.5q2.4-2.6 4.75 0t4.75 0 4.75 0 4.75 0" />
    </g>
  ),
};

/** Round watch-area symbol in a 32×32 box: ring in the state colour, hazard glyph, optional "!" disc. */
function MarkerSymbol({
  hazard,
  state,
  selected = false,
}: {
  hazard: HazardType | null;
  state: ReviewState | undefined;
  selected?: boolean;
}) {
  const Glyph = hazard ? GLYPHS[hazard] : null;
  return (
    <>
      {selected && <circle className="region-map__select-ring" cx="16" cy="16" r="15" />}
      <circle className="region-map__ring" cx="16" cy="16" r="12.5" />
      {Glyph && (
        <g transform="translate(8.5 8.5) scale(0.625)">
          <Glyph />
        </g>
      )}
      {state === 'review' && (
        <g className="region-map__badge">
          <circle cx="26.5" cy="5.5" r="5" />
          <path d="M26.5 3v3.3" />
          <circle className="region-map__badge-dot" cx="26.5" cy="8.4" r="0.95" />
        </g>
      )}
    </>
  );
}

type OfficialKind = 'official' | 'ended' | 'estimate' | 'gauge';

/**
 * Reserved official-style symbols in a 20×20 box. Distinct from watch areas by shape alone:
 * diamond = official warning (dashed when ended), hollow dashed circle = aggregator impact
 * estimate, square = water-level gauge.
 */
function OfficialSymbol({ kind, selected = false }: { kind: OfficialKind; selected?: boolean }) {
  return (
    <>
      {selected && <circle className="region-map__select-ring" cx="10" cy="10" r="9" />}
      {kind === 'estimate' ? (
        <circle className="region-map__wcircle" cx="10" cy="10" r="4.5" />
      ) : kind === 'gauge' ? (
        <rect className="region-map__gsquare" x="5" y="5" width="10" height="10" />
      ) : (
        <rect
          className={`region-map__wdiamond${kind === 'ended' ? ' is-ended' : ''}`}
          x="4"
          y="4"
          width="12"
          height="12"
          transform="rotate(45 10 10)"
        />
      )}
    </>
  );
}

function NeaSwatch({ kind, variable = false }: { kind: 'wind' | 'drift' | 'both'; variable?: boolean }) {
  return (
    <svg className="region-map__nea-swatch" viewBox="0 0 22 16" aria-hidden="true" focusable="false">
      {kind !== 'wind' && <path className="region-map__drift" d="M2 13 L18 3.5 A12 12 0 0 1 20 9.5 Z" />}
      {kind !== 'drift' && (
        <g className={`region-map__wind${variable ? ' is-variable' : ''}`}>
          <line x1="3" y1="12" x2="14" y2="5" />
          <path className="region-map__wind-tip" d="M19 2 L12.4 3.1 L15.6 8.1 Z" />
        </g>
      )}
    </svg>
  );
}

const stateClass = (state: ReviewState | undefined) => `is-${state ?? 'unknown'}`;

// ---------------------------------------------------------------------------------------------
// Overlay layout model (stage pixels)

interface PlacedIncident {
  incident: Incident;
  /** True position in viewBox units. */
  x: number;
  y: number;
  state: ReviewState | undefined;
  stateLabel: string;
  name: string;
}

interface PlacedWarning {
  warning: OfficialWarning;
  x: number;
  y: number;
}

interface PlacedGauge {
  gauge: GaugeReading;
  x: number;
  y: number;
  /** Reading minus the lowest threshold; null when the issuer gives no thresholds. */
  excess: number | null;
}

/** Measured geometry of the stage and the chrome cards, all in stage pixels. */
interface StageGeom {
  /** Stage pixels per viewBox unit. */
  px: number;
  /** The visible container; its origin is negative when the stage is letterboxed inside it. */
  frame: Rect;
  /** Legend, layers card, inset column and attribution, as rendered. */
  chrome: Rect[];
  /** The selected-area callout, as rendered. */
  callout: Rect | null;
  /** Container width <= NARROW_MAX: compact arrangement. */
  narrow: boolean;
}

/** Before the first measurement: the historical stage with estimated chrome boxes. */
function fallbackGeom(hasSelection: boolean, neaActive: boolean, insetAtBottom: boolean): StageGeom {
  const px = FALLBACK_PX;
  const w = VIEW_W * px;
  const h = VIEW_H * px;
  const chrome: Rect[] = [{ x: 10, y: 10, w: 300, h: 170 }];
  if (hasSelection) {
    const side: Rect = neaActive ? { x: w - 330, y: 10, w: 320, h: 300 } : { x: w - 225, y: 10, w: 215, h: 200 };
    chrome.push(insetAtBottom ? { ...side, y: h - side.h - 30 } : side);
  }
  return { px, frame: { x: 0, y: 0, w, h }, chrome, callout: null, narrow: false };
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const rectEq = (a: Rect, b: Rect) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);

function geomEqual(a: StageGeom | null, b: StageGeom): boolean {
  if (!a) return false;
  if (Math.abs(a.px - b.px) > 0.0005 || a.narrow !== b.narrow || !rectEq(a.frame, b.frame)) return false;
  if (a.chrome.length !== b.chrome.length || a.chrome.some((r, i) => !rectEq(r, b.chrome[i]))) return false;
  if ((a.callout === null) !== (b.callout === null)) return false;
  return a.callout === null || b.callout === null || rectEq(a.callout, b.callout);
}

/** Rough text width for Segoe UI / system sans: mixed-case text averages about 0.52 em (0.56 em at weight 600). */
function textWidth(text: string, fontPx: number, semibold = false): number {
  return text.length * fontPx * (semibold ? 0.56 : 0.52);
}

const box = (cx: number, cy: number, r: number): Rect => ({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r });

interface Obstacles {
  frame: Rect;
  /** Chrome cards and the callout: weight 2. */
  chrome: Rect[];
  /** Watch-area marker boxes (own marker excluded): weight 3. */
  markers: Rect[];
  /** Small fixed marks (Singapore dot, leader dots, warning and gauge symbols): weight 2. */
  points: Rect[];
  /** Tags already placed: weight 3. */
  tags: Rect[];
  /** Movable boxes (provisional tags while placing the callout): weight 0.1. */
  soft?: Rect[];
  /** Weight of a marker overlap; the callout uses 10 so it never clips another watch marker. */
  markerWeight?: number;
  /** Weight of a point overlap; the callout uses 0.4 because hover-only official symbols come
      in dozens (a volcano cluster must not push it onto a watch marker). */
  pointWeight?: number;
}

function outOfFrame(r: Rect, frame: Rect): number {
  return r.w * r.h - overlapArea(r, frame);
}

function scoreRect(r: Rect, o: Obstacles, ownMarker: number): number {
  const mw = o.markerWeight ?? 3;
  const pw = o.pointWeight ?? 2;
  let s = outOfFrame(r, o.frame) * 3;
  for (const c of o.chrome) s += overlapArea(r, c) * 2;
  o.markers.forEach((m, i) => {
    if (i !== ownMarker) s += overlapArea(r, m) * mw;
  });
  for (const p of o.points) s += overlapArea(r, p) * pw;
  for (const t of o.tags) s += overlapArea(r, t) * 3;
  if (o.soft) for (const t of o.soft) s += overlapArea(r, t) * 0.1;
  return s;
}

/** Minimum centre distance between two watch-area symbols so each 36 px button stays clickable. */
const MIN_MARKER_DISTANCE = 40;

/**
 * Push overlapping markers apart along the line between them (stage px). The selected marker
 * stays on its true position; the others move. A leader line shows each true position.
 */
function declutter(points: Point[], anchored: number): Point[] {
  const out = points.map((p): Point => [p[0], p[1]]);
  for (let iter = 0; iter < 16; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j][0] - out[i][0];
        let dy = out[j][1] - out[i][1];
        let d = Math.hypot(dx, dy);
        if (d >= MIN_MARKER_DISTANCE) continue;
        if (d < 0.01) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (MIN_MARKER_DISTANCE - d) / d;
        const wi = i === anchored ? 0 : j === anchored ? 1 : 0.5;
        const wj = 1 - wi;
        out[i] = [out[i][0] - dx * push * wi, out[i][1] - dy * push * wi];
        out[j] = [out[j][0] + dx * push * wj, out[j][1] + dy * push * wj];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

type TagPos =
  | 'right'
  | 'left'
  | 'below'
  | 'above'
  | 'below-right'
  | 'above-right'
  | 'below-left'
  | 'above-left';
const TAG_POSITIONS: TagPos[] = [
  'right',
  'left',
  'below',
  'above',
  'below-right',
  'above-right',
  'below-left',
  'above-left',
];
/** Marker centre to tag edge for the four cardinal positions (ring radius 16 + 4), and the diagonal
    tuck (15 for the selected marker, whose ring is scaled 1.15). */
const TAG_GAP = 20;
const TAG_DIAG = 12;
const TAG_DIAG_SELECTED = 15;
/** Cost of dropping the state text from a tag (px², against overlap areas). */
const SHORT_PENALTY = 60;

/** Where a tag of `size` sits for a marker centred at (mx, my). Mirrors the .region-map__tag.is-* rules. */
function tagRectAt(mx: number, my: number, pos: TagPos, size: Size, diag = TAG_DIAG): Rect {
  const { w, h } = size;
  switch (pos) {
    case 'right':
      return { x: mx + TAG_GAP, y: my - h / 2, w, h };
    case 'left':
      return { x: mx - TAG_GAP - w, y: my - h / 2, w, h };
    case 'below':
      return { x: mx - w / 2, y: my + TAG_GAP, w, h };
    case 'above':
      return { x: mx - w / 2, y: my - TAG_GAP - h, w, h };
    case 'below-right':
      return { x: mx + diag, y: my + diag, w, h };
    case 'above-right':
      return { x: mx + diag, y: my - diag - h, w, h };
    case 'below-left':
      return { x: mx - diag - w, y: my + diag, w, h };
    case 'above-left':
      return { x: mx - diag - w, y: my - diag - h, w, h };
  }
}

function tagSize(p: PlacedIncident, fontPx: number, short: boolean): Size {
  const text = textWidth(p.name, fontPx, true) + (short ? 0 : textWidth(` · ${p.stateLabel}`, fontPx));
  return { w: text + 14, h: Math.round(fontPx * 1.4) + 4 };
}

interface TagChoice {
  pos: TagPos;
  short: boolean;
  rect: Rect;
}

function chooseTag(
  mx: number,
  my: number,
  ownMarker: number,
  variants: { short: boolean; size: Size }[],
  obstacles: Obstacles,
  diag = TAG_DIAG,
): TagChoice {
  let best: TagChoice | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const { short, size } of variants) {
    TAG_POSITIONS.forEach((pos, order) => {
      const rect = tagRectAt(mx, my, pos, size, diag);
      const score = scoreRect(rect, obstacles, ownMarker) + order * 0.5 + (short ? SHORT_PENALTY : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { pos, short, rect };
      }
    });
  }
  return best ?? { pos: 'right', short: false, rect: tagRectAt(mx, my, 'right', variants[0].size) };
}

type HAnchor = 'left' | 'right' | 'center';
type VAnchor = 'top' | 'bottom' | 'middle';

interface CalloutChoice {
  rect: Rect;
  hx: HAnchor;
  hy: VAnchor;
  /** Constrain the box width so the text wraps as modelled. */
  maxWidth: number | null;
  /** Show the location text after the name (dropped when the box is squeezed). */
  withRest: boolean;
}

/** Anchor-based CSS position so the rendered box hugs the marker whatever its real text width. */
function anchorStyle(choice: CalloutChoice, px: number, mx: number, my: number): CSSProperties {
  const { rect, hx, hy } = choice;
  const style: CSSProperties = {};
  if (choice.maxWidth !== null) style.maxWidth = `${Math.round(choice.maxWidth)}px`;
  if (hx === 'left') style.left = pct(rect.x / px, VIEW_W);
  else if (hx === 'right') style.right = pct(VIEW_W - (rect.x + rect.w) / px, VIEW_W);
  else style.left = pct(mx / px, VIEW_W);
  if (hy === 'top') style.top = pct(rect.y / px, VIEW_H);
  else if (hy === 'bottom') style.bottom = pct(VIEW_H - (rect.y + rect.h) / px, VIEW_H);
  else style.top = pct(my / px, VIEW_H);
  if (hx === 'center' || hy === 'middle') {
    style.transform = `translate(${hx === 'center' ? '-50%' : '0'}, ${hy === 'middle' ? '-50%' : '0'})`;
  }
  return style;
}

const CALLOUT_MAX_W = 256;
/** Horizontal padding (8 + 8) plus the 3 px rail. */
const CALLOUT_PAD_X = 19;
const CALLOUT_GAP = 18;
const CALLOUT_MIN_W = 110;
/** Below this width the location text is dropped from the title (the review column has it). */
const CALLOUT_REST_MIN_W = 180;

type CalloutPos =
  | 'right-down'
  | 'right-up'
  | 'left-down'
  | 'left-up'
  | 'below-left'
  | 'below-right'
  | 'above-left'
  | 'above-right'
  | 'below'
  | 'above';
const CALLOUT_POSITIONS: CalloutPos[] = [
  'right-down',
  'right-up',
  'left-down',
  'left-up',
  'below-left',
  'below-right',
  'above-left',
  'above-right',
  'below',
  'above',
];

interface CalloutText {
  name: string;
  rest: string;
  coords: string;
  stateLabel: string;
}

function calloutSize(t: CalloutText, avail: number): { w: number; h: number; withRest: boolean; natural: number } | null {
  const nameW = textWidth(t.name, 14, true);
  const restW = t.rest ? textWidth(` · ${t.rest}`, 14) : 0;
  const coordsW = t.coords.length * 7.8;
  const chipW = textWidth(t.stateLabel, 13, true) + 12;
  const natural = Math.max(nameW + restW, coordsW, chipW) + CALLOUT_PAD_X;
  const w = Math.min(CALLOUT_MAX_W, natural, avail);
  if (w < CALLOUT_MIN_W) return null;
  const withRest = t.rest !== '' && w >= CALLOUT_REST_MIN_W;
  const inner = w - CALLOUT_PAD_X;
  const lines = Math.ceil((nameW + (withRest ? restW : 0)) / inner) + Math.ceil(coordsW / inner);
  return { w, h: 41 + 18 * lines, withRest, natural };
}

/** Wide callout: ten candidate positions around the selected marker, least-overlapping wins. */
function placeCallout(
  mx: number,
  my: number,
  ownMarker: number,
  text: CalloutText,
  obstacles: Obstacles,
): CalloutChoice | null {
  const { frame } = obstacles;
  const frameRight = frame.x + frame.w;
  // Chrome to the right or left of the marker within a generous vertical band limits the width
  // of side placements, so a tall inset column squeezes the callout instead of overlapping it.
  const band = (c: Rect) => c.y < my + 170 && c.y + c.h > my - 170;
  const rightLimit = Math.min(frameRight, ...obstacles.chrome.filter((c) => band(c) && c.x > mx).map((c) => c.x));
  const leftLimit = Math.max(frame.x, ...obstacles.chrome.filter((c) => band(c) && c.x + c.w < mx).map((c) => c.x + c.w));
  const clampX = (x: number, w: number) => clamp(x, frame.x + 4, frameRight - w - 4);

  // A chrome card whose edge sits just beyond the usual 22 px gap (the legend column next to
  // Sumatra, say) pushes the side placements past it, up to 30 px further from the marker.
  const rightStarts = [mx + CALLOUT_GAP];
  const leftEnds = [mx - CALLOUT_GAP];
  for (const c of obstacles.chrome.filter(band)) {
    const edgeR = c.x + c.w + 4;
    if (edgeR > rightStarts[0] && edgeR - rightStarts[0] <= 30) rightStarts.push(edgeR);
    const edgeL = c.x - 4;
    if (edgeL < leftEnds[0] && leftEnds[0] - edgeL <= 30) leftEnds.push(edgeL);
  }

  let best: CalloutChoice | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  CALLOUT_POSITIONS.forEach((pos, order) => {
    const right = pos.startsWith('right');
    const left = pos.startsWith('left');
    const variants: { avail: number; edge: number }[] = right
      ? rightStarts.flatMap((x0) => [frameRight, rightLimit].map((lim) => ({ avail: lim - x0 - 4, edge: x0 })))
      : left
        ? leftEnds.flatMap((x1) => [frame.x, leftLimit].map((lim) => ({ avail: x1 - lim - 4, edge: x1 })))
        : [{ avail: frame.w - 8, edge: mx }];
    for (const { avail, edge } of variants) {
      const size = calloutSize(text, avail);
      if (!size) continue;
      const { w, h } = size;
      let rect: Rect;
      let hx: HAnchor = 'left';
      let hy: VAnchor = 'top';
      switch (pos) {
        case 'right-down':
          rect = { x: edge, y: my - 12, w, h };
          break;
        case 'right-up':
          rect = { x: edge, y: my + 12 - h, w, h };
          hy = 'bottom';
          break;
        case 'left-down':
          rect = { x: edge - w, y: my - 12, w, h };
          hx = 'right';
          break;
        case 'left-up':
          rect = { x: edge - w, y: my + 12 - h, w, h };
          hx = 'right';
          hy = 'bottom';
          break;
        case 'below-left':
          rect = { x: clampX(mx + 18 - w, w), y: my + 24, w, h };
          break;
        case 'below-right':
          rect = { x: clampX(mx - 18, w), y: my + 24, w, h };
          break;
        case 'above-left':
          rect = { x: clampX(mx + 18 - w, w), y: my - 24 - h, w, h };
          hy = 'bottom';
          break;
        case 'above-right':
          rect = { x: clampX(mx - 18, w), y: my - 24 - h, w, h };
          hy = 'bottom';
          break;
        case 'below':
          rect = { x: clampX(mx - w / 2, w), y: my + 24, w, h };
          break;
        case 'above':
          rect = { x: clampX(mx - w / 2, w), y: my - 24 - h, w, h };
          hy = 'bottom';
          break;
      }
      const detached = right ? edge - (mx + CALLOUT_GAP) : left ? mx - CALLOUT_GAP - edge : 0;
      const score =
        scoreRect(rect, obstacles, ownMarker) + order * 0.5 + Math.max(0, size.natural - w) * 0.3 + detached * 2;
      if (score < bestScore) {
        bestScore = score;
        best = { rect, hx, hy, maxWidth: w, withRest: size.withRest };
      }
    }
  });
  return best;
}

/** Warning marker callout side: flip near the right edge and near the bottom. */
function hoverSide(x: number, y: number): string {
  return `${x / VIEW_W > 0.62 ? 'is-left' : 'is-right'} ${y / VIEW_H > 0.72 ? 'is-up' : 'is-down'}`;
}

function warningTime(w: OfficialWarning): number {
  const t = Date.parse(w.issuedAt ?? '');
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** Official before aggregator, then newest issuedAt first (no issue time last). */
function compareWarningMarkers(a: OfficialWarning, b: OfficialWarning): number {
  if (a.authority !== b.authority) return a.authority === 'official' ? -1 : 1;
  const ta = warningTime(a);
  const tb = warningTime(b);
  return ta === tb ? 0 : tb - ta;
}

function gaugeExcess(g: GaugeReading): number | null {
  if (!g.thresholds) return null;
  const values = Object.values(g.thresholds).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  return g.value - Math.min(...values);
}

// ---------------------------------------------------------------------------------------------

export default function RegionMap({
  incidents,
  selectedId,
  states,
  onSelect,
  nea = null,
  drift = null,
  placeNames,
  className,
  warnings = null,
  selectedWarningId = null,
  onSelectWarning,
  gauges = null,
  onClearSelection,
}: RegionMapProps) {
  const basemap = useMemo(() => getBasemap(), []);
  const [view, setView] = useState<View>(HOME_VIEW);
  const viewRef = useRef<View>(HOME_VIEW);
  const animRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const kMax = useMemo(() => VIEW_W / (MIN_SPAN_DEG * ((basemap.projection.scale() * Math.PI) / 180)), [basemap]);
  /** Base viewBox point → zoomed viewBox point. */
  const toView = useCallback((p: Point): Point => [view.x + view.k * p[0], view.y + view.k * p[1]], [view]);
  const calloutId = useId();
  const layersTitleId = useId();
  const [layers, setLayers] = useState({ watch: true, warnings: true, nea: true });
  const [geom, setGeom] = useState<StageGeom | null>(null);
  /** Roving tabindex for the official/gauge markers: index of the one tab stop. */
  const [officialActive, setOfficialActive] = useState(0);
  const officialRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLDetailsElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const attributionRef = useRef<HTMLParagraphElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);

  /** Read the stage and the chrome cards; store only when something moved by half a pixel or more. */
  const measure = useCallback(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;
    const s = stage.getBoundingClientRect();
    if (s.width < 20) return;
    const rel = (el: Element | null): Rect | null => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 ? { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height } : null;
    };
    const r = root.getBoundingClientRect();
    const chrome = [legendRef.current, compactRef.current, sideRef.current, attributionRef.current, zoomRef.current]
      .map(rel)
      .filter((x): x is Rect => x !== null);
    const next: StageGeom = {
      px: s.width / VIEW_W,
      frame: { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height },
      chrome,
      callout: rel(calloutRef.current),
      narrow: r.width <= NARROW_MAX,
    };
    setGeom((prev) => (geomEqual(prev, next) ? prev : next));
  }, []);

  const placed = useMemo<PlacedIncident[]>(
    () =>
      incidents
        .map((incident) => {
          const [x, y] = toView(project(basemap.projection, [incident.lon, incident.lat]));
          const state = states[incident.id] as ReviewState | undefined;
          return {
            incident,
            x,
            y,
            state,
            stateLabel: state ? STATE_LABEL[state] : NO_STATE_LABEL,
            name: placeName(incident, placeNames),
          };
        })
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    [basemap, incidents, states, placeNames, toView],
  );

  const selectedIndex = placed.findIndex((p) => p.incident.id === selectedId);
  const selected = selectedIndex >= 0 ? placed[selectedIndex] : null;
  const neaActive = Boolean(selected && nea && drift && drift.incidentId === selected.incident.id);
  const neaShown = neaActive && layers.nea;
  const inset = selected ? getInset(selected.incident.lon, selected.incident.lat, neaActive) : null;
  const neaDrawing = neaShown && inset && drift ? drawNea(inset, drift.downwindDeg) : null;
  // A selection in the top-right quarter would sit under the locator inset: move the inset down.
  const insetAtBottom =
    selected !== null && !neaActive && selected.x / VIEW_W > 0.58 && selected.y / VIEW_H < 0.55;

  const live = geom ?? fallbackGeom(selected !== null, neaActive, insetAtBottom);
  const { px, frame, narrow } = live;

  // --- Free zoom and pan -------------------------------------------------------------------
  /** Zoom between the regional view and about 0.2° across; keep the view centre over APAC. */
  const clampView = useCallback(
    (v: View): View => {
      const k = clamp(v.k, 1, kMax);
      const ax = VIEW_W / 2;
      const ay = VIEW_H / 2;
      const f = k / v.k;
      const x0 = ax - (ax - v.x) * f;
      const y0 = ay - (ay - v.y) * f;
      const cx = clamp((ax - x0) / k, -PAN_MARGIN, VIEW_W + PAN_MARGIN);
      const cy = clamp((ay - y0) / k, -PAN_MARGIN, VIEW_H + PAN_MARGIN);
      return { k, x: ax - cx * k, y: ay - cy * k };
    },
    [kMax],
  );

  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  }, []);

  /** Interaction updates: one React commit per animation frame. */
  const commitSoon = useCallback((v: View) => {
    viewRef.current = v;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setView(viewRef.current);
    });
  }, []);

  /** Animated move (log-zoom, centre follows the zoom so it never swoops); instant under reduced motion. */
  const animateTo = useCallback(
    (to: View, ms = ANIM_MS) => {
      cancelAnim();
      const from = viewRef.current;
      if (ms <= 0 || prefersReducedMotion()) {
        viewRef.current = to;
        setView(to);
        return;
      }
      const ax = VIEW_W / 2;
      const ay = VIEW_H / 2;
      const c0: Point = [(ax - from.x) / from.k, (ay - from.y) / from.k];
      const c1: Point = [(ax - to.x) / to.k, (ay - to.y) / to.k];
      const lk0 = Math.log(from.k);
      const lk1 = Math.log(to.k);
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = 1 - (1 - t) ** 3;
        const k = Math.exp(lk0 + (lk1 - lk0) * e);
        const u = Math.abs(lk1 - lk0) < 0.01 ? e : (1 / from.k - 1 / k) / (1 / from.k - 1 / to.k);
        const v = { k, x: ax - (c0[0] + (c1[0] - c0[0]) * u) * k, y: ay - (c0[1] + (c1[1] - c0[1]) * u) * k };
        viewRef.current = v;
        setView(v);
        animRef.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      animRef.current = requestAnimationFrame(step);
    },
    [cancelAnim],
  );

  const zoomBy = useCallback(
    (factor: number, ax = VIEW_W / 2, ay = VIEW_H / 2, animate = false) => {
      const v = viewRef.current;
      const k = clamp(v.k * factor, 1, kMax);
      const f = k / v.k;
      const next = clampView({ k, x: ax - (ax - v.x) * f, y: ay - (ay - v.y) * f });
      if (animate) animateTo(next, 200);
      else {
        cancelAnim();
        commitSoon(next);
      }
    },
    [kMax, clampView, animateTo, cancelAnim, commitSoon],
  );

  /** The view a selection zooms to: ±1.5° around a summit, or the watch box with a margin. */
  const selectedIncident = selected?.incident ?? null;
  const fitView = useMemo<View>(() => {
    if (!selectedIncident) return HOME_VIEW;
    const area = (selectedIncident as { area?: Record<string, unknown> }).area;
    const n = (key: string) => (area && typeof area[key] === 'number' ? (area[key] as number) : Number.NaN);
    let west = selectedIncident.lon - SUMMIT_FIT_HALF_DEG;
    let east = selectedIncident.lon + SUMMIT_FIT_HALF_DEG;
    let south = selectedIncident.lat - SUMMIT_FIT_HALF_DEG;
    let north = selectedIncident.lat + SUMMIT_FIT_HALF_DEG;
    if (area?.kind === 'bbox' && [n('minLat'), n('maxLat'), n('minLon'), n('maxLon')].every(Number.isFinite)) {
      west = n('minLon') - BOX_FIT_MARGIN_DEG;
      east = n('maxLon') + BOX_FIT_MARGIN_DEG;
      south = n('minLat') - BOX_FIT_MARGIN_DEG;
      north = n('maxLat') + BOX_FIT_MARGIN_DEG;
    }
    const [x0, y0] = project(basemap.projection, [west, north]);
    const [x1, y1] = project(basemap.projection, [east, south]);
    const fw = (FIT_FRAME.x1 - FIT_FRAME.x0) * VIEW_W;
    const fh = (FIT_FRAME.y1 - FIT_FRAME.y0) * VIEW_H;
    const k = clamp(Math.min(fw / Math.max(x1 - x0, 1e-6), fh / Math.max(y1 - y0, 1e-6)), 1, kMax);
    const ax = ((FIT_FRAME.x0 + FIT_FRAME.x1) / 2) * VIEW_W;
    const ay = ((FIT_FRAME.y0 + FIT_FRAME.y1) / 2) * VIEW_H;
    return { k, x: ax - k * ((x0 + x1) / 2), y: ay - k * ((y0 + y1) / 2) };
  }, [selectedIncident, basemap, kMax]);

  // Selecting a watch area (map, list, hash) zooms to it; clearing the selection returns to APAC.
  const fitKey = selectedIncident?.id ?? '';
  useEffect(() => {
    animateTo(fitView);
    // Only a change of selection refits; free zoom and pan are left alone otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(
    () => () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const goHome = () => {
    if (selectedId !== null && onClearSelection) onClearSelection();
    else animateTo(HOME_VIEW);
  };

  /** Client pixels → viewBox units of the (letterboxed) stage. */
  const toViewBox = (clientX: number, clientY: number): Point => {
    const s = stageRef.current?.getBoundingClientRect();
    if (!s || s.width === 0) return [VIEW_W / 2, VIEW_H / 2];
    const unit = s.width / VIEW_W;
    return [(clientX - s.left) / unit, (clientY - s.top) / unit];
  };
  const stageUnit = () => {
    const s = stageRef.current?.getBoundingClientRect();
    return s && s.width > 0 ? s.width / VIEW_W : 1;
  };

  // Wheel / trackpad zoom centred on the cursor (native listener: React's wheel handler is passive).
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = Math.pow(2, -e.deltaY * unit * (e.ctrlKey ? 0.01 : WHEEL_STEP));
    const [ax, ay] = toViewBox(e.clientX, e.clientY);
    zoomBy(factor, ax, ay);
  };
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  // Drag to pan, two-finger pinch; a press that moves less than the threshold stays a click.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; moved: boolean; pinch: { dist: number; mid: Point } | null } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element).closest('[data-no-pan]')) return;
    suppressClick.current = false;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 1) gesture.current = { start: [e.clientX, e.clientY], moved: false, pinch: null };
    else if (gesture.current) {
      gesture.current.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best effort */
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!prev || !g) return;
    const cur: Point = [e.clientX, e.clientY];
    pointers.current.set(e.pointerId, cur);
    const unit = stageUnit();
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), 1);
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (g.pinch) {
        const v = viewRef.current;
        const [ax, ay] = toViewBox(mid[0], mid[1]);
        const k = clamp(v.k * (dist / g.pinch.dist), 1, kMax);
        const f = k / v.k;
        cancelAnim();
        commitSoon(
          clampView({
            k,
            x: ax - (ax - v.x) * f + (mid[0] - g.pinch.mid[0]) / unit,
            y: ay - (ay - v.y) * f + (mid[1] - g.pinch.mid[1]) / unit,
          }),
        );
      }
      g.pinch = { dist, mid };
      return;
    }
    if (!g.moved) {
      const threshold = e.pointerType === 'mouse' ? DRAG_THRESHOLD_MOUSE : DRAG_THRESHOLD_TOUCH;
      if (Math.hypot(cur[0] - g.start[0], cur[1] - g.start[1]) < threshold) return;
      g.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best effort */
      }
      e.currentTarget.classList.add('is-panning');
    }
    const v = viewRef.current;
    cancelAnim();
    commitSoon(clampView({ k: v.k, x: v.x + (cur[0] - prev[0]) / unit, y: v.y + (cur[1] - prev[1]) / unit }));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g) g.pinch = null;
    if (pointers.current.size === 0) {
      if (g?.moved) suppressClick.current = true;
      gesture.current = null;
      e.currentTarget.classList.remove('is-panning');
    }
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button, a, input, summary, [data-no-pan]')) return;
    const [ax, ay] = toViewBox(e.clientX, e.clientY);
    zoomBy(e.shiftKey ? 0.5 : 2, ax, ay, true);
  };

  // Keyboard while the map (or a marker in it) has focus: + / − zoom, arrow keys pan.
  const onMapKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.target as Element).closest('input, summary, a, [data-no-pan]')) return;
    const v = viewRef.current;
    const pan = (dx: number, dy: number) => {
      cancelAnim();
      commitSoon(clampView({ k: v.k, x: v.x + dx, y: v.y + dy }));
    };
    switch (e.key) {
      case '+':
      case '=':
        zoomBy(1.5, VIEW_W / 2, VIEW_H / 2, true);
        break;
      case '-':
      case '_':
        zoomBy(1 / 1.5, VIEW_W / 2, VIEW_H / 2, true);
        break;
      case 'ArrowLeft':
        pan(80, 0);
        break;
      case 'ArrowRight':
        pan(-80, 0);
        break;
      case 'ArrowUp':
        pan(0, 80);
        break;
      case 'ArrowDown':
        pan(0, -80);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // Official warning markers: whole symbol inside the frame, official first, newest first, capped.
  const warningMarkers = useMemo<PlacedWarning[]>(() => {
    if (!warnings || warnings.length === 0) return [];
    const inset = 12 / px;
    const fx0 = frame.x / px + inset;
    const fy0 = frame.y / px + inset;
    const fx1 = (frame.x + frame.w) / px - inset;
    const fy1 = (frame.y + frame.h) / px - inset;
    return warnings
      .filter((w) => w.location && Number.isFinite(w.location.lat) && Number.isFinite(w.location.lon))
      .sort(compareWarningMarkers)
      .map((warning) => {
        const loc = warning.location as { lat: number; lon: number };
        const [x, y] = toView(project(basemap.projection, [loc.lon, loc.lat]));
        return { warning, x, y };
      })
      .filter((m) => m.x >= fx0 && m.x <= fx1 && m.y >= fy0 && m.y <= fy1)
      .slice(0, MAX_WARNING_MARKERS);
  }, [warnings, basemap, px, frame, toView]);

  // Gauge markers: only readings at or above the lowest threshold, or cited by a drawn warning.
  const gaugeMarkers = useMemo<PlacedGauge[]>(() => {
    if (!gauges || gauges.length === 0) return [];
    const drawnIds = warningMarkers.map((m) => m.warning.id);
    const inset = 12 / px;
    const fx0 = frame.x / px + inset;
    const fy0 = frame.y / px + inset;
    const fx1 = (frame.x + frame.w) / px - inset;
    const fy1 = (frame.y + frame.h) / px - inset;
    const rank = (g: PlacedGauge) => g.excess ?? Number.NEGATIVE_INFINITY;
    return gauges
      .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon) && Number.isFinite(g.value))
      .map((gauge): PlacedGauge => {
        const [x, y] = toView(project(basemap.projection, [gauge.lon, gauge.lat]));
        return { gauge, x, y, excess: gaugeExcess(gauge) };
      })
      .filter((m) =>
        m.excess !== null
          ? m.excess >= 0
          : m.gauge.situation !== null && drawnIds.some((id) => id.includes(m.gauge.id)),
      )
      .filter((m) => m.x >= fx0 && m.x <= fx1 && m.y >= fy0 && m.y <= fy1)
      .sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra === rb ? 0 : rb - ra;
      })
      .slice(0, MAX_GAUGE_MARKERS);
  }, [gauges, warningMarkers, basemap, px, frame, toView]);

  const selectedRest = selected ? locationRest(selected.name, selected.incident.locationName) : '';
  const calloutText: CalloutText | null = selected
    ? {
        name: selected.name,
        rest: selectedRest,
        coords: formatLatLon(selected.incident.lat, selected.incident.lon),
        stateLabel: selected.stateLabel,
      }
    : null;

  // Declutter, callout, tags and country labels, all in stage pixels.
  const layout = useMemo(() => {
    const truePts: Point[] = placed.map((p) => [p.x * px, p.y * px]);
    const shown = declutter(truePts, selectedIndex);
    const markerRects = shown.map((pt, i) => box(pt[0], pt[1], i === selectedIndex ? 19 : 16));
    const sg = toView(basemap.singapore);
    const points: Rect[] = [box(sg[0] * px, sg[1] * px, 4)];
    shown.forEach((pt, i) => {
      if (Math.hypot(pt[0] - truePts[i][0], pt[1] - truePts[i][1]) > 1.5) points.push(box(truePts[i][0], truePts[i][1], 4));
    });
    for (const m of warningMarkers) points.push(box(m.x * px, m.y * px, 8));
    for (const g of gaugeMarkers) points.push(box(g.x * px, g.y * px, 7));

    const base: Obstacles = { frame, chrome: live.chrome, markers: markerRects, points, tags: [] };

    const fontPx = narrow ? 12 : 13;
    const variants = placed.map((p) => {
      const short = { short: true, size: tagSize(p, fontPx, true) };
      return narrow ? [short] : [{ short: false, size: tagSize(p, fontPx, false) }, short];
    });
    // Wide maps: the selected marker gets the callout instead of a tag. Compact maps: it gets a
    // name tag with the state rail, placed first so it never hides under a neighbour's tag.
    const tagged = placed.map((_, i) => i).filter((i) => narrow || i !== selectedIndex);
    const order = narrow && selectedIndex >= 0 ? [selectedIndex, ...tagged.filter((i) => i !== selectedIndex)] : tagged;
    const tags = new Map<number, TagChoice>();
    /** Greedy pass over every tagged marker, each avoiding the tags already fixed. */
    const placeTags = (chrome: Rect[]) => {
      for (const i of order) {
        const others = order.filter((j) => j !== i && tags.has(j)).map((j) => (tags.get(j) as TagChoice).rect);
        const [mx, my] = shown[i];
        const diag = i === selectedIndex ? TAG_DIAG_SELECTED : TAG_DIAG;
        tags.set(i, chooseTag(mx, my, i, variants[i], { ...base, chrome, tags: others }, diag));
      }
    };

    // 1. Provisional tags without the callout. 2. The callout prefers spots that leave them
    // alone (soft weight) and never trades a marker for a tag. 3. Tags are revised around the
    // callout as rendered (measured) or as estimated, twice, so each ends with every other fixed.
    placeTags(live.chrome);
    let callout: CalloutChoice | null = null;
    if (selected && calloutText && !narrow) {
      const [mx, my] = shown[selectedIndex];
      const soft = [...tags.values()].map((t) => t.rect);
      callout = placeCallout(mx, my, selectedIndex, calloutText, { ...base, soft, markerWeight: 10, pointWeight: 0.4 });
    }
    const calloutRect = !narrow ? (live.callout ?? callout?.rect ?? null) : null;
    const chrome = calloutRect ? [...live.chrome, calloutRect] : live.chrome;
    placeTags(chrome);
    placeTags(chrome);
    const tagRects = [...tags.values()].map((t) => t.rect);

    const labels: (CountryLabel & { x: number; y: number })[] = [];
    for (const label of COUNTRY_LABELS) {
      const [x, y] = toView(project(basemap.projection, [label.lon, label.lat]));
      const w = label.text.length * 9.6 + 8;
      const r: Rect = { x: x * px - w / 2, y: y * px - 9, w, h: 18 };
      const offFrame = outOfFrame(r, frame) > 0;
      const clash = offFrame || [...chrome, ...markerRects, ...tagRects, ...points].some((o) => overlapArea(r, o) > 0);
      if (!clash) labels.push({ ...label, x, y });
    }
    if (!basemap.hasSingaporePolygon) {
      // Fallback: Singapore drawn only as a labelled point.
      labels.push({ text: 'Singapore', lon: SINGAPORE[0], lat: SINGAPORE[1], x: sg[0] + 40, y: sg[1] + 14 });
    }
    return { shown, truePts, callout, tags, labels };
  }, [placed, selectedIndex, selected, calloutText, px, frame, narrow, live.chrome, live.callout, basemap, warningMarkers, gaugeMarkers, toView]);

  const calloutKey = layout.callout
    ? `${Math.round(layout.callout.rect.x)},${Math.round(layout.callout.rect.y)},${Math.round(layout.callout.rect.w)}`
    : 'none';

  // Measure after every commit that can move or resize an overlay, and whenever the container resizes.
  useLayoutEffect(() => {
    measure();
  }, [measure, selectedId, neaActive, insetAtBottom, calloutKey, warningMarkers.length, gaugeMarkers.length, layers]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    for (const el of [
      rootRef.current,
      stageRef.current,
      legendRef.current,
      compactRef.current,
      sideRef.current,
      calloutRef.current,
      zoomRef.current,
    ]) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [measure, selectedId, neaActive, insetAtBottom, narrow]);

  const chipText = neaShown && nea ? psiChipText(nea) : null;
  const windVariable = Boolean(nea && nea.wind.consistency < 0.5);
  const downwindKnown = neaDrawing?.cone != null;
  const modeLabel = nea?.dataMode === 'live' ? 'LIVE' : 'HISTORICAL SNAPSHOT';

  const hasOfficial = layers.warnings && warningMarkers.some((m) => m.warning.authority === 'official');
  const hasEstimate = layers.warnings && warningMarkers.some((m) => m.warning.authority === 'aggregator');
  const hasGauge = layers.warnings && gaugeMarkers.length > 0;

  const toggleLayer = (key: keyof typeof layers, on: boolean) => setLayers((prev) => ({ ...prev, [key]: on }));

  // One tab stop for every official and gauge marker (the watch areas stay ordinary tab stops).
  const officialCount = warningMarkers.length + gaugeMarkers.length;
  const officialTabStop = officialCount === 0 ? -1 : Math.min(officialActive, officialCount - 1);
  const focusOfficial = (index: number) => {
    if (officialCount === 0) return;
    const i = ((index % officialCount) + officialCount) % officialCount;
    setOfficialActive(i);
    officialRefs.current[i]?.focus();
  };
  const onOfficialKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Number((event.target as HTMLElement).dataset.officialIndex ?? Number.NaN);
    if (!Number.isFinite(current)) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        focusOfficial(current + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        focusOfficial(current - 1);
        break;
      case 'Home':
        focusOfficial(0);
        break;
      case 'End':
        focusOfficial(officialCount - 1);
        break;
      case 'Escape':
        focusOfficial(0);
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  const officialProps = (index: number) => ({
    ref: (el: HTMLButtonElement | null) => {
      officialRefs.current[index] = el;
    },
    tabIndex: index === officialTabStop ? 0 : -1,
    'data-official-index': index,
    onFocus: () => setOfficialActive(index),
  });

  const selectedShown = selected && selectedIndex >= 0 ? layout.shown[selectedIndex] : null;
  const calloutStyle =
    layout.callout && selectedShown ? anchorStyle(layout.callout, px, selectedShown[0], selectedShown[1]) : undefined;

  // One card: states (left) and official symbols (right), the note, the NEA row when drawn, and
  // the three layer toggles as a wrapping row of 24 px targets.
  const legendBody = (
    <>
      <div className="region-map__legend-grid">
        <ul className="region-map__legend-list">
          {LEGEND_STATES.map((state) => (
            <li key={state} className={`region-map__legend-item ${stateClass(state)}`}>
              <svg className="region-map__swatch" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <MarkerSymbol hazard={null} state={state} />
              </svg>
              <span>{STATE_LABEL[state]}</span>
            </li>
          ))}
        </ul>
        {(hasOfficial || hasEstimate || hasGauge) && (
          <ul className="region-map__legend-list is-official">
            {hasOfficial && (
              <li className="region-map__legend-item">
                <svg className="region-map__swatch" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <OfficialSymbol kind="official" />
                </svg>
                <span>
                  Official warning <span className="region-map__legend-sub">(issuer)</span>
                </span>
              </li>
            )}
            {hasEstimate && (
              <li className="region-map__legend-item">
                <svg className="region-map__swatch" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <OfficialSymbol kind="estimate" />
                </svg>
                <span>
                  Impact estimate <span className="region-map__legend-sub">(GDACS)</span>
                </span>
              </li>
            )}
            {hasGauge && (
              <li className="region-map__legend-item">
                <svg className="region-map__swatch" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <OfficialSymbol kind="gauge" />
                </svg>
                <span>
                  Water-level gauge <span className="region-map__legend-sub">(issuer)</span>
                </span>
              </li>
            )}
          </ul>
        )}
      </div>
      <p className="region-map__legend-note">Workflow states, not official alert levels</p>
      {neaShown && (
        <p className="region-map__legend-nea">
          <NeaSwatch kind="both" />
          <span>Wind &amp; haze: NEA Singapore</span>
        </p>
      )}
      <div className="region-map__layers" role="group" aria-labelledby={layersTitleId}>
        <span id={layersTitleId} className="region-map__layers-title">
          Layers
        </span>
        <label className="region-map__layer">
          <input type="checkbox" checked={layers.watch} onChange={(e) => toggleLayer('watch', e.currentTarget.checked)} />
          <span>Watch areas</span>
        </label>
        <label className="region-map__layer">
          <input
            type="checkbox"
            checked={layers.warnings}
            onChange={(e) => toggleLayer('warnings', e.currentTarget.checked)}
          />
          <span>Official warnings</span>
        </label>
        <label className="region-map__layer">
          <input type="checkbox" checked={layers.nea} onChange={(e) => toggleLayer('nea', e.currentTarget.checked)} />
          <span>NEA wind and haze</span>
        </label>
      </div>
    </>
  );

  return (
    <div
      ref={rootRef}
      className={className ? `region-map ${className}` : 'region-map'}
      role="group"
      aria-label="Regional map of watch areas and official warnings. Drag or use the arrow keys to pan; scroll, pinch, or plus and minus to zoom."
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(e) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
      onDoubleClick={onDoubleClick}
      onKeyDown={onMapKeyDown}
    >
      <div ref={stageRef} className="region-map__stage">
        <svg
          className="region-map__svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Map of Southeast Asia with the ASEAN member states highlighted and neighbouring countries muted"
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <path className="region-map__graticule" d={basemap.graticule} />
          <g>
            {basemap.context.map((c) => (
              <path key={c.key} className="region-map__land" d={c.d} data-name={c.feature.properties.name} />
            ))}
          </g>
          <g>
            {basemap.members.map((c) => (
              <path
                key={c.key}
                className="region-map__land is-member"
                d={c.d}
                data-name={c.feature.properties.name}
              />
            ))}
          </g>
          <circle
            className="region-map__point"
            cx={basemap.singapore[0]}
            cy={basemap.singapore[1]}
            r={3.4 / view.k}
          />
          {inset && (
            <rect
              className="region-map__locator"
              x={inset.locator.x}
              y={inset.locator.y}
              width={inset.locator.w}
              height={inset.locator.h}
              rx={2 / view.k}
            />
          )}
          </g>
          {layers.watch &&
            placed.map((p, i) => {
              const [sx, sy] = layout.shown[i];
              const [tx, ty] = layout.truePts[i];
              if (Math.hypot(sx - tx, sy - ty) <= 1.5) return null;
              // Leader from the true position to the decluttered symbol.
              return (
                <g key={p.incident.id} className="region-map__leader">
                  <line x1={p.x} y1={p.y} x2={sx / px} y2={sy / px} />
                  <circle cx={p.x} cy={p.y} r={2.6 / px} />
                </g>
              );
            })}
        </svg>

        {layout.labels.map((l) => (
          <span
            key={l.text}
            className={`region-map__label${l.minor ? ' is-minor' : ''}`}
            style={{ left: pct(l.x, VIEW_W), top: pct(l.y, VIEW_H) }}
            aria-hidden="true"
          >
            {l.text}
          </span>
        ))}

        {layers.warnings && officialCount > 0 && (
          <div
            className="region-map__official-layer"
            role="group"
            aria-label="Official warnings and water-level gauges on the map (arrow keys to move between them)"
            onKeyDown={onOfficialKeyDown}
          >
            {warningMarkers.map(({ warning: w, x, y }, i) => {
              const official = w.authority === 'official';
              const isSelected = w.id === selectedWarningId;
              const area = w.areaDescription.trim() || w.headline.trim();
              const label = official
                ? `Official warning: ${w.issuer} · ${w.level} · ${area}`
                : `Impact estimate (GDACS, not a warning): ${w.issuer} · ${w.level} · ${area}`;
              const kind: OfficialKind = !official ? 'estimate' : w.ended ? 'ended' : 'official';
              return (
                <button
                  key={`${w.id}-${i}`}
                  type="button"
                  className={`region-map__wmarker is-${kind}${isSelected ? ' is-selected' : ''}`}
                  style={{ left: pct(x, VIEW_W), top: pct(y, VIEW_H) }}
                  aria-label={label}
                  aria-pressed={isSelected}
                  onClick={onSelectWarning ? () => onSelectWarning(w.id) : undefined}
                  {...officialProps(i)}
                >
                  <svg className="region-map__wsymbol" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <OfficialSymbol kind={kind} selected={isSelected} />
                  </svg>
                  <span className={`region-map__wcallout ${hoverSide(x, y)}`} aria-hidden="true">
                    <strong>{w.issuer}</strong>
                    <span lang={w.language || undefined}>{w.level}</span>
                    {w.ended && <span className="region-map__wcallout-meta">Ended</span>}
                    {!official && <span className="region-map__wcallout-meta">Impact estimate, not a warning</span>}
                  </span>
                </button>
              );
            })}

            {gaugeMarkers.map(({ gauge: g, x, y }, i) => {
              const reading = `${formatValue(g.value)} ${g.unit} (${g.datum})`;
              const label = `Water level: ${g.name} · ${reading}${g.situation ? ` · ${g.situation}` : ''} · ${g.issuer}`;
              const cited = warningMarkers.find((m) => m.warning.id.includes(g.id));
              const isSelected = cited !== undefined && cited.warning.id === selectedWarningId;
              return (
                <button
                  key={`${g.id}-${i}`}
                  type="button"
                  className={`region-map__wmarker is-gauge${isSelected ? ' is-selected' : ''}`}
                  style={{ left: pct(x, VIEW_W), top: pct(y, VIEW_H) }}
                  aria-label={label}
                  aria-pressed={cited ? isSelected : undefined}
                  onClick={onSelectWarning && cited ? () => onSelectWarning(cited.warning.id) : undefined}
                  {...officialProps(warningMarkers.length + i)}
                >
                  <svg className="region-map__wsymbol" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <OfficialSymbol kind="gauge" selected={isSelected} />
                  </svg>
                  <span className={`region-map__wcallout ${hoverSide(x, y)}`} aria-hidden="true">
                    <strong>{g.issuer}</strong>
                    <span className="mono">
                      {g.name} · {reading}
                    </span>
                    {g.situation && <span lang={issuerLang(g.issuer)}>{g.situation}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {layers.watch &&
          placed.map((p, i) => {
            const isSelected = i === selectedIndex;
            const [sx, sy] = layout.shown[i];
            const tag = layout.tags.get(i);
            return (
              <button
                key={p.incident.id}
                type="button"
                className={`region-map__marker ${stateClass(p.state)}${isSelected ? ' is-selected' : ''}`}
                style={{ left: pct(sx / px, VIEW_W), top: pct(sy / px, VIEW_H) }}
                aria-label={`${p.incident.title} — ${p.stateLabel}`}
                aria-pressed={isSelected}
                aria-describedby={isSelected && layout.callout ? calloutId : undefined}
                onClick={() => {
                  if (isSelected) animateTo(fitView);
                  onSelect(p.incident.id);
                }}
              >
                <svg className="region-map__symbol" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                  <MarkerSymbol hazard={p.incident.hazard} state={p.state} selected={isSelected} />
                </svg>
                {tag && (
                  <span className={`region-map__tag is-${tag.pos}${isSelected ? ' is-selected' : ''}`} aria-hidden="true">
                    <span className="region-map__tag-name">{p.name}</span>
                    {!tag.short && <span className="region-map__tag-state"> · {p.stateLabel}</span>}
                  </span>
                )}
              </button>
            );
          })}

        {layers.watch && selected && layout.callout && (
          <div
            ref={calloutRef}
            id={calloutId}
            className={`region-map__callout ${stateClass(selected.state)}`}
            style={calloutStyle}
          >
            <p className="region-map__callout-title">
              <strong>{selected.name}</strong>
              {layout.callout.withRest && selectedRest && <> · {selectedRest}</>}
            </p>
            <p className="region-map__callout-coords mono">
              <span>{formatCoordinate(selected.incident.lat, 'N', 'S')},</span>{' '}
              <span>{formatCoordinate(selected.incident.lon, 'E', 'W')}</span>
            </p>
            <p className="region-map__callout-state">{selected.stateLabel}</p>
          </div>
        )}
      </div>

      {narrow ? (
        // Compact maps: one closed-by-default disclosure holds the legend and the layer toggles,
        // so nothing covers the markers unless the presenter opens it.
        <details ref={compactRef} className="region-map__compact" data-no-pan>
          <summary className="region-map__compact-summary">Legend and layers</summary>
          <div className="region-map__legend is-inline" role="group" aria-label="Map legend and layers">
            {legendBody}
          </div>
        </details>
      ) : (
        <div ref={legendRef} className="region-map__legend" role="group" aria-label="Map legend and layers" data-no-pan>
          {legendBody}
        </div>
      )}

      {selected && inset && (
        <div
          ref={sideRef}
          data-no-pan
          className={`region-map__side${insetAtBottom ? ' is-bottom' : ''}${neaActive ? ' has-nea' : ''}`}
        >
          <figure className="region-map__inset">
            <div className="region-map__inset-map" style={{ aspectRatio: `${inset.w} / ${inset.h}` }}>
              <svg
                className="region-map__inset-svg"
                viewBox={`0 0 ${inset.w} ${inset.h}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={
                  neaShown
                    ? `Zoomed view of ${selected.name} and Singapore with the NEA wind direction and an illustrative haze drift`
                    : neaActive
                      ? `Zoomed view of ${selected.name} and Singapore`
                      : `Locator map, about ${INSET_HALF_SPAN} degrees around ${selected.name}`
                }
              >
                <rect className="region-map__inset-water" width={inset.w} height={inset.h} />
                <path className="region-map__graticule" d={inset.graticule} />
                {inset.countries.map((c) => (
                  <path key={c.key} className={`region-map__land${c.asean ? ' is-member' : ''}`} d={c.d} />
                ))}
                {neaDrawing?.cone && <path className="region-map__drift" d={neaDrawing.cone} />}
                {inset.singapore && (
                  <circle
                    className="region-map__sg-dot"
                    cx={inset.singapore[0]}
                    cy={inset.singapore[1]}
                    r={3.5}
                  />
                )}
                {neaDrawing?.arrow && (
                  <g className={`region-map__wind${windVariable ? ' is-variable' : ''}`}>
                    <line
                      className="region-map__wind-halo"
                      x1={neaDrawing.arrow.tail[0]}
                      y1={neaDrawing.arrow.tail[1]}
                      x2={neaDrawing.arrow.head[0]}
                      y2={neaDrawing.arrow.head[1]}
                    />
                    <line
                      x1={neaDrawing.arrow.tail[0]}
                      y1={neaDrawing.arrow.tail[1]}
                      x2={neaDrawing.arrow.head[0]}
                      y2={neaDrawing.arrow.head[1]}
                    />
                    <path className="region-map__wind-tip" d={neaDrawing.arrow.tip} />
                  </g>
                )}
                <g
                  className={`region-map__inset-marker ${stateClass(selected.state)}`}
                  transform={`translate(${(inset.incident[0] - 15).toFixed(1)} ${(inset.incident[1] - 15).toFixed(1)}) scale(${30 / 32})`}
                >
                  <MarkerSymbol hazard={selected.incident.hazard} state={selected.state} />
                </g>
              </svg>
              {neaDrawing && (
                <span
                  className="region-map__psi"
                  style={{
                    left: pct(neaDrawing.chip.x, inset.w),
                    top: pct(neaDrawing.chip.y, inset.h),
                    maxWidth: pct(neaDrawing.chip.w, inset.w),
                  }}
                  title={nea?.haze ? `NEA PSI reading ${formatUtc(nea.haze.observedAt)}` : undefined}
                >
                  {chipText ?? 'Singapore (NEA stations)'}
                </span>
              )}
              {neaDrawing?.driftLabel && (
                <span
                  className="region-map__drift-label"
                  style={{
                    left: pct(neaDrawing.driftLabel.x, inset.w),
                    top: pct(neaDrawing.driftLabel.y, inset.h),
                    maxWidth: pct(neaDrawing.driftLabel.w, inset.w),
                  }}
                >
                  Illustrative drift, not a dispersion model
                </span>
              )}
            </div>
            {!neaActive && (
              <figcaption className="region-map__inset-caption">
                <span className="region-map__inset-name">{selected.name}</span>
                {selectedRest && <span className="region-map__inset-place">{selectedRest}</span>}
                <span className="region-map__inset-scale">Locator, ±{INSET_HALF_SPAN}°</span>
              </figcaption>
            )}
          </figure>

          {neaShown && nea && drift && (
            <div className="region-map__nea" title={nea.attribution}>
              <p className="region-map__nea-source">
                <span className="region-map__only-wide">Wind: NEA Singapore stations</span>
                <span className="region-map__only-narrow">NEA Singapore</span>{' '}
                <span className={`region-map__mode is-${nea.dataMode}`}>{modeLabel}</span>{' '}
                <time dateTime={nea.observedAt}>{formatUtc(nea.observedAt)}</time>
              </p>
              <p className={`region-map__nea-row is-wind${downwindKnown ? '' : ' is-unavailable'}`}>
                {downwindKnown && <NeaSwatch kind="wind" variable={windVariable} />}
                <span>{downwindKnown ? windLine(nea) : 'Wind direction unavailable'}</span>
              </p>
              {downwindKnown && (
                <p className="region-map__nea-row is-drift">
                  <NeaSwatch kind="drift" />
                  <span className="region-map__only-wide">
                    Singapore wind applied to the {selected.name} hotspot area, {Math.round(drift.distanceKm)} km away
                  </span>
                  <span className="region-map__only-narrow">Illustrative drift, not a dispersion model</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div ref={zoomRef} className="region-map__zoom" role="group" aria-label="Zoom" data-no-pan>
        <button type="button" className="region-map__zoom-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(2, VIEW_W / 2, VIEW_H / 2, true)}>
          +
        </button>
        <button type="button" className="region-map__zoom-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(0.5, VIEW_W / 2, VIEW_H / 2, true)}>
          −
        </button>
        <button type="button" className="region-map__zoom-home" title="Back to the regional view" onClick={goHome}>
          All APAC
        </button>
      </div>

      <p ref={attributionRef} className="region-map__attribution" title={REGION.attribution}>
        Boundaries: Natural Earth (public domain)
      </p>
    </div>
  );
}
