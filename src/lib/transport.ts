// Illustrative haze transport: forward trajectories through a MODELLED wind grid from clustered FIRMS
// hotspots, checked against Singapore. Pure and deterministic. Context, never evidence; not a
// dispersion model (no vertical motion, mixing, deposition or chemistry).
import type { Observation } from '../types';
import type { WindGrid } from './windField';
import type { HotspotMember, Watch } from './watchRules';

export const SINGAPORE = { lat: 1.3521, lon: 103.8198 } as const;
/** Within this distance of the receptor counts as "reaches Singapore". */
export const REACH_KM = 75;
export const TRANSPORT_CAVEAT = 'Illustrative only; not a dispersion model.';

const R_KM = 6371.0088;
const KM_PER_DEG = (Math.PI * R_KM) / 180;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Index and fraction of x in an ascending axis; null outside. */
function locate(axis: readonly number[], x: number): { k: number; f: number } | null {
  const n = axis.length;
  if (n < 2 || !Number.isFinite(x) || x < axis[0] || x > axis[n - 1]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= x) lo = mid;
    else hi = mid;
  }
  return { k: lo, f: (x - axis[lo]) / (axis[lo + 1] - axis[lo]) };
}

function timeAxisMs(grid: WindGrid): number[] {
  return grid.times.map((t) => Date.parse(t));
}

function bilinear(field: number[][], j: { k: number; f: number }, i: { k: number; f: number }): number {
  const a = field[j.k][i.k];
  const b = field[j.k][i.k + 1];
  const c = field[j.k + 1][i.k];
  const d = field[j.k + 1][i.k + 1];
  return (a * (1 - i.f) + b * i.f) * (1 - j.f) + (c * (1 - i.f) + d * i.f) * j.f;
}

function sampleAt(grid: WindGrid, tMs: number[], lat: number, lon: number, ms: number): { u: number; v: number } | null {
  const j = locate(grid.lats, lat);
  const i = locate(grid.lons, lon);
  if (!j || !i) return null;
  let t: { k: number; f: number } | null;
  if (tMs.length === 1) t = ms === tMs[0] ? { k: 0, f: 0 } : null;
  else t = locate(tMs, ms);
  if (!t) return null;
  const k2 = Math.min(t.k + 1, tMs.length - 1);
  const u = bilinear(grid.u[t.k], j, i) * (1 - t.f) + bilinear(grid.u[k2], j, i) * t.f;
  const v = bilinear(grid.v[t.k], j, i) * (1 - t.f) + bilinear(grid.v[k2], j, i) * t.f;
  return { u, v };
}

/** Wind (u east, v north, m/s) at a point and time: bilinear in space, linear in time; null outside the grid. */
export function sampleWind(grid: WindGrid, lat: number, lon: number, timeISO: string): { u: number; v: number } | null {
  const ms = Date.parse(timeISO);
  if (!Number.isFinite(ms)) return null;
  return sampleAt(grid, timeAxisMs(grid), lat, lon, ms);
}

// ---------------------------------------------------------------------------
// Hotspot sources

export interface HotspotPoint {
  latitude: number;
  longitude: number;
  frp: number;
}

export interface HotspotSource {
  /** Stable id: `${watchId}:${cellLat}:${cellLon}`. */
  id: string;
  watchId: string;
  /** Plain words, e.g. "Riau peatland hotspots". */
  label: string;
  /** FRP-weighted centroid of the cluster. */
  lat: number;
  lon: number;
  count: number;
  /** Sum of fire radiative power, MW. */
  frpSum: number;
}

/**
 * Cluster hotspots into cells of `cellDeg` (default 0.5°), FRP-weighted centroid per cell, largest
 * first (count, then FRP, then id), capped at `max`. Deterministic for the same input set.
 */
