// Regional map: locally bundled Natural Earth boundaries (data/region.geojson), drawn as
// pure SVG with d3-geo. No tiles and no network requests. Incident markers, labels, the
// location callout, the legend and the zoomed inset are HTML overlays positioned in viewBox
// percentages, so text and hit areas keep a fixed pixel size at any container width.
//
// Overlay text is laid out for a ~700×420 container (1366×768 windowed browser). Below
// 600 px container width, CSS container queries switch to a compact arrangement.
import { useId, useMemo } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { geoBounds, geoGraticule, geoMercator, geoPath } from 'd3-geo';
import type { GeoProjection } from 'd3-geo';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import regionRaw from '../../data/region.geojson?raw';
import type {
  DriftAssessment,
  HazardType,
  Incident,
  NeaContext,
  ReviewLabel,
  ReviewState,
} from '../types';
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

/** Fixed frame. scripts/build-region.mjs mirrors these numbers to choose context countries. */
const VIEW_W = 1000;
const VIEW_H = 640;
const VIEW_PAD = 28;
/** Stage pixels per viewBox unit in a ~700×420 container; used to estimate label collisions. */
const REF_PX = 0.656;
const REF_W = VIEW_W * REF_PX;
const REF_H = VIEW_H * REF_PX;

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
  size: { w: number; h: number },
  gap: number,
  bounds: { w: number; h: number },
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

const CHIP_SIZE = { w: 170, h: 40 };
const DRIFT_LABEL_SIZE = { w: 150, h: 38 };

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

const pct = (value: number, total: number) => `${((value / total) * 100).toFixed(3)}%`;

// ---------------------------------------------------------------------------------------------
// Marker symbol (shared by markers, inset and legend), drawn in a 32×32 box

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
// Overview layout: always-visible marker tags and country labels without collisions

type TagSide = 'right' | 'left' | 'below' | 'above';
type Side = 'is-left' | 'is-right';
type Dir = 'is-up' | 'is-down';

interface PlacedIncident {
  incident: Incident;
  x: number;
  y: number;
  state: ReviewState | undefined;
  stateLabel: string;
  name: string;
}

/** Overlay zones in stage reference pixels at ~700×420 (legend top-left, inset top-right). */
const LEGEND_ZONE: Rect = { x: 0, y: 0, w: 150, h: 150 };
const insetZone = (nea: boolean): Rect =>
  nea ? { x: REF_W - 320, y: 0, w: 320, h: 315 } : { x: REF_W - 215, y: 0, w: 215, h: 200 };

function calloutZone(p: PlacedIncident, side: Side, dir: Dir): Rect {
  const mx = p.x * REF_PX;
  const my = p.y * REF_PX;
  const w = side === 'is-left' ? Math.min(240, mx - 34) : 240;
  const h = 105;
  return {
    x: side === 'is-left' ? mx - 24 - w : mx + 24,
    y: dir === 'is-up' ? my + 12 - h : my - 12,
    w,
    h,
  };
}

function tagRect(p: PlacedIncident, side: TagSide, w: number): Rect {
  const mx = p.x * REF_PX;
  const my = p.y * REF_PX;
  const h = 22;
  switch (side) {
    case 'right':
      return { x: mx + 20, y: my - h / 2, w, h };
    case 'left':
      return { x: mx - 20 - w, y: my - h / 2, w, h };
    case 'below':
      return { x: mx - w / 2, y: my + 20, w, h };
    case 'above':
      return { x: mx - w / 2, y: my - 20 - h, w, h };
  }
}

