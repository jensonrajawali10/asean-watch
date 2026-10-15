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
 * the given order, judged on the nowMs clock) for the watch's hazard. For a volcano, the record naming
 * that volcano (by GVP number or by area name) is preferred, and a record carrying another volcano's GVP
 * number is never used. Returns null rather than a message for another hazard: no block is better than a
 * misleading one.
 */
export function officialLevelFor(
  incident: Pick<Incident, 'hazard' | 'title' | 'volcanoId'>,
  warnings: readonly OfficialWarning[],
  nowMs: number,
): OfficialWarning | null {
  const hazards = XREF_HAZARDS[incident.hazard] ?? [];
  const candidates = warnings.filter((w) => w.authority === 'official' && !isExpired(w, nowMs) && hazards.includes(w.hazard));
  if (incident.hazard !== 'volcano') return candidates[0] ?? null;
  const gvp = gvpNumber(incident.volcanoId);
  const title = norm(incident.title);
  const naming = candidates.find(
    (w) => (gvp !== null && idGvpNumbers(w).includes(gvp)) || (title !== '' && w.areas.some((a) => norm(a.name) === title)),
  );
  if (naming) return naming;
  return candidates.find((w) => idGvpNumbers(w).every((n) => n === gvp)) ?? null;
}

/**
 * True when the warning was relayed from this gauge. The adapters build the id as
 * "<gauge id>:<observedAt>" (ThaiWater, DSDA), so the warning id equals the gauge id or starts with it
 * plus ':'. A substring test is wrong: "thaiwater:T.1" is inside "thaiwater:T.13:…".
 */
export function warningMatchesGauge(warningId: string, gaugeId: string): boolean {
  if (!gaugeId || gaugeId.endsWith(':')) return false;
  return warningId === gaugeId || warningId.startsWith(`${gaugeId}:`);
}

/** Epoch ms of an ISO time, or null when absent or unreadable. */
function timeMs(iso: string | null | undefined): number | null {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * True when a message is no longer in force: the issuer ended or cancelled it, or its expiry has passed
 * on the nowMs clock. `ended` alone was fixed when the message was parsed (against its retrieval time),
 * so a bundled snapshot or a tab left open would otherwise keep an expired message active.
 */
export function isExpired(w: Pick<OfficialWarning, 'ended' | 'expiresAt'>, nowMs: number): boolean {
  if (w.ended) return true;
  const expires = timeMs(w.expiresAt);
  return expires !== null && expires <= nowMs;
}

/** How an inactive message is labelled. EXPIRED carries the issuer's expiry time. */
export type EndedLabel = { text: 'ENDED' } | { text: 'EXPIRED'; at: string };

/**
 * The label for a message that is no longer in force, or null while it is active:
 * - ENDED when the issuer ended or cancelled it before its expiry (expiry still ahead when retrieved),
 *   or ended it without giving an expiry;
 * - EXPIRED <expiry> only once the expiry has passed on the nowMs clock.
 */
export function endedLabel(w: Pick<OfficialWarning, 'ended' | 'expiresAt' | 'retrievedAt'>, nowMs: number): EndedLabel | null {
  if (!isExpired(w, nowMs)) return null;
  const expires = timeMs(w.expiresAt);
  const retrieved = timeMs(w.retrievedAt);
  const endedBeforeExpiry = w.ended && expires !== null && retrieved !== null && expires > retrieved;
  if (w.expiresAt && expires !== null && expires <= nowMs && !endedBeforeExpiry) return { text: 'EXPIRED', at: w.expiresAt };
  return { text: 'ENDED' };
}

/** Official warnings within this distance of a watch area are listed next to it (km). */
export const NEAR_KM = 150;

/**
 * The panel's text when its list is empty. Near a watch area it says what was searched (the radius and
 * place), because other warnings were retrieved; it never reads as an all-clear.
 */
export function emptyWarningsText(opts: { loading: boolean; nearName: string | null; nearKm?: number }): string {
  if (opts.loading) return 'Loading official feeds…';
  if (opts.nearName) return `None within ${opts.nearKm ?? NEAR_KM} km of ${opts.nearName} in the feeds below. This is not an all-clear.`;
  return 'No official warnings retrieved from the feeds below. This is not an all-clear.';
}
