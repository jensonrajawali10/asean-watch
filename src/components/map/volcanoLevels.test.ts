import { describe, expect, it } from 'vitest';
import type { OfficialWarning } from '../../types';
import { officialVolcanoLevel, parseLevelNumber } from './volcanoLevels';

const MERAPI = { lat: -7.54, lon: 110.446 };

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
    const result = officialVolcanoLevel(MERAPI, [far, w({})]);
    expect(result?.level).toBe('Level III (Siaga)');
    expect(result?.levelNumber).toBe(3);
    expect(result?.issuer).toBe('PVMBG MAGMA Indonesia');
  });

  it('ignores ended messages, aggregators, other hazards and messages without a position', () => {
    expect(officialVolcanoLevel(MERAPI, [w({ ended: true })])).toBeNull();
    expect(officialVolcanoLevel(MERAPI, [w({ authority: 'aggregator' })])).toBeNull();
    expect(officialVolcanoLevel(MERAPI, [w({ hazard: 'earthquake' })])).toBeNull();
    expect(officialVolcanoLevel(MERAPI, [w({ location: null })])).toBeNull();
  });

  it('prefers the newest message at the same place', () => {
    const older = w({ id: 'a', level: 'Level II (Waspada)', issuedAt: '2026-10-01T00:00:00Z' });
    const newer = w({ id: 'b', level: 'Level III (Siaga)', issuedAt: '2026-10-13T00:00:00Z' });
    expect(officialVolcanoLevel(MERAPI, [older, newer])?.warningId).toBe('b');
  });
});
