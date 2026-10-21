// Modelled PM2.5 over the haze region: CAMS global atmospheric composition forecast via the Open-Meteo
// Air Quality API (CC BY 4.0). MODELLED context, never evidence, never an official advisory, never NEA PSI.
// One multi-location request: the 1° wind grid (WIND_GRID_SPEC, 390 points, row-major lat outer) followed
// by AQ_PLACES. Verified live 2026-10-14 07:10 UTC: HTTP 200, CORS *, ~1 MB, ~1.8 s, hourly pm2_5 in
// "μg/m³", no nulls. past_days=1 and forecast_days=3 so the scrubber's now −24 h … +48 h is always covered.
// loadAirQuality(): memory cache → localStorage cache → live (through the same-origin relay
// /api/open-meteo?feed=aq, src/lib/openMeteoRelay.ts) → stale cache → bundled snapshot
// data/aq-snapshot.json (dataMode "historical", stored every 3 h). Never throws.
import { fetchOpenMeteoRelay, OpenMeteoRelayError } from './openMeteoRelay';
import { gridAxes, sampleRegular, timeWeights } from './windField';

export const AQ_API_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const AQ_SOURCE = 'Open-Meteo Air Quality API';
export const AQ_SOURCE_URL = 'https://open-meteo.com/en/docs/air-quality-api';
export const AQ_MODEL = 'CAMS global atmospheric composition forecast (Copernicus, about 45 km)';
export const AQ_ATTRIBUTION =
  'Air quality: Open-Meteo.com (CC BY 4.0), CAMS global forecast (Copernicus Atmosphere Monitoring Service).';
export const AQ_UNIT = 'µg/m³';
export const AQ_PAST_DAYS = 1;
export const AQ_FORECAST_DAYS = 3;
export const AQ_CACHE_TTL_MS = 30 * 60 * 1000;
/** A stored live response older than this is not used as a fallback. */
export const AQ_STALE_MAX_MS = 6 * 60 * 60 * 1000;
export const AQ_BACKOFF_MS = 5 * 60 * 1000;
/** Client timeout for the relay: above a cold relay's upstream fetch of the grid and places. */
export const AQ_RELAY_TIMEOUT_MS = 15000;
export const AQ_CACHE_KEY = 'asean-watch:aq:v1';
/** Scrubber window around "now" and its step. */
export const SCRUB_PAST_H = 24;
export const SCRUB_FUTURE_H = 48;
export const SCRUB_STEP_H = 3;

export const PM25_BANDS_TITLE = 'PM2.5 µg/m³';
export const PM25_BANDS_NOTE =
  'US EPA-style PM2.5 concentration bands applied to MODELLED CAMS values (24-hour breakpoints used on hourly model values). ' +
  'Not NEA PSI, not an official AQI or advisory.';

export interface Pm25Band {
  key: 'good' | 'moderate' | 'usg' | 'unhealthy' | 'very-unhealthy' | 'hazardous';
  label: string;
  /** Inclusive lower bound, µg/m³. */
  min: number;
  /** Exclusive upper bound, µg/m³ (Infinity for the last band). */
  max: number;
  /** Marker colour: a desaturated EPA-like hue (green, yellow, orange, red, purple, maroon). */
  color: string;
}

export const PM25_BANDS: readonly Pm25Band[] = [
  { key: 'good', label: 'Good', min: 0, max: 15, color: '#62b77a' },
  { key: 'moderate', label: 'Moderate', min: 15, max: 35, color: '#e3c95a' },
  { key: 'usg', label: 'Unhealthy for sensitive groups', min: 35, max: 55, color: '#e99a54' },
  { key: 'unhealthy', label: 'Unhealthy', min: 55, max: 150, color: '#dc6262' },
  { key: 'very-unhealthy', label: 'Very unhealthy', min: 150, max: 250, color: '#a774c4' },
  { key: 'hazardous', label: 'Hazardous', min: 250, max: Number.POSITIVE_INFINITY, color: '#9c4a72' },
];

