// Tests for the official-warning view helpers, on real items from the bundled snapshots
// (data/warnings-snapshot.json, data/ptwc-snapshot.json) wherever the snapshot has the case.
import { describe, expect, it } from 'vitest';
import type { Incident, OfficialWarning } from '../types';
import { compareWarnings, loadWarningsSnapshot, warningsNear } from './warnings';
import { loadPtwcSnapshot } from './ptwc';
import { loadFixtures } from './fixtures';
import { mergeWarnings, officialLevelFor } from './warningsView';

const FEED = loadWarningsSnapshot();
const PTWC = loadPtwcSnapshot();
const ALL = mergeWarnings(FEED.warnings, PTWC.warnings);
const INCIDENTS = loadFixtures().incidents;
/** App's radius for "near" a watch area. */
const NEAR_KM = 150;

const incident = (id: string): Incident => {
  const found = INCIDENTS.find((i) => i.id === id);
  if (!found) throw new Error(`no watch ${id} in the fixtures`);
  return found;
};
const nearTo = (i: Incident) => warningsNear(ALL, i.lat, i.lon, NEAR_KM);
const byId = (id: string): OfficialWarning => {
  const found = ALL.find((w) => w.id === id);
  if (!found) throw new Error(`no warning ${id} in the snapshot`);
  return found;
};

/** The landing view's "newest 20" (OfficialWarnings LIST_CAP). */
const LIST_CAP = 20;

describe('mergeWarnings (H1)', () => {
  const merged = mergeWarnings(FEED.warnings, PTWC.warnings);

  it('keeps every item from both sources', () => {
    expect(FEED.warnings.length).toBeGreaterThan(LIST_CAP);
    expect(PTWC.warnings).toHaveLength(1);
    expect(merged).toHaveLength(FEED.warnings.length + PTWC.warnings.length);
  });

  it('puts the PTWC message, newer than every feed item, first and so inside the newest 20', () => {
    const ptwc = PTWC.warnings[0];
    // Real data: PTWC issued 2026-10-13T12:34:39Z; the newest feed item (DSDA Jakarta) 07:40Z.
    expect(ptwc.issuedAt).toBe('2026-10-13T12:34:39Z');
    expect(FEED.warnings[0].issuedAt).toBe('2026-10-13T07:40:00Z');
    expect(merged[0].id).toBe(ptwc.id);
    expect(merged.slice(0, LIST_CAP).map((w) => w.id)).toContain(ptwc.id);
  });

  it('orders exactly as loadOfficialWarnings does (issuedAt descending, no issue time last)', () => {
    expect(merged).toEqual([...merged].sort(compareWarnings));
    const firstUndated = merged.findIndex((w) => w.issuedAt === null);
    expect(firstUndated).toBeGreaterThan(0);
    expect(merged.slice(firstUndated).every((w) => w.issuedAt === null)).toBe(true);
  });

  it('does not reorder or mutate its inputs', () => {
    const before = FEED.warnings.map((w) => w.id);
    const ptwcFirst: OfficialWarning[] = [...PTWC.warnings, ...FEED.warnings.slice(0, 3)];
    mergeWarnings(FEED.warnings, ptwcFirst);
    expect(FEED.warnings.map((w) => w.id)).toEqual(before);
    expect(ptwcFirst[0].id).toBe(PTWC.warnings[0].id);
  });
});

describe('officialLevelFor (H2)', () => {
  const MAGMA = {
    'watch-merapi': 'magma-level-list:263250:2026-10-13T07:51:22Z',
    'watch-semeru': 'magma-level-list:263300:2026-10-13T07:51:22Z',
    'watch-anak-krakatau': 'magma-level-list:262000:2026-10-13T07:51:22Z',
    'watch-sinabung': 'magma-level-list:261080:2026-10-13T07:51:22Z',
  } as const;

  it("shows Anak Krakatau's PVMBG/MAGMA level, not the nearer-in-time Jakarta flood gate", () => {
    const ak = incident('watch-anak-krakatau');
    const near = nearTo(ak);
    // Real data: a DSDA Jakarta flood gate (~140 km, issued 07:40Z) sorts before the undated MAGMA record.
    expect(near[0].issuer).toMatch(/DSDA/);
    expect(near[0].hazard).toBe('flood');
    const official = officialLevelFor(ak, near);
    expect(official?.id).toBe(MAGMA['watch-anak-krakatau']);
    expect(official?.level).toBe('Level III (Siaga)');
    expect(official?.issuer).toMatch(/PVMBG/);
  });

  it('picks each volcano its own MAGMA record', () => {
    for (const [watchId, magmaId] of Object.entries(MAGMA)) {
      const i = incident(watchId);
      expect(officialLevelFor(i, nearTo(i))?.id, watchId).toBe(magmaId);
    }
  });

  it('carries the record mode and retrieval time for the badge (recorded MAGMA level = historical)', () => {
    const ak = incident('watch-anak-krakatau');
    const official = officialLevelFor(ak, nearTo(ak));
    expect(official?.dataMode).toBe('historical');
    expect(official?.retrievedAt).toBe('2026-10-13T07:51:22Z');
  });

  it('shows no block rather than a message for another hazard', () => {
    const ak = incident('watch-anak-krakatau');
    const floodOnly = nearTo(ak).filter((w) => w.hazard === 'flood');
    expect(floodOnly.length).toBeGreaterThan(0);
    expect(officialLevelFor(ak, floodOnly)).toBeNull();
    // Riau (wildfire, smoke) is only answered by a haze message; a flood gate is not one.
    const riau = incident('watch-riau-haze');
    expect(officialLevelFor(riau, floodOnly)).toBeNull();
    expect(officialLevelFor(riau, nearTo(riau))).toBeNull();
  });

  it("never shows a record that carries another volcano's GVP number", () => {
    const merapi = incident('watch-merapi');
    expect(officialLevelFor(merapi, [byId(MAGMA['watch-semeru'])])).toBeNull();
  });

  it('prefers the record naming the volcano, else falls back to a volcano record with no GVP number', () => {
    const merapi = incident('watch-merapi');
    const jma = ALL.find((w) => w.id.startsWith('jma-volcano:') && !w.ended) as OfficialWarning;
    // The record naming the volcano wins over an earlier one that does not.
    expect(officialLevelFor(merapi, [jma, byId(MAGMA['watch-merapi'])])?.id).toBe(MAGMA['watch-merapi']);
    // Fallback (a JMA or GeoNet record carries no GVP number); App only passes records within 150 km.
    expect(officialLevelFor(merapi, [jma])?.id).toBe(jma.id);
  });

  it('matches by area name when the id carries no GVP number', () => {
    const merapi = incident('watch-merapi');
    const record = byId(MAGMA['watch-merapi']);
    const renamed = { ...record, id: 'magma-level-list:merapi:2026-10-13T07:51:22Z' };
    const other = { ...byId(MAGMA['watch-semeru']), id: 'magma-level-list:semeru:2026-10-13T07:51:22Z' };
    expect(officialLevelFor(merapi, [other, renamed])?.id).toBe(renamed.id);
  });

  it('skips aggregator estimates and messages the issuer ended', () => {
    const merapi = incident('watch-merapi');
    const record = byId(MAGMA['watch-merapi']);
    expect(officialLevelFor(merapi, [{ ...record, authority: 'aggregator' }])).toBeNull();
    expect(officialLevelFor(merapi, [{ ...record, ended: true }])).toBeNull();
  });
});
