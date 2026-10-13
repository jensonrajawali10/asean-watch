// NEA live context layer: Singapore wind and haze from data.gov.sg. Owned by the logic builder.
// Context, not evidence: nothing here feeds deriveReview or changes a review state.
//
// Sources (checked 2026-10-13):
// - Endpoints: https://api-open.data.gov.sg/v2/real-time/api/{wind-direction,wind-speed,psi,pm25}
//   (no key, CORS open). Wind direction is degrees FROM (10-minute average), speed in knots.
// - Dataset pages: Wind Direction across Singapore
//   https://data.gov.sg/datasets/d_534cf203023b51f51f879145ccc56ff9/view, Wind Speed across Singapore
//   https://data.gov.sg/datasets/d_7677738484067741bf3b56ab5d69c7e9/view, Pollutant Standards Index (PSI)
//   https://data.gov.sg/datasets/d_fe37906a0182569d891506e815e819b7/view, PM2.5
//   https://data.gov.sg/datasets/d_e1058d6974c877257e32048ab128ad83/view
// - PSI descriptors: NEA haze site https://www.haze.gov.sg/ (24-hr PSI: 0 - 50 Good, 51 - 100
//   Moderate, 101 - 200 Unhealthy, 201 - 300 Very unhealthy, Above 300 Hazardous).
// - Licence: Singapore Open Data Licence version 1.0 https://data.gov.sg/open-data-licence; the
//   attribution follows its example notice ("Contains information from {name of dataset} accessed
//   on {date} from {source of data} which is made available under the terms of ...").
import snapshotJson from '../../data/nea-snapshot.json';
import type {
  DriftAssessment,
  HazeReading,
  Incident,
  NeaContext,
  NeaStationWind,
  WindSummary,
} from '../types';

export const NEA_RANGE_KM = 600;

/** Reference point for Singapore used by assessDrift. */
export const SINGAPORE = { lat: 1.3521, lon: 103.8198 } as const;

export const NEA_ENDPOINTS = {
  windDirection: 'https://api-open.data.gov.sg/v2/real-time/api/wind-direction',
  windSpeed: 'https://api-open.data.gov.sg/v2/real-time/api/wind-speed',
  psi: 'https://api-open.data.gov.sg/v2/real-time/api/psi',
  pm25: 'https://api-open.data.gov.sg/v2/real-time/api/pm25',
} as const;

export const NEA_SOURCE_NAME = 'NEA real-time weather and air quality via data.gov.sg';
/** data.gov.sg dataset page for the primary layer (wind direction); confirmed to resolve. */
export const NEA_SOURCE_URL = 'https://data.gov.sg/datasets/d_534cf203023b51f51f879145ccc56ff9/view';
export const NEA_LICENCE_URL = 'https://data.gov.sg/open-data-licence';
/** Label for the drift overlay (docs/CONTRACT.md). */
export const DRIFT_CAVEAT = 'Illustrative haze drift using Singapore station wind, not a dispersion model';

/** NEA 24-hour PSI descriptors, from https://www.haze.gov.sg/ (see header comment). */
export const PSI_BANDS: ReadonlyArray<{ max: number; label: string }> = [
  { max: 50, label: 'Good' },
  { max: 100, label: 'Moderate' },
  { max: 200, label: 'Unhealthy' },
  { max: 300, label: 'Very unhealthy' },
  { max: Number.POSITIVE_INFINITY, label: 'Hazardous' },
];

export function psiBand(psi: number): string {
  return (PSI_BANDS.find((b) => psi <= b.max) ?? PSI_BANDS[PSI_BANDS.length - 1]).label;
}

export interface NeaLoadResult {
  context: NeaContext | null;
  /** True when live fetch failed and the bundled snapshot was used. */
  fellBack: boolean;
  /** Readable reason the live fetch failed, or null. */
  error: string | null;
}

/** Raw API bodies, exactly as returned. psi and pm25 may be null when they could not be fetched. */
export interface NeaRawResponses {
  windDirection: unknown;
  windSpeed: unknown;
  psi: unknown;
  pm25: unknown;
}

