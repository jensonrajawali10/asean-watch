// "If it erupted now": an illustrative, deterministic ash-puff scenario for a watched volcano. MODELLED
// SCENARIO, never a prediction, never a warning, never a VAAC advisory, never a hazard zone.
//
// Method (stated in the caveats and the workspace methods note):
// - An eruption is ASSUMED to start at the given "now" (the map scrubber's anchor hour) and to last
//   `emissionHours` (default: the scenario length). One ash puff leaves the vent every hour, from the start to
//   the end of the eruption, at each of three heights: 700 hPa (~3 km), 500 hPa (~5.5 km) and 300 hPa (~9 km).
//   The column height is an assumption, not an observation.
// - Each puff moves with the MODELLED Open-Meteo wind at that pressure level AT THE SUMMIT, varying in time
//   (u and v interpolated linearly between forecast hours; 10-minute forward steps, wind at each step's
//   midpoint). It does not sample the wind where the ash has moved to: the same simplification as the
//   ash-drift lines (ashDrift.ts).
// - Each puff's radius grows linearly with age: 5 km at the vent plus 3.6 km per hour. 3.6 km/h is 2 sigma
//   of the long-range horizontal spread sigma ~ 0.5 m/s x travel time (Heffter 1965, J. Appl. Meteor. 4,
//   153-156). Illustrative only: a real ash cloud's width depends on the eruption, wind shear and fallout.
// - The release is continuous, so each height's ash is the chain vent -> youngest puff -> ... -> oldest puff,
//   joined by tapered capsules (radius interpolated along each link). Without the links, hourly puffs in a
//   fast wind would look like separate beads.
// - The footprint for a time is the outline of the union of the three chains (all heights) then.
// - A place's first arrival is the first 10-minute step at which it lies inside any chain.
// Not modelled: ash fallout to the ground, particle sizes, concentrations, gravity spreading, terrain,
// rain-out, the real eruption column. Output is deterministic for the same wind series and start time.
import { AQ_PLACES } from './airQuality';
import { ASH_LEVELS, bearingDeg, compass16, destination, distanceKm, windAt } from './ashDrift';
import type { AshLevel, AshWindData, AshWindSeries } from './ashDrift';
import { PLACE_PROVINCE } from './places';
import type { PlaceRef } from './places';

export const SCENARIO_LABEL = 'MODELLED SCENARIO';
export const SCENARIO_DEFAULT_HOURS = 24;
export const SCENARIO_MAX_HOURS = 48;
/** A scenario shorter than this is shifted earlier inside the wind series (and flagged) rather than cut short. */
export const SCENARIO_MIN_HOURS = 6;
export const PUFF_EVERY_H = 1;
export const SCENARIO_STEP_MIN = 10;
/** Puff radius at the vent (km): an illustrative umbrella-cloud size, not a measured one. */
export const PUFF_START_RADIUS_KM = 5;
/** Radius growth (km per hour of age): 2 x Heffter's sigma = 0.5 m/s x t. Illustrative. */
export const PUFF_SPREAD_KM_PER_H = 3.6;
/** The headline direction is the vent-to-ash-front bearing after this many hours. */
export const DIRECTION_HOURS = 6;
/** Distances reported per level (hours after the start; only those inside the scenario). */
export const SCENARIO_TICK_HOURS: readonly number[] = [3, 6, 12, 24, 48];
/** Less than this displacement (km) after DIRECTION_HOURS reads as "stays close to the summit". */
export const CALM_KM = 10;

const HOUR_MS = 3_600_000;
const STEP_MS = SCENARIO_STEP_MIN * 60_000;
const STEPS_PER_HOUR = 60 / SCENARIO_STEP_MIN;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.32;
const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const LEVEL_KEYS: readonly AshLevel[] = ASH_LEVELS.map((l) => l.key);

// ---------------------------------------------------------------------------
// Places

export interface ScenarioPlace {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** English province name (Indonesia), for local time labels; null when not needed or unknown. */
  province: string | null;
  lat: number;
  lon: number;
  /** Where the coordinates come from. */
  source: string;
}

const GEONAMES = (id: number) => `GeoNames ${id} via the Open-Meteo geocoding API, checked 2026-10-15`;

/**
 * Towns near the watched volcanoes (coordinates only; no populations). Coordinates are GeoNames populated-place
 * points (https://www.geonames.org/<id>, CC BY 4.0) read through the Open-Meteo geocoding API on 2026-10-15.
 */
export const VOLCANO_TOWNS: Readonly<Record<string, readonly ScenarioPlace[]>> = {
  // Merapi (GVP 263250), Central Java / Yogyakarta
  'gvp-263250': [
    { id: 'yogyakarta', name: 'Yogyakarta', country: 'ID', province: 'Yogyakarta', lat: -7.80139, lon: 110.36472, source: GEONAMES(1621177) },
    { id: 'magelang', name: 'Magelang', country: 'ID', province: 'Central Java', lat: -7.47056, lon: 110.21778, source: GEONAMES(1636884) },
    { id: 'klaten', name: 'Klaten', country: 'ID', province: 'Central Java', lat: -7.70583, lon: 110.60639, source: GEONAMES(1639900) },
    { id: 'boyolali', name: 'Boyolali', country: 'ID', province: 'Central Java', lat: -7.53306, lon: 110.59583, source: GEONAMES(1648084) },
    { id: 'surakarta', name: 'Surakarta', country: 'ID', province: 'Central Java', lat: -7.55611, lon: 110.83167, source: GEONAMES(1625812) },
    { id: 'semarang', name: 'Semarang', country: 'ID', province: 'Central Java', lat: -6.99306, lon: 110.42083, source: GEONAMES(1627896) },
  ],
  // Semeru (GVP 263300), East Java
  'gvp-263300': [
    { id: 'lumajang', name: 'Lumajang', country: 'ID', province: 'East Java', lat: -8.1335, lon: 113.2248, source: GEONAMES(1637090) },
    { id: 'malang', name: 'Malang', country: 'ID', province: 'East Java', lat: -7.9797, lon: 112.6304, source: GEONAMES(1636722) },
    { id: 'surabaya', name: 'Surabaya', country: 'ID', province: 'East Java', lat: -7.24917, lon: 112.75083, source: GEONAMES(1625822) },
    { id: 'denpasar', name: 'Denpasar', country: 'ID', province: 'Bali', lat: -8.65, lon: 115.21667, source: GEONAMES(1645528) },
  ],
  // Sinabung (GVP 261080), Karo, North Sumatra (Medan is in AQ_PLACES)
  'gvp-261080': [
    { id: 'berastagi', name: 'Berastagi', country: 'ID', province: 'North Sumatra', lat: 3.19468, lon: 98.50889, source: GEONAMES(1215395) },
    { id: 'kabanjahe', name: 'Kabanjahe', country: 'ID', province: 'North Sumatra', lat: 3.1001, lon: 98.4908, source: GEONAMES(1214965) },
  ],
  // Anak Krakatau (GVP 262000 Krakatau), Sunda Strait (Jakarta is in AQ_PLACES)
  'gvp-262000': [
    { id: 'bandar-lampung', name: 'Bandar Lampung', country: 'ID', province: 'Lampung', lat: -5.42917, lon: 105.26111, source: GEONAMES(1624917) },
    { id: 'serang', name: 'Serang', country: 'ID', province: 'Banten', lat: -6.11528, lon: 106.15417, source: GEONAMES(1627549) },
    { id: 'cilegon', name: 'Cilegon', country: 'ID', province: 'Banten', lat: -6.0144, lon: 106.0542, source: GEONAMES(1646511) },
  ],
};

