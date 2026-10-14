// Pure geometry and style helpers for MapView (no DOM, no MapLibre runtime), so they are unit-tested
// in node. Coordinates are [lon, lat] in degrees throughout.
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import type { StyleSpecification } from 'maplibre-gl';

export type LonLat = [number, number];
/** [[west, south], [east, north]] */
export type Bounds = [LonLat, LonLat];

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Point reached from (lon, lat) after `km` along the initial bearing (degrees clockwise from north). */
export function destination(lon: number, lat: number, bearingDeg: number, km: number): LonLat {
  const d = km / EARTH_RADIUS_KM;
  const phi1 = lat * RAD;
  const lambda1 = lon * RAD;
  const theta = bearingDeg * RAD;
  const sinPhi2 = Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda2 =
    lambda1 + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * Math.sin(phi2));
  return [lambda2 / RAD, phi2 / RAD];
}

/** Closed geodesic circle (first point repeated last) of radius `km` around (lon, lat). */
export function ringPolygon(lon: number, lat: number, km: number, steps = 96): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < steps; i++) out.push(destination(lon, lat, (360 * i) / steps, km));
  out.push(out[0]);
  return out;
}

/** Wedge from the apex along `bearingDeg` ± `halfAngleDeg`, `km` long, closed. */
export function conePolygon(lon: number, lat: number, bearingDeg: number, km: number, halfAngleDeg: number, steps = 12): LonLat[] {
  const apex: LonLat = [lon, lat];
  const out: LonLat[] = [apex];
  for (let i = 0; i <= steps; i++) {
    out.push(destination(lon, lat, bearingDeg - halfAngleDeg + (2 * halfAngleDeg * i) / steps, km));
  }
  out.push(apex);
  return out;
}

/** Selection fits: ±0.3° around a summit (the 15 km reference rings fill the view); a watch box with a 0.3° margin. */
export const SUMMIT_FIT_HALF_DEG = 0.3;
export const BOX_FIT_MARGIN_DEG = 0.3;

/** Camera target for a selected watch area. `area` is read structurally (bbox watches carry min/max lat/lon). */
export function selectionBounds(incident: { lon: number; lat: number; area?: unknown }): Bounds {
  const area = incident.area as Record<string, unknown> | undefined;
  const n = (key: string) => (area && typeof area[key] === 'number' ? (area[key] as number) : Number.NaN);
  if (area?.kind === 'bbox' && [n('minLat'), n('maxLat'), n('minLon'), n('maxLon')].every(Number.isFinite)) {
    return [
      [n('minLon') - BOX_FIT_MARGIN_DEG, n('minLat') - BOX_FIT_MARGIN_DEG],
      [n('maxLon') + BOX_FIT_MARGIN_DEG, n('maxLat') + BOX_FIT_MARGIN_DEG],
    ];
  }
  return [
    [incident.lon - SUMMIT_FIT_HALF_DEG, incident.lat - SUMMIT_FIT_HALF_DEG],
    [incident.lon + SUMMIT_FIT_HALF_DEG, incident.lat + SUMMIT_FIT_HALF_DEG],
  ];
}

function eachPosition(geometry: Geometry | null, visit: (p: Position) => void): void {
  if (!geometry) return;
  switch (geometry.type) {
    case 'Point':
      visit(geometry.coordinates);
      break;
    case 'MultiPoint':
    case 'LineString':
      geometry.coordinates.forEach(visit);
      break;
    case 'MultiLineString':
    case 'Polygon':
      geometry.coordinates.forEach((ring) => ring.forEach(visit));
      break;
    case 'MultiPolygon':
      geometry.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(visit)));
      break;
    case 'GeometryCollection':
      geometry.geometries.forEach((g) => eachPosition(g, visit));
      break;
  }
}

