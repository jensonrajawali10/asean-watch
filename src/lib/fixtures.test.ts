// Runs the loader and the review pipeline against the REAL snapshot in data/ (no mocks), plus a few
// synthetic inputs to buildFixtures for the edge cases.
import { describe, expect, it } from 'vitest';
import firmsJson from '../../data/real/firms.json';
import quakesJson from '../../data/real/quakes.json';
import metaJson from '../../data/real/meta.json';
import volcanoesJson from '../../data/volcanoes.json';
import watchesJson from '../../data/watches.json';
import { buildBriefing } from './briefing';
import { buildFixtures, findVolcano, loadFixtures, replayStepsFor } from './fixtures';
import { deriveReview, parseUtcTimestamp, visibleObservations } from './reviewRules';
import {
  RULE_DISCLAIMER,
  SEISMIC_RADIUS_KM,
  THERMAL_RADIUS_KM,
  firmsConfidence,
  firmsObservedAt,
  haversineKm,
  utcDayIndex,
} from './watchRules';
import type { FirmsRow, Watch } from './watchRules';

const fx = loadFixtures();
const DAY_MS = 86_400_000;

const VOLCANO_WATCHES: Array<[string, string, string]> = [
  ['watch-merapi', 'gvp-263250', '263250'],
  ['watch-semeru', 'gvp-263300', '263300'],
  ['watch-anak-krakatau', 'gvp-262000', '262000'],
  ['watch-sinabung', 'gvp-261080', '261080'],
];

function watch(id: string): Watch {
  const found = fx.watches.find((w) => w.id === id);
  if (!found) throw new Error(`Watch "${id}" is missing from data/watches.json`);
  return found;
}

function reviewAt(w: Watch, replayIndex: number) {
  return deriveReview(visibleObservations(fx.observations, w.id, replayIndex), w.scenarioWindow);
}

describe('real snapshot loads cleanly', () => {
  it('has zero validation issues, no duplicates, and records', () => {
    expect(fx.issues.map((i) => i.message)).toEqual([]);
    expect(fx.duplicatesIgnored).toBe(0);
    expect(fx.observations.length).toBeGreaterThan(0);
  });

  it('keeps the Fixtures fields the UI uses, plus the real-data fields', () => {
    for (const k of ['volcanoes', 'incidents', 'scenario', 'observations', 'issues', 'duplicatesIgnored'] as const) {
      expect(fx).toHaveProperty(k);
    }
    expect(fx.incidents).toBe(fx.watches);
    expect(fx.scenario.incidentId).toBe('watch-merapi');
    expect(fx.scenario.replaySteps).toBe(fx.replaySteps);
  });

  it('is all real: every watch and record is historical, nothing says simulated', () => {
    expect(fx.watches.map((w) => w.dataMode)).toEqual(fx.watches.map(() => 'historical'));
    expect(fx.observations.filter((o) => o.dataMode !== 'historical').map((o) => o.id)).toEqual([]);
    const text = JSON.stringify([fx.watches, fx.observations]);
    expect(text).not.toMatch(/simulat|fictional|demo fixture/i);
  });

  it('stays small (< 300 KB of snapshot JSON) and loads the same ids every time', () => {
    const size = JSON.stringify(firmsJson).length + JSON.stringify(quakesJson).length + JSON.stringify(metaJson).length;
    expect(size).toBeLessThan(300 * 1024);
    expect(loadFixtures().observations.map((o) => o.id)).toEqual(fx.observations.map((o) => o.id));
  });
});