function outOfFrame(r: Rect): number {
  const inside = overlapArea(r, { x: 0, y: 0, w: REF_W, h: REF_H });
  return r.w * r.h - inside;
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
}: RegionMapProps) {
  const basemap = useMemo(() => getBasemap(), []);
  const calloutId = useId();

  const placed = useMemo<PlacedIncident[]>(
    () =>
      incidents
        .map((incident) => {
          const [x, y] = project(basemap.projection, [incident.lon, incident.lat]);
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
    [basemap, incidents, states, placeNames],
  );

  const selected = useMemo(() => placed.find((p) => p.incident.id === selectedId) ?? null, [placed, selectedId]);
  const neaActive = Boolean(selected && nea && drift && drift.incidentId === selected.incident.id);
  const inset = selected ? getInset(selected.incident.lon, selected.incident.lat, neaActive) : null;
  const neaDrawing = neaActive && inset && drift ? drawNea(inset, drift.downwindDeg) : null;

  // Callout placement. Wide maps: NEA selections on the left half go left-up so the large NEA
  // panel keeps the top-right; otherwise right unless near the right edge, up only near the
  // bottom. Narrow maps (n-* classes): right unless near the right edge; up when the NEA strip
  // is docked at the bottom.
  const sx = selected ? selected.x / VIEW_W : 0;
  const sy = selected ? selected.y / VIEW_H : 0;
  const side: Side = neaActive && sx < 0.5 && sx > 0.22 ? 'is-left' : sx > 0.58 ? 'is-left' : 'is-right';
  const dir: Dir = neaActive && side === 'is-left' ? 'is-up' : sy > 0.75 ? 'is-up' : 'is-down';
  const narrowSide = sx > 0.55 ? 'n-left' : 'n-right';
  const narrowDir = (neaActive && sy > 0.35) || sy > 0.75 ? 'n-up' : 'n-down';
  const insetAtBottom = selected !== null && !neaActive && sx > 0.58 && sy < 0.55;

  const layout = useMemo(() => {
    const blocked: Rect[] = [LEGEND_ZONE];
    if (selected) {
      blocked.push(insetAtBottom ? { ...insetZone(false), y: REF_H - 230 } : insetZone(neaActive));
      blocked.push(calloutZone(selected, side, dir));
    }
    const markerRects = placed.map((p) => {
      const r = p.incident.id === selectedId ? 22 : 18;
      return { x: p.x * REF_PX - r, y: p.y * REF_PX - r, w: 2 * r, h: 2 * r };
    });
    const sgRect: Rect = {
      x: basemap.singapore[0] * REF_PX - 5,
      y: basemap.singapore[1] * REF_PX - 5,
      w: 10,
      h: 10,
    };

    const tags = new Map<string, TagSide>();
    const tagRects: Rect[] = [];
    placed.forEach((p, i) => {
      if (p.incident.id === selectedId) return;
      const w = (p.name.length + 3 + p.stateLabel.length) * 6.6 + 16;
      let best: TagSide = 'right';
      let bestScore = Number.POSITIVE_INFINITY;
      (['right', 'left', 'below', 'above'] as TagSide[]).forEach((sideName, order) => {
        const r = tagRect(p, sideName, w);
        let score = order * 0.5 + outOfFrame(r) * 3 + overlapArea(r, sgRect) * 4;
        for (const b of blocked) score += overlapArea(r, b) * 2;
        markerRects.forEach((m, j) => {
          if (j !== i) score += overlapArea(r, m) * 3;
        });
        for (const t of tagRects) score += overlapArea(r, t) * 3;
        if (score < bestScore) {
          bestScore = score;
          best = sideName;
        }
      });
      tags.set(p.incident.id, best);
      tagRects.push(tagRect(p, best, w));
    });

    const labels: (CountryLabel & { x: number; y: number })[] = [];
    for (const label of COUNTRY_LABELS) {
      const [x, y] = project(basemap.projection, [label.lon, label.lat]);
      const w = label.text.length * 9 + 8;
      const r: Rect = { x: x * REF_PX - w / 2, y: y * REF_PX - 9, w, h: 18 };
      const clash = [...blocked, ...markerRects, ...tagRects].some((o) => overlapArea(r, o) > 0);
      if (!clash) labels.push({ ...label, x, y });
    }
    if (!basemap.hasSingaporePolygon) {
      // Fallback: Singapore drawn only as a labelled point.
      const [x, y] = basemap.singapore;
      labels.push({ text: 'Singapore', lon: SINGAPORE[0], lat: SINGAPORE[1], x: x + 40, y: y + 14 });
    }
    return { tags, labels };
  }, [basemap, placed, selected, selectedId, insetAtBottom, neaActive, side, dir]);

  const selectedRest = selected ? locationRest(selected.name, selected.incident.locationName) : '';
  const chipText = neaActive && nea ? psiChipText(nea) : null;
  const windVariable = Boolean(nea && nea.wind.consistency < 0.5);
  const downwindKnown = neaDrawing?.cone != null;
  const modeLabel = nea?.dataMode === 'live' ? 'LIVE' : 'HISTORICAL SNAPSHOT';

  const calloutStyle = selected
    ? ({
        left: pct(selected.x, VIEW_W),
        top: pct(selected.y, VIEW_H),
        '--rm-x': pct(selected.x, VIEW_W),
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={className ? `region-map ${className}` : 'region-map'}
      role="group"
      aria-label="Regional incident map"
    >
      <div className="region-map__stage">
        <svg
          className="region-map__svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Map of Southeast Asia with the ASEAN member states highlighted and neighbouring countries muted"
        >
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
            r={3.4}
          />
          {inset && (
            <rect
              className="region-map__locator"
              x={inset.locator.x}
              y={inset.locator.y}
              width={inset.locator.w}
              height={inset.locator.h}
              rx={2}
            />
          )}
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

        {placed.map((p) => {
          const isSelected = p.incident.id === selectedId;
          const tagSide = layout.tags.get(p.incident.id) ?? 'right';
          return (
            <button
              key={p.incident.id}
              type="button"
              className={`region-map__marker ${stateClass(p.state)}${isSelected ? ' is-selected' : ''}`}
              style={{ left: pct(p.x, VIEW_W), top: pct(p.y, VIEW_H) }}
              aria-label={`${p.incident.title} — ${p.stateLabel}`}
              aria-pressed={isSelected}
              aria-describedby={isSelected ? calloutId : undefined}
              onClick={() => onSelect(p.incident.id)}
            >
              <svg className="region-map__symbol" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <MarkerSymbol hazard={p.incident.hazard} state={p.state} selected={isSelected} />
              </svg>
              {!isSelected && (
                <span className={`region-map__tag is-${tagSide}`} aria-hidden="true">
                  <span className="region-map__tag-name">{p.name}</span>
                  <span className="region-map__tag-state"> · {p.stateLabel}</span>
                </span>
              )}
            </button>
          );
        })}

        {selected && (
          <div
            id={calloutId}
            className={`region-map__callout ${side} ${dir} ${narrowSide} ${narrowDir} ${stateClass(selected.state)}`}
            style={calloutStyle}
          >
            <p className="region-map__callout-title">
              <strong>{selected.name}</strong>
              {selectedRest && <> · {selectedRest}</>}
            </p>
            <p className="region-map__callout-coords">
              {formatLatLon(selected.incident.lat, selected.incident.lon)}
            </p>
            <p className="region-map__callout-state">{selected.stateLabel}</p>
          </div>
        )}
      </div>

      <div className="region-map__legend" role="group" aria-label="Map legend">
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
        <p className="region-map__legend-note">Workflow states, not official alert levels</p>
        {neaActive && (
          <p className="region-map__legend-nea">
            <NeaSwatch kind="both" />
            <span>Wind &amp; haze: NEA Singapore</span>
          </p>
        )}
      </div>

      {selected && inset && (
        <div
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
                  neaActive
                    ? `Zoomed view of ${selected.name} and Singapore with the NEA wind direction and an illustrative haze drift`
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

          {neaActive && nea && (
            <div className="region-map__nea" title={nea.attribution}>
              <p className="region-map__nea-source">
                <span>Wind: NEA Singapore stations</span>{' '}
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
                  <span className="region-map__only-wide">Real Singapore wind applied to a simulated hotspot</span>
                  <span className="region-map__only-narrow">Illustrative drift, not a dispersion model</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="region-map__attribution" title={REGION.attribution}>
        Boundaries: Natural Earth (public domain)
      </p>
    </div>
  );
}
