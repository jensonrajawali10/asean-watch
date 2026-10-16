import { describe, expect, it } from 'vitest';
import type { OfficialWarning } from '../../types';
import { officialVolcanoLevel, parseLevelNumber } from './volcanoLevels';

const MERAPI = { title: 'Merapi', volcanoId: 'gvp-263250', lat: -7.54, lon: 110.446 };
/** A fixed clock after the records below. */
const NOW = Date.parse('2026-10-15T12:00:00Z');

function w(over: Partial<OfficialWarning>): OfficialWarning {
  return {
    id: 'magma:merapi',
    issuer: 'PVMBG MAGMA Indonesia',
    issuerUrl: 'https://magma.esdm.go.id/',
    authority: 'official',
    hazard: 'volcano',
    product: 'Tingkat aktivitas',
    level: 'Level III (Siaga)',
    levelGloss: 'Level 3 of 4',
    headline: 'Merapi',
    areaDescription: '',
    areas: [],
    location: { lat: -7.54, lon: 110.446 },
    issuedAt: '2026-10-13T06:52:00Z',
    expiresAt: null,
    ended: false,
    instruction: null,
    language: 'id',
    sourceUrl: 'https://magma.esdm.go.id/',
    dataMode: 'historical',
    retrievedAt: '2026-10-13T06:52:00Z',
    ...over,
  };
}

describe('parseLevelNumber', () => {
  it('reads Roman and Arabic level numbers', () => {
    expect(parseLevelNumber('Level III (Siaga)')).toBe(3);
    expect(parseLevelNumber('Level IV (Awas)')).toBe(4);
    expect(parseLevelNumber('Alert Level 2')).toBe(2);
    expect(parseLevelNumber('Tsunami Advisory')).toBeNull();
  });
});

describe('officialVolcanoLevel', () => {
  it('returns the verbatim level of the nearest active official volcano message', () => {
    const far = w({ id: 'magma:semeru', level: 'Level II (Waspada)', location: { lat: -8.108, lon: 112.922 } });
    const result = officialVolcanoLevel(MERAPI, [far, w({})], NOW);
    expect(result?.level).toBe('Level III (Siaga)');
    expect(result?.levelNumber).toBe(3);
    expect(result?.issuer).toBe('PVMBG MAGMA Indonesia');
  });

  it('ignores ended messages, aggregators, other hazards and messages without a position', () => {
    expect(officialVolcanoLevel(MERAPI, [w({ ended: true })], NOW)).toBeNull();
    expect(officialVolcanoLevel(MERAPI, [w({ authority: 'aggregator' })], NOW)).toBeNull();
    expect(officialVolcanoLevel(MERAPI, [w({ hazard: 'earthquake' })], NOW)).toBeNull();
    expect(officialVolcanoLevel(MERAPI, [w({ location: null })], NOW)).toBeNull();
  });

  it('prefers the newest message at the same place', () => {
    const older = w({ id: 'a', level: 'Level II (Waspada)', issuedAt: '2026-10-01T00:00:00Z' });
    const newer = w({ id: 'b', level: 'Level III (Siaga)', issuedAt: '2026-10-13T00:00:00Z' });
    expect(officialVolcanoLevel(MERAPI, [older, newer], NOW)?.warningId).toBe('b');
  });

  it("prefers the record naming the volcano, and never one carrying another volcano's GVP number", () => {
    const nearerUnnamed = w({ id: 'other-feed:1', level: 'Level II (Waspada)' });
    const naming = w({ id: 'magma-level-list:263250:2026-10-13T07:51:22Z', location: { lat: -7.6, lon: 110.5 } });
    expect(officialVolcanoLevel(MERAPI, [nearerUnnamed, naming], NOW)?.warningId).toBe(naming.id);
    const semeruAtMerapi = w({ id: 'magma-level-list:263300:2026-10-13T07:51:22Z' });
    expect(officialVolcanoLevel(MERAPI, [semeruAtMerapi], NOW)).toBeNull();
  });

  it('judges expiry on the clock and carries the mode and retrieval time for the card', () => {
    const dated = w({ expiresAt: '2026-10-14T00:00:00Z' });
    expect(officialVolcanoLevel(MERAPI, [dated], Date.parse('2026-10-13T12:00:00Z'))?.retrievedAt).toBe('2026-10-13T06:52:00Z');
    expect(officialVolcanoLevel(MERAPI, [dated], NOW)).toBeNull();
    expect(officialVolcanoLevel(MERAPI, [w({})], NOW)?.dataMode).toBe('historical');
  });
});
