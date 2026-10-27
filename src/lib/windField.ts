// Modelled wind field over the haze region from Open-Meteo (CC BY 4.0). MODELLED context, never evidence.
// Grid: 1° over lat -6..8, lon 95..120 (15 x 26 = 390 points, one multi-location request; verified live
// 2026-10-13 08:32 UTC: HTTP 200, ~0.9 MB, ~3 s). Wind at 10 m: peat smoke is a surface (boundary-layer)
// plume, so 10 m is the drift wind for haze, and it is the level NEA measures in Singapore.
// loadWindField(): live first through the same-origin relay /api/open-meteo?feed=wind (src/lib/openMeteoRelay.ts;
// timeout, in-flight dedupe, memory cache, backoff), then the bundled snapshot data/wind-snapshot.json
// (dataMode "historical"). Never throws.
// Two levels: '10m' (default; the trajectory logic in transport.ts) and '925hPa' (about 800 m, the
// lower boundary layer that carries a regional smoke plume; the default for the animated particles).
// Variable names verified live 2026-10-14: wind_speed_925hPa / wind_direction_925hPa, unit m/s.
// The 925 hPa snapshot is data/wind925-snapshot.json (scripts/capture-wind-snapshot.mjs 925hPa).

import { fetchOpenMeteoRelay, OpenMeteoRelayError, type OpenMeteoRelayPayload } from './openMeteoRelay';

export const WIND_GRID_SPEC = { minLat: -6, maxLat: 8, minLon: 95, maxLon: 120, stepDeg: 1 } as const;
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const WIND_ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0), best-match global weather model.';
export const WIND_LEVEL = '10 m';

export type WindLevel = '10m' | '925hPa';
/** Open-Meteo hourly variables and display label per level. */
export const WIND_LEVELS: Record<WindLevel, { speedVar: string; dirVar: string; label: string }> = {
  '10m': { speedVar: 'wind_speed_10m', dirVar: 'wind_direction_10m', label: '10 m' },
  '925hPa': { speedVar: 'wind_speed_925hPa', dirVar: 'wind_direction_925hPa', label: '925 hPa' },
};
/** Level for the animated wind particles. */
export const PARTICLE_WIND_LEVEL: WindLevel = '925hPa';
export const WIND_CACHE_TTL_MS = 30 * 60 * 1000;
export const WIND_BACKOFF_MS = 5 * 60 * 1000;
/**
 * The levels the relay asks for in ONE request. Open-Meteo counts a multi-location request once per
 * location whatever its variables (up to 10), so batching both levels halves the cost of the grid.
 */
export const WIND_RELAY_LEVELS: readonly WindLevel[] = ['10m', '925hPa'];
/** Client timeout for the relay: above a cold relay's upstream fetch of the 390-point grid. */
export const WIND_RELAY_TIMEOUT_MS = 15000;

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

