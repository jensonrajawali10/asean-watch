// The official activity level to ring a volcano marker with (docs/UX_V3.md section 2): the issuer's own
// level, verbatim. Which record that is comes from the one shared rule, officialLevelFor
// (src/lib/warningsView.ts), so the map ring, the volcano card and the review's cross-reference always
// show the same message. Only the ring colour is ours, and it follows the issuer's published scale
// (MAGMA Level I to IV, PHIVOLCS Alert Level 0 to 5). Pure, tested.
import type { OfficialWarning } from '../../types';
import { LEVEL_RADIUS_KM, officialLevelFor } from '../../lib/warningsView';
import type { OfficialLevelWatch } from '../../lib/warningsView';

/** Official volcano messages that do not name the volcano count only within this distance of it. */
export { LEVEL_RADIUS_KM };

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
  /** When the record was retrieved (a recorded MAGMA level is HISTORICAL as of this time). */
  retrievedAt: string;
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

/** The ring and card view of an official level record; null passes through. */
export function toOfficialVolcanoLevel(w: OfficialWarning | null): OfficialVolcanoLevel | null {
  if (!w) return null;
  return {
    level: w.level,
    issuer: w.issuer,
    issuerUrl: w.issuerUrl,
    levelNumber: parseLevelNumber(w.level),
    warningId: w.id,
    issuedAt: w.issuedAt,
    dataMode: w.dataMode,
    retrievedAt: w.retrievedAt,
  };
}

/**
 * The official level of a watched volcano (officialLevelFor): the active record naming it, else the
 * nearest active official volcano message within LEVEL_RADIUS_KM that names no other volcano. Expiry is
 * judged on the nowMs clock. Aggregator items never count.
 */
export function officialVolcanoLevel(
  watch: Omit<OfficialLevelWatch, 'hazard'>,
  warnings: readonly OfficialWarning[],
  nowMs: number,
): OfficialVolcanoLevel | null {
  return toOfficialVolcanoLevel(officialLevelFor({ ...watch, hazard: 'volcano' }, warnings, nowMs));
}
