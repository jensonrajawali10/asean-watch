// The earthquake caption (M5), on the bundled quakes snapshot (data/quakes-snapshot.json).
import { describe, expect, it } from 'vitest';
import type { ConnectorStatus } from '../../types';
import { loadQuakesSnapshot } from '../../lib/quakesLive';
import { QUAKE_SCOPE, quakeCaption } from './quakeCaption';

const SNAP = loadQuakesSnapshot();
/** Two days after the snapshot capture (2026-10-14 11:47 UTC). */
const LATER = Date.parse('2026-10-16T12:00:00Z');
/** Just after the capture: some snapshot events are within 24 h. */
const AT_CAPTURE = Date.parse('2026-10-14T12:00:00Z');

const asLive = (s: ConnectorStatus, at = '2026-10-16T11:58:00Z'): ConnectorStatus => ({ ...s, status: 'live', retrievedAt: at, message: `LIVE, fetched ${at}.` });

describe('quakeCaption', () => {
  it('names the real scope: USGS M4.5+ for 7 days and the BMKG latest lists', () => {
    const { key } = quakeCaption(SNAP.statuses, SNAP.events, LATER);
    expect(QUAKE_SCOPE).toBe('USGS M4.5+ (7 days) and BMKG latest lists');
    expect(key).toContain(QUAKE_SCOPE);
    expect(key).not.toMatch(/^Earthquakes M4\.5\+/);
    // Real data: the BMKG list includes events below M4.5, so "M4.5+" alone was wrong.
    expect(SNAP.events.some((q) => q.source === 'BMKG' && q.magnitude < 4.5)).toBe(true);
  });

  it('on the snapshot, says HISTORICAL SNAPSHOT with its time and does not count "the last 24 h"', () => {
    expect(SNAP.statuses.every((s) => s.status === 'snapshot')).toBe(true);
    const { meta } = quakeCaption(SNAP.statuses, SNAP.events, LATER);
    expect(meta).toMatch(/^HISTORICAL SNAPSHOT 2026-10-14 11:47 UTC\. Not refreshed live, so recent earthquakes may be missing\./);
    expect(meta).toContain(`${SNAP.events.length} reports from the snapshot.`);
    expect(meta).not.toMatch(/last 24 h/);
    expect(meta).not.toMatch(/\b0 /);
  });

  it('on the snapshot, still points out reports that are within 24 h of now', () => {
    const { meta } = quakeCaption(SNAP.statuses, SNAP.events, AT_CAPTURE);
    expect(meta).toMatch(/, [1-9]\d* within 24 h of now \(bright\)\./);
    expect(meta).not.toMatch(/last 24 h/);
  });

  it('when live, gives LIVE with the retrieval time and the 24 h counts', () => {
    const statuses = SNAP.statuses.map((s) => asLive(s));
    const { meta } = quakeCaption(statuses, SNAP.events, AT_CAPTURE);
    expect(meta).toMatch(/^LIVE 2026-10-16 11:58 UTC\. [1-9]\d* in the last 24 h \(bright\), \d+ earlier\./);
  });

  it('when mixed, labels each group with its sources', () => {
    const statuses = SNAP.statuses.map((s) => (s.sourceId === 'usgs-quakes' ? asLive(s) : s));
    const { meta } = quakeCaption(statuses, SNAP.events, LATER);
    expect(meta).toMatch(/^LIVE 2026-10-16 11:58 UTC \(USGS Earthquake Hazards Program\) · HISTORICAL SNAPSHOT 2026-10-14 11:47 UTC \(BMKG, BMKG InaTEWS\)\./);
    expect(meta).toMatch(/in the last 24 h/);
  });

  it('when every source is unavailable, says so and never counts', () => {
    const statuses = SNAP.statuses.map((s): ConnectorStatus => ({ ...s, status: 'unavailable', retrievedAt: null }));
    const { meta } = quakeCaption(statuses, [], LATER);
    expect(meta).toMatch(/^Earthquake feeds unavailable: check USGS Earthquake Hazards Program, BMKG, BMKG InaTEWS directly\./);
    expect(meta).not.toMatch(/last 24 h/);
  });
});