/** The one multi-location request: points in row-major order (lat outer, lon inner), one or more levels. */
export function buildWindUrl(
  lats: number[] = gridAxes().lats,
  lons: number[] = gridAxes().lons,
  forecastDays = 3,
  level: WindLevel | readonly WindLevel[] = '10m',
): string {
  const levels: readonly WindLevel[] = typeof level === 'string' ? [level] : level;
  const vars = levels.flatMap((l) => [WIND_LEVELS[l].speedVar, WIND_LEVELS[l].dirVar]).join(',');
  const la: number[] = [];
  const lo: number[] = [];
  for (const lat of lats) for (const lon of lons) {
    la.push(lat);
    lo.push(lon);
  }
  return (
    `${OPEN_METEO_FORECAST_URL}?latitude=${la.join(',')}&longitude=${lo.join(',')}` +
    `&hourly=${vars}&wind_speed_unit=ms&past_days=1&forecast_days=${forecastDays}&timezone=GMT`
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
  level: WindLevel = '10m',
): WindGrid | null {
  const { speedVar, dirVar, label } = WIND_LEVELS[level];
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
    const sp = e.hourly[speedVar];
    const dir = e.hourly[dirVar];
    const tt = e.hourly.time;
    if (!Array.isArray(sp) || !Array.isArray(dir) || !Array.isArray(tt) || sp.length !== nT || dir.length !== nT || tt.length !== nT) return null;
    if (isRecord(e.hourly_units) && e.hourly_units[speedVar] !== undefined && e.hourly_units[speedVar] !== 'm/s') return null;
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
    level: label,
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

// The bundled snapshots are fallbacks only, so they are not in the entry chunk: each is its own
// same-origin chunk (content-hashed, works offline once the app is loaded), fetched in parallel with the
// live request by loadWindField and awaited only on the fallback path.
const snapshotChunks: Partial<Record<WindLevel, Promise<unknown>>> = {};
function snapshotChunk(level: WindLevel): Promise<unknown> {
  snapshotChunks[level] ??= (
    level === '925hPa' ? import('../../data/wind925-snapshot.json') : import('../../data/wind-snapshot.json')
  ).then(
    (m) => m.default as unknown,
    (err: unknown) => {
      delete snapshotChunks[level]; // a failed chunk load can be retried
      throw err;
    },
  );
  return snapshotChunks[level];
}

/** The bundled HISTORICAL wind grid at `level`, or null when it is missing, malformed or cannot be loaded. */
export async function loadWindSnapshot(level: WindLevel = '10m'): Promise<WindGrid | null> {
  let raw: unknown;
  try {
    raw = await snapshotChunk(level);
  } catch {
    return null;
  }
  const g = parseWindGrid(raw, 'historical');
  // A snapshot of another level must never stand in for this one.
  return g && g.level === WIND_LEVELS[level].label ? g : null;
}

// ---------------------------------------------------------------------------
// Live loading through the relay, with cache, in-flight dedupe and backoff (pattern from nea.ts). One
// relay answer carries both levels, so concurrent loads of the two levels share one request. Caches are
// per level; the backoff is shared.

const inflight: Partial<Record<WindLevel, Promise<WindLoadResult>>> = {};
const memoryCache: Partial<Record<WindLevel, { grid: WindGrid; at: number }>> = {};
let relayInflight: Promise<OpenMeteoRelayPayload> | null = null;
let backoffUntil = 0;

export function resetWindCache(): void {
  for (const k of Object.keys(WIND_LEVELS) as WindLevel[]) {
    delete inflight[k];
    delete memoryCache[k];
  }
  relayInflight = null;
  backoffUntil = 0;
}

async function snapshotResult(message: string, level: WindLevel): Promise<WindLoadResult> {
  const grid = await loadWindSnapshot(level);
  return grid
    ? { grid, status: 'snapshot', message }
    : {
        grid: null,
        status: 'unavailable',
        message: `${message} The bundled ${WIND_LEVELS[level].label} wind snapshot is missing or malformed.`,
      };
}

/** The relay's wind answer (both levels), shared by concurrent callers; it owns its own timeout. */
function windRelay(timeoutMs: number, fetchImpl: typeof fetch): Promise<OpenMeteoRelayPayload> {
  if (relayInflight) return relayInflight;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const p = fetchOpenMeteoRelay('wind', fetchImpl, controller.signal)
    .catch((err: unknown) => {
      throw controller.signal.aborted ? new Error(`timed out after ${timeoutMs} ms`) : err;
    })
    .finally(() => {
      clearTimeout(timer);
      relayInflight = null;
    });
  relayInflight = p;
  return p;
}

async function loadLive(level: WindLevel, timeoutMs: number, fetchImpl: typeof fetch, now: () => number): Promise<WindLoadResult> {
  try {
    const payload = await windRelay(timeoutMs, fetchImpl);
    const grid = normaliseOpenMeteoWind(payload.raw, gridAxes(), payload.retrievedAt, 'live', level);
    if (!grid) return await snapshotResult('Open-Meteo response was not in the expected shape; showing the bundled wind snapshot.', level);
    // A copy the relay serves because Open-Meteo is failing is shown, but not cached here.
    if (payload.stale) return { grid, status: 'cached', message: `Open-Meteo is not answering; showing the model run retrieved ${payload.retrievedAt}.` };
    memoryCache[level] = { grid, at: now() };
    return { grid, status: 'live', message: null };
  } catch (err) {
    if (err instanceof OpenMeteoRelayError && (err.status === 429 || err.status === 503)) {
      backoffUntil = now() + Math.min(err.retryAfterMs ?? WIND_BACKOFF_MS, WIND_BACKOFF_MS);
      return await snapshotResult(`Open-Meteo is busy (${err.message}); showing the bundled wind snapshot.`, level);
    }
    if (err instanceof OpenMeteoRelayError) return await snapshotResult(`The Open-Meteo relay returned HTTP ${err.status}; showing the bundled wind snapshot.`, level);
    const why = err instanceof Error ? err.message : String(err);
    return await snapshotResult(`Open-Meteo unavailable (${why}); showing the bundled wind snapshot.`, level);
  }
}

/** Live modelled wind grid at `level` (default 10 m), else the bundled snapshot. Never throws. */
export async function loadWindField(opts?: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  level?: WindLevel;
}): Promise<WindLoadResult> {
  const now = opts?.now ?? Date.now;
  const level: WindLevel = opts?.level ?? '10m';
  // Start the fallback chunk now, alongside the live request; it is awaited only if needed.
  void snapshotChunk(level).catch(() => undefined);
  try {
    const cached = memoryCache[level];
    if (cached && now() - cached.at < WIND_CACHE_TTL_MS) return { grid: cached.grid, status: 'cached', message: null };
    if (now() < backoffUntil) return await snapshotResult('Open-Meteo rate limit backoff in effect; showing the bundled wind snapshot.', level);
    const fetchImpl = opts?.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return await snapshotResult('No fetch available; showing the bundled wind snapshot.', level);
    let p = inflight[level];
    if (!p) {
      p = loadLive(level, opts?.timeoutMs ?? WIND_RELAY_TIMEOUT_MS, fetchImpl, now).finally(() => {
        delete inflight[level];
      });
      inflight[level] = p;
    }
    return await p;
  } catch (err) {
    return await snapshotResult(`Wind load failed (${err instanceof Error ? err.message : String(err)}); showing the bundled wind snapshot.`, level);
  }
}

// ---------------------------------------------------------------------------
// Fast sampling for animation: interpolate one time slice once (when the hour changes), then sample
// it bilinearly per particle per frame without re-parsing the time axis. Same maths as
// transport.ts sampleWind (bilinear in space, linear in time), so the two agree.

export interface WindSlice {
  lats: readonly number[];
  lons: readonly number[];
  /** ISO 8601 UTC time of the slice. */
  time: string;
  /** Row-major [j * nLon + i], m/s. */
  u: Float32Array;
  v: Float32Array;
}

/** Index pair and weight for `ms` on an ascending time axis, clamped to its ends. */
export function timeWeights(timesMs: readonly number[], ms: number): { a: number; b: number; f: number } {
  const n = timesMs.length;
  if (n === 0 || !(ms > timesMs[0])) return { a: 0, b: 0, f: 0 };
  if (ms >= timesMs[n - 1]) return { a: n - 1, b: n - 1, f: 0 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timesMs[mid] <= ms) lo = mid;
    else hi = mid;
  }
  return { a: lo, b: hi, f: (ms - timesMs[lo]) / (timesMs[hi] - timesMs[lo]) };
}