// ---------------------------------------------------------------------------
// Small helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** "2026-10-13T14:39:00+08:00" -> "2026-10-13T06:39:00Z". Null when not an ISO 8601 timestamp with a zone. */
export function toUtcIso(value: unknown): string | null {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass name for a bearing in degrees. */
export function compassName(deg: number): string {
  return COMPASS[Math.round(normDeg(deg) / 22.5) % 16];
}

/** Signed smallest difference a - b in degrees, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = normDeg(a - b);
  return d > 180 ? d - 360 : d;
}

const EARTH_RADIUS_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle (haversine) distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from point 1 to point 2, degrees clockwise from north. */
export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return normDeg((Math.atan2(y, x) * 180) / Math.PI);
}

// ---------------------------------------------------------------------------
// Wind summary

/** Speed-weighted vector mean of station winds (meteorological FROM convention). */
export function summariseWind(stations: NeaStationWind[]): WindSummary {
  const usable = stations.filter((s) => finite(s.fromDeg) !== null);
  const withSpeed = usable.filter((s) => finite(s.speedKnots) !== null && (s.speedKnots as number) >= 0);
  // Weight by speed when any station reports one; otherwise fall back to direction-only (unit weights).
  const used = withSpeed.length > 0 ? withSpeed : usable;
  const weightOf = (s: NeaStationWind) => (withSpeed.length > 0 ? (s.speedKnots as number) : 1);

  if (used.length === 0) {
    return { fromDeg: null, meanSpeedKnots: null, consistency: 0, stationCount: 0, label: 'No usable wind reading' };
  }

  // u, v = components of the air motion (toward). A wind FROM theta moves toward theta + 180.
  let u = 0;
  let v = 0;
  let weightSum = 0;
  for (const s of used) {
    const w = weightOf(s);
    u += -w * Math.sin(rad(s.fromDeg));
    v += -w * Math.cos(rad(s.fromDeg));
    weightSum += w;
  }
  const n = used.length;
  const resultant = Math.hypot(u / n, v / n);
  const meanWeight = weightSum / n;
  const meanSpeedKnots = withSpeed.length > 0 ? round(meanWeight, 2) : null;
  const consistency = meanWeight > 0 ? Math.min(1, round(resultant / meanWeight, 3)) : 0;
  const stationCount = n;
  const speedText = meanSpeedKnots === null ? 'speed not reported' : `${meanSpeedKnots.toFixed(1)} kn`;

  if (meanSpeedKnots !== null && meanWeight === 0) {
    return { fromDeg: null, meanSpeedKnots, consistency: 0, stationCount, label: 'Calm (0.0 kn)' };
  }
  if (resultant <= 1e-6 * Math.max(1, meanWeight)) {
    return {
      fromDeg: null,
      meanSpeedKnots,
      consistency: 0,
      stationCount,
      label: `No prevailing direction (${speedText}), variable: stations disagree`,
    };
  }

  // Direction the mean air motion comes FROM.
  let fromDeg = round(normDeg((Math.atan2(-u, -v) * 180) / Math.PI), 1);
  if (fromDeg >= 360) fromDeg = 0;
  const base =
    meanSpeedKnots === null
      ? `From ${compassName(fromDeg)} (${Math.round(fromDeg) % 360}°), speed not reported`
      : `From ${compassName(fromDeg)} (${Math.round(fromDeg) % 360}°) at ${speedText}`;
  const label = consistency < 0.5 ? `${base}, variable: stations disagree` : base;
  return { fromDeg, meanSpeedKnots, consistency, stationCount, label };
}

// ---------------------------------------------------------------------------
// Normaliser (shared by the live and snapshot paths)

interface RawReading {
  timestamp: string;
  values: Map<string, unknown>;
}

/** Latest reading block of an NEA weather response, or null when the shape is unusable. */
function latestReading(body: unknown): RawReading | null {
  if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.readings)) return null;
  let best: RawReading | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const r of body.data.readings) {
    if (!isRecord(r) || !Array.isArray(r.data)) continue;
    const ts = toUtcIso(r.timestamp);
    const ms = ts === null ? Number.NaN : Date.parse(ts);
    if (!Number.isFinite(ms) || ms <= bestMs) continue;
    const values = new Map<string, unknown>();
    for (const d of r.data) {
      if (isRecord(d) && typeof d.stationId === 'string' && !values.has(d.stationId)) values.set(d.stationId, d.value);
    }
    best = { timestamp: ts as string, values };
    bestMs = ms;
  }
  return best;
}