/** Band for a PM2.5 value (negative or non-finite values have no band). */
export function pm25Band(value: number): Pm25Band | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return PM25_BANDS.find((b) => value >= b.min && value < b.max) ?? null;
}

/**
 * WHO global air quality guidelines (2021): PM2.5 24-hour AQG level 15 µg/m³ (99th percentile; annual 5 µg/m³).
 * Verified live 2026-10-14 in WHO's "Compendium of WHO and other UN guidance on health and environment, 2024
 * update", chapter 2 (Air pollution), table of AQG levels and interim targets:
 * https://cdn.who.int/media/docs/default-source/who-compendium-on-health-and-environment/who_compendium_chapter2.pdf?sfvrsn=14f84896_8
 * (publication page: https://www.who.int/publications/i/item/9789240034228).
 */
export const WHO_PM25_24H_UGM3 = 15;

/** What PM2.5 is, in one plain sentence. No health advice of our own. */
export const PM25_MEANING = 'Fine smoke and dust, small enough to reach deep into the lungs.';

/** The unit in plain words, for the big number. */
export const PM25_UNIT_WORDS = 'µg/m³ of PM2.5';

export interface Pm25Description {
  band: Pm25Band | null;
  /** value / WHO 24-hour guideline, rounded (1 decimal under 10, whole above); null for a non-finite value. */
  timesWho: number | null;
  /** "2,116" */
  valueText: string;
  /** Meaning sentence plus the WHO scale comparison. */
  sentence: string;
  /** Just the WHO comparison, e.g. "About 141× the WHO 24-hour guideline (15 µg/m³)." */
  scale: string;
}

const groupInt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Plain-language reading of a MODELLED PM2.5 value: band, scale against the WHO 24-hour guideline, sentence. */
export function describePm25(value: number): Pm25Description {
  const band = pm25Band(value);
  if (!Number.isFinite(value) || value < 0) {
    return { band: null, timesWho: null, valueText: '—', sentence: PM25_MEANING, scale: '' };
  }
  const ratio = value / WHO_PM25_24H_UGM3;
  const timesWho = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  const guide = `the WHO 24-hour guideline (${WHO_PM25_24H_UGM3} µg/m³)`;
  let scale: string;
  if (ratio < 0.95) scale = `Under ${guide}.`;
  else if (ratio < 1.05) scale = `About the same as ${guide}.`;
  else scale = `About ${timesWho.toLocaleString('en-US')}× ${guide}.`;
  return { band, timesWho, valueText: groupInt(value), sentence: `${PM25_MEANING} ${scale}`, scale };
}

/** What the band means for a reader, in plain words (lower case, after "the air is forecast to be"). */
const BAND_WORDS: Record<Pm25Band['key'], string> = {
  good: 'fairly clean',
  moderate: 'a little smoky',
  usg: 'smoky enough to bother sensitive people (children, older people, anyone with asthma)',
  unhealthy: 'unhealthy for everyone',
  'very-unhealthy': 'very unhealthy for everyone',
  hazardous: 'hazardous for everyone',
};

/** What "µg/m³" means, in one plain line. */
export const UGM3_WORDS = 'µg/m³ means micrograms of smoke in each cubic metre of air.';

/**
 * A PM2.5 value in plain words: how smoky (`band`, e.g. "hazardous for everyone") and how it compares with
 * the WHO's daily guideline (`scale`, e.g. "about 119 times the WHO's daily guideline of 15 µg/m³").
 * Null for a value with no band. No health advice of our own.
 */