/** AQ_PLACES as scenario places ("Dumai (Riau peatlands)" -> "Dumai"). */
export const AQ_SCENARIO_PLACES: readonly ScenarioPlace[] = AQ_PLACES.map((p) => ({
  id: p.id,
  name: p.name.replace(/\s*\(.*\)\s*$/, ''),
  country: p.country,
  province: PLACE_PROVINCE[p.id] ?? null,
  lat: p.lat,
  lon: p.lon,
  source: 'AQ_PLACES (GeoNames via the Open-Meteo geocoding API, 2026-10-14)',
}));

/** Every bundled town (all volcanoes) plus the air-quality cities, the given volcano's towns first. */
export function scenarioPlaces(volcanoId?: string | null): ScenarioPlace[] {
  const own = (volcanoId && VOLCANO_TOWNS[volcanoId]) || [];
  const rest = Object.entries(VOLCANO_TOWNS).flatMap(([id, list]) => (id === volcanoId ? [] : list));
  const seen = new Set<string>();
  const out: ScenarioPlace[] = [];
  for (const p of [...own, ...rest, ...AQ_SCENARIO_PLACES]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** For places.ts localTimeLabel(). */
export function scenarioPlaceRef(p: Pick<ScenarioPlace, 'country' | 'province'>): PlaceRef {
  return { country: p.country, province: p.province };
}

// ---------------------------------------------------------------------------
// Types

export type LonLat = [number, number];
/** A closed ring of [lon, lat] (first point repeated at the end). */
export type Ring = LonLat[];

/** A circle of modelled ash at one height. */
export interface PlumeCircle {
  level: AshLevel;
  /** Hours since this ash left the vent. */
  ageH: number;
  lat: number;
  lon: number;
  radiusKm: number;
}

/** One of the hourly puffs. */
export interface Puff extends PlumeCircle {
  /** Hours after the scenario start when the puff left the vent. */
  emittedH: number;
}

export interface ScenarioFrame {
  /** Hours after the start (0 … hours). */
  hour: number;
  /** ISO 8601 UTC. */
  time: string;
  /** The hourly puffs that have left the vent by then (youngest last). */
  puffs: Puff[];
  /** Outline of the union of the three ash chains at this hour (one ring per separate patch or hole). Lazy. */
  readonly footprint: Ring[];
}

export interface Arrival {
  /** Hours after the start, to the nearest 10 minutes. */
  hours: number;
  /** ISO 8601 UTC. */
  time: string;
}

export interface PlaceArrival extends Arrival {
  place: ScenarioPlace;
  /** The height whose ash arrived first (ties: the lowest level). */
  level: AshLevel;
  byLevel: Partial<Record<AshLevel, Arrival>>;
  /** From the vent. */
  distanceKm: number;
  bearingDeg: number;
}

export interface Heading {
  bearingDeg: number;
  /** "WSW". */
  compass: string;
  /** "west-south-west". */
  words: string;
}

export interface LevelTick {
  hour: number;
  time: string;
  lat: number;
  lon: number;
  /** Vent to the ash front (the first puff's centre). */
  distanceKm: number;
  bearingDeg: number | null;
}

export interface LevelStats {
  level: AshLevel;
  hPa: string;
  /** "~5.5 km". */
  label: string;
  role: string;
  /** Wind at the summit at the start: speed and the direction it blows FROM and TOWARD. */
  windAtStart: { speedMs: number; fromDeg: number; towardDeg: number } | null;
  /** Mean wind speed over the scenario (m/s). */
  meanSpeedMs: number | null;
  /** Vent to the ash front after DIRECTION_HOURS (or the whole scenario if shorter); null when calm. */
  heading: Heading | null;
  /** Direction the front moves after DIRECTION_HOURS; null when the scenario is shorter or the move is small. */
  laterHeading: Heading | null;
  ticks: LevelTick[];
  /** Hourly path of the first puff (the ash front) from the vent, for the map trail. */
  frontPath: { lat: number; lon: number; time: string }[];
  /** Places reached by this height, earliest first. */
  placesReached: { place: ScenarioPlace; hours: number; time: string }[];
}

export interface ScenarioSummary {
  label: typeof SCENARIO_LABEL;
  /** "If Merapi erupted now, ash at about 5.5–9 km would drift west-south-west". */
  direction: string;
  /** The same without the "If … erupted now," lead: "Ash at about 5.5–9 km would drift west-south-west". */
  directionShort: string;
  /** "modelled to pass near Yogyakarta within about 2 h (ash at about 3 km)", or the no-town clause. */
  places: string;
  /** The two joined into one sentence. */
  sentence: string;
  /** Upper-column heading words ("west-south-west"); null when calm or split. */
  directionWords: string | null;
  /** Up to three earliest arrivals. */
  nearest: PlaceArrival[];
  /** Plain-language caveats, always shown with the scenario. */
  caveats: string[];
}

export interface WindMeta {
  dataMode: 'live' | 'historical';
  retrievedAt: string;
  source: string;
  sourceUrl: string;
  attribution: string;
}

export interface EruptionScenario {
  kind: 'modelled-scenario';
  volcanoId: string;
  name: string;
  vent: { lat: number; lon: number };
  /** The requested "now", floored to the hour. */
  requestedStartISO: string;
  startISO: string;
  startMs: number;
  endISO: string;
  /** True when the wind data forced a start other than the requested hour. */
  startShifted: boolean;
  /** Scenario length actually run (hours), and what was asked for. */
  hours: number;
  requestedHours: number;
  /** Length of the assumed eruption (hours from the start); puffs leave at 0, 1, … emissionHours. */
  emissionHours: number;
  frames: ScenarioFrame[];
  levels: LevelStats[];
  /** Every listed place reached, earliest first. */
  arrivals: PlaceArrival[];
  /** [west, south, east, north] over all frames. */
  bounds: [number, number, number, number];
  wind: WindMeta | null;
  assumptions: {
    puffEveryH: number;
    startRadiusKm: number;
    spreadKmPerH: number;
    stepMinutes: number;
    levels: string;
  };
  summary: ScenarioSummary;
  /** positions[level][emission][hour] = [lon, lat] at that whole hour; null before emission. */
  positions: Record<AshLevel, (LonLat | null)[][]>;
}

export interface ScenarioOptions {
  /** Scenario length in hours (default 24, at most 48; cut to the wind data available). */
  hours?: number;
  /** Length of the assumed eruption in hours (default: the scenario length). */
  emissionHours?: number;
  /** Places to time (default scenarioPlaces(volcanoId)). */
  places?: readonly ScenarioPlace[];
  /** Display name (e.g. the watch title "Anak Krakatau" rather than the GVP name "Krakatau"). */
  name?: string;
  wind?: WindMeta | null;
}

// ---------------------------------------------------------------------------
// Small helpers

const WORDS: Record<string, string> = {
  N: 'north',
  NNE: 'north-north-east',
  NE: 'north-east',
  ENE: 'east-north-east',
  E: 'east',
  ESE: 'east-south-east',
  SE: 'south-east',
  SSE: 'south-south-east',
  S: 'south',
  SSW: 'south-south-west',
  SW: 'south-west',
  WSW: 'west-south-west',
  W: 'west',
  WNW: 'west-north-west',
  NW: 'north-west',
  NNW: 'north-north-west',
};

export function heading(bearing: number): Heading {
  const b = ((bearing % 360) + 360) % 360;
  const c = compass16(b);
  return { bearingDeg: b, compass: c, words: WORDS[c] ?? c };
}

/** Puff radius (km) at an age (hours). */
export function puffRadiusKm(ageH: number): number {
  return PUFF_START_RADIUS_KM + PUFF_SPREAD_KM_PER_H * Math.max(0, ageH);
}

/** Local east/north offset (km) of b from a (equirectangular; fine at these distances for direction words). */
function offsetKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): { e: number; n: number } {
  return { e: (b.lon - a.lon) * KM_PER_DEG_LON_EQ * Math.cos(rad((a.lat + b.lat) / 2)), n: (b.lat - a.lat) * KM_PER_DEG_LAT };
}

const angleDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** "within the first hour" / "within about 2 h". */
export function hoursPhrase(h: number): string {
  if (!(h >= 0)) return '';
  if (h < 1) return 'within the first hour';
  return `within about ${Math.round(h)} h`;
}

/** "about 2 h" / "under 1 h". */
export function hoursShort(h: number): string {
  if (!(h >= 0)) return '';
  if (h < 1) return 'under 1 h';
  return `about ${Math.round(h)} h`;
}

const levelInfo = (l: AshLevel) => ASH_LEVELS.find((x) => x.key === l) ?? { key: l, hPa: `${l} hPa`, label: l, role: '' };
/** "about 3 km" from "~3 km". */
export const levelWords = (l: AshLevel): string => `about ${levelInfo(l).label.replace(/^~/, '')}`;

// ---------------------------------------------------------------------------
// Start and length

/**
 * The scenario window inside the wind series: start at the hour at or before `nowMs` and run `wantHours`
 * (cut to the data). If fewer than SCENARIO_MIN_HOURS remain (a stale snapshot), the start moves back so the
 * scenario still runs, and `shifted` is set. Null when the series has no usable times.
 */
export function scenarioWindow(series: AshWindSeries, nowMs: number, wantHours: number): { startMs: number; hours: number; shifted: boolean } | null {
  const t = series.times.map((x) => Date.parse(x)).filter(Number.isFinite);
  if (t.length < 2 || !Number.isFinite(nowMs)) return null;
  const first = t[0];
  const last = t[t.length - 1];
  const want = Math.max(1, Math.min(SCENARIO_MAX_HOURS, Math.floor(wantHours)));
  const hour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  let start = Math.max(first, hour);
  if (last - start < Math.min(want, SCENARIO_MIN_HOURS) * HOUR_MS) start = Math.max(first, last - want * HOUR_MS);
  const hours = Math.min(want, Math.floor((last - start) / HOUR_MS));
  if (hours < 1) return null;
  return { startMs: start, hours, shifted: start !== hour };
}

// ---------------------------------------------------------------------------
// Chains: the continuous ash at one height = vent -> youngest puff -> … -> oldest puff

interface ChainSource {
  vent: { lat: number; lon: number };
  emissionHours: number;
  hours: number;
  positions: Record<AshLevel, (LonLat | null)[][]>;
}

/**
 * Circles of one height's chain at `hc` hours after the start (0 ≤ hc ≤ hours), youngest first: the vent while
 * the eruption lasts, then every puff that has left, positions interpolated between whole hours.
 */
function chainAt(src: ChainSource, level: AshLevel, hc: number): PlumeCircle[] {
  const h0 = Math.min(Math.floor(hc), src.hours);
  const f = hc - h0;
  const out: PlumeCircle[] = [];
  if (hc <= src.emissionHours) out.push({ level, ageH: 0, lat: src.vent.lat, lon: src.vent.lon, radiusKm: PUFF_START_RADIUS_KM });
  const paths = src.positions[level] ?? [];
  for (let e = Math.min(paths.length - 1, h0); e >= 0; e--) {
    const a = paths[e][h0];
    if (!a) continue;
    const b = f > 0 ? paths[e][h0 + 1] : null;
    const ageH = hc - e;
    if (ageH === 0 && out.length > 0) continue; // the puff leaving now is the vent circle
    out.push({
      level,
      ageH,
      lat: b ? a[1] + (b[1] - a[1]) * f : a[1],
      lon: b ? a[0] + (b[0] - a[0]) * f : a[0],
      radiusKm: puffRadiusKm(ageH),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Footprint: union of chains -> outline rings (signed-distance raster + marching squares)

const GRID_TARGET = 80;
const MIN_CELL_DEG = 0.01;

interface Circle {
  lat: number;
  lon: number;
  radiusKm: number;
}

/** Signed area of a closed ring in square degrees (shoelace). */
function ringArea(ring: Ring): number {
  let a = 0;
  for (let k = 0; k + 1 < ring.length; k++) a += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
  return a / 2;
}

/**
 * Outline rings of the union of chains of circles. Consecutive circles in a chain are joined by a tapered
 * capsule (radius interpolated along the link); a chain of one circle is just that circle. Signed-distance
 * raster at 1/80 of the extent, contoured by marching squares with linear interpolation. Deterministic;
 * rings are closed [lon, lat] lists.
 */
export function footprintRings(chains: readonly (readonly Circle[])[]): Ring[] {
  const cs = chains.map((c) => c.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon) && x.radiusKm > 0)).filter((c) => c.length > 0);
  if (cs.length === 0) return [];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const dLon = (c: Circle) => c.radiusKm / (KM_PER_DEG_LON_EQ * Math.max(0.05, Math.cos(rad(c.lat))));
  for (const chain of cs) {
    for (const c of chain) {
      const dy = c.radiusKm / KM_PER_DEG_LAT;
      const dx = dLon(c);
      w = Math.min(w, c.lon - dx);
      e = Math.max(e, c.lon + dx);
      s = Math.min(s, c.lat - dy);
      n = Math.max(n, c.lat + dy);
    }
  }
  // Cell size: 1/GRID_TARGET of the extent. Circles narrower than 0.75 cell are drawn at 0.75 cell so the
  // narrow end at the vent stays visible on a long plume (display only; arrivals use the exact radii).
  const cell = Math.max(MIN_CELL_DEG, Math.max(e - w, n - s) / GRID_TARGET);
  const minDrawKm = 0.75 * cell * KM_PER_DEG_LAT;
  const drawn = cs.map((chain) => chain.map((c) => (c.radiusKm >= minDrawKm ? c : { lat: c.lat, lon: c.lon, radiusKm: minDrawKm })));
  w -= 2 * cell;
  s -= 2 * cell;
  e += 2 * cell;
  n += 2 * cell;
  const nx = Math.ceil((e - w) / cell) + 1;
  const ny = Math.ceil((n - s) / cell) + 1;
  const g = new Float64Array(nx * ny).fill(-1e6);

  // Stamp the signed distance (km, positive inside) of each link: radius at the closest point minus distance.
  const stamp = (a: Circle, b: Circle) => {
    const kx = KM_PER_DEG_LON_EQ * Math.cos(rad((a.lat + b.lat) / 2));
    const bx = (b.lon - a.lon) * kx;
    const by = (b.lat - a.lat) * KM_PER_DEG_LAT;
    const len2 = bx * bx + by * by;
    const lo = Math.min(a.lon - dLon(a), b.lon - dLon(b));
    const hi = Math.max(a.lon + dLon(a), b.lon + dLon(b));
    const bot = Math.min(a.lat - a.radiusKm / KM_PER_DEG_LAT, b.lat - b.radiusKm / KM_PER_DEG_LAT);
    const top = Math.max(a.lat + a.radiusKm / KM_PER_DEG_LAT, b.lat + b.radiusKm / KM_PER_DEG_LAT);
    const i0 = Math.max(0, Math.floor((lo - w) / cell) - 2);
    const i1 = Math.min(nx - 1, Math.ceil((hi - w) / cell) + 2);
    const j0 = Math.max(0, Math.floor((bot - s) / cell) - 2);
    const j1 = Math.min(ny - 1, Math.ceil((top - s) / cell) + 2);
    for (let j = j0; j <= j1; j++) {
      const py = (s + j * cell - a.lat) * KM_PER_DEG_LAT;
      for (let i = i0; i <= i1; i++) {
        const px = (w + i * cell - a.lon) * kx;
        const t = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
        const v = a.radiusKm + (b.radiusKm - a.radiusKm) * t - Math.hypot(px - t * bx, py - t * by);
        const k = j * nx + i;
        if (v > g[k]) g[k] = v;
      }
    }
  };
  for (const chain of drawn) {
    if (chain.length === 1) stamp(chain[0], chain[0]);
    for (let k = 0; k + 1 < chain.length; k++) stamp(chain[k], chain[k + 1]);
  }

  const at = (i: number, j: number) => g[j * nx + i];
  // Edge keys: horizontal edge from (i, j) to (i+1, j) = 2*(j*nx+i); vertical edge from (i, j) to (i, j+1) = +1.
  const points = new Map<number, LonLat>();
  const point = (key: number): LonLat => {
    const cached = points.get(key);
    if (cached) return cached;
    const base = key >> 1;
    const i = base % nx;
    const j = (base - i) / nx;
    const vertical = (key & 1) === 1;
    const i2 = vertical ? i : i + 1;
    const j2 = vertical ? j + 1 : j;
    const va = at(i, j);
    const vb = at(i2, j2);
    const t = va === vb ? 0.5 : Math.min(1, Math.max(0, va / (va - vb)));
    const p: LonLat = [w + (i + (i2 - i) * t) * cell, s + (j + (j2 - j) * t) * cell];
    points.set(key, p);
    return p;
  };
  const segs: [number, number][] = [];
  const byKey = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const idx = segs.length;
    segs.push([a, b]);
    for (const k of [a, b]) {
      const list = byKey.get(k);
      if (list) list.push(idx);
      else byKey.set(k, [idx]);
    }
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = at(i, j);
      const v10 = at(i + 1, j);
      const v11 = at(i + 1, j + 1);
      const v01 = at(i, j + 1);
      const c = (v00 > 0 ? 1 : 0) | (v10 > 0 ? 2 : 0) | (v11 > 0 ? 4 : 0) | (v01 > 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const B = 2 * (j * nx + i);
      const L = B + 1;
      const R = 2 * (j * nx + i + 1) + 1;
      const T = 2 * ((j + 1) * nx + i);
      const centreIn = (v00 + v10 + v11 + v01) / 4 > 0;
      switch (c) {
        case 1:
        case 14:
          add(L, B);
          break;
        case 2:
        case 13:
          add(B, R);
          break;
        case 3:
        case 12:
          add(L, R);
          break;
        case 4:
        case 11:
          add(R, T);
          break;
        case 6:
        case 9:
          add(B, T);
          break;
        case 7:
        case 8:
          add(L, T);
          break;
        case 5:
          if (centreIn) {
            add(B, R);
            add(T, L);
          } else {
            add(L, B);
            add(R, T);
          }
          break;
        case 10:
          if (centreIn) {
            add(L, B);
            add(R, T);
          } else {
            add(B, R);
            add(T, L);
          }
          break;
      }
    }
  }
  const used = new Uint8Array(segs.length);
  const rings: Ring[] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const startKey = segs[s0][0];
    const ring: Ring = [point(startKey)];
    let key = segs[s0][1];
    let guard = segs.length + 2;
    while (key !== startKey && guard-- > 0) {
      ring.push(point(key));
      const next = (byKey.get(key) ?? []).find((idx) => !used[idx]);
      if (next === undefined) break;
      used[next] = 1;
      key = segs[next][0] === key ? segs[next][1] : segs[next][0];
    }
    if (ring.length >= 3) {
      ring.push(ring[0]);
      // Drop cell-sized slivers (raster artefacts where two links meet), keep real patches and holes.
      if (Math.abs(ringArea(ring)) >= 2.5 * cell * cell) rings.push(ring);
    }
  }
  return rings;
}

// ---------------------------------------------------------------------------
// The scenario

/** Build the scenario from one volcano's wind series. Null when the series has no usable wind at the start. */
export function buildScenarioFromSeries(series: AshWindSeries, nowMs: number, opts: ScenarioOptions = {}): EruptionScenario | null {
  const requestedHours = Math.max(1, Math.min(SCENARIO_MAX_HOURS, Math.floor(opts.hours ?? SCENARIO_DEFAULT_HOURS)));
  const win = scenarioWindow(series, nowMs, requestedHours);
  if (!win) return null;
  const { startMs } = win;
  const levels = LEVEL_KEYS;

  // Wind per level per 10-minute step (midpoint); the scenario stops at the first gap in any level.
  let steps = win.hours * STEPS_PER_HOUR;
  const winds = {} as Record<AshLevel, { u: number; v: number }[]>;
  for (const l of levels) {
    winds[l] = [];
    for (let k = 0; k < steps; k++) {
      const wv = windAt(series, l, startMs + (k + 0.5) * STEP_MS);
      if (!wv || !Number.isFinite(wv.u) || !Number.isFinite(wv.v)) {
        steps = k;
        break;
      }
      winds[l].push(wv);
    }
  }
  const hours = Math.floor(steps / STEPS_PER_HOUR);
  if (hours < 1) return null;
  steps = hours * STEPS_PER_HOUR;
  const emissionHours = Math.max(0, Math.min(hours, Math.floor(opts.emissionHours ?? hours)));
  const vent = { lat: series.lat, lon: series.lon };
  const places = opts.places ?? scenarioPlaces(series.volcanoId);

  // Candidate places: within the farthest any ash could reach; local km coordinates from the vent.
  let maxSpeed = 0;
  for (const l of levels) for (const wv of winds[l]) maxSpeed = Math.max(maxSpeed, Math.hypot(wv.u, wv.v));
  const reachKm = maxSpeed * 3.6 * hours + puffRadiusKm(hours) + 5;
  const kx0 = KM_PER_DEG_LON_EQ * Math.cos(rad(vent.lat));
  const toX = (lon: number) => (lon - vent.lon) * kx0;
  const toY = (lat: number) => (lat - vent.lat) * KM_PER_DEG_LAT;
  const candidates = places
    .map((p) => ({ p, d: distanceKm(vent.lat, vent.lon, p.lat, p.lon), x: toX(p.lon), y: toY(p.lat) }))
    .filter((c) => c.d <= reachKm);

  // Step-major simulation: every puff of every height advances together; the chains are checked each step.
  const nPuffs = emissionHours + 1;
  const positions = {} as Record<AshLevel, (LonLat | null)[][]>;
  const firstStep = new Map<string, Partial<Record<AshLevel, number>>>();
  const cx = new Float64Array(nPuffs + 1);
  const cy = new Float64Array(nPuffs + 1);
  const cr = new Float64Array(nPuffs + 1);
  for (const l of levels) {
    const lat = new Float64Array(nPuffs).fill(vent.lat);
    const lon = new Float64Array(nPuffs).fill(vent.lon);
    const paths: (LonLat | null)[][] = Array.from({ length: nPuffs }, () => new Array<LonLat | null>(hours + 1).fill(null));
    const pending = [...candidates];
    for (let k = 0; k <= steps; k++) {
      const tH = k / STEPS_PER_HOUR;
      const emitted = Math.min(emissionHours, Math.floor(tH + 1e-9));
      if (k % STEPS_PER_HOUR === 0) {
        const h = k / STEPS_PER_HOUR;
        for (let e = 0; e <= emitted; e++) paths[e][h] = [lon[e], lat[e]];
      }
      // Chain in local km: the vent while erupting, then each puff from youngest to oldest.
      let m = 0;
      if (tH <= emissionHours) {
        cx[m] = 0;
        cy[m] = 0;
        cr[m] = PUFF_START_RADIUS_KM;
        m++;
      }
      for (let e = emitted; e >= 0; e--) {
        cx[m] = toX(lon[e]);
        cy[m] = toY(lat[e]);
        cr[m] = puffRadiusKm(tH - e);
        m++;
      }
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let q = 0; q < m; q++) {
        x0 = Math.min(x0, cx[q] - cr[q]);
        x1 = Math.max(x1, cx[q] + cr[q]);
        y0 = Math.min(y0, cy[q] - cr[q]);
        y1 = Math.max(y1, cy[q] + cr[q]);
      }
      for (let pi = pending.length - 1; pi >= 0; pi--) {
        const c = pending[pi];
        if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
        let inside = false;
        for (let q = 0; q < m && !inside; q++) {
          const q2 = q + 1 < m ? q + 1 : q;
          const bx = cx[q2] - cx[q];
          const by = cy[q2] - cy[q];
          const px = c.x - cx[q];
          const py = c.y - cy[q];
          const len2 = bx * bx + by * by;
          const t = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
          const r = cr[q] + (cr[q2] - cr[q]) * t;
          const dx = px - t * bx;
          const dy = py - t * by;
          inside = dx * dx + dy * dy <= r * r;
        }
        if (inside) {
          const rec = firstStep.get(c.p.id) ?? {};
          rec[l] = k;
          firstStep.set(c.p.id, rec);
          pending.splice(pi, 1);
        }
      }
      if (k === steps) break;
      const wv = winds[l][k];
      const speed = Math.hypot(wv.u, wv.v);
      if (speed > 0) {
        const brg = (deg(Math.atan2(wv.u, wv.v)) + 360) % 360;
        const km = (speed * STEP_MS) / 1e6;
        for (let e = 0; e <= emitted; e++) {
          const d = destination(lat[e], lon[e], brg, km);
          lat[e] = d.lat;
          lon[e] = d.lon;
        }
      }
      // A puff leaving at the next whole hour starts at the vent (already filled).
    }
    positions[l] = paths;
  }

  const src: ChainSource = { vent, emissionHours, hours, positions };

  // Frames
  const frames: ScenarioFrame[] = [];
  let bw = vent.lon;
  let bs = vent.lat;
  let be = vent.lon;
  let bn = vent.lat;
  for (let h = 0; h <= hours; h++) {
    const puffs: Puff[] = [];
    for (const l of levels) {
      for (let e = 0; e < positions[l].length; e++) {
        const p = positions[l][e][h];
        if (!p) continue;
        const ageH = h - e;
        puffs.push({ level: l, emittedH: e, ageH, lat: p[1], lon: p[0], radiusKm: puffRadiusKm(ageH) });
      }
    }
    for (const p of puffs) {
      const dy = p.radiusKm / KM_PER_DEG_LAT;
      const dx = p.radiusKm / (KM_PER_DEG_LON_EQ * Math.cos(rad(p.lat)));
      bw = Math.min(bw, p.lon - dx);
      be = Math.max(be, p.lon + dx);
      bs = Math.min(bs, p.lat - dy);
      bn = Math.max(bn, p.lat + dy);
    }
    // The outline is computed on first read (about 1-2 ms per hour) and kept.
    let rings: Ring[] | null = null;
    const hour = h;
    frames.push({
      hour,
      time: toIso(startMs + h * HOUR_MS),
      puffs,
      get footprint(): Ring[] {
        rings ??= footprintRings(levels.map((l) => chainAt(src, l, hour)));
        return rings;
      },
    });
  }

  // Arrivals
  const stepToArrival = (k: number): Arrival => ({ hours: k / STEPS_PER_HOUR, time: toIso(startMs + k * STEP_MS) });
  const arrivals: PlaceArrival[] = [];
  for (const { p, d } of candidates) {
    const rec = firstStep.get(p.id);
    if (!rec) continue;
    let bestLevel: AshLevel | null = null;
    let bestK = Infinity;
    const byLevel: Partial<Record<AshLevel, Arrival>> = {};
    for (const l of levels) {
      const k = rec[l];
      if (k === undefined) continue;
      byLevel[l] = stepToArrival(k);
      if (k < bestK) {
        bestK = k;
        bestLevel = l;
      }
    }
    if (bestLevel === null) continue;
    arrivals.push({
      place: p,
      ...stepToArrival(bestK),
      level: bestLevel,
      byLevel,
      distanceKm: d,
      bearingDeg: bearingDeg(vent.lat, vent.lon, p.lat, p.lon),
    });
  }
  arrivals.sort((a, b) => a.hours - b.hours || a.distanceKm - b.distanceKm || a.place.id.localeCompare(b.place.id));

  // Per-level statistics (the first puff is the ash front).
  const stats: LevelStats[] = levels.map((l) => {
    const info = levelInfo(l);
    const front = positions[l][0];
    const pt = (h: number) => {
      const p = front[h];
      return p ? { lat: p[1], lon: p[0] } : null;
    };
    const w0 = windAt(series, l, startMs);
    const toward = w0 ? (deg(Math.atan2(w0.u, w0.v)) + 360) % 360 : 0;
    const speeds = winds[l].slice(0, steps).map((wv) => Math.hypot(wv.u, wv.v));
    const hDir = Math.min(DIRECTION_HOURS, hours);
    const atDir = pt(hDir);
    const atEnd = pt(hours);
    const headDist = atDir ? distanceKm(vent.lat, vent.lon, atDir.lat, atDir.lon) : 0;
    const laterDist = atDir && atEnd && hours > hDir ? distanceKm(atDir.lat, atDir.lon, atEnd.lat, atEnd.lon) : 0;
    const ticks: LevelTick[] = [];
    for (const th of SCENARIO_TICK_HOURS) {
      const p = th <= hours ? pt(th) : null;
      if (!p) continue;
      const dist = distanceKm(vent.lat, vent.lon, p.lat, p.lon);
      ticks.push({ hour: th, time: toIso(startMs + th * HOUR_MS), lat: p.lat, lon: p.lon, distanceKm: dist, bearingDeg: dist > 0.5 ? bearingDeg(vent.lat, vent.lon, p.lat, p.lon) : null });
    }
    const placesReached = arrivals
      .flatMap((a) => {
        const at = a.byLevel[l];
        return at ? [{ place: a.place, hours: at.hours, time: at.time }] : [];
      })
      .sort((a, b) => a.hours - b.hours || a.place.id.localeCompare(b.place.id));
    return {
      level: l,
      hPa: info.hPa,
      label: info.label,
      role: info.role,
      windAtStart: w0 ? { speedMs: Math.hypot(w0.u, w0.v), towardDeg: toward, fromDeg: (toward + 180) % 360 } : null,
      meanSpeedMs: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
      heading: atDir && headDist >= CALM_KM ? heading(bearingDeg(vent.lat, vent.lon, atDir.lat, atDir.lon)) : null,
      laterHeading: atDir && atEnd && laterDist >= 3 * CALM_KM ? heading(bearingDeg(atDir.lat, atDir.lon, atEnd.lat, atEnd.lon)) : null,
      ticks,
      frontPath: front.flatMap((p, h) => (p ? [{ lat: p[1], lon: p[0], time: toIso(startMs + h * HOUR_MS) }] : [])),
      placesReached,
    };
  });

  const scenario: EruptionScenario = {
    kind: 'modelled-scenario',
    volcanoId: series.volcanoId,
    name: opts.name ?? series.name,
    vent,
    requestedStartISO: toIso(Math.floor(nowMs / HOUR_MS) * HOUR_MS),
    startISO: toIso(startMs),
    startMs,
    endISO: toIso(startMs + hours * HOUR_MS),
    startShifted: win.shifted,
    hours,
    requestedHours,
    emissionHours,
    frames,
    levels: stats,
    arrivals,
    bounds: [bw, bs, be, bn],
    wind: opts.wind ?? null,
    assumptions: {
      puffEveryH: PUFF_EVERY_H,
      startRadiusKm: PUFF_START_RADIUS_KM,
      spreadKmPerH: PUFF_SPREAD_KM_PER_H,
      stepMinutes: SCENARIO_STEP_MIN,
      levels: ASH_LEVELS.map((x) => `${x.hPa} (${x.label})`).join(', '),
    },
    summary: null as unknown as ScenarioSummary,
    positions,
  };
  scenario.summary = summariseScenario(scenario);
  return scenario;
}

