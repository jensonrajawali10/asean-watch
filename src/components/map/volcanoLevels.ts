// The official activity level to ring a volcano marker with (docs/UX_V3.md section 2): the issuer's own
// level, verbatim, from the official warnings near the summit. Only the ring colour is ours, and it follows
// the issuer's published scale (MAGMA Level I to IV, PHIVOLCS Alert Level 0 to 5). Pure, tested.
import type { OfficialWarning } from '../../types';
import { warningDistanceKm } from '../../lib/warnings';

/** Official volcano messages further than this from the summit are not about it. */
export const LEVEL_RADIUS_KM = 60;

export interface OfficialVolcanoLevel {
  /** Verbatim level, e.g. "Level III (Siaga)". */
  level: string;
  issuer: string;
  issuerUrl: string;
  /** 0 to 5 parsed from the level text; null when no number can be read. */
  levelNumber: number | null;
  warningId: string;
  issuedAt: string | null;
  dataMode: 'live' | 'historical';
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

/** "Level III (Siaga)" -> 3, "Alert Level 2" -> 2, "Level 4" -> 4; null when unreadable. */
export function parseLevelNumber(level: string): number | null {
  const roman = /\blevel\s+(IV|III|II|I|V)\b/i.exec(level);
  if (roman) return ROMAN[roman[1].toUpperCase()] ?? null;
  const digit = /\blevel\s+(\d)\b/i.exec(level);
  if (digit) return Number(digit[1]);
  return null;
}

/**
 * The active official volcano message nearest the summit (ties: newest). Aggregator items never count.
 */
export function officialVolcanoLevel(
  volcano: { lat: number; lon: number },
  warnings: readonly OfficialWarning[],
  radiusKm: number = LEVEL_RADIUS_KM,
): OfficialVolcanoLevel | null {
  let best: { w: OfficialWarning; km: number } | null = null;
  for (const w of warnings) {
    if (w.authority !== 'official' || w.hazard !== 'volcano' || w.ended) continue;
    const km = warningDistanceKm(w, volcano.lat, volcano.lon);
    if (km === null || km > radiusKm) continue;
    if (!best || km < best.km - 1e-6 || (Math.abs(km - best.km) <= 1e-6 && issued(w) > issued(best.w))) best = { w, km };
  }
  if (!best) return null;
  const w = best.w;
  return {
    level: w.level,
    issuer: w.issuer,
    issuerUrl: w.issuerUrl,
    levelNumber: parseLevelNumber(w.level),
    warningId: w.id,
    issuedAt: w.issuedAt,
    dataMode: w.dataMode,
  };
}

function issued(w: OfficialWarning): number {
  const t = Date.parse(w.issuedAt ?? '');
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}
