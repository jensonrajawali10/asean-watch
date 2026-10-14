// Pure render helpers for the connector layers (earthquakes, tide gauges, modelled river flow) and the
// map's caption stack. No DOM, no map: tested in connectorRender.test.ts.
import type { QuakeEvent } from '../../types';

export type RGB = [number, number, number];

/** Earthquakes newer than this are drawn emphasised (full opacity, thicker outline). */
export const QUAKE_RECENT_HOURS = 24;

/** Pixel radius by magnitude: M4.5 = 3 px, +3.5 px per magnitude unit, 3..16 px. */
export function quakeRadiusPx(magnitude: number): number {
  if (!Number.isFinite(magnitude)) return 3;
  return Math.min(16, Math.max(3, 3 + (magnitude - 4.5) * 3.5));
}

export type DepthBand = 'shallow' | 'intermediate' | 'deep' | 'unknown';

/** Conventional seismological depth classes: shallow < 70 km, intermediate 70-300 km, deep >= 300 km. */
export function quakeDepthBand(depthKm: number | null): DepthBand {
  if (depthKm === null || !Number.isFinite(depthKm)) return 'unknown';
  if (depthKm < 70) return 'shallow';
  if (depthKm < 300) return 'intermediate';
  return 'deep';
}

/** Depth colours: amber, teal, violet, grey. Never the reserved official red. */
export const QUAKE_DEPTH_RGB: Record<DepthBand, RGB> = {
  shallow: [242, 176, 64],
  intermediate: [64, 168, 190],
  deep: [150, 118, 214],
  unknown: [150, 150, 150],
};

export const DEPTH_LABEL: Record<DepthBand, string> = {
  shallow: 'shallow (< 70 km)',
  intermediate: 'intermediate (70-300 km)',
  deep: 'deep (300 km +)',
  unknown: 'depth not given',
};

export function isRecentQuake(timeISO: string, nowMs: number): boolean {
  const t = Date.parse(timeISO);
  return Number.isFinite(t) && nowMs - t <= QUAKE_RECENT_HOURS * 3600000 && t <= nowMs + 3600000;
}

function utc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/**
 * Hover text for one agency report. The USGS tsunami flag appears only together with its "not a
 * warning" note; BMKG's tsunami-potential statement is quoted verbatim.
 */
export function quakeTooltip(q: QuakeEvent, tsunamiFlagNote: string): string {
  const lines = [
    `Earthquake · ${q.source} (${q.dataMode === 'live' ? 'LIVE' : 'HISTORICAL SNAPSHOT'})`,
    q.product,
    `M ${Number(q.magnitude.toFixed(1))} ${q.magType ?? '(type not given)'} · ${q.depthKm !== null ? `depth ${Number(q.depthKm.toFixed(0))} km` : 'depth not given'}`,
    utc(q.timeISO),
    q.place,
  ];
  if (q.potential) lines.push(`BMKG: ${q.potential}`);
  if (q.source === 'USGS' && q.tsunamiFlag === true) lines.push(`USGS tsunami flag set. ${tsunamiFlagNote}`);
  return lines.join('\n');
}

export interface ChartGeometry {
  /** SVG path data; a missing value starts a new segment. */
  path: string;
  min: number;
  max: number;
  t0: number;
  t1: number;
}

/** Line chart geometry for an inline SVG of `width` x `height` with `pad` px inside. Null with < 2 values. */
export function lineChart(points: readonly { t: number; v: number | null }[], width: number, height: number, pad: number): ChartGeometry | null {
  const valid = points.filter((p): p is { t: number; v: number } => p.v !== null && Number.isFinite(p.v) && Number.isFinite(p.t));
  if (valid.length < 2) return null;
  const t0 = Math.min(...valid.map((p) => p.t));
  const t1 = Math.max(...valid.map((p) => p.t));
  const min = Math.min(...valid.map((p) => p.v));
  const max = Math.max(...valid.map((p) => p.v));
  const w = width - 2 * pad;
  const h = height - 2 * pad;
  const x = (t: number) => pad + (t1 === t0 ? w / 2 : ((t - t0) / (t1 - t0)) * w);
  const y = (v: number) => pad + (max === min ? h / 2 : (1 - (v - min) / (max - min)) * h);
  let path = '';
  let pen = false;
  for (const p of points) {
    if (p.v === null || !Number.isFinite(p.v) || !Number.isFinite(p.t)) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  }
  return { path, min, max, t0, t1 };
}

/** Caption stack: at most `maxVisible` notes shown; the rest go behind a "Notes (n)" chip. */
export function stackNotes<T>(entries: readonly T[], maxVisible = 2): { visible: T[]; hidden: T[] } {
  return { visible: entries.slice(0, maxVisible), hidden: entries.slice(maxVisible) };
}