/** Build the scenario for one watched volcano from the loaded ash-wind data (live or snapshot). Never throws. */
export function buildEruptionScenario(
  data: AshWindData | null | undefined,
  volcanoId: string | null | undefined,
  nowMs: number,
  opts: Omit<ScenarioOptions, 'wind'> = {},
): EruptionScenario | null {
  if (!data || !volcanoId) return null;
  const series = data.volcanoes.find((v) => v.volcanoId === volcanoId);
  if (!series) return null;
  try {
    return buildScenarioFromSeries(series, nowMs, {
      ...opts,
      wind: { dataMode: data.dataMode, retrievedAt: data.retrievedAt, source: data.source, sourceUrl: data.sourceUrl, attribution: data.attribution },
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The scenario at any time (the map scrubber and the play animation)

/** Hours after the scenario start at `timeMs` (may be negative or past the end); null when not finite. */
export function scenarioHourAt(scenario: EruptionScenario, timeMs: number): number | null {
  if (!Number.isFinite(timeMs)) return null;
  return (timeMs - scenario.startMs) / HOUR_MS;
}

/** Hours into the scenario, clamped to [0, hours]; null before the start. */
function clampedHour(scenario: EruptionScenario, timeMs: number): number | null {
  const h = scenarioHourAt(scenario, timeMs);
  if (h === null || h < 0) return null;
  return Math.min(h, scenario.hours);
}

/**
 * The hourly puffs at any time, interpolated between whole hours. Empty before the start; held at the last
 * hour after the end (the scrubber can run past a 24 h scenario).
 */
export function puffsAt(scenario: EruptionScenario, timeMs: number, levels: readonly AshLevel[] = LEVEL_KEYS): Puff[] {
  const hc = clampedHour(scenario, timeMs);
  if (hc === null) return [];
  const out: Puff[] = [];
  for (const l of levels) {
    for (const c of chainAt(scenario, l, hc)) {
      const emittedH = hc - c.ageH;
      if (Math.abs(emittedH - Math.round(emittedH)) > 1e-9) continue; // the vent circle between whole hours
      out.push({ ...c, emittedH: Math.round(emittedH) });
    }
  }
  return out;
}

/** Each height's chain at any time (vent first while erupting, then youngest to oldest puff). */
export function chainsAt(scenario: EruptionScenario, timeMs: number, levels: readonly AshLevel[] = LEVEL_KEYS): { level: AshLevel; circles: PlumeCircle[] }[] {
  const hc = clampedHour(scenario, timeMs);
  if (hc === null) return [];
  return levels.map((level) => ({ level, circles: chainAt(scenario, level, hc) }));
}

/**
 * Circles for drawing: each chain densified so neighbouring circles overlap (spacing at most `spacing` x the
 * smaller radius), giving a continuous plume rather than hourly beads.
 */
export function plumeCirclesAt(scenario: EruptionScenario, timeMs: number, levels: readonly AshLevel[] = LEVEL_KEYS, spacing = 0.5): PlumeCircle[] {
  const out: PlumeCircle[] = [];
  for (const { circles } of chainsAt(scenario, timeMs, levels)) {
    for (let k = 0; k < circles.length; k++) {
      const a = circles[k];
      out.push(a);
      const b = circles[k + 1];
      if (!b) continue;
      const d = distanceKm(a.lat, a.lon, b.lat, b.lon);
      const n = Math.min(64, Math.ceil(d / (spacing * Math.min(a.radiusKm, b.radiusKm))));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const ageH = a.ageH + (b.ageH - a.ageH) * t;
        out.push({ level: a.level, ageH, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, radiusKm: a.radiusKm + (b.radiusKm - a.radiusKm) * t });
      }
    }
  }
  return out;
}

/** The ash front path per level up to `timeMs` (vent first), for the trail. */
export function frontPathsAt(scenario: EruptionScenario, timeMs: number): { level: AshLevel; path: LonLat[] }[] {
  const hc = clampedHour(scenario, timeMs);
  if (hc === null) return [];
  const h0 = Math.floor(hc);
  return scenario.levels.map((s) => {
    const full = scenario.positions[s.level][0] ?? [];
    const path = full.slice(0, h0 + 1).filter((p): p is LonLat => p !== null);
    const a = full[h0];
    const b = full[h0 + 1];
    if (a && b && hc > h0) path.push([a[0] + (b[0] - a[0]) * (hc - h0), a[1] + (b[1] - a[1]) * (hc - h0)]);
    return { level: s.level, path };
  });
}

const footprintCache = new WeakMap<EruptionScenario, Map<number, Ring[]>>();

/** Footprint outline at any time (whole hours use the frame's outline; others are cached per 5 minutes). */
export function footprintAt(scenario: EruptionScenario, timeMs: number): Ring[] {
  const hc = clampedHour(scenario, timeMs);
  if (hc === null) return [];
  if (Number.isInteger(hc)) return scenario.frames[hc]?.footprint ?? [];
  // Cached per 5 minutes: smooth enough for the play animation, cheap enough to recompute.
  const key = Math.round((hc * 60) / 5) * 5;
  if (key % 60 === 0) return scenario.frames[key / 60]?.footprint ?? [];
  let cache = footprintCache.get(scenario);
  if (!cache) {
    cache = new Map();
    footprintCache.set(scenario, cache);
  }
  const hit = cache.get(key);
  if (hit) return hit;
  const rings = footprintRings(chainsAt(scenario, scenario.startMs + (key / 60) * HOUR_MS).map((c) => c.circles));
  if (cache.size > 96) cache.clear();
  cache.set(key, rings);
  return rings;
}

/** Places whose first arrival is at or before `timeMs`. */
export function arrivalsBy(scenario: EruptionScenario, timeMs: number): PlaceArrival[] {
  const h = scenarioHourAt(scenario, timeMs);
  if (h === null || h < 0) return [];
  return scenario.arrivals.filter((a) => a.hours <= h + 1e-9);
}

// ---------------------------------------------------------------------------
// Plain-language summary

const UPPER: readonly AshLevel[] = ['500', '300'];

/** Direction and place sentence plus the caveats. Plain English, no warnings, never "evacuate". */
export function summariseScenario(s: EruptionScenario): ScenarioSummary {
  const hDir = Math.min(DIRECTION_HOURS, s.hours);
  const byLevel = new Map(s.levels.map((l) => [l.level, l]));
  const upper = UPPER.map((l) => byLevel.get(l)).filter((l): l is LevelStats => Boolean(l));
  const moving = upper.filter((l) => l.heading);
  let core: string;
  let directionWords: string | null = null;
  const band = `about ${levelInfo('500').label.replace(/^~/, '').replace(/ km$/, '')}–${levelInfo('300').label.replace(/^~/, '')}`;
  if (moving.length === 0) {
    core = `ash at ${band} would stay close to the summit at first (light winds aloft)`;
  } else if (moving.length === 2 && angleDiff(moving[0].heading!.bearingDeg, moving[1].heading!.bearingDeg) > 90) {
    core = `ash at ${levelWords(moving[0].level)} would drift ${moving[0].heading!.words} and ash at ${levelWords(moving[1].level)} ${moving[1].heading!.words}`;
  } else {
    // Combined heading of the upper column: sum of the front offsets after hDir hours.
    let ee = 0;
    let nn = 0;
    for (const l of moving) {
      const tick = l.frontPath[hDir];
      if (!tick) continue;
      const o = offsetKm(s.vent, tick);
      ee += o.e;
      nn += o.n;
    }
    const hd = heading((deg(Math.atan2(ee, nn)) + 360) % 360);
    directionWords = hd.words;
    const later = moving.map((l) => l.laterHeading).filter((x): x is Heading => x !== null);
    let turn = '';
    if (later.length === moving.length && later.length > 0) {
      let le = 0;
      let ln = 0;
      for (const x of later) {
        le += Math.sin(rad(x.bearingDeg));
        ln += Math.cos(rad(x.bearingDeg));
      }
      const lh = heading((deg(Math.atan2(le, ln)) + 360) % 360);
      if (angleDiff(lh.bearingDeg, hd.bearingDeg) > 45) turn = `, then turn ${lh.words}`;
    }
    core = `ash at ${band} would drift ${hd.words}${turn}`;
  }
  const direction = `If ${s.name} erupted now, ${core}`;
  const directionShort = `${core.charAt(0).toUpperCase()}${core.slice(1)}`;

  const nearest = s.arrivals.slice(0, 3);
  let places: string;
  if (nearest.length === 0) {
    places = `no listed town falls inside the modelled ash area within ${s.hours} h (a scenario, not an all-clear)`;
  } else {
    const first = nearest[0];
    places = `modelled to pass near ${first.place.name} ${hoursPhrase(first.hours)} (ash at ${levelWords(first.level)})`;
  }
  const sentence = `${direction}; ${places}.`;

  const when = `${s.startISO.slice(11, 16)} UTC on ${s.startISO.slice(0, 10)}`;
  const caveats = [
    `A MODELLED SCENARIO, not a prediction: it shows where ash could go if an eruption started at ${when}. It says nothing about whether or when an eruption will happen.`,
    'Not a dispersion model: ash moves with the forecast wind above the summit (Open-Meteo; 700, 500 and 300 hPa) and widens at a fixed illustrative rate. The real wind along the path, and where ash falls to the ground, can differ.',
    `The eruption is assumed: continuous ash for ${s.emissionHours} h at about 3, 5.5 and 9 km. A real plume depends on the eruption's size, height and length.`,
    'Not a VAAC advisory: VAAC Darwin issues the official advisories for ash in the air over Indonesia.',
    "The official volcano level comes from PVMBG (MAGMA Indonesia); follow their information and local authorities' instructions.",
  ];
  if (s.startShifted) {
    caveats.push(
      `The wind data available start the scenario at ${s.startISO.slice(0, 16).replace('T', ' ')} UTC rather than the requested ${s.requestedStartISO.slice(0, 16).replace('T', ' ')} UTC.`,
    );
  }
  return { label: SCENARIO_LABEL, direction, directionShort, places, sentence, directionWords, nearest, caveats };
}
