// View helpers for official warnings: how the relayed messages are combined, matched and labelled in
// the UI. Pure and deterministic (any clock is passed in), so the map, the rail and the analyst
// workspace all make the same decisions. Nothing here rewords, re-scores or merges an issuer's text.
import type { OfficialWarning } from '../types';
import { compareWarnings } from './warnings';

/**
 * One list from several sources (the official feeds and PTWC), newest first with the same ordering as
 * loadOfficialWarnings (issuedAt descending, no issue time last, then issuer and id).
 */
export function mergeWarnings(...lists: readonly (readonly OfficialWarning[])[]): OfficialWarning[] {
  return lists.flat().sort(compareWarnings);
}
