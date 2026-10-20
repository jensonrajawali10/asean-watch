// Tests for the official-warning view helpers, on real items from the bundled snapshots
// (data/warnings-snapshot.json, data/ptwc-snapshot.json) wherever the snapshot has the case.
import { describe, expect, it } from 'vitest';
import type { Incident, OfficialWarning } from '../types';
import { compareWarnings, loadWarningsSnapshot, warningsNear } from './warnings';
import type { WarningsSnapshot } from './warnings';
import { loadPtwcSnapshot } from './ptwc';
import type { PtwcPayload } from './ptwc';
// Frozen copies of the 2026-10-13 captures: the cases below name real items from them, so a data refresh
// (which rewrites data/*.json) must not change what these tests see.
import warningsFixture from './__fixtures__/warnings-snapshot-2026-10-13.json';
import ptwcFixture from './__fixtures__/ptwc-snapshot-2026-10-13.json';
import { loadFixtures } from './fixtures';
import { NEAR_KM, belowTopOfScale, emptyWarningsText, endedLabel, isExpired, mergeWarnings, officialLevelFor, officialScale, warningMatchesGauge } from './warningsView';
import { findMagmaLevel } from './volcanoOfficial';
import { officialVolcanoLevel } from '../components/map/volcanoLevels';

const FEED = loadWarningsSnapshot(warningsFixture as unknown as WarningsSnapshot);
const PTWC = loadPtwcSnapshot(ptwcFixture as unknown as PtwcPayload);
const ALL = mergeWarnings(FEED.warnings, PTWC.warnings);
const INCIDENTS = loadFixtures().incidents;
/** A fixed clock after every snapshot capture (2026-10-13/14). */
const NOW = Date.parse('2026-10-15T12:00:00Z');

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
    const official = officialLevelFor(ak, near, NOW);
    expect(official?.id).toBe(MAGMA['watch-anak-krakatau']);
    expect(official?.level).toBe('Level III (Siaga)');
    expect(official?.issuer).toMatch(/PVMBG/);
  });

  it('picks each volcano its own MAGMA record', () => {
    for (const [watchId, magmaId] of Object.entries(MAGMA)) {
      const i = incident(watchId);
      expect(officialLevelFor(i, nearTo(i), NOW)?.id, watchId).toBe(magmaId);
    }
  });

  it('carries the record mode and retrieval time for the badge (recorded MAGMA level = historical)', () => {
    const ak = incident('watch-anak-krakatau');
    const official = officialLevelFor(ak, nearTo(ak), NOW);
    expect(official?.dataMode).toBe('historical');
    expect(official?.retrievedAt).toBe('2026-10-13T07:51:22Z');
  });

  it('shows no block rather than a message for another hazard', () => {
    const ak = incident('watch-anak-krakatau');
    const floodOnly = nearTo(ak).filter((w) => w.hazard === 'flood');
    expect(floodOnly.length).toBeGreaterThan(0);
    expect(officialLevelFor(ak, floodOnly, NOW)).toBeNull();
    // Riau (wildfire, smoke) is only answered by a haze message; a flood gate is not one.
    const riau = incident('watch-riau-haze');
    expect(officialLevelFor(riau, floodOnly, NOW)).toBeNull();
    expect(officialLevelFor(riau, nearTo(riau), NOW)).toBeNull();
  });

  it("never shows a record that carries another volcano's GVP number", () => {
    const merapi = incident('watch-merapi');
    expect(officialLevelFor(merapi, [byId(MAGMA['watch-semeru'])], NOW)).toBeNull();
  });

  it('prefers the record naming the volcano, else falls back to a volcano record with no GVP number', () => {
    const merapi = incident('watch-merapi');
    const jma = ALL.find((w) => w.id.startsWith('jma-volcano:') && !w.ended) as OfficialWarning;
    // The record naming the volcano wins over an earlier one that does not.
    expect(officialLevelFor(merapi, [jma, byId(MAGMA['watch-merapi'])], NOW)?.id).toBe(MAGMA['watch-merapi']);
    // Fallback: a volcano record with no GVP number (JMA, GeoNet) counts only within LEVEL_RADIUS_KM of the
    // watch (the v3 map rule). The real JMA record is in Japan, so it is not Merapi's level.
    expect(officialLevelFor(merapi, [jma], NOW)).toBeNull();
    const jmaNearby = { ...jma, location: { lat: merapi.lat + 0.2, lon: merapi.lon }, areas: [] };
    expect(officialLevelFor(merapi, [jmaNearby], NOW)?.id).toBe(jma.id);
    const tooFar = { ...jmaNearby, location: { lat: merapi.lat + 1, lon: merapi.lon } };
    expect(officialLevelFor(merapi, [tooFar], NOW)).toBeNull();
    // Without a position for the watch, the first unnamed record in the given order (the near list).
    expect(officialLevelFor({ hazard: 'volcano', title: 'Merapi', volcanoId: merapi.volcanoId }, [jma], NOW)?.id).toBe(jma.id);
  });

  it('matches by area name when the id carries no GVP number', () => {
    const merapi = incident('watch-merapi');
    const record = byId(MAGMA['watch-merapi']);
    const renamed = { ...record, id: 'magma-level-list:merapi:2026-10-13T07:51:22Z' };
    const other = { ...byId(MAGMA['watch-semeru']), id: 'magma-level-list:semeru:2026-10-13T07:51:22Z' };
    expect(officialLevelFor(merapi, [other, renamed], NOW)?.id).toBe(renamed.id);
  });

  it('skips aggregator estimates and messages the issuer ended', () => {
    const merapi = incident('watch-merapi');
    const record = byId(MAGMA['watch-merapi']);
    expect(officialLevelFor(merapi, [{ ...record, authority: 'aggregator' }], NOW)).toBeNull();
    expect(officialLevelFor(merapi, [{ ...record, ended: true }], NOW)).toBeNull();
  });

  it('skips a message whose expiry has passed on the clock, even if not marked ended (M4)', () => {
    const merapi = incident('watch-merapi');
    const record = { ...byId(MAGMA['watch-merapi']), expiresAt: '2026-10-14T00:00:00Z' };
    expect(record.ended).toBe(false);
    expect(officialLevelFor(merapi, [record], Date.parse('2026-10-13T12:00:00Z'))?.id).toBe(record.id);
    expect(officialLevelFor(merapi, [record], NOW)).toBeNull();
  });
});

