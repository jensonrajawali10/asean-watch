// View helpers for official warnings: how the relayed messages are combined, matched and labelled in
// the UI. Pure and deterministic (any clock is passed in), so the map, the rail and the analyst
// workspace all make the same decisions. Nothing here rewords, re-scores or merges an issuer's text.
import type { HazardType, Incident, OfficialWarning, WarningHazard } from '../types';
import { compareWarnings } from './warnings';

/**
 * One list from several sources (the official feeds and PTWC), newest first with the same ordering as
 * loadOfficialWarnings (issuedAt descending, no issue time last, then issuer and id).
 */
export function mergeWarnings(...lists: readonly (readonly OfficialWarning[])[]): OfficialWarning[] {
  return lists.flat().sort(compareWarnings);
}

/** The official hazards that answer a watch area's hazard. A wildfire watch is about its smoke (haze). */
const XREF_HAZARDS: Record<HazardType, readonly WarningHazard[]> = {
  volcano: ['volcano'],
  flood: ['flood'],
  wildfire: ['haze'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Smithsonian GVP number from a watch's volcanoId ("gvp-262000" -> "262000"). */
function gvpNumber(volcanoId: string | null): string | null {
  return /(?:^|\D)(\d{6})$/.exec(volcanoId ?? '')?.[1] ?? null;
}

/** GVP numbers a record carries as an id segment (MAGMA: "magma-level-list:<gvp>:<retrievedAt>"). */
function idGvpNumbers(w: OfficialWarning): string[] {
  return w.id.split(':').filter((s) => /^\d{6}$/.test(s));
}

/**
 * The official level to show beside a watch area's own state: the first active official message (in
 * the given order) for the watch's hazard. For a volcano, the record naming that volcano (by GVP number
 * or by area name) is preferred, and a record naming another volcano is never used. Returns null rather
 * than a message for another hazard or another volcano: no block is better than a misleading one.
 */
export function officialLevelFor(
  incident: Pick<Incident, 'hazard' | 'title' | 'volcanoId'>,
  warnings: readonly OfficialWarning[],
): OfficialWarning | null {
  const hazards = XREF_HAZARDS[incident.hazard] ?? [];
  const candidates = warnings.filter((w) => w.authority === 'official' && !w.ended && hazards.includes(w.hazard));
  if (incident.hazard !== 'volcano') return candidates[0] ?? null;
  const gvp = gvpNumber(incident.volcanoId);
  const title = norm(incident.title);
  const naming = candidates.find(
    (w) => (gvp !== null && idGvpNumbers(w).includes(gvp)) || (title !== '' && w.areas.some((a) => norm(a.name) === title)),
  );
  if (naming) return naming;
  return candidates.find((w) => idGvpNumbers(w).every((n) => n === gvp)) ?? null;
}