/** Bounding box of the given features; null when there are no coordinates. */
export function featureBounds(features: readonly Feature[]): Bounds | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const f of features) {
    eachPosition(f.geometry, ([lon, lat]) => {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    });
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

/**
 * Map padding from the floating panels' footprint. When the panels would leave less than
 * `minVisible` px of map between them, both are scaled down so the camera still has room.
 */
export function overlayPadding(left: number, right: number, width: number, minVisible = 200): { left: number; right: number } {
  const l = Math.max(0, left);
  const r = Math.max(0, right);
  const room = Math.max(0, width - minVisible);
  if (l + r <= room || l + r === 0) return { left: Math.round(l), right: Math.round(r) };
  const f = room / (l + r);
  return { left: Math.round(l * f), right: Math.round(r * f) };
}

/** Screen pixels per degree of longitude at a Web Mercator zoom (512 px tiles, as MapLibre). */
export function pxPerDegree(zoom: number): number {
  return (512 * 2 ** zoom) / 360;
}

/** Grid stride (in 1° cells) so modelled wind arrows stay at least `spacingPx` apart on screen. */
export function windArrowStride(zoom: number, spacingPx = 44): number {
  return Math.max(1, Math.ceil(spacingPx / Math.max(pxPerDegree(zoom), 1e-6)));
}

/** True when a 1° grid point is kept at this stride (works for negative coordinates too). */
export function keepAtStride(lat: number, lon: number, stride: number): boolean {
  const m = (x: number) => ((Math.round(x) % stride) + stride) % stride;
  return m(lat) === 0 && m(lon) === 0;
}

/** Wind toward (u east, v north) → deck.gl icon angle (degrees counter-clockwise from east). */
export function arrowAngleDeg(u: number, v: number): number {
  return Math.atan2(v, u) / RAD;
}

/** Path points that fall on whole 12-hour marks after the start (the dots on the modelled haze paths). */
export function twelveHourTicks(points: readonly { lat: number; lon: number; time: string }[]): LonLat[] {
  if (points.length === 0) return [];
  const t0 = Date.parse(points[0].time);
  return points
    .filter((p) => {
      const h = (Date.parse(p.time) - t0) / 3_600_000;
      return h > 0 && Math.abs(h / 12 - Math.round(h / 12)) < 1e-6;
    })
    .map((p) => [p.lon, p.lat]);
}

/** Haze-tint opacity (0..1) by NEA PSI band word; unknown bands get a light default. */
export function psiHazeAlpha(band: string): number {
  switch (band.trim().toLowerCase()) {
    case 'good':
      return 0.06;
    case 'moderate':
      return 0.16;
    case 'unhealthy':
      return 0.3;
    case 'very unhealthy':
      return 0.44;
    case 'hazardous':
      return 0.56;
    default:
      return 0.14;
  }
}

// ---------------------------------------------------------------------------------------------
// Offline fallback style: the bundled Natural Earth countries (data/region.geojson) as plain land and
// water fills, so the map still draws with no network. No glyphs or sprites are referenced.

export interface RegionProperties {
  name: string;
  iso_n3: string | null;
  asean: boolean;
}
export type RegionCollection = FeatureCollection<Polygon | MultiPolygon, RegionProperties> & { attribution?: string };

export const OFFLINE_ATTRIBUTION = 'Offline map: Natural Earth boundaries (public domain)';

export function buildOfflineStyle(region: RegionCollection, dark: boolean): StyleSpecification {
  const c = dark
    ? { water: '#1d2733', land: '#2b333d', asean: '#3a434e', stroke: '#56606c', strokeAsean: '#8c96a3' }
    : { water: '#c9d7e2', land: '#e4e1d9', asean: '#f7f4eb', stroke: '#b3ab9d', strokeAsean: '#6f6756' };
  return {
    version: 8,
    name: dark ? 'ASEAN Watch offline (dark)' : 'ASEAN Watch offline',
    sources: {
      region: { type: 'geojson', data: region, attribution: OFFLINE_ATTRIBUTION },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': c.water } },
      {
        id: 'land',
        type: 'fill',
        source: 'region',
        filter: ['!=', ['get', 'asean'], true],
        paint: { 'fill-color': c.land, 'fill-outline-color': c.stroke },
      },
      {
        id: 'land-asean',
        type: 'fill',
        source: 'region',
        filter: ['==', ['get', 'asean'], true],
        paint: { 'fill-color': c.asean },
      },
      {
        id: 'border',
        type: 'line',
        source: 'region',
        paint: { 'line-color': c.stroke, 'line-width': 0.6 },
      },
      {
        id: 'border-asean',
        type: 'line',
        source: 'region',
        filter: ['==', ['get', 'asean'], true],
        paint: { 'line-color': c.strokeAsean, 'line-width': 0.9 },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// FIRMS hotspot members for the map

/** One FIRMS detection drawn on the map; `current` is true for the replay day on screen. */
export interface MapHotspot {
  id: string;
  lat: number;
  lon: number;
  frp: number;
  confidenceLabel: string;
  observedAt: string;
  current: boolean;
}

interface ObservationLike {
  id: string;
  incidentId: string;
  category: string;
  replayStep: number;
}
interface MemberLike {
  id: string;
  latitude: number;
  longitude: number;
  frp: number;
  confidenceLabel: string;
  observedAt: string;
}

/**
 * The individual hotspots behind the selected watch's thermal records up to the replay day
 * (earlier days kept, flagged `current: false`). Duplicates and non-finite points are dropped.
 */
export function hotspotsUpToDay(
  observations: readonly ObservationLike[],
  members: Readonly<Record<string, readonly MemberLike[]>> | null | undefined,
  incidentId: string | null,
  replayIndex: number,
): MapHotspot[] {
  if (!incidentId || !members) return [];
  const seen = new Set<string>();
  const out: MapHotspot[] = [];
  for (const o of observations) {
    if (o.incidentId !== incidentId || o.category !== 'thermal' || o.replayStep > replayIndex) continue;
    const list = members[o.id];
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (seen.has(m.id) || !Number.isFinite(m.latitude) || !Number.isFinite(m.longitude)) continue;
      seen.add(m.id);
      out.push({
        id: m.id,
        lat: m.latitude,
        lon: m.longitude,
        frp: m.frp,
        confidenceLabel: m.confidenceLabel,
        observedAt: m.observedAt,
        current: o.replayStep === replayIndex,
      });
    }
  }
  return out;
}

/**
 * Split a path into dashes: `on` segments drawn, then `off` skipped, repeating (deck.gl's core path
 * layer has no dash support without the extensions package). Each dash is its own path.
 */
export function dashedPaths(points: readonly LonLat[], on = 2, off = 1): LonLat[][] {
  const out: LonLat[][] = [];
  if (on < 1 || points.length < 2) return out;
  const period = on + Math.max(0, off);
  for (let i = 0; i < points.length - 1; i += period) {
    const dash = points.slice(i, Math.min(points.length, i + on + 1));
    if (dash.length >= 2) out.push(dash as LonLat[]);
  }
  return out;
}