describe('one official level everywhere (H2 on the v3 shell)', () => {
  const VOLCANO_WATCHES = ['watch-merapi', 'watch-semeru', 'watch-anak-krakatau', 'watch-sinabung'];

  it('gives each of the four volcanoes its own PVMBG/MAGMA level in the review, the map ring, the card and the MAGMA lookup', () => {
    for (const watchId of VOLCANO_WATCHES) {
      const i = incident(watchId);
      const review = officialLevelFor(i, nearTo(i), NOW);
      const fromAll = officialLevelFor(i, ALL, NOW);
      const ring = officialVolcanoLevel(i, nearTo(i), NOW);
      const magma = findMagmaLevel(ALL, i, NOW);
      expect(review?.id, watchId).toMatch(/^magma-level-list:\d{6}:/);
      expect(review?.issuer, watchId).toMatch(/PVMBG/);
      expect(review?.level, watchId).toBe('Level III (Siaga)');
      expect(fromAll?.id, watchId).toBe(review?.id);
      expect(ring?.warningId, watchId).toBe(review?.id);
      expect(ring?.dataMode, watchId).toBe('historical');
      expect(ring?.retrievedAt, watchId).toBe('2026-10-13T07:51:22Z');
      expect(magma?.id, watchId).toBe(review?.id);
    }
  });

  it("never gives Anak Krakatau the Jakarta flood gate's Siaga 3, whichever helper is asked", () => {
    const ak = incident('watch-anak-krakatau');
    const dsda = nearTo(ak).filter((w) => /DSDA/.test(w.issuer));
    expect(dsda.length).toBeGreaterThan(0);
    for (const level of [officialLevelFor(ak, dsda, NOW), officialVolcanoLevel(ak, dsda, NOW), findMagmaLevel(dsda, ak, NOW)]) {
      expect(level).toBeNull();
    }
  });

  it('the MAGMA lookup follows the clock when given one, and the issuer flag otherwise', () => {
    const merapi = incident('watch-merapi');
    const record = { ...byId('magma-level-list:263250:2026-10-13T07:51:22Z'), expiresAt: '2026-10-14T00:00:00Z' };
    expect(findMagmaLevel([record], merapi, NOW)).toBeNull();
    expect(findMagmaLevel([record], merapi)?.id).toBe(record.id);
    expect(findMagmaLevel([{ ...record, ended: true }], merapi)).toBeNull();
  });
});

