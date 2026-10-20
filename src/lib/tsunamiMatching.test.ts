// Tsunami warning-to-area matching (QC finding H1). A tsunami message that names its warned areas is
// matched on those areas only: a watch next to a warned district gets the message even when the quake
// epicentre is far away, a watch next to the epicentre does not get a message for other coasts, and a
// message in force is never dropped (out of range, it is listed apart). Expected values are derived from
// the bundled data (watches.json, the geoBoundaries centres and the BMKG snapshot), not typed in.
import { describe, expect, it } from 'vitest';
import type { OfficialWarning, OfficialWarningArea } from '../types';
import { buildBriefing } from './briefing';
import type { BriefingInput } from './briefing';
import { loadFixtures } from './fixtures';
import { haversineKm } from './nea';
import { idnDistrictIndex, placeTsunamiAreas } from './tsunamiAreas';
import { BUNDLED_WARNINGS_SNAPSHOT, parseBmkgTsunami, partitionWarnings, warningDistanceKm, warningMatchPoints, warningsNear } from './warnings';
import { NEAR_KM } from './warningsView';
import { deriveReview } from './reviewRules';

const META = { dataMode: 'historical' as const, retrievedAt: '2026-10-13T07:51:20Z' };
const FX = loadFixtures();
const KRAKATAU = FX.incidents.find((i) => i.title === 'Anak Krakatau')!;
const RAW: string = BUNDLED_WARNINGS_SNAPSHOT.feeds['bmkg-inatews'].raw as string;

/** The first real InaTEWS <info> block that names warned areas, as BMKG published it. */
function realInfoWithAreas(): string {
  const blocks = RAW.match(/<info>[\s\S]*?<\/info>/g) ?? [];
  const b = blocks.find((x) => x.includes('<wzarea>'));
  if (!b) throw new Error('snapshot has no InaTEWS message with warned areas');
  return b;
}

/**
 * A synthetic but real-shaped InaTEWS message (QC proof F1): the real block with its epicentre moved
 * and its <wzarea> list replaced. Only the parsed fields we test are changed; the rest is BMKG's text.
 */
function syntheticMessage(epicentre: { lat: number; lon: number }, areas: { district: string; level: string }[]): OfficialWarning {
  const info = realInfoWithAreas()
    .replace(/<coordinates>[^<]*<\/coordinates>/, `<coordinates>${epicentre.lon},${epicentre.lat}</coordinates>`)
    .replace(/<wzarea>[\s\S]*<\/wzarea>/, () =>
      areas
        .map((a) => `<wzarea><province>X</province><district>${a.district}</district><level>${a.level}</level></wzarea>`)
        .join('\n'),
    );
  const xml = `<?xml version="1.0"?><alert>${info}</alert>`;
  const [w] = parseBmkgTsunami(xml, META).warnings;
  return w;
}

const placedPoint = (name: string) => {
  const p = placeTsunamiAreas([{ name, level: null, lat: null, lon: null }], idnDistrictIndex()).placed[0];
  if (!p) throw new Error(`${name} is not placed`);
  return p;
};

describe('tsunami matching on warned areas, not the epicentre', () => {
  // A Sunda-trench epicentre south-west of Anak Krakatau, chosen from the data: the farthest point along
  // the bearing that is still more than NEAR_KM from the watch, while the warned districts are within it.
  const districts = [
    { district: 'PANDEGLANG BAGIAN BARAT', level: 'AWAS' },
    { district: 'LAMPUNG-SELATAN', level: 'SIAGA' },
  ];
  const epicentre = { lat: KRAKATAU.lat - 1.6, lon: KRAKATAU.lon - 1.2 };
  const w = syntheticMessage(epicentre, districts);

  it('the case is real-shaped: epicentre beyond NEAR_KM, warned districts within it', () => {
    expect(haversineKm(KRAKATAU.lat, KRAKATAU.lon, epicentre.lat, epicentre.lon)).toBeGreaterThan(NEAR_KM);
    for (const d of districts) {
      const p = placedPoint(d.district);
      expect(haversineKm(KRAKATAU.lat, KRAKATAU.lon, p.lat, p.lon)).toBeLessThanOrEqual(NEAR_KM);
    }
    expect(w.ended).toBe(false);
    expect(w.areas.map((a) => a.name)).toEqual(districts.map((d) => d.district));
  });

  it('a watch next to the warned districts gets the message (no under-matching)', () => {
    expect(warningsNear([w], KRAKATAU.lat, KRAKATAU.lon, NEAR_KM)).toEqual([w]);
    const expected = Math.min(...districts.map((d) => placedPoint(d.district)).map((p) => haversineKm(KRAKATAU.lat, KRAKATAU.lon, p.lat, p.lon)));
    expect(warningDistanceKm(w, KRAKATAU.lat, KRAKATAU.lon)).toBeCloseTo(expected, 6);
  });

  it('the epicentre does not match: a place by the epicentre but far from every warned district is not near (no over-matching)', () => {
    const far = Math.min(...districts.map((d) => placedPoint(d.district)).map((p) => haversineKm(epicentre.lat, epicentre.lon, p.lat, p.lon)));
    expect(far).toBeGreaterThan(NEAR_KM);
    expect(warningsNear([w], epicentre.lat, epicentre.lon, NEAR_KM)).toEqual([]);
  });

  it('matches on exactly the named areas: points are the placed districts, epicentre excluded', () => {
    const { points, unplaced } = warningMatchPoints(w);
    expect(unplaced).toBe(0);
    expect(points).toHaveLength(districts.length);
    expect(points).not.toContainEqual(w.location);
  });

  it('the bundled InaTEWS messages match on their own districts', () => {
    const real = parseBmkgTsunami(RAW, META).warnings.filter((x) => x.areas.length > 0);
    expect(real.length).toBeGreaterThan(0);
    for (const m of real) {
      const placement = placeTsunamiAreas(m.areas, idnDistrictIndex());
      const { points, unplaced } = warningMatchPoints(m);
      expect(points).toEqual(placement.placed.map((p) => ({ lat: p.lat, lon: p.lon })));
      expect(unplaced).toBe(placement.unplaced.length);
    }
  });

  it('a tsunami message without named areas (e.g. a PD-4 closing message) still matches on its epicentre', () => {
    const closing = parseBmkgTsunami(RAW, META).warnings.find((x) => x.areas.length === 0 && x.location !== null)!;
    expect(closing).toBeDefined();
    expect(warningDistanceKm(closing, closing.location!.lat, closing.location!.lon)).toBe(0);
  });
});