interface StationMeta {
  name: string;
  lat: number;
  lon: number;
}

function stationMeta(...bodies: unknown[]): Map<string, StationMeta> {
  const meta = new Map<string, StationMeta>();
  for (const body of bodies) {
    if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.stations)) continue;
    for (const s of body.data.stations) {
      if (!isRecord(s) || typeof s.id !== 'string' || meta.has(s.id) || !isRecord(s.location)) continue;
      const lat = finite(s.location.latitude);
      const lon = finite(s.location.longitude);
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      meta.set(s.id, { name: typeof s.name === 'string' && s.name.trim() !== '' ? s.name : s.id, lat, lon });
    }
  }
  return meta;
}

const REGION_ORDER = ['north', 'south', 'east', 'west', 'central'];

function regionValues(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort((a, b) => {
    const ia = REGION_ORDER.indexOf(a);
    const ib = REGION_ORDER.indexOf(b);
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const out: Record<string, number> = {};
  for (const k of keys) {
    const n = finite(value[k]);
    if (n !== null && n >= 0) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Latest air-quality item of an NEA psi/pm25 response. */
function latestItem(body: unknown): { timestamp: string | null; readings: Record<string, unknown> } | null {
  if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.items)) return null;
  let best: { timestamp: string | null; readings: Record<string, unknown> } | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const item of body.data.items) {
    if (!isRecord(item) || !isRecord(item.readings)) continue;
    const ts = toUtcIso(item.timestamp) ?? toUtcIso(item.updatedTimestamp);
    const ms = ts === null ? Number.NEGATIVE_INFINITY : Date.parse(ts);
    if (best !== null && ms <= bestMs) continue;
    best = { timestamp: ts, readings: item.readings };
    bestMs = ms;
  }
  return best;
}

function normaliseHaze(psiBody: unknown, pm25Body: unknown, fallbackTime: string): HazeReading | null {
  const psiItem = latestItem(psiBody);
  const psi24h = psiItem ? regionValues(psiItem.readings.psi_twenty_four_hourly) : null;
  if (!psiItem || !psi24h) return null;
  const pmItem = latestItem(pm25Body);
  const pm25OneHour = pmItem ? regionValues(pmItem.readings.pm25_one_hourly) : null;
  return {
    observedAt: psiItem.timestamp ?? fallbackTime,
    psi24h,
    pm25OneHour,
    psiBand: psiBand(Math.max(...Object.values(psi24h))),
  };
}

function attributionFor(haze: HazeReading | null, retrievedAt: string): string {
  const names = ['Wind Direction across Singapore', 'Wind Speed across Singapore'];
  if (haze) names.push('Pollutant Standards Index (PSI)');
  if (haze?.pm25OneHour) names.push('PM2.5');
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  const date = /^\d{4}-\d{2}-\d{2}/.test(retrievedAt) ? retrievedAt.slice(0, 10) : retrievedAt;
  return (
    `Contains information from ${list} accessed on ${date} from data.gov.sg which is made available ` +
    `under the terms of the Singapore Open Data Licence version 1.0 ${NEA_LICENCE_URL}`
  );
}

/**
 * Pure: raw NEA responses -> NeaContext. Bad station values are dropped (and counted in the
 * quality note). Throws a readable Error only when the wind responses have no usable reading,
 * because wind is the core of the layer. psi/pm25 may be null or malformed: haze becomes null.
 */
export function normaliseNea(
  raw: NeaRawResponses,
  dataMode: NeaContext['dataMode'],
  retrievedAt: string,
): NeaContext {
  const direction = latestReading(raw.windDirection);
  if (!direction) throw new Error('NEA wind direction response has no readable reading');
  const speed = latestReading(raw.windSpeed);
  const meta = stationMeta(raw.windDirection, raw.windSpeed);

  const stations: NeaStationWind[] = [];
  let dropped = 0;
  for (const [stationId, value] of direction.values) {
    const deg = finite(value);
    const m = meta.get(stationId);
    if (deg === null || deg < 0 || deg > 360 || !m) {
      dropped += 1;
      continue;
    }
    const sp = finite(speed?.values.get(stationId));
    stations.push({
      stationId,
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      fromDeg: deg === 360 ? 0 : deg,
      speedKnots: sp !== null && sp >= 0 ? sp : null,
    });
  }
  if (stations.length === 0) throw new Error('NEA wind direction response has no usable station readings');

  const wind = summariseWind(stations);
  const haze = normaliseHaze(raw.psi, raw.pm25, direction.timestamp);
  const retrieved = toUtcIso(retrievedAt) ?? retrievedAt;

  const notes = [
    'Wind measured at NEA Singapore stations (10-minute averages); it describes conditions over ' +
      'Singapore, not along a haze path.',
    haze
      ? '24-hour PSI and 1-hour PM2.5 are NEA regional readings for Singapore.'
      : 'No NEA haze reading was available.',
    'Context, not evidence: it never changes a review state.',
  ];
  if (dropped > 0) notes.push(`${dropped} station reading${dropped === 1 ? ' was' : 's were'} dropped as invalid.`);
  if (dataMode === 'historical') notes.push(`Bundled snapshot captured ${retrieved}; not current conditions.`);

  return {
    dataMode,
    observedAt: direction.timestamp,
    retrievedAt: retrieved,
    stations,
    wind,
    haze,
    sourceName: NEA_SOURCE_NAME,
    sourceUrl: NEA_SOURCE_URL,
    attribution: attributionFor(haze, retrieved),
    qualityNote: notes.join(' '),
  };
}

// ---------------------------------------------------------------------------
// Snapshot and live loading

interface SnapshotFile {
  capturedAt: string;
  responses: NeaRawResponses;
}

/** The bundled real snapshot (data/nea-snapshot.json) as a historical context, or null if unusable. */
export function loadNeaSnapshot(): NeaContext | null {
  try {
    const snap = snapshotJson as unknown as SnapshotFile;
    return normaliseNea(snap.responses, 'historical', snap.capturedAt);
  } catch {
    return null;
  }
}

class FetchFailure extends Error {}

function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof FetchFailure) return err.message;
  if (err instanceof Error && err.name === 'AbortError') return `timed out after ${timeoutMs} ms`;
  if (err instanceof Error) return `network error (${err.message})`;
  return `network error (${String(err)})`;
}