describe('warningMatchesGauge (M2)', () => {
  const T1 = 'thaiwater:T.1';

  it("links gauge T.1 to its own ThaiWater message, not T.13's", () => {
    // Real data: T.13, T.14 and T.15 all sort before T.1, and "thaiwater:T.1" is a substring of each.
    const linked = ALL.find((w) => warningMatchesGauge(w.id, T1));
    expect(linked?.id).toBe('thaiwater:T.1:2026-10-13T06:00:00Z');
    expect(linked?.areaDescription).toMatch(/Nakhon Chai Si/);
    expect(warningMatchesGauge('thaiwater:T.13:2026-10-13T06:00:00Z', T1)).toBe(false);
  });

  it('matches every snapshot gauge to at most one message, and each message to at most one gauge', () => {
    const relayed = ALL.filter((w) => FEED.gauges.some((g) => warningMatchesGauge(w.id, g.id)));
    expect(relayed.length).toBeGreaterThan(0);
    for (const w of relayed) expect(FEED.gauges.filter((g) => warningMatchesGauge(w.id, g.id)), w.id).toHaveLength(1);
    for (const g of FEED.gauges) expect(ALL.filter((w) => warningMatchesGauge(w.id, g.id)).length, g.id).toBeLessThanOrEqual(1);
    // C.3 is a prefix of C.35, C.36 and C.37 in the same snapshot.
    for (const id of ['thaiwater:C.35', 'thaiwater:C.36', 'thaiwater:C.37']) {
      const w = ALL.find((x) => x.id.startsWith(`${id}:`));
      if (w) expect(warningMatchesGauge(w.id, 'thaiwater:C.3')).toBe(false);
    }
  });

  it('accepts an exact id and rejects empty or open-ended gauge ids', () => {
    expect(warningMatchesGauge('dsda-jakarta:107', 'dsda-jakarta:107')).toBe(true);
    expect(warningMatchesGauge('dsda-jakarta:107:2026-10-13T07:40:00Z', 'dsda-jakarta:107')).toBe(true);
    expect(warningMatchesGauge('dsda-jakarta:107:2026-10-13T07:40:00Z', '')).toBe(false);
    expect(warningMatchesGauge('dsda-jakarta:107:2026-10-13T07:40:00Z', 'dsda-jakarta:')).toBe(false);
  });
});

describe('isExpired and endedLabel (M4)', () => {
  const jmaTsunami = ALL.filter((w) => w.id.startsWith('jma-tsunami:'));
  const ptwc = PTWC.warnings[0];

  it('reads real expired messages as EXPIRED with the issuer expiry', () => {
    // Real data: JMA tsunami items expired 2026-10-11T11:00Z, captured 2026-10-13; PTWC expired 13:34:39Z.
    expect(jmaTsunami.length).toBeGreaterThan(0);
    for (const w of jmaTsunami) {
      expect(isExpired(w, NOW)).toBe(true);
      expect(endedLabel(w, NOW)).toEqual({ text: 'EXPIRED', at: w.expiresAt });
    }
    expect(ptwc.expiresAt).toBe('2026-10-13T13:34:39Z');
    expect(endedLabel(ptwc, NOW)).toEqual({ text: 'EXPIRED', at: '2026-10-13T13:34:39Z' });
  });

  it('expires an un-ended message once its expiry passes on the clock (snapshot shown later, or a tab left open)', () => {
    // As captured while the advisory was still valid: not ended, expiry ahead of the retrieval time.
    const valid = { ...jmaTsunami[0], ended: false, retrievedAt: '2026-10-11T09:00:00Z' };
    const before = Date.parse('2026-10-11T10:00:00Z');
    expect(isExpired(valid, before)).toBe(false);
    expect(endedLabel(valid, before)).toBeNull();
    expect(isExpired(valid, NOW)).toBe(true);
    expect(endedLabel(valid, NOW)).toEqual({ text: 'EXPIRED', at: '2026-10-11T11:00:00Z' });
  });

  it('labels a message cancelled before its expiry ENDED, never "EXPIRED <a future time>"', () => {
    // A PTWC Cancel (or JMA 解除) retrieved while its expiry was still two hours ahead.
    const cancelled = { ...ptwc, ended: true, retrievedAt: '2026-10-13T12:40:00Z', expiresAt: '2026-10-13T14:40:00Z' };
    const soon = Date.parse('2026-10-13T12:45:00Z');
    expect(isExpired(cancelled, soon)).toBe(true);
    expect(endedLabel(cancelled, soon)).toEqual({ text: 'ENDED' });
    // Still ENDED (not EXPIRED) after the expiry has also passed: the issuer ended it first.
    expect(endedLabel(cancelled, NOW)).toEqual({ text: 'ENDED' });
  });

  it('keeps messages with no expiry active until the issuer ends them', () => {
    const magma = ALL.filter((w) => w.id.startsWith('magma-level-list:'));
    expect(magma).toHaveLength(4);
    for (const w of magma) {
      expect(isExpired(w, NOW)).toBe(false);
      expect(endedLabel(w, NOW)).toBeNull();
    }
    const bmkgEnded = ALL.find((w) => w.id.startsWith('bmkg-inatews:') && w.ended) as OfficialWarning;
    expect(bmkgEnded.expiresAt).toBeNull();
    expect(endedLabel(bmkgEnded, NOW)).toEqual({ text: 'ENDED' });
  });
});

