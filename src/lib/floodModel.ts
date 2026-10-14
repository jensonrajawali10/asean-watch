// Modelled river discharge (GloFAS v4 via the Open-Meteo Flood API) at a few named river points.
// MODELLED context only: never an observation, never evidence, never a flood warning. Official flood
// warnings come from national agencies (e.g. ThaiWater/RID, JPS Malaysia, BMKG/BBWS, MRC).
//
// Verified live 2026-10-14 (CORS "*"): one request for many coordinates returns an array in input order.
//   https://flood-api.open-meteo.com/v1/flood?latitude=a,b,..&longitude=x,y,..&daily=river_discharge&past_days=7&forecast_days=8
// GloFAS is a 0.05° grid; the requested point can fall on a minor channel (research note: Ayutthaya
// 1.8 m³/s at the requested cell vs 4,314 m³/s one cell away), so each point searches a 5×5
// neighbourhood (±0.1°) and uses the cell with the highest mean discharge. Small urban rivers
// (Ciliwung) remain poorly resolved. Snapshot: data/flood-snapshot.json (npm run refresh:flood).
import snapshotJson from '../../data/flood-snapshot.json';
import type { ConnectorStatus, RiverDischargeDay, RiverDischargeSeries } from '../types';
import { isRecord, isoNoMs, loadLiveFirst, num, snapshotOnly, str } from './liveLoad';

export const FLOOD_MODEL_NOTE =
  'MODELLED river discharge from GloFAS (Copernicus Emergency Management Service) via Open-Meteo, on a ' +
  '0.05° grid: not a gauge reading and not a flood warning. Follow your national flood agency.';
export const FLOOD_MODEL_ATTRIBUTION =
  'Flood data: Open-Meteo.com (CC BY 4.0), based on Copernicus Emergency Management Service GloFAS (European Union).';
export const FLOOD_API = 'https://flood-api.open-meteo.com/v1/flood';
export const GRID_STEP = 0.05;
export const NEIGHBOURHOOD = 2; // ±2 cells -> 5×5

export interface RiverPoint {
  id: string;
  river: string;
  place: string;
  country: string;
  lat: number;
  lon: number;
}

/** Keep in step with POINTS in scripts/capture-flood-snapshot.mjs. */
export const RIVER_POINTS: readonly RiverPoint[] = [
  { id: 'mekong-phnom-penh', river: 'Mekong', place: 'Phnom Penh', country: 'KH', lat: 11.55, lon: 104.92 },
  { id: 'chao-phraya-ayutthaya', river: 'Chao Phraya', place: 'Ayutthaya', country: 'TH', lat: 14.35, lon: 100.56 },
  { id: 'ciliwung-jakarta', river: 'Ciliwung', place: 'Jakarta', country: 'ID', lat: -6.2, lon: 106.85 },
  { id: 'kelantan-kota-bharu', river: 'Kelantan', place: 'Kota Bharu', country: 'MY', lat: 6.12, lon: 102.24 },
];

/** The 25 grid coordinates around a point, row-major (lat outer, lon inner), 3-decimal strings. */
export function neighbourhood(lat: number, lon: number): { lats: string[]; lons: string[] } {
  const lats: string[] = [];
  const lons: string[] = [];
  for (let i = -NEIGHBOURHOOD; i <= NEIGHBOURHOOD; i++) {
    for (let j = -NEIGHBOURHOOD; j <= NEIGHBOURHOOD; j++) {
      lats.push((lat + i * GRID_STEP).toFixed(3));
      lons.push((lon + j * GRID_STEP).toFixed(3));
    }
  }
  return { lats, lons };
}

export function floodApiUrl(points: readonly RiverPoint[] = RIVER_POINTS): string {
  const lats: string[] = [];
  const lons: string[] = [];
  for (const p of points) {
    const n = neighbourhood(p.lat, p.lon);
    lats.push(...n.lats);
    lons.push(...n.lons);
  }
  return `${FLOOD_API}?latitude=${lats.join(',')}&longitude=${lons.join(',')}&daily=river_discharge&past_days=7&forecast_days=8`;
}

interface Cell {
  lat: number;
  lon: number;
  time: string[];
  q: (number | null)[];
}

function cellOf(raw: unknown): Cell | null {
  if (!isRecord(raw) || !isRecord(raw.daily)) return null;
  const lat = num(raw.latitude);
  const lon = num(raw.longitude);
  const time = raw.daily.time;
  const q = raw.daily.river_discharge;
  if (lat === null || lon === null || !Array.isArray(time) || !Array.isArray(q) || time.length !== q.length) return null;
  if (isRecord(raw.daily_units) && raw.daily_units.river_discharge !== undefined && raw.daily_units.river_discharge !== 'm³/s') return null;
  return { lat, lon, time: time.map((t) => str(t) ?? ''), q: q.map((v) => num(v)) };
}