async function fetchJson(fetchImpl: typeof fetch, url: string, signal: AbortSignal, aborted: Promise<never>): Promise<unknown> {
  const request = (async () => {
    const res = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new FetchFailure(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (isRecord(body) && 'code' in body && body.code !== 0) {
      throw new FetchFailure(`API code ${String(body.code)}${typeof body.errorMsg === 'string' && body.errorMsg ? ` (${body.errorMsg})` : ''}`);
    }
    return body;
  })();
  return Promise.race([request, aborted]);
}

const ENDPOINT_LABELS: Record<keyof typeof NEA_ENDPOINTS, string> = {
  windDirection: 'wind direction',
  windSpeed: 'wind speed',
  psi: 'PSI',
  pm25: 'PM2.5',
};

/** Live first (5 s timeout), then the bundled snapshot. Never throws. */
export async function loadNeaContext(opts?: { timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<NeaLoadResult> {
  const timeoutMs = opts?.timeoutMs ?? 5000;

  const fallBack = (reason: string): NeaLoadResult => {
    const context = loadNeaSnapshot();
    return {
      context,
      fellBack: true,
      error: context
        ? `Live NEA data unavailable (${reason}); showing the bundled snapshot captured ${context.retrievedAt}.`
        : `Live NEA data unavailable (${reason}), and the bundled snapshot could not be read.`,
    };
  };

  try {
    const fetchImpl = opts?.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) return fallBack('fetch is not available in this environment');

    const controller = new AbortController();
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
    aborted.catch(() => undefined); // never an unhandled rejection
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const keys = Object.keys(NEA_ENDPOINTS) as Array<keyof typeof NEA_ENDPOINTS>;
    let settled: PromiseSettledResult<unknown>[];
    try {
      settled = await Promise.allSettled(
        keys.map((k) => fetchJson(fetchImpl, NEA_ENDPOINTS[k], controller.signal, aborted)),
      );
    } finally {
      clearTimeout(timer);
    }
    const result = Object.fromEntries(keys.map((k, i) => [k, settled[i]])) as Record<
      keyof typeof NEA_ENDPOINTS,
      PromiseSettledResult<unknown>
    >;
    const failure = (k: keyof typeof NEA_ENDPOINTS): string | null => {
      const r = result[k];
      return r.status === 'rejected' ? `${ENDPOINT_LABELS[k]}: ${describeError(r.reason, timeoutMs)}` : null;
    };
    const valueOf = (k: keyof typeof NEA_ENDPOINTS): unknown => {
      const r = result[k];
      return r.status === 'fulfilled' ? r.value : null;
    };

    const windFailures = [failure('windDirection'), failure('windSpeed')].filter((f): f is string => f !== null);
    if (windFailures.length > 0) return fallBack(windFailures.join('; '));

    const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    let context: NeaContext;
    try {
      context = normaliseNea(
        { windDirection: valueOf('windDirection'), windSpeed: valueOf('windSpeed'), psi: valueOf('psi'), pm25: valueOf('pm25') },
        'live',
        retrievedAt,
      );
    } catch (err) {
      return fallBack(err instanceof Error ? err.message : String(err));
    }

    const hazeFailures = [failure('psi'), failure('pm25')].filter((f): f is string => f !== null);
    const error =
      hazeFailures.length > 0
        ? `Live NEA haze readings partly unavailable (${hazeFailures.join('; ')}); wind is live.`
        : null;
    return { context, fellBack: false, error };
  } catch (err) {
    return fallBack(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Drift

function hazardSource(incident: Incident): string {
  const mode = incident.dataMode === 'simulated' ? 'simulated ' : '';
  return incident.hazard === 'wildfire' ? `this ${mode}hotspot` : `this ${mode}incident location`;
}

function aboutKm(km: number): string {
  return km < 10 ? 'less than 10 km' : `about ${Math.round(km / 10) * 10} km`;
}

/** Null when the incident is more than NEA_RANGE_KM from Singapore. */
export function assessDrift(incident: Incident, ctx: NeaContext): DriftAssessment | null {
  const distanceKm = haversineKm(incident.lat, incident.lon, SINGAPORE.lat, SINGAPORE.lon);
  if (!Number.isFinite(distanceKm) || distanceKm > NEA_RANGE_KM) return null;
  const bearingToSingaporeDeg = round(initialBearingDeg(incident.lat, incident.lon, SINGAPORE.lat, SINGAPORE.lon), 1);
  const fromDeg = ctx.wind.fromDeg;
  const downwindDeg = fromDeg === null ? null : round(normDeg(fromDeg + 180), 1);
  const singaporeDownwind = downwindDeg === null ? null : Math.abs(angleDiff(downwindDeg, bearingToSingaporeDeg)) <= 45;

  const source = hazardSource(incident);
  const distance = aboutKm(distanceKm);
  const caveat = 'Illustrative only; not a dispersion model.';
  let text: string;
  if (fromDeg === null || downwindDeg === null) {
    text =
      `No usable real wind direction from NEA Singapore stations is available to relate ${source} ` +
      `to Singapore, ${distance} away. ${caveat}`;
  } else {
    const parts = [
      ctx.dataMode === 'historical' ? 'snapshot' : null,
      `from ${compassName(fromDeg)}`,
      ctx.wind.meanSpeedKnots === null ? 'speed not reported' : `${ctx.wind.meanSpeedKnots.toFixed(1)} kn`,
      ctx.wind.consistency < 0.5 ? 'low station agreement' : null,
    ].filter((p): p is string => p !== null);
    const wind = `Real wind measured at NEA Singapore stations (${parts.join(', ')})`;
    text = singaporeDownwind
      ? `${wind} would carry haze from ${source} toward Singapore, ${distance} away. ${caveat}`
      : `${wind} would not carry haze from ${source} toward Singapore, ${distance} away; it blows ` +
        `toward ${compassName(downwindDeg)}. ${caveat}`;
  }

  return {
    incidentId: incident.id,
    distanceKm: round(distanceKm, 1),
    bearingToSingaporeDeg,
    downwindDeg,
    singaporeDownwind,
    text,
  };
}
