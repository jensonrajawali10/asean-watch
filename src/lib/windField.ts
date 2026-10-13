// Modelled wind field over the haze region from Open-Meteo (CC BY 4.0). MODELLED context, never evidence.
// Grid: 1° over lat -6..8, lon 95..120 (15 x 26 = 390 points, one multi-location request; verified live
// 2026-10-13 08:32 UTC: HTTP 200, ~0.9 MB, ~3 s). Wind at 10 m: peat smoke is a surface (boundary-layer)
// plume, so 10 m is the drift wind for haze, and it is the level NEA measures in Singapore.
// loadWindField(): live first (timeout, in-flight dedupe, memory cache), then the bundled snapshot
// data/wind-snapshot.json (dataMode "historical"). Never throws.
import snapshotJson from '../../data/wind-snapshot.json';

export const WIND_GRID_SPEC = { minLat: -6, maxLat: 8, minLon: 95, maxLon: 120, stepDeg: 1 } as const;
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const WIND_ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0), best-match global weather model.';
export const WIND_LEVEL = '10 m';
export const WIND_CACHE_TTL_MS = 30 * 60 * 1000;
export const WIND_BACKOFF_MS = 5 * 60 * 1000;

export interface WindGrid {
  /** Ascending latitudes (degrees). */
  lats: number[];
  /** Ascending longitudes (degrees). */
  lons: number[];
  /** Ascending ISO 8601 UTC times ("...Z"). */
  times: string[];
  /** Eastward wind, m/s, indexed [t][j = lat][i = lon]. */
  u: number[][][];
  /** Northward wind, m/s, indexed [t][j = lat][i = lon]. */
  v: number[][][];
  source: string;
  sourceUrl: string;
  model: string;
  /** Height of the wind, e.g. "10 m". */
  level: string;
  /** ISO 8601 UTC time it was fetched (live) or captured (snapshot). */
  retrievedAt: string;
  dataMode: 'live' | 'historical';
  attribution: string;
}

export interface WindLoadResult {
  grid: WindGrid | null;
  status: 'live' | 'cached' | 'snapshot' | 'unavailable';
  message: string | null;
}

/**
 * Meteorological FROM-direction (degrees clockwise from north) and speed to u (east) / v (north).
 * Wind from the north (0°) blows southward: u = 0, v = -speed.
 */
export function windFromToUV(fromDeg: number, speed: number): { u: number; v: number } {
  const r = (fromDeg * Math.PI) / 180;
  const u = -speed * Math.sin(r);
  const v = -speed * Math.cos(r);
  // Clean up -0 and float noise so cardinal directions give exact zeros.
  const clean = (x: number) => (Math.abs(x) < 1e-9 ? 0 : x);
  return { u: clean(u), v: clean(v) };
}

/** Grid axes for WIND_GRID_SPEC. */
export function gridAxes(spec: { minLat: number; maxLat: number; minLon: number; maxLon: number; stepDeg: number } = WIND_GRID_SPEC): {
  lats: number[];
  lons: number[];
} {
  const axis = (a: number, b: number) => {
    const out: number[] = [];
    for (let x = a; x <= b + 1e-9; x += spec.stepDeg) out.push(Math.round(x * 1000) / 1000);
    return out;
  };
  return { lats: axis(spec.minLat, spec.maxLat), lons: axis(spec.minLon, spec.maxLon) };
}