describe('partitionWarnings never drops a tsunami message in force', () => {
  const pandeglang = placedPoint('PANDEGLANG BAGIAN BARAT');
  const flores = realInfoWithAreas();
  const real = parseBmkgTsunami(`<alert>${flores}</alert>`, META).warnings[0];

  it('in force, warned areas far away: listed elsewhere, not near', () => {
    const d = warningDistanceKm(real, KRAKATAU.lat, KRAKATAU.lon)!;
    expect(d).toBeGreaterThan(NEAR_KM);
    expect(real.ended).toBe(false);
    const { near, elsewhere } = partitionWarnings([real], KRAKATAU.lat, KRAKATAU.lon, NEAR_KM);
    expect(near).toEqual([]);
    expect(elsewhere).toEqual([real]);
  });

  it('ended by the issuer and far away: left out (as before)', () => {
    const ended = { ...real, ended: true };
    expect(partitionWarnings([ended], KRAKATAU.lat, KRAKATAU.lon, NEAR_KM)).toEqual({ near: [], elsewhere: [] });
  });

  it('past its expiry on the clock and far away: left out', () => {
    const expiring = { ...real, expiresAt: '2026-10-14T00:00:00Z' };
    const nowMs = Date.parse('2026-10-15T00:00:00Z');
    expect(partitionWarnings([expiring], KRAKATAU.lat, KRAKATAU.lon, NEAR_KM, nowMs).elsewhere).toEqual([]);
    expect(partitionWarnings([expiring], KRAKATAU.lat, KRAKATAU.lon, NEAR_KM, Date.parse('2026-10-13T12:00:00Z')).elsewhere).toEqual([expiring]);
  });

  it('a district that cannot be placed is never guessed: with no placed area the message is listed elsewhere', () => {
    const unknown: OfficialWarningArea = { name: 'NOT-A-REAL-DISTRICT BAGIAN BARAT', level: 'AWAS', lat: null, lon: null, province: null };
    const m = { ...real, areas: [unknown] };
    expect(warningMatchPoints(m)).toEqual({ points: [], unplaced: 1 });
    expect(warningDistanceKm(m, KRAKATAU.lat, KRAKATAU.lon)).toBeNull();
    expect(partitionWarnings([m], KRAKATAU.lat, KRAKATAU.lon, NEAR_KM).elsewhere).toEqual([m]);
  });

  it('partly placed and the placed part is far: listed elsewhere, so the unplaced district is not lost', () => {
    const unknown: OfficialWarningArea = { name: 'NOT-A-REAL-DISTRICT', level: 'AWAS', lat: null, lon: null, province: null };
    const m = { ...real, areas: [real.areas[0], unknown] };
    expect(warningMatchPoints(m).unplaced).toBe(1);
    expect(partitionWarnings([m], KRAKATAU.lat, KRAKATAU.lon, NEAR_KM)).toEqual({ near: [], elsewhere: [m] });
  });

  it('non-tsunami warnings are unchanged: near by location, elsewhere only without coordinates', () => {
    const base = { ...real, hazard: 'flood' as const, areas: [] };
    const close = { ...base, id: 'a', location: { lat: pandeglang.lat, lon: pandeglang.lon } };
    const far = { ...base, id: 'b', location: { lat: 10, lon: 100 } };
    const none = { ...base, id: 'c', location: null };
    expect(partitionWarnings([close, far, none], KRAKATAU.lat, KRAKATAU.lon, NEAR_KM)).toEqual({ near: [close], elsewhere: [none] });
  });

  it('a non-BMKG tsunami message with uncoordinated areas (JMA) is not placed on Indonesian districts', () => {
    const jma = { ...real, id: 'jma-tsunami:x', areas: [{ name: 'BALI', level: 'Tsunami Warning', lat: null, lon: null }] };
    expect(warningMatchPoints(jma)).toEqual({ points: [], unplaced: 1 });
  });
});

describe('the text brief relays other tsunami messages in force verbatim', () => {
  const real = parseBmkgTsunami(`<alert>${realInfoWithAreas()}</alert>`, META).warnings[0];
  const input: BriefingInput = {
    incident: KRAKATAU,
    volcano: null,
    step: null,
    review: deriveReview([], KRAKATAU.scenarioWindow),
    issues: [],
    warnings: [],
    otherTsunami: [real],
    warningFeeds: [],
  };
  const text = buildBriefing(input);

  it('keeps "none near" true and lists the regional message with its headline and named areas', () => {
    expect(text).toContain('No official warning near this incident was returned by the feeds checked below.');
    expect(text).toContain('Other official tsunami messages in force');
    expect(text).toContain('[W1] BMKG InaTEWS');
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toContain(real.headline.replace(/\s+/g, ' '));
    for (const a of real.areas) expect(flat).toContain(a.name);
  });
});
