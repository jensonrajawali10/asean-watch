import { describe, expect, it } from 'vitest';
import type { OfficialWarning } from '../../types';
import { activeOfficial, alertsPill, countsText, groupByHazard, HAZARD_ORDER, hazardMix, isUrgentWarning, warningCounts } from './alerts';

function warning(over: Partial<OfficialWarning>): OfficialWarning {
  return {
    id: 'x:1',
    issuer: 'BMKG InaTEWS',
    issuerUrl: 'https://inatews.bmkg.go.id/',
    authority: 'official',
    hazard: 'volcano',
    product: 'Level',
    level: 'Level III (Siaga)',
    levelGloss: null,
    headline: 'Merapi',
    areaDescription: '',
    areas: [],
    location: null,
    issuedAt: '2026-10-13T00:00:00Z',
    expiresAt: null,
    ended: false,
    instruction: null,
    language: 'id',
    sourceUrl: 'https://example.org',
    dataMode: 'historical',
    retrievedAt: '2026-10-13T00:00:00Z',
    ...over,
  };
}

describe('alertsPill', () => {
  it('counts active official messages only', () => {
    const list = [warning({}), warning({ id: 'x:2', ended: true }), warning({ id: 'x:3', authority: 'aggregator' })];
    expect(activeOfficial(list)).toHaveLength(1);
    expect(alertsPill(list)).toEqual({ count: 1, urgent: false, label: 'official alert in force: volcano' });
    expect(alertsPill([]).label).toBe('official alerts in force');
  });

  it('turns red for a tsunami warning in force, not for an information statement', () => {
    expect(isUrgentWarning(warning({ hazard: 'tsunami', level: 'Warning Tsunami PD-3.4', product: 'Warning' }))).toBe(true);
    expect(isUrgentWarning(warning({ hazard: 'tsunami', level: 'Tsunami Information', product: 'TSUNAMI INFORMATION STATEMENT' }))).toBe(false);
    expect(isUrgentWarning(warning({ hazard: 'tsunami', ended: true, level: 'Warning' }))).toBe(false);
  });

  it('turns red for an evacuation instruction in any hazard', () => {
    expect(isUrgentWarning(warning({ instruction: 'Masyarakat agar segera mengungsi ke tempat aman' }))).toBe(true);
    expect(isUrgentWarning(warning({ headline: 'Residents should evacuate the 5 km zone' }))).toBe(true);
    expect(isUrgentWarning(warning({}))).toBe(false);
  });

  it('judges expiry on the page clock when given one', () => {
    const tsunami = warning({ hazard: 'tsunami', level: 'Warning', product: 'Warning', expiresAt: '2026-10-14T00:00:00Z' });
    const before = Date.parse('2026-10-13T12:00:00Z');
    const after = Date.parse('2026-10-14T06:00:00Z');
    expect(alertsPill([tsunami], before)).toEqual({ count: 1, urgent: true, label: 'official alert in force: tsunami' });
    // Past its expiry: no longer counted, and the pill is not red, although the issuer's ended flag is false.
    expect(alertsPill([tsunami], after)).toEqual({ count: 0, urgent: false, label: 'official alerts in force' });
    expect(isUrgentWarning(tsunami, after)).toBe(false);
    // Without a clock: judged as relayed.
    expect(alertsPill([tsunami]).count).toBe(1);
  });
});

describe('warningCounts: one number everywhere', () => {
  it('the pill, the tile and the list heading count the same in-force set', async () => {
    const { loadWarningsSnapshot } = await import('../../lib/warnings');
    const { loadPtwcSnapshot } = await import('../../lib/ptwc');
    const { mergeWarnings } = await import('../../lib/warningsView');
    const all = mergeWarnings(loadWarningsSnapshot().warnings, loadPtwcSnapshot().warnings);
    const now = Date.parse('2026-10-20T06:00:00Z');
    const c = warningCounts(all, now);
    expect(c.inForce).toBe(alertsPill(all, now).count);
    expect(c.inForce).toBe(activeOfficial(all, now).length);
    expect(c.inForce + c.endedOrExpired + c.estimates).toBe(all.length);
    expect(countsText(c)).toBe(
      `${c.total} messages: ${c.inForce} in force` +
        (c.endedOrExpired ? `, ${c.endedOrExpired} ended or expired` : '') +
        (c.estimates ? `, ${c.estimates} impact estimate${c.estimates === 1 ? '' : 's'}` : ''),
    );
  });
});

describe('what the alerts are about', () => {
  const list = [
    warning({ id: 'f1', hazard: 'flood' }),
    warning({ id: 'f2', hazard: 'flood' }),
    warning({ id: 'v1', hazard: 'volcano' }),
    warning({ id: 't1', hazard: 'tsunami' }),
  ];
  it('names the most numerous kinds first, up to three', () => {
    expect(hazardMix(list)).toBe('floods, tsunami, volcano');
    expect(alertsPill(list).label).toBe('official alerts in force: floods, tsunami, volcano');
  });
  it('groups the list by hazard, tsunami first, keeping each group in order', () => {
    const g = groupByHazard(list);
    expect(g.map((x) => x.hazard)).toEqual(['tsunami', 'volcano', 'flood']);
    expect(g[2].items.map((w) => w.id)).toEqual(['f1', 'f2']);
    expect(HAZARD_ORDER[0]).toBe('tsunami');
  });
});