describe('watch areas', () => {
  it('lists the four MAGMA Level III volcanoes and the Riau haze box', () => {
    expect(fx.watches.map((w) => w.id)).toEqual([...VOLCANO_WATCHES.map(([id]) => id), 'watch-riau-haze']);
    expect(fx.watches.every((w) => w.replayable && w.title.length <= 30)).toBe(true);
  });

  it('places each volcano watch on its Smithsonian GVP summit point', () => {
    for (const [id, volcanoId, gvpNumber] of VOLCANO_WATCHES) {
      const w = watch(id);
      const v = findVolcano(fx.volcanoes, w.volcanoId);
      expect(w.volcanoId).toBe(volcanoId);
      expect(w.area).toEqual({ kind: 'summit' });
      expect(v?.gvpNumber).toBe(gvpNumber);
      expect([w.lat, w.lon]).toEqual([v?.lat, v?.lon]);
      expect(v?.catalogSource.url).toBe(`https://volcano.si.edu/volcano.cfm?vn=${gvpNumber}`);
      expect(w.references.some((r) => r.url.startsWith('https://magma.esdm.go.id/'))).toBe(true);
    }
    expect(fx.volcanoes.map((v) => [v.name, v.lat, v.lon, v.elevationM])).toEqual([
      ['Merapi', -7.54, 110.446, 2910],
      ['Semeru', -8.108, 112.922, 3657],
      ['Krakatau', -6.1009, 105.4233, 285],
      ['Sinabung', 3.17, 98.392, 2460],
    ]);
    expect(findVolcano(fx.volcanoes, null)).toBeNull();
    expect(findVolcano(fx.volcanoes, 'gvp-nope')).toBeNull();
  });

  it('gives Riau a box that contains its marker and has no volcano', () => {
    const riau = watch('watch-riau-haze');
    expect(riau.hazard).toBe('wildfire');
    expect(riau.volcanoId).toBeNull();
    expect(riau.area).toEqual({ kind: 'bbox', minLat: -0.5, maxLat: 1.6, minLon: 101.0, maxLon: 103.2 });
    if (riau.area.kind !== 'bbox') throw new Error('unreachable');
    expect(riau.lat).toBeGreaterThan(riau.area.minLat);
    expect(riau.lat).toBeLessThan(riau.area.maxLat);
    expect(riau.lon).toBeGreaterThan(riau.area.minLon);
    expect(riau.lon).toBeLessThan(riau.area.maxLon);
  });

  it('shares one scenario window, equal to the snapshot window', () => {
    for (const w of fx.watches) expect(w.scenarioWindow).toEqual(fx.snapshot.window);
    expect(fx.snapshot.window.end).toBe(fx.snapshot.retrievedAt);
  });
});

