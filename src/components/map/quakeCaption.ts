// The map caption for the earthquake layer: what the layer covers, each source's data mode and
// retrieval time (from the quake statuses), and the counts. Pure (the clock is passed in). When no
// source is live, it says so instead of counting "the last 24 h": a zero from a stale snapshot would
// read as an all-clear.
import type { ConnectorStatus, QuakeEvent } from '../../types';
import { formatUtc } from '../format';
import { isRecentQuake } from './connectorRender';

/** What the layer holds: USGS FDSN M4.5+ for the past 7 days, and BMKG's own latest lists (any magnitude). */
export const QUAKE_SCOPE = 'USGS M4.5+ (7 days) and BMKG latest lists';

export interface QuakeCaption {
  /** The bold part: scope and symbology. */
  key: string;
  /** Data mode and retrieval time per source, then the counts. */
  meta: string;
}

const NOT_A_WARNING = "Each agency's report is shown separately. Not a tsunami warning.";

/** The oldest retrieval time of a group (the conservative "as of"), or null. */
function oldest(statuses: readonly ConnectorStatus[]): string | null {
  const times = statuses.map((s) => s.retrievedAt).filter((t): t is string => typeof t === 'string' && t !== '');
  return times.length ? times.sort()[0] : null;
}

function group(label: string, statuses: readonly ConnectorStatus[], withNames: boolean): string {
  const at = oldest(statuses);
  const names = withNames ? ` (${statuses.map((s) => s.sourceName).join(', ')})` : '';
  return `${label}${at ? ` ${formatUtc(at)}` : ''}${names}`;
}

export function quakeCaption(statuses: readonly ConnectorStatus[], events: readonly QuakeEvent[], nowMs: number): QuakeCaption {
  const key = `Earthquakes: ${QUAKE_SCOPE} (USGS filled, BMKG rings), sized by magnitude, coloured by depth.`;
  const live = statuses.filter((s) => s.status === 'live' || s.status === 'cached');
  const snapshot = statuses.filter((s) => s.status === 'snapshot');
  const unavailable = statuses.filter((s) => s.status === 'unavailable');
  const recent = events.filter((q) => isRecentQuake(q.timeISO, nowMs)).length;

  if (live.length === 0) {
    const mode =
      snapshot.length > 0
        ? group('HISTORICAL SNAPSHOT', snapshot, false)
        : `Earthquake feeds unavailable: check ${statuses.map((s) => s.sourceName).join(', ') || 'USGS and BMKG'} directly`;
    const bright = recent > 0 ? `, ${recent} within 24 h of now (bright)` : '';
    return {
      key,
      meta:
        `${mode}. Not refreshed live, so recent earthquakes may be missing. ` +
        `${events.length} ${events.length === 1 ? 'report' : 'reports'} from the snapshot${bright}. ${NOT_A_WARNING}`,
    };
  }

  const mixed = snapshot.length > 0 || unavailable.length > 0;
  const modes = [group('LIVE', live, mixed)];
  if (snapshot.length > 0) modes.push(group('HISTORICAL SNAPSHOT', snapshot, true));
  if (unavailable.length > 0) modes.push(`unavailable (${unavailable.map((s) => s.sourceName).join(', ')})`);
  return {
    key,
    meta: `${modes.join(' · ')}. ${recent} in the last 24 h (bright), ${events.length - recent} earlier. ${NOT_A_WARNING}`,
  };
}
