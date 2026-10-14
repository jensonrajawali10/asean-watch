// Illustrative ash drift from a volcano summit at three heights, from MODELLED Open-Meteo pressure-level
// winds (CC BY 4.0). Context only: not an ash advisory, not a dispersion model, not a hazard zone. The
// official sources are PVMBG (MAGMA Indonesia) for the volcano and VAAC Darwin for ash in the air.
//
// Levels: 700 hPa (~3 km, summit level), 500 hPa (~5.5 km, mid column), 300 hPa (~9 km, tall column).
// Variables verified 2026-10-14: wind_speed_{700,500,300}hPa and wind_direction_{700,500,300}hPa (FROM, °), m/s.
//
// Simplification (stated in the map caption): the drift uses the time-varying forecast wind AT THE
// SUMMIT for the whole path, i.e. it does not sample the wind where the ash has moved to. Forward steps of
// 30 minutes for 24 hours, wind interpolated linearly in time (u and v), ticks at 3, 6, 12 and 24 h.
//
// loadAshWind(): live Open-Meteo first (timeout, in-flight dedupe, memory cache, 429 backoff), then the
// bundled snapshot data/ash-wind-snapshot.json (dataMode "historical"). Never throws.
import snapshotJson from '../../data/ash-wind-snapshot.json';
import { OPEN_METEO_FORECAST_URL, windFromToUV } from './windField';

export type AshLevel = '700' | '500' | '300';

export const ASH_LEVELS: ReadonlyArray<{ key: AshLevel; hPa: string; label: string; role: string }> = [
  { key: '700', hPa: '700 hPa', label: '~3 km', role: 'summit level' },
  { key: '500', hPa: '500 hPa', label: '~5.5 km', role: 'mid column' },
  { key: '300', hPa: '300 hPa', label: '~9 km', role: 'tall column' },
];

export const DRIFT_STEP_MIN = 30;
export const DRIFT_HOURS = 24;
export const DRIFT_TICK_HOURS: readonly number[] = [3, 6, 12, 24];
export const ASH_WIND_ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0), pressure-level winds, best-match global weather model.';
export const ASH_CACHE_TTL_MS = 30 * 60 * 1000;
export const ASH_BACKOFF_MS = 5 * 60 * 1000;

export interface AshWindSeries {
  /** Smithsonian GVP id, e.g. "gvp-263250" (matches Incident.volcanoId). */
  volcanoId: string;
  name: string;
  /** GVP summit point. */
  lat: number;
  lon: number;
  /** Ascending ISO 8601 UTC hours. */
  times: string[];
  /** Per level: speed (m/s) and FROM direction (degrees), one per time. */
  wind: Record<AshLevel, { speed: number[]; dir: number[] }>;
}

export interface AshWindData {
  volcanoes: AshWindSeries[];
  source: string;
  sourceUrl: string;
  retrievedAt: string;
  dataMode: 'live' | 'historical';
  attribution: string;
}

export interface AshWindLoadResult {
  data: AshWindData | null;
  status: 'live' | 'cached' | 'snapshot' | 'unavailable';
  message: string | null;
}

export interface DriftPoint {
  lat: number;
  lon: number;
  /** ISO 8601 UTC. */
  time: string;
}

export interface DriftTrack {
  level: AshLevel;
  label: string;
  /** From the summit, one point per 30-minute step (fewer if the forecast ends first). */
  points: DriftPoint[];
  /** Points at 3, 6, 12 and 24 h after the start (only those the track reaches). */
  ticks: (DriftPoint & { hour: number })[];
  /** Straight-line distance (km) and initial bearing (degrees) from the summit to the last point. */
  distanceKm: number;
  bearingDeg: number | null;
}

// ---------------------------------------------------------------------------
// Pure maths