/** The grid at one time (clamped to the grid's time range), as flat typed arrays. */
export function windSlice(grid: WindGrid, timeISO: string): WindSlice {
  const nLat = grid.lats.length;
  const nLon = grid.lons.length;
  const parsed = Date.parse(timeISO);
  const ms = Number.isFinite(parsed) ? parsed : Date.parse(grid.times[0]);
  const { a, b, f } = timeWeights(grid.times.map((t) => Date.parse(t)), ms);
  const u = new Float32Array(nLat * nLon);
  const v = new Float32Array(nLat * nLon);
  for (let j = 0; j < nLat; j += 1) {
    for (let i = 0; i < nLon; i += 1) {
      const k = j * nLon + i;
      u[k] = grid.u[a][j][i] * (1 - f) + grid.u[b][j][i] * f;
      v[k] = grid.v[a][j][i] * (1 - f) + grid.v[b][j][i] * f;
    }
  }
  return { lats: grid.lats, lons: grid.lons, time: timeISO, u, v };
}

/**
 * Bilinear sample of a regular ascending grid stored row-major; NaN outside. Assumes evenly spaced
 * axes (the 1° WIND_GRID_SPEC), which keeps it cheap enough for thousands of calls a frame.
 */
export function sampleRegular(field: ArrayLike<number>, lats: readonly number[], lons: readonly number[], lat: number, lon: number): number {
  const nLat = lats.length;
  const nLon = lons.length;
  const fy = ((lat - lats[0]) / (lats[nLat - 1] - lats[0])) * (nLat - 1);
  const fx = ((lon - lons[0]) / (lons[nLon - 1] - lons[0])) * (nLon - 1);
  if (!(fy >= 0 && fy <= nLat - 1 && fx >= 0 && fx <= nLon - 1)) return Number.NaN;
  const j = Math.min(Math.floor(fy), nLat - 2);
  const i = Math.min(Math.floor(fx), nLon - 2);
  const ty = fy - j;
  const tx = fx - i;
  const k = j * nLon + i;
  const top = field[k] * (1 - tx) + field[k + 1] * tx;
  const bot = field[k + nLon] * (1 - tx) + field[k + nLon + 1] * tx;
  return top * (1 - ty) + bot * ty;
}

/** Wind (u east, v north, m/s) from a slice; null outside the grid. */
export function sampleSlice(slice: WindSlice, lat: number, lon: number): { u: number; v: number } | null {
  const u = sampleRegular(slice.u, slice.lats, slice.lons, lat, lon);
  if (Number.isNaN(u)) return null;
  return { u, v: sampleRegular(slice.v, slice.lats, slice.lons, lat, lon) };
}