export function plainAirWords(value: number): { band: string; scale: string; valueText: string } | null {
  const d = describePm25(value);
  if (!d.band || d.timesWho === null) return null;
  const who = WHO_PM25_24H_UGM3;
  const scale =
    value < who * 0.95
      ? `under the WHO's daily guideline of ${who} µg/m³`
      : value < who * 1.05
        ? `about the WHO's daily guideline of ${who} µg/m³`
        : `about ${d.timesWho.toLocaleString('en-US')} times the WHO's daily guideline of ${who} µg/m³`;
  return { band: BAND_WORDS[d.band.key], scale, valueText: d.valueText };
}

/**
 * The first sentence of a city card, in plain words: how smoky the air is forecast to be and how far over
 * the WHO's daily guideline. Says it is a forecast; gives no health advice of our own.
 */
export function plainAirSentence(name: string, value: number): string {
  const w = plainAirWords(value);
  if (!w) return `No forecast value for ${name} at this hour.`;
  return `The air around ${name} is forecast to be ${w.band}: ${w.valueText} µg/m³ of fine smoke, ${w.scale}.`;
}

/** "PM2.5 23 µg/m³ (modelled)". */
export function pm25Label(value: number): string {
  return `PM2.5 ${Math.round(value)} ${AQ_UNIT} (modelled)`;
}

export interface AqPlace {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** 'fire-area': a town in a peatland fire-prone district, shown for context. */
  kind: 'city' | 'fire-area';
}

/**
 * City centres verified 2026-10-14 against the Open-Meteo geocoding API (GeoNames). Fire areas are the
 * main towns of districts with recurrent peatland fires; the value is CAMS at that point, not a fire report.
 */
export const AQ_PLACES: readonly AqPlace[] = [
  { id: 'singapore', name: 'Singapore', country: 'SG', lat: 1.3521, lon: 103.8198, kind: 'city' },
  { id: 'kuala-lumpur', name: 'Kuala Lumpur', country: 'MY', lat: 3.1412, lon: 101.6865, kind: 'city' },
  { id: 'ipoh', name: 'Ipoh', country: 'MY', lat: 4.5841, lon: 101.0829, kind: 'city' },
  { id: 'george-town', name: 'George Town', country: 'MY', lat: 5.4112, lon: 100.3354, kind: 'city' },
  { id: 'kuching', name: 'Kuching', country: 'MY', lat: 1.55, lon: 110.3333, kind: 'city' },
  { id: 'pekanbaru', name: 'Pekanbaru', country: 'ID', lat: 0.5167, lon: 101.4417, kind: 'city' },
  { id: 'jambi', name: 'Jambi', country: 'ID', lat: -1.6, lon: 103.6167, kind: 'city' },
  { id: 'palembang', name: 'Palembang', country: 'ID', lat: -2.9167, lon: 104.7458, kind: 'city' },
  { id: 'pontianak', name: 'Pontianak', country: 'ID', lat: -0.0319, lon: 109.325, kind: 'city' },
  { id: 'palangka-raya', name: 'Palangka Raya', country: 'ID', lat: -2.2083, lon: 113.9167, kind: 'city' },
  { id: 'medan', name: 'Medan', country: 'ID', lat: 3.5833, lon: 98.6667, kind: 'city' },
  { id: 'jakarta', name: 'Jakarta', country: 'ID', lat: -6.2146, lon: 106.8451, kind: 'city' },
  { id: 'bangkok', name: 'Bangkok', country: 'TH', lat: 13.754, lon: 100.5014, kind: 'city' },
  { id: 'chiang-mai', name: 'Chiang Mai', country: 'TH', lat: 18.7904, lon: 98.9847, kind: 'city' },
  { id: 'hat-yai', name: 'Hat Yai', country: 'TH', lat: 7.0084, lon: 100.4767, kind: 'city' },
  { id: 'hanoi', name: 'Hanoi', country: 'VN', lat: 21.0245, lon: 105.8412, kind: 'city' },
  { id: 'phnom-penh', name: 'Phnom Penh', country: 'KH', lat: 11.5625, lon: 104.916, kind: 'city' },
  { id: 'manila', name: 'Manila', country: 'PH', lat: 14.6042, lon: 120.9822, kind: 'city' },
  { id: 'cebu', name: 'Cebu', country: 'PH', lat: 10.3167, lon: 123.8907, kind: 'city' },
  // Capitals added 2026-10-20 so every ASEAN member has at least one point; verified the same way.
  { id: 'ho-chi-minh-city', name: 'Ho Chi Minh City', country: 'VN', lat: 10.823, lon: 106.6297, kind: 'city' },
  { id: 'bandar-seri-begawan', name: 'Bandar Seri Begawan', country: 'BN', lat: 4.8904, lon: 114.9401, kind: 'city' },
  { id: 'vientiane', name: 'Vientiane', country: 'LA', lat: 17.9667, lon: 102.6, kind: 'city' },
  { id: 'yangon', name: 'Yangon', country: 'MM', lat: 16.8053, lon: 96.1561, kind: 'city' },
  { id: 'naypyidaw', name: 'Naypyidaw', country: 'MM', lat: 19.7366, lon: 96.2072, kind: 'city' },
  { id: 'dili', name: 'Dili', country: 'TL', lat: -8.5586, lon: 125.5736, kind: 'city' },
  { id: 'dumai', name: 'Dumai (Riau peatlands)', country: 'ID', lat: 1.6671, lon: 101.4432, kind: 'fire-area' },
  { id: 'kayu-agung', name: 'Kayu Agung (Ogan Komering Ilir)', country: 'ID', lat: -3.392, lon: 104.8306, kind: 'fire-area' },
  { id: 'ketapang', name: 'Ketapang (West Kalimantan)', country: 'ID', lat: -1.8386, lon: 109.9773, kind: 'fire-area' },
  { id: 'pulang-pisau', name: 'Pulang Pisau (Central Kalimantan)', country: 'ID', lat: -2.7671, lon: 114.2406, kind: 'fire-area' },
];