const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (degrees clockwise from north) from point 1 to point 2. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function destination(lat: number, lon: number, bearing: number, km: number): { lat: number; lon: number } {
  const d = km / R_KM;
  const b = rad(bearing);
  const p1 = rad(lat);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: ((deg(l2) + 540) % 360) - 180 };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass16(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * Wind (u east, v north, m/s) at the summit at `ms`, interpolating u and v linearly between forecast hours.
 * Null outside the forecast range or when a value is missing (never extrapolated).
 */
export function windAt(series: AshWindSeries, level: AshLevel, ms: number): { u: number; v: number } | null {
  const t = series.times.map((x) => Date.parse(x));
  const w = series.wind[level];
  if (!w || t.length === 0 || !Number.isFinite(ms) || ms < t[0] || ms > t[t.length - 1]) return null;
  let i = 0;
  while (i < t.length - 1 && t[i + 1] <= ms) i++;
  const uv = (k: number) => (Number.isFinite(w.speed[k]) && Number.isFinite(w.dir[k]) ? windFromToUV(w.dir[k], w.speed[k]) : null);
  const a = uv(i);
  if (!a) return null;
  if (i === t.length - 1 || ms === t[i]) return a;
  const b = uv(i + 1);
  if (!b) return null;
  const f = (ms - t[i]) / (t[i + 1] - t[i]);
  return { u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f };
}

/**
 * Start of the drift: the forecast hour at or before `nowMs`, kept inside the series so a full 24 h fits
 * when it can (a stale snapshot starts at the latest hour that still leaves 24 h, or its first hour).
 */
export function driftStartTime(series: AshWindSeries, nowMs: number): string | null {
  const t = series.times.map((x) => Date.parse(x)).filter(Number.isFinite);
  if (t.length === 0) return null;
  const hour = Math.floor(nowMs / 3600000) * 3600000;
  const latestFull = t[t.length - 1] - DRIFT_HOURS * 3600000;
  const start = Math.max(t[0], Math.min(hour, latestFull));
  return toIso(start);
}

/** Forward drift from the summit using the summit's time-varying wind (midpoint in time per step). */
export function driftTrack(series: AshWindSeries, level: AshLevel, startISO: string): DriftTrack {
  const label = ASH_LEVELS.find((l) => l.key === level)?.label ?? level;
  const start = Date.parse(startISO);
  const points: DriftPoint[] = [{ lat: series.lat, lon: series.lon, time: toIso(start) }];
  const ticks: DriftTrack['ticks'] = [];
  const stepMs = DRIFT_STEP_MIN * 60000;
  const steps = (DRIFT_HOURS * 60) / DRIFT_STEP_MIN;
  let { lat, lon } = points[0];
  for (let k = 1; k <= steps && Number.isFinite(start); k++) {
    const mid = start + (k - 0.5) * stepMs;
    const w = windAt(series, level, mid);
    if (!w) break;
    const speed = Math.hypot(w.u, w.v);
    if (speed > 0) ({ lat, lon } = destination(lat, lon, (deg(Math.atan2(w.u, w.v)) + 360) % 360, (speed * stepMs) / 1000 / 1000));
    const p = { lat, lon, time: toIso(start + k * stepMs) };
    points.push(p);
    const hour = (k * DRIFT_STEP_MIN) / 60;
    if (DRIFT_TICK_HOURS.includes(hour)) ticks.push({ ...p, hour });
  }
  const last = points[points.length - 1];
  const dist = distanceKm(series.lat, series.lon, last.lat, last.lon);
  return { level, label, points, ticks, distanceKm: dist, bearingDeg: dist > 0.5 ? bearingDeg(series.lat, series.lon, last.lat, last.lon) : null };
}

/** All three tracks for one volcano from `nowMs` (null when the series has no usable time). */
export function ashDriftTracks(series: AshWindSeries, nowMs: number): { startISO: string; tracks: DriftTrack[] } | null {
  const startISO = driftStartTime(series, nowMs);
  if (!startISO) return null;
  return { startISO, tracks: ASH_LEVELS.map((l) => driftTrack(series, l.key, startISO)) };
}

// ---------------------------------------------------------------------------
// Parsing (snapshot and live)

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const LEVEL_KEYS: AshLevel[] = ['700', '500', '300'];

function parseSeries(raw: unknown): AshWindSeries | null {
  if (!isRecord(raw) || typeof raw.volcanoId !== 'string' || typeof raw.name !== 'string') return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  const times = Array.isArray(raw.times) ? raw.times : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !times || times.length < 2 || !times.every((t) => typeof t === 'string' && Number.isFinite(Date.parse(t)))) return null;
  if (!isRecord(raw.wind)) return null;
  const wind = {} as AshWindSeries['wind'];
  for (const l of LEVEL_KEYS) {
    const w = raw.wind[l];
    if (!isRecord(w) || !Array.isArray(w.speed) || !Array.isArray(w.dir) || w.speed.length !== times.length || w.dir.length !== times.length) return null;
    wind[l] = { speed: w.speed.map(Number), dir: w.dir.map(Number) };
  }
  return { volcanoId: raw.volcanoId, name: raw.name, lat, lon, times: times as string[], wind };
}

export function parseAshWindSnapshot(raw: unknown): AshWindData | null {
  if (!isRecord(raw) || !Array.isArray(raw.volcanoes) || typeof raw.retrievedAt !== 'string') return null;
  const volcanoes = raw.volcanoes.map(parseSeries).filter((s): s is AshWindSeries => s !== null);
  if (volcanoes.length === 0) return null;
  return {
    volcanoes,
    source: typeof raw.source === 'string' ? raw.source : 'Open-Meteo',
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : 'https://open-meteo.com/en/docs',
    retrievedAt: raw.retrievedAt,
    dataMode: 'historical',
    attribution: typeof raw.attribution === 'string' ? raw.attribution : ASH_WIND_ATTRIBUTION,
  };
}

export function loadAshWindSnapshot(): AshWindData | null {
  try {
    return parseAshWindSnapshot(snapshotJson as unknown);
  } catch {
    return null;
  }
}

type Point = { volcanoId: string; name: string; lat: number; lon: number };