function mean(q: (number | null)[]): number {
  const v = q.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1;
}

/** Highest mean discharge wins; ties go to the cell nearest the requested point. */
export function pickBestCell(cells: Cell[], lat: number, lon: number): Cell | null {
  let best: Cell | null = null;
  let bestMean = -Infinity;
  let bestDist = Infinity;
  for (const c of cells) {
    const m = mean(c.q);
    if (m < 0) continue;
    const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
    if (m > bestMean || (m === bestMean && d < bestDist)) {
      best = c;
      bestMean = m;
      bestDist = d;
    }
  }
  return best;
}

/** Open-Meteo multi-location response (25 cells per point, in RIVER_POINTS order) -> one series per point. */
export function parseFloodResponse(
  raw: unknown,
  meta: { dataMode: 'live' | 'historical'; retrievedAt: string; sourceUrl: string },
  points: readonly RiverPoint[] = RIVER_POINTS,
): RiverDischargeSeries[] {
  const rows = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : null;
  const per = (2 * NEIGHBOURHOOD + 1) ** 2;
  if (!rows || rows.length !== points.length * per) throw new Error('unexpected Open-Meteo flood payload');
  const today = meta.retrievedAt.slice(0, 10);
  const out: RiverDischargeSeries[] = [];
  points.forEach((p, i) => {
    const cells = rows.slice(i * per, (i + 1) * per).map(cellOf).filter((c): c is Cell => c !== null);
    const best = pickBestCell(cells, p.lat, p.lon);
    if (!best) return;
    const days: RiverDischargeDay[] = best.time.map((date, k) => ({
      date,
      dischargeM3s: best.q[k],
      kind: date < today ? 'past' : date === today ? 'today' : 'forecast',
    }));
    out.push({
      pointId: p.id,
      river: p.river,
      place: p.place,
      country: p.country,
      requested: { lat: p.lat, lon: p.lon },
      cell: { lat: Math.round(best.lat * 1000) / 1000, lon: Math.round(best.lon * 1000) / 1000 },
      unit: 'm³/s',
      days,
      basis: 'MODELLED',
      dataMode: meta.dataMode,
      retrievedAt: meta.retrievedAt,
      sourceUrl: 'https://open-meteo.com/en/docs/flood-api',
      note: FLOOD_MODEL_NOTE,
    });
  });
  if (out.length === 0) throw new Error('no usable GloFAS cells');
  return out;
}

export interface FloodSnapshot {
  capturedAt: string;
  url: string;
  retrievedAt: string;
  raw: unknown;
}
export const BUNDLED_FLOOD_SNAPSHOT = snapshotJson as unknown as FloodSnapshot;

export interface FloodModelResult {
  series: RiverDischargeSeries[];
  status: ConnectorStatus;
  note: string;
  attribution: string;
}

function spec(source: FloodSnapshot | null, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }) {
  return {
    sourceId: 'open-meteo-flood',
    sourceName: 'Open-Meteo Flood API (GloFAS)',
    fetchImpl: opts?.fetchImpl,
    timeoutMs: opts?.timeoutMs ?? 10000,
    ttlMs: 60 * 60 * 1000, // daily model: an hour of reuse is plenty
    retrievedAtOf: (v: RiverDischargeSeries[]) => v[0]?.retrievedAt ?? isoNoMs(Date.now()),
    live: async (get: (url: string, kind: 'json' | 'text') => Promise<unknown>) => {
      const url = floodApiUrl();
      const raw = await get(url, 'json');
      return parseFloodResponse(raw, { dataMode: 'live', retrievedAt: isoNoMs(Date.now()), sourceUrl: url });
    },
    snapshot: () => {
      if (!source || typeof source.retrievedAt !== 'string') return null;
      return {
        value: parseFloodResponse(source.raw, { dataMode: 'historical', retrievedAt: source.retrievedAt, sourceUrl: source.url }),
        retrievedAt: source.retrievedAt,
      };
    },
  };
}

function wrap(r: { value: RiverDischargeSeries[] | null; status: ConnectorStatus }): FloodModelResult {
  return { series: r.value ?? [], status: r.status, note: FLOOD_MODEL_NOTE, attribution: FLOOD_MODEL_ATTRIBUTION };
}

/** Live GloFAS discharge (1 h cache, 60 s backoff) with the HISTORICAL snapshot fallback. Never throws. */
export async function loadFloodModel(opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; snapshot?: FloodSnapshot | null }): Promise<FloodModelResult> {
  const source = opts?.snapshot === undefined ? BUNDLED_FLOOD_SNAPSHOT : opts.snapshot;
  return wrap(await loadLiveFirst(spec(source, opts)));
}

export function loadFloodModelSnapshot(source: FloodSnapshot | null = BUNDLED_FLOOD_SNAPSHOT): FloodModelResult {
  return wrap(snapshotOnly(spec(source)));
}