describe('records', () => {
  it('every record has a real source URL, UTC times, and sits inside the snapshot window', () => {
    const start = parseUtcTimestamp(fx.snapshot.window.start) as number;
    const end = parseUtcTimestamp(fx.snapshot.window.end) as number;
    for (const o of fx.observations) {
      expect(o.sourceUrl, o.id).toMatch(/^https?:\/\/[a-z0-9.-]+\.(gov|go\.id|org|edu)\//);
      expect(o.observedAt, o.id).toMatch(/Z$/);
      expect(o.ingestedAt, o.id).toMatch(/Z$/);
      const t = parseUtcTimestamp(o.observedAt) as number;
      expect(t, o.id).toBeGreaterThanOrEqual(start);
      expect(t, o.id).toBeLessThanOrEqual(end);
      expect(parseUtcTimestamp(o.ingestedAt) as number, o.id).toBeGreaterThanOrEqual(t);
    }
  });

  it('every anomaly carries its stated rule, and only anomalies do', () => {
    for (const o of fx.observations) {
      if (o.anomaly) expect(o.anomalyReason?.endsWith(RULE_DISCLAIMER), o.id).toBe(true);
      else expect(o.anomalyReason, o.id).toBeNull();
    }
  });

  it('names real products only (NASA FIRMS, USGS, BMKG); no granule or scene ids', () => {
    for (const o of fx.observations) {
      expect(o.sourceName, o.id).toMatch(/^(NASA FIRMS (VIIRS 375 m|MODIS 1 km) NRT \(|USGS earthquake catalog|BMKG )/);
      expect(o.id, o.id).not.toMatch(/granule|scene|VNP14|VJ114|VJ214|MOD14|MYD14/i);
    }
  });

  it('Merapi has its real thermal records: exactly the FIRMS rows within 5 km of the GVP summit', () => {
    const merapi = watch('watch-merapi');
    const rows = (firmsJson as { rows: FirmsRow[] }).rows;
    const start = fx.snapshot.window.start;
    const expected = rows.filter((r) => {
      const at = firmsObservedAt(r.acq_date, r.acq_time);
      return at !== null && at <= fx.snapshot.window.end && (utcDayIndex(at, start) ?? -1) >= 0 &&
        haversineKm(merapi.lat, merapi.lon, r.latitude, r.longitude) <= THERMAL_RADIUS_KM;
    });
    const thermal = fx.observations.filter((o) => o.incidentId === merapi.id && o.category === 'thermal');
    // The committed snapshot (13 Oct 2026) has Merapi hotspots. A later refresh with none is possible
    // (cloud): then update this line, not the rule.
    expect(thermal.length).toBeGreaterThan(0);
    expect(thermal).toHaveLength(expected.length);
    expect(thermal.filter((o) => o.anomaly)).toHaveLength(expected.filter((r) => firmsConfidence(r)?.passes).length);
    for (const o of thermal) {
      expect(o.unit).toBe('MW');
      expect(o.sourceName).toMatch(/^NASA FIRMS /);
      expect(o.summary).toMatch(/km from the summit/);
    }
  });

  it('every seismic record is within the stated radius or box (none were found in this snapshot window)', () => {
    for (const o of fx.observations.filter((x) => x.category === 'seismic')) {
      expect(o.summary).toMatch(new RegExp(`(\\d+(\\.\\d)? km from the summit|inside the watch box)`));
      expect(Number(/([\d.]+) km from the summit/.exec(o.summary)?.[1] ?? 0)).toBeLessThanOrEqual(SEISMIC_RADIUS_KM);
    }
  });

  it('Riau thermal records are daily totals, at most one per sensor per day', () => {
    const riau = fx.observations.filter((o) => o.incidentId === 'watch-riau-haze' && o.category === 'thermal');
    expect(riau.length).toBeGreaterThan(0);
    expect(riau.every((o) => o.unit === 'detections' && Number.isInteger(o.value))).toBe(true);
    const keys = riau.map((o) => `${o.sourceName}|${o.replayStep}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('replay over the real last 7 days', () => {
  it('has 7 UTC days in order, the last clocked at the snapshot time', () => {
    const steps = fx.replaySteps;
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const start = parseUtcTimestamp(fx.snapshot.window.start) as number;
    steps.forEach((s, i) => {
      const clock = parseUtcTimestamp(s.clock) as number;
      if (i < steps.length - 1) expect(clock).toBe(start + (i + 1) * DAY_MS - 1000);
      expect(s.label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
    });
    expect(steps[steps.length - 1].clock).toBe(fx.snapshot.retrievedAt);
  });

  it('every watch replays over the same days', () => {
    for (const w of fx.watches) expect(replayStepsFor(fx, w.id)).toBe(fx.replaySteps);
    expect(replayStepsFor(fx, 'watch-nope')).toEqual([]);
  });

  it("each record appears on its own UTC day, so Next step reveals real days in order", () => {
    for (const o of fx.observations) expect(o.replayStep, o.id).toBe(utcDayIndex(o.observedAt, fx.snapshot.window.start));
    for (const w of fx.watches) {
      let previous = -1;
      for (const s of fx.replaySteps) {
        const visible = visibleObservations(fx.observations, w.id, s.index);
        expect(visible.length).toBeGreaterThanOrEqual(previous);
        expect(visible.every((o) => (parseUtcTimestamp(o.observedAt) as number) <= (parseUtcTimestamp(s.clock) as number))).toBe(true);
        previous = visible.length;
      }
    }
  });

  it('nothing is excluded by the window, and state follows the anomalies that are visible', () => {
    for (const w of fx.watches) {
      for (const s of fx.replaySteps) {
        const r = reviewAt(w, s.index);
        expect(r.evidence.filter((e) => e.reason === 'Outside scenario window, not counted')).toEqual([]);
        const anomalyCategories = new Set(r.evidence.filter((e) => e.observation.anomaly).map((e) => e.observation.category));
        expect(r.anomalyCategories.length).toBe(anomalyCategories.size);
      }
    }
  });

  it("the last-day brief for Merapi names every evidence record, its source URL, and the day's clock", () => {
    const merapi = watch('watch-merapi');
    const step = fx.replaySteps[fx.replaySteps.length - 1];
    const review = reviewAt(merapi, step.index);
    const text = buildBriefing({ incident: merapi, volcano: findVolcano(fx.volcanoes, merapi.volcanoId), step, review, issues: fx.issues });
    expect(text).toContain(step.clock);
    expect(text.replace(/\s+/g, ' ')).toContain('elevation 2910 m');
    for (const e of review.evidence) {
      expect(text).toContain(e.observation.id);
      expect(text).toContain(e.observation.sourceUrl);
    }
  });
});

describe('snapshot metadata', () => {
  it('records every source with its URL, retrieval time and attribution', () => {
    expect(fx.snapshot.sources.map((s) => s.id)).toEqual([
      'firms-viirs-snpp',
      'firms-viirs-noaa20',
      'firms-viirs-noaa21',
      'firms-modis',
      'usgs-fdsn',
      'bmkg-gempaterkini',
      'bmkg-gempadirasakan',
      'bmkg-live30event',
    ]);
    for (const s of fx.snapshot.sources) {
      expect(s.url, s.id).toMatch(/^https:\/\//);
      expect(s.retrievedAt, s.id).toBe(fx.snapshot.retrievedAt);
      expect(s.attribution.length, s.id).toBeGreaterThan(0);
      if (s.id.startsWith('firms-')) expect(s.lastModified, s.id).toMatch(/Z$/);
    }
    expect(fx.snapshot.satelliteAsOf).toMatch(/Z$/);
    const credits = fx.snapshot.attributions.join(' ');
    for (const needed of ['NASA FIRMS, LANCE', 'U.S. Geological Survey', 'Sumber data: BMKG']) expect(credits).toContain(needed);
  });

  it('collected with margins at least as wide as the watch rules', () => {
    const collection = (metaJson as { collection: { thermalRadiusKm: number; seismicRadiusKm: number } }).collection;
    expect(collection.thermalRadiusKm).toBeGreaterThanOrEqual(THERMAL_RADIUS_KM);
    expect(collection.seismicRadiusKm).toBeGreaterThanOrEqual(SEISMIC_RADIUS_KM);
  });

  it('gives every watch its plain-language rules', () => {
    for (const w of fx.watches) {
      const rules = fx.rulesByWatch[w.id];
      expect(rules).toHaveLength(2);
      expect(rules.every((r) => r.endsWith(RULE_DISCLAIMER))).toBe(true);
    }
  });
});

describe('buildFixtures edge cases (synthetic input)', () => {
  const meta = {
    retrievedAt: '2026-10-13T07:26:44Z',
    window: { start: '2026-10-07T00:00:00Z', end: '2026-10-13T07:26:44Z' },
    sources: [],
  };

  it('a watch with no records still has the 7 days and shows Monitoring', () => {
    const built = buildFixtures({ volcanoes: volcanoesJson, watches: watchesJson, firms: { rows: [] }, quakes: { rows: [] }, meta });
    expect(built.issues).toEqual([]);
    expect(built.observations).toEqual([]);
    expect(built.replaySteps).toHaveLength(7);
    for (const w of built.watches) {
      expect(replayStepsFor(built, w.id)).toHaveLength(7);
      expect(deriveReview(visibleObservations(built.observations, w.id, 6), w.scenarioWindow).label).toBe('Monitoring');
    }
  });

  it('reports a missing snapshot instead of throwing', () => {
    const built = buildFixtures({ volcanoes: volcanoesJson, watches: watchesJson, firms: null, quakes: null, meta: null });
    expect(built.observations).toEqual([]);
    expect(built.replaySteps).toEqual([]);
    expect(built.issues.map((i) => i.message)).toEqual([
      'data/real/meta.json is missing or malformed, so no snapshot records were loaded. Run npm run refresh:data.',
    ]);
  });

  it('reports a bad raw row once, not once per watch', () => {
    const bad = { file: 'viirs-noaa20', latitude: -7.54, longitude: 110.446, acq_date: '2026-10-09', acq_time: '1812', satellite: '??', confidence: 'nominal', version: '2.0NRT', frp: 1, daynight: 'N' };
    const built = buildFixtures({ volcanoes: volcanoesJson, watches: watchesJson, firms: { rows: [bad] }, quakes: { rows: [] }, meta });
    expect(built.issues.map((i) => i.message)).toEqual([
      'Snapshot row 0 in data/real/firms.json skipped: unknown FIRMS satellite code "??".',
    ]);
  });

  it('skips a malformed watch with a readable issue', () => {
    const watches = [{ ...(watchesJson as unknown[])[0] as object, id: 'watch-broken', area: { kind: 'circle' } }];
    const built = buildFixtures({ volcanoes: volcanoesJson, watches, firms: { rows: [] }, quakes: { rows: [] }, meta });
    expect(built.watches).toEqual([]);
    expect(built.issues[0].message).toBe('Watch "watch-broken" skipped: area must be {"kind":"summit"} or a valid bbox.');
  });
});