export function buildAshWindUrl(points: readonly Point[]): string {
  const vars = LEVEL_KEYS.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`]).join(',');
  return (
    `${OPEN_METEO_FORECAST_URL}?latitude=${points.map((p) => p.lat).join(',')}&longitude=${points.map((p) => p.lon).join(',')}` +
    `&hourly=${vars}&wind_speed_unit=ms&forecast_days=3&timezone=GMT`
  );
}

/** Open-Meteo multi-location response -> series per point (null when the shape or units are wrong). */
export function normaliseAshWind(raw: unknown, points: readonly Point[], retrievedAt: string): AshWindData | null {
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length !== points.length) return null;
  const volcanoes: AshWindSeries[] = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!isRecord(e) || !isRecord(e.hourly) || !isRecord(e.hourly_units)) return null;
    const h = e.hourly;
    const units = e.hourly_units;
    if (!Array.isArray(h.time)) return null;
    const times = h.time.map((t) => (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t) ? `${t}:00Z` : null));
    if (times.some((t) => t === null)) return null;
    const wind = {} as AshWindSeries['wind'];
    for (const l of LEVEL_KEYS) {
      const speed = h[`wind_speed_${l}hPa`];
      const dir = h[`wind_direction_${l}hPa`];
      if (units[`wind_speed_${l}hPa`] !== 'm/s' || !Array.isArray(speed) || !Array.isArray(dir) || speed.length !== times.length || dir.length !== times.length) {
        return null;
      }
      wind[l] = { speed: speed.map((x) => (typeof x === 'number' ? x : Number.NaN)), dir: dir.map((x) => (typeof x === 'number' ? x : Number.NaN)) };
    }
    const p = points[i];
    volcanoes.push({ volcanoId: p.volcanoId, name: p.name, lat: p.lat, lon: p.lon, times: times as string[], wind });
  }
  return { volcanoes, source: 'Open-Meteo Forecast API', sourceUrl: 'https://open-meteo.com/en/docs', retrievedAt, dataMode: 'live', attribution: ASH_WIND_ATTRIBUTION };
}

// ---------------------------------------------------------------------------
// Loading: live, then memory cache, then the bundled snapshot. Never throws.

let inflight: Promise<AshWindLoadResult> | null = null;
let memory: { data: AshWindData; at: number } | null = null;
let backoffUntil = 0;

export function resetAshWindCache(): void {
  inflight = null;
  memory = null;
  backoffUntil = 0;
}

function fallback(message: string, now: () => number): AshWindLoadResult {
  // A good live result from this session (even past its TTL) beats the older bundled snapshot.
  if (memory && now() - memory.at < 6 * 60 * 60 * 1000) return { data: memory.data, status: 'cached', message };
  const data = loadAshWindSnapshot();
  return data
    ? { data, status: 'snapshot', message }
    : { data: null, status: 'unavailable', message: `${message} The bundled ash-wind snapshot is missing or malformed.` };
}

async function loadLive(points: readonly Point[], timeoutMs: number, fetchImpl: typeof fetch, now: () => number): Promise<AshWindLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(buildAshWindUrl(points), { signal: controller.signal });
    if (res.status === 429) {
      backoffUntil = now() + ASH_BACKOFF_MS;
      return fallback('Open-Meteo rate limit reached; showing the bundled ash-wind snapshot.', now);
    }
    if (!res.ok) return fallback(`Open-Meteo returned HTTP ${res.status}; showing the bundled ash-wind snapshot.`, now);
    const json: unknown = await res.json();
    const data = normaliseAshWind(json, points, toIso(now()));
    if (!data) return fallback('Open-Meteo response was not in the expected shape; showing the bundled ash-wind snapshot.', now);
    memory = { data, at: now() };
    return { data, status: 'live', message: null };
  } catch (err) {
    const why = controller.signal.aborted ? `timed out after ${timeoutMs} ms` : err instanceof Error ? err.message : String(err);
    return fallback(`Open-Meteo unavailable (${why}); showing the bundled ash-wind snapshot.`, now);
  } finally {
    clearTimeout(timer);
  }
}

/** Live pressure-level winds at the watched volcano summits, else the bundled snapshot. Never throws. */
export async function loadAshWind(opts?: {
  points?: readonly Point[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<AshWindLoadResult> {
  const now = opts?.now ?? Date.now;
  try {
    if (memory && now() - memory.at < ASH_CACHE_TTL_MS) return { data: memory.data, status: 'cached', message: null };
    if (now() < backoffUntil) return fallback('Open-Meteo rate limit backoff in effect; showing the bundled ash-wind snapshot.', now);
    const points = opts?.points ?? (loadAshWindSnapshot()?.volcanoes ?? []).map(({ volcanoId, name, lat, lon }) => ({ volcanoId, name, lat, lon }));
    if (points.length === 0) return fallback('No volcano points to request.', now);
    const fetchImpl = opts?.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return fallback('No fetch available; showing the bundled ash-wind snapshot.', now);
    if (!inflight) {
      inflight = loadLive(points, opts?.timeoutMs ?? 8000, fetchImpl, now).finally(() => {
        inflight = null;
      });
    }
    return await inflight;
  } catch (err) {
    return fallback(`Ash-wind load failed (${err instanceof Error ? err.message : String(err)}); showing the bundled ash-wind snapshot.`, now);
  }
}