describe('emptyWarningsText (L7)', () => {
  it('near a watch area with nothing within the radius, says what was searched, not that nothing was retrieved', () => {
    const riau = incident('watch-riau-haze');
    // Real data: nothing within 150 km of Riau, while 111 warnings were retrieved.
    expect(nearTo(riau)).toHaveLength(0);
    expect(ALL.length).toBeGreaterThan(100);
    expect(NEAR_KM).toBe(150);
    expect(emptyWarningsText({ loading: false, nearName: 'Riau' })).toBe(
      'None within 150 km of Riau in the feeds below. This is not an all-clear.',
    );
  });

  it('keeps the APAC-wide and loading texts', () => {
    expect(emptyWarningsText({ loading: false, nearName: null })).toBe(
      'No official warnings retrieved from the feeds below. This is not an all-clear.',
    );
    expect(emptyWarningsText({ loading: true, nearName: 'Riau' })).toBe('Loading official feeds…');
  });
});

describe('officialScale: style by the issuer\'s own scale', () => {
  const snap = loadWarningsSnapshot(warningsFixture as unknown as WarningsSnapshot);
  it('DSDA Siaga k is rank 5-k of 4 (Siaga 1 most severe); only Siaga 1 is the top', () => {
    const dsda = snap.warnings.filter((w) => w.id.startsWith('dsda-jakarta:'));
    expect(dsda.length).toBeGreaterThan(0);
    for (const w of dsda) {
      const k = Number(/Siaga\s*([1-4])/i.exec(w.level)?.[1]);
      expect(officialScale(w)).toEqual({ rank: 5 - k, of: 4 });
      expect(belowTopOfScale(w)).toBe(k !== 1);
    }
    expect(officialScale({ id: 'dsda-jakarta:x', level: 'Status : Siaga 3', levelGloss: null })).toEqual({ rank: 2, of: 4 });
  });
  it('MAGMA Level III is 3 of 4, ThaiWater level 5 is the top of 5, others have no scale', () => {
    expect(officialScale({ id: 'magma-level-list:262000:x', level: 'Level III (Siaga)', levelGloss: null })).toEqual({ rank: 3, of: 4 });
    expect(belowTopOfScale({ id: 'magma-level-list:x', level: 'Level IV (Awas)', levelGloss: null })).toBe(false);
    const tw = snap.warnings.find((w) => w.id.startsWith('thaiwater:'))!;
    expect(officialScale(tw)).toEqual({ rank: 5, of: 5 });
    expect(belowTopOfScale(tw)).toBe(false);
    expect(officialScale({ id: 'bmkg-inatews:x', level: 'SIAGA', levelGloss: null })).toBeNull();
    // A submarine volcano's eruption forecast (no warning) sits below JMA's warning for the surrounding sea.
    const fc = { id: 'jma-volcano:323:x', level: '活火山であることに留意（海底火山）', levelGloss: 'JMA eruption forecast, no warning in force: note that this is an active volcano' };
    expect(officialScale(fc)).toEqual({ rank: 1, of: 2 });
    expect(belowTopOfScale(fc)).toBe(true);
    expect(belowTopOfScale({ ...fc, level: '周辺海域警戒', levelGloss: 'JMA eruption warning for the sea around this submarine volcano' })).toBe(false);
    const jma = snap.warnings.filter((w) => w.id.startsWith('jma-volcano:') && /Level\s+[1-5]\s+of\s+5/i.test(w.levelGloss ?? ''));
    expect(jma.length).toBeGreaterThan(0);
    for (const w of jma) {
      const n = Number(/Level\s+([1-5])\s+of\s+5/i.exec(w.levelGloss!)![1]);
      expect(officialScale(w)).toEqual({ rank: n, of: 5 });
      expect(belowTopOfScale(w)).toBe(n < 5);
    }
  });
});
