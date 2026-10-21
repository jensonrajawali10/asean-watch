// Pure helpers for the Water & tsunami section (kept out of the component file for fast refresh).
import { BMKG_LEVEL_RANK } from '../../lib/warnings';

/** BMKG areas shown before "Show all": enough for the most severe rows in a narrow drawer. */
export const BMKG_AREAS_PREVIEW = 8;

/** BMKG's named areas, most severe level first (AWAS, SIAGA, WASPADA, then any other), BMKG's order within a level. */
export function bmkgAreasBySeverity<T extends { level: string | null }>(areas: readonly T[]): T[] {
  const rank = (a: T) => BMKG_LEVEL_RANK[(a.level ?? '').trim().toUpperCase()] ?? 0;
  return areas.map((a, i) => ({ a, i })).sort((x, y) => rank(y.a) - rank(x.a) || x.i - y.i).map((x) => x.a);
}

/** A PTWC information statement (not a threat or warning product), by PTWC's own product category. */
export function isPtwcInformation(level: string): boolean {
  return /\binformation\b/i.test(level) && !/\b(warning|threat|watch|advisory)\b/i.test(level);
}
