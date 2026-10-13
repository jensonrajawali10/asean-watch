// Small pure display helpers for the UI shell. No wall-clock time, no locale-dependent dates.
import type { Category, DataMode, HazardType } from '../types';
import { NEA_RANGE_KM } from '../lib/nea';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 → "2026-03-14 06:20 UTC". Readable fallback for missing or unparseable input. */
export function formatUtc(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return 'Not available';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `Unreadable time (${iso})`;
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

function trimNumber(n: number): string {
  return String(Number(n.toFixed(4)));
}

/** (-7.54, 110.446) → "7.54° S, 110.446° E". */
export function formatCoords(lat: unknown, lon: unknown): string {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return 'Coordinates not available';
  }
  return `${trimNumber(Math.abs(lat))}° ${lat < 0 ? 'S' : 'N'}, ${trimNumber(Math.abs(lon))}° ${lon < 0 ? 'W' : 'E'}`;
}

/** Numeric value with unit ("24.6 MW"), or the text of a qualitative value. */
export function formatValue(value: unknown, unit: string | null | undefined): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'Invalid value';
    const v = value.toLocaleString('en-US', { maximumFractionDigits: 3 });
    return unit ? `${v} ${unit}` : v;
  }
  if (typeof value === 'string' && value.trim() !== '') return value;
  return 'No value';
}

export function isNumericValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export const CATEGORY_LABELS: Record<Category, string> = {
  thermal: 'Thermal',
  gas: 'Gas',
  deformation: 'Deformation',
  ash: 'Ash',
  seismic: 'Seismic',
  report: 'Report',
};

export const HAZARD_LABELS: Record<HazardType, string> = {
  volcano: 'Volcano',
  wildfire: 'Wildfire and haze',
  flood: 'Flood',
};

export const MODE_LABELS: Record<DataMode, string> = {
  simulated: 'SIMULATED',
  historical: 'HISTORICAL',
  live: 'LIVE',
};

export function categoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

export function hazardLabel(hazard: string): string {
  return (HAZARD_LABELS as Record<string, string>)[hazard] ?? hazard;
}

export function modeLabel(mode: string): string {
  return (MODE_LABELS as Record<string, string>)[mode] ?? String(mode).toUpperCase();
}

/** "1 observation" / "6 observations". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Only http(s) links are rendered as anchors; anything else is shown as plain text. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

const SINGAPORE = { lat: 1.3521, lon: 103.8198 };

/** True when a point is within the NEA context range of Singapore (great-circle distance). */
export function isNearSingapore(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const rad = Math.PI / 180;
  const dLat = (SINGAPORE.lat - lat) * rad;
  const dLon = (SINGAPORE.lon - lon) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(SINGAPORE.lat * rad) * Math.sin(dLon / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  return km <= NEA_RANGE_KM;
}

/** "Simulated fixture modelled on X" → "Modelled on X". "Modelled on" is never stripped. */
export function shortSourceName(name: string): string {
  const m = /^simulated fixture modell?ed on\s+(.+)$/i.exec(name.trim());
  return m ? `Modelled on ${m[1]}` : name;
}