export interface AqPlaceSeries extends AqPlace {
  /** PM2.5 µg/m³ per `times` entry. */
  pm25: number[];
}

export interface AirQualityData {
  /** Ascending latitudes (the 1° wind grid). */
  lats: number[];
  /** Ascending longitudes. */
  lons: number[];
  /** Ascending ISO 8601 UTC times ("...Z"); hourly live, 3-hourly in the snapshot. */
  times: string[];
  /** PM2.5 µg/m³ indexed [t][j = lat][i = lon]. */
  pm25: number[][][];
  places: AqPlaceSeries[];
  source: string;
  sourceUrl: string;
  model: string;
  unit: string;
  /** ISO 8601 UTC time it was fetched (live) or captured (snapshot). */
  retrievedAt: string;
  dataMode: 'live' | 'historical';
  attribution: string;
}

export interface AqLoadResult {
  data: AirQualityData | null;
  status: 'live' | 'cached' | 'snapshot' | 'unavailable';
  message: string | null;
}

/** The one multi-location request: grid points (lat outer, lon inner), then the places. */
export function buildAqUrl(
  axes: { lats: readonly number[]; lons: readonly number[] } = gridAxes(),
  places: readonly AqPlace[] = AQ_PLACES,
): string {
  const la: number[] = [];
  const lo: number[] = [];
  for (const lat of axes.lats) for (const lon of axes.lons) {
    la.push(lat);
    lo.push(lon);
  }
  for (const p of places) {
    la.push(p.lat);
    lo.push(p.lon);
  }
  return (
    `${AQ_API_URL}?latitude=${la.join(',')}&longitude=${lo.join(',')}` +
    `&hourly=pm2_5&past_days=${AQ_PAST_DAYS}&forecast_days=${AQ_FORECAST_DAYS}&timezone=GMT`
  );
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function toUtc(t: unknown): string | null {
  if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z?$/.test(t)) return null;
  const iso = t.endsWith('Z') ? t : `${t}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.000Z$/, 'Z') : null;
}

/** Open-Meteo writes "μg/m³" with the Greek mu (U+03BC); accept the micro sign (U+00B5) too. */
function isMicrogramUnit(u: unknown): boolean {
  return typeof u === 'string' && /^[µμ]g\/m(³|3)$/.test(u.trim());
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Normalise an Open-Meteo multi-location air-quality response (one entry per requested point, in
 * request order: grid then places) to AirQualityData. Hours where any location lacks a value are
 * dropped (CAMS can end a few hours early); any structural or unit problem returns null.
 */
export function normaliseOpenMeteoAq(
  json: unknown,
  axes: { lats: readonly number[]; lons: readonly number[] },
  places: readonly AqPlace[],
  retrievedAt: string,
  dataMode: AirQualityData['dataMode'] = 'live',
): AirQualityData | null {
  const list = Array.isArray(json) ? json : [json];
  const nLat = axes.lats.length;
  const nLon = axes.lons.length;
  const nGrid = nLat * nLon;
  if (list.length !== nGrid + places.length || list.length === 0) return null;
  const first = list[0];
  if (!isRecord(first) || !isRecord(first.hourly) || !Array.isArray(first.hourly.time)) return null;
  const allTimes = first.hourly.time.map(toUtc);
  if (allTimes.length === 0 || allTimes.some((t) => t === null)) return null;
  const nT = allTimes.length;
  const series: number[][] = [];
  for (const e of list) {
    if (!isRecord(e) || !isRecord(e.hourly)) return null;
    const pm = e.hourly.pm2_5;
    const tt = e.hourly.time;
    if (!Array.isArray(pm) || !Array.isArray(tt) || pm.length !== nT || tt.length !== nT) return null;
    if (isRecord(e.hourly_units) && e.hourly_units.pm2_5 !== undefined && !isMicrogramUnit(e.hourly_units.pm2_5)) return null;
    series.push(pm.map((x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : Number.NaN)));
  }
  const keep: number[] = [];
  for (let t = 0; t < nT; t += 1) if (series.every((s) => !Number.isNaN(s[t]))) keep.push(t);
  if (keep.length < 2) return null;
  const pm25 = keep.map((t) =>
    Array.from({ length: nLat }, (_, j) => Array.from({ length: nLon }, (_, i) => round1(series[j * nLon + i][t]))),
  );
  return {
    lats: [...axes.lats],
    lons: [...axes.lons],
    times: keep.map((t) => allTimes[t] as string),
    pm25,
    places: places.map((p, k) => ({ ...p, pm25: keep.map((t) => round1(series[nGrid + k][t])) })),
    source: AQ_SOURCE,
    sourceUrl: AQ_SOURCE_URL,
    model: AQ_MODEL,
    unit: AQ_UNIT,
    retrievedAt,
    dataMode,
    attribution: AQ_ATTRIBUTION,
  };
}

const isFiniteNonNeg = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Validate a stored dataset (bundled snapshot or localStorage). Returns null when malformed. */
export function parseAirQuality(raw: unknown, dataMode: AirQualityData['dataMode']): AirQualityData | null {
  if (!isRecord(raw)) return null;
  const { lats, lons, times, pm25, places } = raw;
  if (!Array.isArray(lats) || !Array.isArray(lons) || !Array.isArray(times) || !Array.isArray(pm25) || !Array.isArray(places)) return null;
  if (lats.length < 2 || lons.length < 2 || times.length < 2) return null;
  if (!lats.every((n) => typeof n === 'number') || !lons.every((n) => typeof n === 'number')) return null;
  if (!times.every((t) => typeof t === 'string' && toUtc(t) === t)) return null;
  const nT = times.length;
  if (
    pm25.length !== nT ||
    !pm25.every(
      (row) =>
        Array.isArray(row) &&
        row.length === lats.length &&
        row.every((r) => Array.isArray(r) && r.length === lons.length && r.every(isFiniteNonNeg)),
    )
  )
    return null;
  const outPlaces: AqPlaceSeries[] = [];
  for (const p of places) {
    if (!isRecord(p)) return null;
    const { id, name, country, lat, lon, kind } = p;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof country !== 'string') return null;
    if (typeof lat !== 'number' || typeof lon !== 'number' || (kind !== 'city' && kind !== 'fire-area')) return null;
    if (!Array.isArray(p.pm25) || p.pm25.length !== nT || !p.pm25.every(isFiniteNonNeg)) return null;
    outPlaces.push({ id, name, country, lat, lon, kind, pm25: p.pm25 as number[] });
  }
  if (typeof raw.retrievedAt !== 'string' || toUtc(raw.retrievedAt) === null) return null;
  const str = (x: unknown, d: string) => (typeof x === 'string' && x ? x : d);
  return {
    lats: lats as number[],
    lons: lons as number[],
    times: times as string[],
    pm25: pm25 as number[][][],
    places: outPlaces,
    source: str(raw.source, AQ_SOURCE),
    sourceUrl: str(raw.sourceUrl, AQ_SOURCE_URL),
    model: str(raw.model, AQ_MODEL),
    unit: AQ_UNIT,
    retrievedAt: raw.retrievedAt,
    dataMode,
    attribution: str(raw.attribution, AQ_ATTRIBUTION),
  };
}

// The bundled snapshot is a fallback only, so it is its own same-origin chunk (content-hashed, works
// offline once the app is loaded), fetched in parallel with the live request by loadAirQuality.
let snapshotChunkP: Promise<unknown> | null = null;
function snapshotChunk(): Promise<unknown> {
  snapshotChunkP ??= import('../../data/aq-snapshot.json').then(
    (m) => m.default as unknown,
    (err: unknown) => {
      snapshotChunkP = null; // a failed chunk load can be retried
      throw err;
    },
  );
  return snapshotChunkP;
}

/** The bundled HISTORICAL air-quality run, or null when it is missing, malformed or cannot be loaded. */
export async function loadAqSnapshot(): Promise<AirQualityData | null> {
  try {
    return parseAirQuality(await snapshotChunk(), 'historical');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sampling

/** The PM2.5 grid at one time (linear in time, clamped to the data range), row-major [j * nLon + i]. */
export function pm25Slice(data: AirQualityData, timeISO: string): Float32Array {
  const nLat = data.lats.length;
  const nLon = data.lons.length;
  const { a, b, f } = timeWeights(
    data.times.map((t) => Date.parse(t)),
    Date.parse(timeISO),
  );
  const out = new Float32Array(nLat * nLon);
  for (let j = 0; j < nLat; j += 1)
    for (let i = 0; i < nLon; i += 1) out[j * nLon + i] = data.pm25[a][j][i] * (1 - f) + data.pm25[b][j][i] * f;
  return out;
}

/** Bilinear PM2.5 on the grid at a point and time; NaN outside the grid. */
export function pm25At(data: AirQualityData, lat: number, lon: number, timeISO: string): number {
  return sampleRegular(pm25Slice(data, timeISO), data.lats, data.lons, lat, lon);
}

/** A place's PM2.5 at a time (linear between stored hours, clamped to the data range). */
export function placePm25At(data: AirQualityData, place: AqPlaceSeries, timeISO: string): number {
  const { a, b, f } = timeWeights(
    data.times.map((t) => Date.parse(t)),
    Date.parse(timeISO),
  );
  return place.pm25[a] * (1 - f) + place.pm25[b] * f;
}

const HOUR_MS = 3_600_000;
const isoZ = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');

/** The scrubber's "now": the wall clock for live data, the capture time for a snapshot. */
export function forecastAnchorMs(data: Pick<AirQualityData, 'dataMode' | 'retrievedAt'> | null, nowMs: number): number {
  if (data && data.dataMode === 'historical') {
    const ms = Date.parse(data.retrievedAt);
    if (Number.isFinite(ms)) return ms;
  }
  return nowMs;
}

export interface ForecastSteps {
  /** ISO 8601 UTC step times, every SCRUB_STEP_H hours on UTC hours divisible by the step. */
  times: string[];
  /** Index of the step at (the floor of) the anchor. */
  nowIndex: number;
  /** Hours from the anchor step, per step (e.g. -24 … 48). */
  offsetsH: number[];
}

/**
 * 3-hourly steps from anchor −24 h to anchor +48 h (anchor floored to the step), clipped to
 * [dataStart, dataEnd] when given. Always returns at least the anchor step.
 */
export function forecastSteps(anchorMs: number, range?: { startMs: number; endMs: number } | null): ForecastSteps {
  const stepMs = SCRUB_STEP_H * HOUR_MS;
  const anchor = Math.floor(anchorMs / stepMs) * stepMs;
  const times: string[] = [];
  const offsetsH: number[] = [];
  let nowIndex = 0;
  for (let h = -SCRUB_PAST_H; h <= SCRUB_FUTURE_H; h += SCRUB_STEP_H) {
    const ms = anchor + h * HOUR_MS;
    if (range && h !== 0 && (ms < range.startMs || ms > range.endMs)) continue;
    if (h === 0) nowIndex = times.length;
    times.push(isoZ(ms));
    offsetsH.push(h);
  }
  return { times, nowIndex, offsetsH };
}

/** Data range for forecastSteps. */
export function aqRange(data: AirQualityData | null): { startMs: number; endMs: number } | null {
  if (!data || data.times.length === 0) return null;
  return { startMs: Date.parse(data.times[0]), endMs: Date.parse(data.times[data.times.length - 1]) };
}

// ---------------------------------------------------------------------------
// Loading: memory cache, localStorage cache, live, stale cache, snapshot

let inflight: Promise<AqLoadResult> | null = null;
let memoryCache: { data: AirQualityData; at: number } | null = null;
let backoffUntil = 0;

export function resetAqCache(opts?: { keepStorage?: boolean }): void {
  inflight = null;
  memoryCache = null;
  backoffUntil = 0;
  if (!opts?.keepStorage) {
    try {
      globalThis.localStorage?.removeItem(AQ_CACHE_KEY);
    } catch {
      /* storage blocked */
    }
  }
}

/** True when a dataset carries exactly the current AQ_PLACES, in order. */
export function samePlaces(data: Pick<AirQualityData, 'places'>): boolean {
  return data.places.length === AQ_PLACES.length && data.places.every((p, i) => p.id === AQ_PLACES[i].id);
}

function readStored(now: number, maxAgeMs: number): { data: AirQualityData; at: number } | null {
  try {
    const raw = globalThis.localStorage?.getItem(AQ_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.at !== 'number' || now - parsed.at > maxAgeMs || parsed.at > now + 60_000) return null;
    const data = parseAirQuality(parsed.data, 'live');
    // A run saved before AQ_PLACES changed lacks the new places: ignore it, so the next load fetches them.
    return data && samePlaces(data) ? { data, at: parsed.at } : null;
  } catch {
    return null;
  }
}

function writeStored(data: AirQualityData, at: number): void {
  try {
    globalThis.localStorage?.setItem(AQ_CACHE_KEY, JSON.stringify({ at, data }));
  } catch {
    /* quota or blocked: the memory cache still works */
  }
}

async function fallbackResult(message: string, now: number): Promise<AqLoadResult> {
  const stale = readStored(now, AQ_STALE_MAX_MS);
  if (stale) return { data: stale.data, status: 'cached', message: `${message} Showing the model run retrieved ${stale.data.retrievedAt}.` };
  const data = await loadAqSnapshot();
  return data
    ? { data, status: 'snapshot', message: `${message} Showing the bundled air-quality snapshot.` }
    : { data: null, status: 'unavailable', message: `${message} The bundled air-quality snapshot is missing or malformed.` };
}

async function loadLive(timeoutMs: number, fetchImpl: typeof fetch, now: () => number): Promise<AqLoadResult> {
  const axes = gridAxes();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The relay fetches buildAqUrl(gridAxes(), AQ_PLACES) and returns Open-Meteo's answer as received.
    const payload = await fetchOpenMeteoRelay('aq', fetchImpl, controller.signal);
    const data = normaliseOpenMeteoAq(payload.raw, axes, AQ_PLACES, payload.retrievedAt, 'live');
    if (!data) return await fallbackResult('Open-Meteo air-quality response was not in the expected shape.', now());
    // A copy the relay serves because Open-Meteo is failing is shown, but not cached here.
    if (payload.stale) return { data, status: 'cached', message: `Open-Meteo is not answering. Showing the model run retrieved ${payload.retrievedAt}.` };
    memoryCache = { data, at: now() };
    writeStored(data, now());
    return { data, status: 'live', message: null };
  } catch (err) {
    if (err instanceof OpenMeteoRelayError && (err.status === 429 || err.status === 503)) {
      backoffUntil = now() + Math.min(err.retryAfterMs ?? AQ_BACKOFF_MS, AQ_BACKOFF_MS);
      return await fallbackResult(`Open-Meteo air quality is busy (${err.message}).`, now());
    }
    if (err instanceof OpenMeteoRelayError) return await fallbackResult(`The Open-Meteo relay returned HTTP ${err.status}.`, now());
    const why = controller.signal.aborted ? `timed out after ${timeoutMs} ms` : err instanceof Error ? err.message : String(err);
    return await fallbackResult(`Open-Meteo air quality unavailable (${why}).`, now());
  } finally {
    clearTimeout(timer);
  }
}

/** Live modelled PM2.5 (CAMS), else a recent cached run, else the bundled snapshot. Never throws. */
export async function loadAirQuality(opts?: { timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number }): Promise<AqLoadResult> {
  const now = opts?.now ?? Date.now;
  // Start the fallback chunk now, alongside the live request; it is awaited only if needed.
  void snapshotChunk().catch(() => undefined);
  try {
    if (memoryCache && now() - memoryCache.at < AQ_CACHE_TTL_MS) return { data: memoryCache.data, status: 'cached', message: null };
    const fresh = readStored(now(), AQ_CACHE_TTL_MS);
    if (fresh) {
      memoryCache = fresh;
      return { data: fresh.data, status: 'cached', message: null };
    }
    if (now() < backoffUntil) return await fallbackResult('Open-Meteo air-quality rate limit backoff in effect.', now());
    const fetchImpl = opts?.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return await fallbackResult('No fetch available.', now());
    if (!inflight) {
      inflight = loadLive(opts?.timeoutMs ?? AQ_RELAY_TIMEOUT_MS, fetchImpl, now).finally(() => {
        inflight = null;
      });
    }
    return await inflight;
  } catch (err) {
    return await fallbackResult(`Air-quality load failed (${err instanceof Error ? err.message : String(err)}).`, Date.now());
  }
}

export interface WorstPlaceStep {
  timeISO: string;
  place: AqPlaceSeries;
  /** Highest MODELLED PM2.5 among the places at that time, µg/m³. */
  pm25: number;
}

/** For each step time, the place with the highest modelled PM2.5 (first in AQ_PLACES order on ties). */
export function worstPlaceByStep(data: AirQualityData | null, times: readonly string[]): WorstPlaceStep[] {
  if (!data || data.places.length === 0) return [];
  return times.map((timeISO) => {
    let place = data.places[0];
    let pm25 = placePm25At(data, place, timeISO);
    for (const p of data.places.slice(1)) {
      const v = placePm25At(data, p, timeISO);
      if (v > pm25) {
        pm25 = v;
        place = p;
      }
    }
    return { timeISO, place, pm25 };
  });
}