/** The one multi-location request: points in row-major order (lat outer, lon inner). */
export function buildWindUrl(lats: number[] = gridAxes().lats, lons: number[] = gridAxes().lons, forecastDays = 3): string {
  const la: number[] = [];
  const lo: number[] = [];
  for (const lat of lats) for (const lon of lons) {
    la.push(lat);
    lo.push(lon);
  }
  return (
    `${OPEN_METEO_FORECAST_URL}?latitude=${la.join(',')}&longitude=${lo.join(',')}` +
    `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&past_days=1&forecast_days=${forecastDays}&timezone=GMT`
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

/**
 * Normalise an Open-Meteo multi-location response (an array, one entry per requested point in request
 * order) to a WindGrid. Returns null on any structural problem or missing value: never a partial grid.
 */
export function normaliseOpenMeteoWind(
  json: unknown,
  axes: { lats: number[]; lons: number[] },
  retrievedAt: string,
  dataMode: WindGrid['dataMode'] = 'live',
): WindGrid | null {
  const list = Array.isArray(json) ? json : [json];
  const nLat = axes.lats.length;
  const nLon = axes.lons.length;
  if (list.length !== nLat * nLon || list.length === 0) return null;
  const first = list[0];
  if (!isRecord(first) || !isRecord(first.hourly) || !Array.isArray(first.hourly.time)) return null;
  const times = first.hourly.time.map(toUtc);
  if (times.length === 0 || times.some((t) => t === null)) return null;
  const nT = times.length;
  const u: number[][][] = Array.from({ length: nT }, () => Array.from({ length: nLat }, () => new Array<number>(nLon).fill(0)));
  const v: number[][][] = Array.from({ length: nT }, () => Array.from({ length: nLat }, () => new Array<number>(nLon).fill(0)));
  for (let k = 0; k < list.length; k += 1) {
    const e = list[k];
    if (!isRecord(e) || !isRecord(e.hourly)) return null;
    const sp = e.hourly.wind_speed_10m;
    const dir = e.hourly.wind_direction_10m;
    const tt = e.hourly.time;
    if (!Array.isArray(sp) || !Array.isArray(dir) || !Array.isArray(tt) || sp.length !== nT || dir.length !== nT || tt.length !== nT) return null;
    if (isRecord(e.hourly_units) && e.hourly_units.wind_speed_10m !== undefined && e.hourly_units.wind_speed_10m !== 'm/s') return null;
    const j = Math.floor(k / nLon);
    const i = k % nLon;
    for (let t = 0; t < nT; t += 1) {
      const s = sp[t];
      const d = dir[t];
      if (typeof s !== 'number' || typeof d !== 'number' || !Number.isFinite(s) || !Number.isFinite(d)) return null;
      const w = windFromToUV(d, s);
      u[t][j][i] = w.u;
      v[t][j][i] = w.v;
    }
  }
  return {
    lats: [...axes.lats],
    lons: [...axes.lons],
    times: times as string[],
    u,
    v,
    source: 'Open-Meteo Forecast API',
    sourceUrl: 'https://open-meteo.com/en/docs',
    model: 'Open-Meteo best match (global weather models)',
    level: WIND_LEVEL,
    retrievedAt,
    dataMode,
    attribution: WIND_ATTRIBUTION,
  };
}

function isNum3(x: unknown, nT: number, nLat: number, nLon: number): x is number[][][] {
  return (
    Array.isArray(x) &&
    x.length === nT &&
    x.every((row) => Array.isArray(row) && row.length === nLat && row.every((r) => Array.isArray(r) && r.length === nLon && r.every((n) => typeof n === 'number' && Number.isFinite(n))))
  );
}

/** Validate a stored grid (the bundled snapshot). Returns null when malformed. */
export function parseWindGrid(raw: unknown, dataMode: WindGrid['dataMode']): WindGrid | null {
  if (!isRecord(raw)) return null;
  const { lats, lons, times } = raw;
  if (!Array.isArray(lats) || !Array.isArray(lons) || !Array.isArray(times)) return null;
  if (lats.length < 2 || lons.length < 2 || times.length < 1) return null;
  if (!lats.every((n) => typeof n === 'number') || !lons.every((n) => typeof n === 'number')) return null;
  if (!times.every((t) => typeof t === 'string' && toUtc(t) === t)) return null;
  if (!isNum3(raw.u, times.length, lats.length, lons.length) || !isNum3(raw.v, times.length, lats.length, lons.length)) return null;
  if (typeof raw.retrievedAt !== 'string' || toUtc(raw.retrievedAt) === null) return null;
  const str = (x: unknown, d: string) => (typeof x === 'string' && x ? x : d);
  return {
    lats: lats as number[],
    lons: lons as number[],
    times: times as string[],
    u: raw.u,
    v: raw.v,
    source: str(raw.source, 'Open-Meteo Forecast API'),
    sourceUrl: str(raw.sourceUrl, 'https://open-meteo.com/en/docs'),
    model: str(raw.model, 'Open-Meteo best match (global weather models)'),
    level: str(raw.level, WIND_LEVEL),
    retrievedAt: raw.retrievedAt,
    dataMode,
    attribution: str(raw.attribution, WIND_ATTRIBUTION),
  };
}

export function loadWindSnapshot(): WindGrid | null {
  return parseWindGrid(snapshotJson as unknown, 'historical');
}

// ---------------------------------------------------------------------------
// Live loading with cache, in-flight dedupe and backoff (pattern from nea.ts)

let inflight: Promise<WindLoadResult> | null = null;
let memoryCache: { grid: WindGrid; at: number } | null = null;
let backoffUntil = 0;

export function resetWindCache(): void {
  inflight = null;
  memoryCache = null;
  backoffUntil = 0;
}

function snapshotResult(message: string): WindLoadResult {
  const grid = loadWindSnapshot();
  return grid
    ? { grid, status: 'snapshot', message }
    : { grid: null, status: 'unavailable', message: `${message} The bundled wind snapshot is missing or malformed.` };
}

async function loadLive(timeoutMs: number, fetchImpl: typeof fetch, now: () => number): Promise<WindLoadResult> {
  const axes = gridAxes();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(buildWindUrl(axes.lats, axes.lons), { signal: controller.signal });
    if (res.status === 429) {
      backoffUntil = now() + WIND_BACKOFF_MS;
      return snapshotResult('Open-Meteo rate limit reached; showing the bundled wind snapshot.');
    }
    if (!res.ok) return snapshotResult(`Open-Meteo returned HTTP ${res.status}; showing the bundled wind snapshot.`);
    const json: unknown = await res.json();
    const retrievedAt = new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const grid = normaliseOpenMeteoWind(json, axes, retrievedAt, 'live');
    if (!grid) return snapshotResult('Open-Meteo response was not in the expected shape; showing the bundled wind snapshot.');
    memoryCache = { grid, at: now() };
    return { grid, status: 'live', message: null };
  } catch (err) {
    const why = controller.signal.aborted ? `timed out after ${timeoutMs} ms` : err instanceof Error ? err.message : String(err);
    return snapshotResult(`Open-Meteo unavailable (${why}); showing the bundled wind snapshot.`);
  } finally {
    clearTimeout(timer);
  }
}

/** Live modelled wind grid, else the bundled snapshot. Never throws. */
export async function loadWindField(opts?: { timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number }): Promise<WindLoadResult> {
  const now = opts?.now ?? Date.now;
  try {
    if (memoryCache && now() - memoryCache.at < WIND_CACHE_TTL_MS) return { grid: memoryCache.grid, status: 'cached', message: null };
    if (now() < backoffUntil) return snapshotResult('Open-Meteo rate limit backoff in effect; showing the bundled wind snapshot.');
    const fetchImpl = opts?.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return snapshotResult('No fetch available; showing the bundled wind snapshot.');
    if (!inflight) {
      inflight = loadLive(opts?.timeoutMs ?? 8000, fetchImpl, now).finally(() => {
        inflight = null;
      });
    }
    return await inflight;
  } catch (err) {
    return snapshotResult(`Wind load failed (${err instanceof Error ? err.message : String(err)}); showing the bundled wind snapshot.`);
  }
}