export function clusterHotspots(
  watchId: string,
  label: string,
  points: readonly HotspotPoint[],
  opts?: { cellDeg?: number; max?: number },
): HotspotSource[] {
  const cell = opts?.cellDeg ?? 0.5;
  const max = opts?.max ?? 6;
  const cells = new Map<string, { cj: number; ci: number; n: number; frp: number; wLat: number; wLon: number; w: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    const cj = Math.floor(p.latitude / cell);
    const ci = Math.floor(p.longitude / cell);
    const key = `${cj}:${ci}`;
    const c = cells.get(key) ?? { cj, ci, n: 0, frp: 0, wLat: 0, wLon: 0, w: 0 };
    const frp = Number.isFinite(p.frp) && p.frp > 0 ? p.frp : 0;
    const w = 1 + frp; // count and FRP both pull the centroid
    c.n += 1;
    c.frp += frp;
    c.wLat += p.latitude * w;
    c.wLon += p.longitude * w;
    c.w += w;
    cells.set(key, c);
  }
  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  return [...cells.values()]
    .map((c) => ({
      id: `${watchId}:${round(c.cj * cell, 3)}:${round(c.ci * cell, 3)}`,
      watchId,
      label,
      lat: round(c.wLat / c.w, 4),
      lon: round(c.wLon / c.w, 4),
      count: c.n,
      frpSum: round(c.frp, 1),
    }))
    .sort((a, b) => b.count - a.count || b.frpSum - a.frpSum || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Trajectories

export interface TrajectoryPoint {
  lat: number;
  lon: number;
  /** ISO 8601 UTC. */
  time: string;
}

export interface ReceptorResult {
  receptor: { name: string; lat: number; lon: number };
  /** Closest approach of the path to the receptor, km. */
  closestKm: number;
  /** ISO 8601 UTC time of closest approach. */
  closestTime: string;
  hoursToClosest: number;
  /** True when the path comes within REACH_KM. */
  reaches: boolean;
  /** Hours from the start until first within REACH_KM; null when it never does. */
  arrivalHours: number | null;
}

export interface Trajectory {
  source: HotspotSource;
  points: TrajectoryPoint[];
  /** "complete": ran the full hours; "grid-edge": left the grid; "time-edge": ran past the wind data. */
  endReason: 'complete' | 'grid-edge' | 'time-edge';
  hours: number;
  receptor: ReceptorResult;
  summary: string;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');

/** Degrees per second for a wind at a latitude. */
function rate(w: { u: number; v: number }, lat: number): { dLat: number; dLon: number } {
  const kmPerDegLon = KM_PER_DEG * Math.max(Math.cos(rad(lat)), 1e-6);
  return { dLat: w.v / 1000 / KM_PER_DEG, dLon: w.u / 1000 / kmPerDegLon };
}

function integrate(grid: WindGrid, tMs: number[], lat0: number, lon0: number, startMs: number, hours: number, stepMinutes: number) {
  const dt = stepMinutes * 60;
  const steps = Math.round((hours * 60) / stepMinutes);
  const pts: TrajectoryPoint[] = [{ lat: lat0, lon: lon0, time: iso(startMs) }];
  let lat = lat0;
  let lon = lon0;
  let ms = startMs;
  const tEnd = tMs[tMs.length - 1];
  let endReason: Trajectory['endReason'] = 'complete';
  if (sampleAt(grid, tMs, lat, lon, ms) === null) {
    endReason = ms < tMs[0] || ms > tEnd ? 'time-edge' : 'grid-edge';
    return { pts, endReason };
  }
  for (let s = 0; s < steps; s += 1) {
    if (ms + dt * 1000 > tEnd) {
      endReason = 'time-edge';
      break;
    }
    const w1 = sampleAt(grid, tMs, lat, lon, ms);
    if (!w1) {
      endReason = 'grid-edge';
      break;
    }
    const r1 = rate(w1, lat);
    const midLat = lat + (r1.dLat * dt) / 2;
    const midLon = lon + (r1.dLon * dt) / 2;
    const w2 = sampleAt(grid, tMs, midLat, midLon, ms + (dt * 1000) / 2);
    if (!w2) {
      endReason = 'grid-edge';
      break;
    }
    const r2 = rate(w2, midLat);
    const nLat = lat + r2.dLat * dt;
    const nLon = lon + r2.dLon * dt;
    if (locate(grid.lats, nLat) === null || locate(grid.lons, nLon) === null) {
      endReason = 'grid-edge';
      break;
    }
    lat = nLat;
    lon = nLon;
    ms += dt * 1000;
    pts.push({ lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, time: iso(ms) });
  }
  return { pts, endReason };
}

/** Closest approach of a polyline to a receptor (segments interpolated in a local flat projection). */
export function receptorAnalysis(
  points: readonly TrajectoryPoint[],
  receptor: { name: string; lat: number; lon: number } = { name: 'Singapore', ...SINGAPORE },
  reachKm = REACH_KM,
): ReceptorResult {
  const t0 = Date.parse(points[0].time);
  const kx = KM_PER_DEG * Math.cos(rad(receptor.lat));
  const xy = (p: TrajectoryPoint) => ({ x: (p.lon - receptor.lon) * kx, y: (p.lat - receptor.lat) * KM_PER_DEG });
  let best = { km: haversineKm(points[0].lat, points[0].lon, receptor.lat, receptor.lon), ms: t0 };
  let arrivalMs: number | null = best.km <= reachKm ? t0 : null;
  for (let k = 1; k < points.length; k += 1) {
    const a = xy(points[k - 1]);
    const b = xy(points[k]);
    const ta = Date.parse(points[k - 1].time);
    const tb = Date.parse(points[k].time);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const f = len2 > 0 ? Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2)) : 0;
    const km = Math.hypot(a.x + f * dx, a.y + f * dy);
    if (km < best.km) best = { km, ms: ta + f * (tb - ta) };
    if (arrivalMs === null && km <= reachKm) {
      // First entry into the reach circle along this segment.
      const A = len2;
      const B = 2 * (a.x * dx + a.y * dy);
      const C = a.x * a.x + a.y * a.y - reachKm * reachKm;
      const disc = B * B - 4 * A * C;
      const fe = A > 0 && disc >= 0 ? Math.max(0, (-B - Math.sqrt(disc)) / (2 * A)) : f;
      arrivalMs = ta + Math.min(1, fe) * (tb - ta);
    }
  }
  const h = (ms: number) => Math.round(((ms - t0) / 3_600_000) * 10) / 10;
  return {
    receptor: { ...receptor },
    closestKm: Math.round(best.km),
    closestTime: iso(Math.round(best.ms / 1000) * 1000),
    hoursToClosest: h(best.ms),
    reaches: arrivalMs !== null,
    arrivalHours: arrivalMs === null ? null : h(arrivalMs),
  };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass8(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function fmtLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** One plain sentence per trajectory, always with the caveat. */
export function summariseTrajectory(source: HotspotSource, points: readonly TrajectoryPoint[], r: ReceptorResult, level: string): string {
  const from = `${source.label} near ${fmtLatLon(source.lat, source.lon)} (${source.count} hotspot${source.count === 1 ? '' : 's'})`;
  const last = points[points.length - 1];
  const hours = Math.round((Date.parse(last.time) - Date.parse(points[0].time)) / 3_600_000);
  if (r.reaches) {
    return `Modelled ${level} winds carry air from ${from} to within ${r.closestKm} km of ${r.receptor.name} after ~${Math.round(r.arrivalHours ?? r.hoursToClosest)} h. ${TRANSPORT_CAVEAT}`;
  }
  const dy = last.lat - points[0].lat;
  const dx = (last.lon - points[0].lon) * Math.cos(rad(points[0].lat));
  const heading = Math.hypot(dx, dy) < 0.05 ? 'little net movement' : `a net drift toward the ${compass8((Math.atan2(dx, dy) * 180) / Math.PI)}`;
  return `Modelled ${level} winds carry air from ${from} with ${heading} over ${hours} h; it does not reach ${r.receptor.name} (closest ${r.closestKm} km, after ~${Math.round(r.hoursToClosest)} h). ${TRANSPORT_CAVEAT}`;
}

/** Forward trajectories (RK2 midpoint) from each source. Stops at the grid edge or the end of the wind data. */
export function computeTrajectories(
  grid: WindGrid,
  sources: readonly HotspotSource[],
  startISO: string,
  hours = 48,
  stepMinutes = 30,
): Trajectory[] {
  const startMs = Date.parse(startISO);
  if (!Number.isFinite(startMs) || stepMinutes <= 0 || hours <= 0) return [];
  const tMs = timeAxisMs(grid);
  return sources.map((source) => {
    const { pts, endReason } = integrate(grid, tMs, source.lat, source.lon, startMs, hours, stepMinutes);
    const receptor = receptorAnalysis(pts);
    return {
      source,
      points: pts,
      endReason,
      hours: Math.round(((Date.parse(pts[pts.length - 1].time) - startMs) / 3_600_000) * 10) / 10,
      receptor,
      summary: summariseTrajectory(source, pts, receptor, grid.level),
    };
  });
}

/**
 * Haze sources for one UTC day (default: each watch's latest day with thermal records): the confident
 * FIRMS members of every wildfire (haze box) watch, clustered per watch. Use with loadFixtures().
 */
export function hazeSourcesFromFixtures(
  fx: {
    watches: ReadonlyArray<Pick<Watch, 'id' | 'title' | 'hazard'>>;
    observations: readonly Observation[];
    members: Record<string, HotspotMember[]>;
  },
  opts?: { day?: string; cellDeg?: number; maxPerWatch?: number },
): HotspotSource[] {
  const out: HotspotSource[] = [];
  for (const w of fx.watches) {
    if (w.hazard !== 'wildfire') continue;
    const thermal = fx.observations.filter((o) => o.incidentId === w.id && o.category === 'thermal');
    if (thermal.length === 0) continue;
    const day = opts?.day ?? thermal.map((o) => o.observedAt.slice(0, 10)).sort().at(-1);
    const pts = thermal
      .filter((o) => o.observedAt.slice(0, 10) === day)
      .flatMap((o) => fx.members[o.id] ?? [])
      .filter((m) => m.meetsRule);
    out.push(...clusterHotspots(w.id, w.title, pts, { cellDeg: opts?.cellDeg, max: opts?.maxPerWatch }));
  }
  return out;
}
