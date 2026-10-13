// Watch rules against synthetic raw rows: distance, confidence, daily aggregation, seismic radius and
// magnitude, windowing, stable ids and reason text.
import { describe, expect, it } from 'vitest';
import {
  HAZE_MIN_DETECTIONS_PER_DAY,
  RULE_DISCLAIMER,
  SEISMIC_RADIUS_KM,
  THERMAL_RADIUS_KM,
  WATCH_RULE_TEXT,
  buildReplayDays,
  firmsConfidence,
  firmsObservedAt,
  haversineKm,
  hazeThermalObservations,
  observationsForWatch,
  ruleContext,
  rulesForWatch,
  seismicObservations,
  utcDayIndex,
  volcanoThermalObservations,
} from './watchRules';
import type { FirmsRow, QuakeRow, RuleContext, Watch } from './watchRules';

const KM_PER_DEG_LAT = (2 * Math.PI * 6371.0088) / 360;

const META = {
  retrievedAt: '2026-10-13T07:26:44Z',
  window: { start: '2026-10-07T00:00:00Z', end: '2026-10-13T07:26:44Z' },
  sources: [
    { id: 'firms-viirs-noaa20', lastModified: '2026-10-13T06:43:17Z' },
    { id: 'firms-viirs-snpp', lastModified: '2026-10-13T06:50:48Z' },
    { id: 'firms-modis', lastModified: null },
    { id: 'usgs-fdsn', lastModified: '2026-10-13T07:26:45Z' },
    { id: 'bmkg-live30event', lastModified: '2026-10-13T06:48:29Z' },
  ],
};
const CTX: RuleContext = ruleContext(META);

const VOLCANO: Watch = {
  id: 'watch-test-volcano',
  key: 'testv',
  title: 'Test volcano',
  hazard: 'volcano',
  volcanoId: 'gvp-000000',
  locationName: 'Test',
  country: 'Indonesia',
  lat: -7.54,
  lon: 110.446,
  area: { kind: 'summit' },
  dataMode: 'historical',
  scenarioWindow: META.window,
  replayable: true,
  summary: 'Synthetic watch for tests.',
  references: [],
};

const BOX: Watch = {
  ...VOLCANO,
  id: 'watch-test-box',
  key: 'testbox',
  hazard: 'wildfire',
  volcanoId: null,
  lat: 0.5,
  lon: 102.5,
  area: { kind: 'bbox', minLat: 0, maxLat: 1, minLon: 102, maxLon: 103 },
};

/** A VIIRS NOAA-20 row `northKm` north of the test volcano summit. */
function firms(over: Partial<FirmsRow> & { northKm?: number } = {}): FirmsRow {
  const { northKm = 0, ...rest } = over;
  return {
    file: 'viirs-noaa20',
    latitude: Number((VOLCANO.lat + northKm / KM_PER_DEG_LAT).toFixed(5)),
    longitude: VOLCANO.lon,
    acq_date: '2026-10-09',
    acq_time: '1812',
    satellite: 'N20',
    confidence: 'nominal',
    version: '2.0NRT',
    frp: 2.5,
    daynight: 'N',
    bright_ti4: 330,
    ...rest,
  };
}

function quake(over: Partial<QuakeRow> & { northKm?: number } = {}): QuakeRow {
  const { northKm = 10, ...rest } = over;
  return {
    source: 'usgs',
    product: 'fdsn-event',
    eventId: 'us7000test',
    time: '2026-10-10T03:30:17Z',
    lat: Number((VOLCANO.lat + northKm / KM_PER_DEG_LAT).toFixed(5)),
    lon: VOLCANO.lon,
    depthKm: 12,
    mag: 3.4,
    magType: 'mb',
    place: '20 km N of Testtown, Indonesia',
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000test',
    status: 'reviewed',
    updated: '2026-10-10T04:00:00Z',
    ...rest,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('helpers', () => {
  it('haversineKm: one degree of latitude is about 111.2 km', () => {
    expect(haversineKm(0, 100, 1, 100)).toBeCloseTo(111.195, 2);
    expect(haversineKm(-7.54, 110.446, -7.54, 110.446)).toBe(0);
  });

  it('firmsObservedAt: acq_date + HHMM UTC to an ISO time ending in Z', () => {
    expect(firmsObservedAt('2026-10-09', '1812')).toBe('2026-10-09T18:12:00Z');
    expect(firmsObservedAt('2026-10-09', '812')).toBe('2026-10-09T08:12:00Z');
    expect(firmsObservedAt('2026-10-09', '0005')).toBe('2026-10-09T00:05:00Z');
    expect(firmsObservedAt('2026-02-30', '1200')).toBeNull();
    expect(firmsObservedAt('2026-10-09', '2460')).toBeNull();
    expect(firmsObservedAt('09/10/2026', '1200')).toBeNull();
  });

  it('utcDayIndex counts UTC days from the window start', () => {
    expect(utcDayIndex('2026-10-07T00:00:00Z', META.window.start)).toBe(0);
    expect(utcDayIndex('2026-10-07T23:59:59Z', META.window.start)).toBe(0);
    expect(utcDayIndex('2026-10-08T00:00:00Z', META.window.start)).toBe(1);
    expect(utcDayIndex('2026-10-06T23:59:00Z', META.window.start)).toBe(-1);
    expect(utcDayIndex('not a time', META.window.start)).toBeNull();
  });

  it('buildReplayDays: one step per UTC day, end-of-day clocks, the last clock is the snapshot time', () => {
    const days = buildReplayDays(META.window);
    expect(days.map((d) => d.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(days.map((d) => d.label)).toEqual(['7 Oct', '8 Oct', '9 Oct', '10 Oct', '11 Oct', '12 Oct', '13 Oct']);
    expect(days[0].clock).toBe('2026-10-07T23:59:59Z');
    expect(days[5].clock).toBe('2026-10-12T23:59:59Z');
    expect(days[6].clock).toBe(META.window.end);
    expect(days[6].description).toContain('incomplete');
    expect(buildReplayDays({ start: 'x', end: META.window.end })).toEqual([]);
    expect(buildReplayDays({ start: META.window.end, end: META.window.start })).toEqual([]);
  });

  it('ruleContext: ingestedAt is the Last-Modified header, else the retrieval time', () => {
    expect(CTX.dayCount).toBe(7);
    expect(CTX.ingestedAt['firms-viirs-noaa20']).toBe('2026-10-13T06:43:17Z');
    expect(CTX.ingestedAt['firms-modis']).toBe(META.retrievedAt);
  });
});

describe('FIRMS confidence', () => {
  it('VIIRS: nominal and high pass, low does not (long and short codes)', () => {
    for (const c of ['nominal', 'high', 'n', 'h', 'NOMINAL']) expect(firmsConfidence({ satellite: 'N20', confidence: c })?.passes).toBe(true);
    for (const c of ['low', 'l']) {
      const v = firmsConfidence({ satellite: 'N', confidence: c });
      expect(v?.passes).toBe(false);
      expect(v?.shortfall).toBe('the watch rule needs VIIRS confidence nominal or high');
    }
    expect(firmsConfidence({ satellite: 'N21', confidence: 'medium' })).toBeNull();
  });

  it('MODIS: 50 or more passes, 49 does not', () => {
    expect(firmsConfidence({ satellite: 'T', confidence: 50 })).toMatchObject({ passes: true, label: 'MODIS confidence 50' });
    expect(firmsConfidence({ satellite: 'A', confidence: '49' })).toMatchObject({ passes: false, label: 'MODIS confidence 49' });
    expect(firmsConfidence({ satellite: 'A', confidence: 101 })).toBeNull();
    expect(firmsConfidence({ satellite: 'X', confidence: 80 })).toBeNull();
  });
});

describe('thermal rule: volcano summit', () => {
  it(`flags a confident hotspot within ${THERMAL_RADIUS_KM} km and drops one beyond it`, () => {
    const rows = [firms({ northKm: 0.6 }), firms({ northKm: 4.9, acq_time: '1813' }), firms({ northKm: 5.1, acq_time: '1814' })];
    const { observations, problems } = volcanoThermalObservations(VOLCANO, rows, CTX);
    expect(problems).toEqual([]);
    expect(observations).toHaveLength(2);
    expect(observations.every((o) => o.anomaly && o.category === 'thermal')).toBe(true);
    const [near, edge] = observations;
    expect(near.value).toBe(2.5);
    expect(near.unit).toBe('MW');
    expect(near.anomalyReason).toBe(
      'FIRMS hotspot 0.6 km from the summit (rule: within 5 km) with VIIRS confidence nominal ' +
        `(rule: VIIRS nominal or high, MODIS 50 or more). ${RULE_DISCLAIMER}`,
    );
    expect(edge.anomalyReason).toContain('4.9 km from the summit');
  });

  it('keeps low-confidence hotspots, not flagged, with the reason in the summary', () => {
    const { observations } = volcanoThermalObservations(VOLCANO, [firms({ confidence: 'low', daynight: 'D', frp: 4.84 })], CTX);
    expect(observations).toHaveLength(1);
    const [o] = observations;
    expect(o.anomaly).toBe(false);
    expect(o.anomalyReason).toBeNull();
    expect(o.summary).toBe(
      'Daytime VIIRS hotspot (NOAA-20) 0 km from the summit, fire radiative power 4.84 MW, confidence low. ' +
        'Not flagged: the watch rule needs VIIRS confidence nominal or high.',
    );
    expect(o.qualityNote).toContain('FIRMS VIIRS confidence low');
  });

  it('MODIS uses the 0-100 confidence threshold and names the platform', () => {
    const rows = [
      firms({ file: 'modis', satellite: 'A', confidence: 49, acq_time: '2029' }),
      firms({ file: 'modis', satellite: 'T', confidence: 50, acq_time: '0128' }),
    ];
    const { observations } = volcanoThermalObservations(VOLCANO, rows, CTX);
    const byPlatform = Object.fromEntries(observations.map((o) => [o.sourceName, o]));
    expect(byPlatform['NASA FIRMS MODIS 1 km NRT (Aqua)'].anomaly).toBe(false);
    expect(byPlatform['NASA FIRMS MODIS 1 km NRT (Aqua)'].summary).toContain('Not flagged: the watch rule needs MODIS confidence 50 or more.');
    expect(byPlatform['NASA FIRMS MODIS 1 km NRT (Terra)'].anomaly).toBe(true);
    // MODIS has no Last-Modified in META, so ingestedAt falls back to the retrieval time.
    expect(byPlatform['NASA FIRMS MODIS 1 km NRT (Terra)'].ingestedAt).toBe(META.retrievedAt);
  });

  it('maps a FIRMS row to a real, labelled observation (times, source, mode, notes)', () => {
    const [o] = volcanoThermalObservations(VOLCANO, [firms({ acq_date: '2026-10-07', acq_time: '1752' })], CTX).observations;
    expect(o).toMatchObject({
      incidentId: VOLCANO.id,
      observedAt: '2026-10-07T17:52:00Z',
      ingestedAt: '2026-10-13T06:43:17Z',
      sourceName: 'NASA FIRMS VIIRS 375 m NRT (NOAA-20)',
      sourceUrl: 'https://www.earthdata.nasa.gov/data/instruments/viirs/viirs-i-band-375-m-active-fire-data',
      dataMode: 'historical',
      replayStep: 0,
    });
    expect(o.qualityNote).toContain('FIRMS VIIRS confidence nominal (FIRMS version 2.0NRT)');
    expect(o.qualityNote).toContain('can also be a vegetation fire or other hot ground'); // non-volcanic causes
    expect(o.qualityNote).toContain('Near-real-time (NRT) data are preliminary');
    expect(o.qualityNote).toContain('Cloud and thick smoke hide hotspots');
  });

  it('puts each record on its UTC day and drops rows outside the window', () => {
    const rows = [
      firms({ acq_date: '2026-10-06', acq_time: '2359' }),
      firms({ acq_date: '2026-10-07', acq_time: '0000' }),
      firms({ acq_date: '2026-10-10', acq_time: '1200' }),
      firms({ acq_date: '2026-10-13', acq_time: '0726' }),
      firms({ acq_date: '2026-10-13', acq_time: '0727' }),
    ];
    const { observations } = volcanoThermalObservations(VOLCANO, rows, CTX);
    expect(observations.map((o) => [o.observedAt, o.replayStep])).toEqual([
      ['2026-10-07T00:00:00Z', 0],
      ['2026-10-10T12:00:00Z', 3],
      ['2026-10-13T07:26:00Z', 6],
    ]);
  });

  it('gives stable ids from source + time + coordinates, independent of row order', () => {
    const rows = [firms({ northKm: 1 }), firms({ northKm: 2 }), firms({ satellite: 'N', file: 'viirs-snpp', northKm: 1 })];
    const a = volcanoThermalObservations(VOLCANO, rows, CTX).observations.map((o) => o.id);
    const b = volcanoThermalObservations(VOLCANO, [...rows].reverse(), CTX).observations.map((o) => o.id);
    expect(new Set(a).size).toBe(3);
    expect([...a].sort()).toEqual([...b].sort());
    expect(a[0]).toBe(`testv-firms-n20-20261009T1812Z-${Math.abs(rows[0].latitude).toFixed(5)}S-110.44600E`);
    expect(a[2]).toMatch(/^testv-firms-snpp-20261009T1812Z-/);
  });

  it('reports unreadable rows instead of guessing', () => {
    const rows = [firms({ satellite: 'Q' }), firms({ acq_time: '9999' }), firms({ confidence: 'maybe' }), firms({ frp: Number.NaN })];
    const { observations, problems } = volcanoThermalObservations(VOLCANO, rows, CTX);
    expect(observations).toEqual([]);
    expect(problems.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(problems[0].message).toContain('unknown FIRMS satellite code "Q"');
  });
});

describe('thermal rule: haze box, one record per sensor per UTC day', () => {
  const inBox = (i: number, over: Partial<FirmsRow> = {}): FirmsRow =>
    firms({ latitude: 0.1 + i * 0.01, longitude: 102.5, acq_date: '2026-10-08', acq_time: i < 6 ? '0612' : '1830', frp: 1.5, ...over });

  it(`aggregates per sensor and day; ${HAZE_MIN_DETECTIONS_PER_DAY} or more confident hotspots is an anomaly`, () => {
    const rows: FirmsRow[] = [
      ...Array.from({ length: 12 }, (_, i) => inBox(i)),
      inBox(20, { confidence: 'low' }),
      inBox(21, { confidence: 'low' }),
      firms({ latitude: 1.5, longitude: 102.5, acq_date: '2026-10-08' }), // outside the box
      ...Array.from({ length: 9 }, (_, i) => inBox(i, { satellite: 'N', file: 'viirs-snpp' })),
    ];
    const { observations, problems } = hazeThermalObservations(BOX, rows, CTX);
    expect(problems).toEqual([]);
    expect(observations).toHaveLength(2);
    const n20 = observations.find((o) => o.id === 'testbox-firms-n20-20261008');
    const snpp = observations.find((o) => o.id === 'testbox-firms-snpp-20261008');
    expect(n20).toMatchObject({ value: 12, unit: 'detections', anomaly: true, replayStep: 1, observedAt: '2026-10-08T18:30:00Z' });
    expect(n20?.ingestedAt).toBe('2026-10-13T06:43:17Z');
    expect(n20?.summary).toBe(
      'NOAA-20 VIIRS: 12 nominal- or high-confidence hotspots in the watch box on 8 Oct (UTC), summed fire radiative ' +
        'power 18 MW; 2 low-confidence hotspots not counted. Detection times (UTC): 06:12, 18:30.',
    );
    expect(n20?.anomalyReason).toBe(
      '12 nominal- or high-confidence FIRMS hotspots from one sensor (NOAA-20 VIIRS) inside the watch box on this UTC ' +
        `day (rule: 10 or more). ${RULE_DISCLAIMER}`,
    );
    expect(snpp).toMatchObject({ value: 9, anomaly: false, anomalyReason: null });
    expect(snpp?.summary).toContain('Not flagged: below the watch rule of 10 per sensor per UTC day.');
  });

  it('is exactly at the threshold boundary: 10 flags, 9 does not', () => {
    const ten = hazeThermalObservations(BOX, Array.from({ length: 10 }, (_, i) => inBox(i)), CTX).observations;
    const nine = hazeThermalObservations(BOX, Array.from({ length: 9 }, (_, i) => inBox(i)), CTX).observations;
    expect(ten.map((o) => [o.value, o.anomaly])).toEqual([[10, true]]);
    expect(nine.map((o) => [o.value, o.anomaly])).toEqual([[9, false]]);
  });

  it('splits days by UTC date and never aggregates across sensors', () => {
    const rows = [inBox(0), inBox(1, { acq_date: '2026-10-09' }), inBox(2, { satellite: 'N21', file: 'viirs-noaa21' })];
    const ids = hazeThermalObservations(BOX, rows, CTX).observations.map((o) => o.id).sort();
    expect(ids).toEqual(['testbox-firms-n20-20261008', 'testbox-firms-n20-20261009', 'testbox-firms-n21-20261008']);
  });

  it('a volcano watch never aggregates, and a box watch never produces per-hotspot records', () => {
    expect(hazeThermalObservations(VOLCANO, [firms()], CTX).observations).toEqual([]);
    const box = observationsForWatch(BOX, { firms: [inBox(0)], quakes: [] }, CTX).observations;
    expect(box.map((o) => o.unit)).toEqual(['detections']);
  });
});

describe('seismic rule', () => {
  it(`keeps quakes within ${SEISMIC_RADIUS_KM} km; M 3.0 or more is an anomaly, smaller is context`, () => {
    const rows = [
      quake({ eventId: 'us-a', mag: 3.0, northKm: 29.9 }),
      quake({ eventId: 'us-b', mag: 2.9, northKm: 5 }),
      quake({ eventId: 'us-c', mag: 6.1, northKm: 30.2 }),
    ];
    const { observations, problems } = seismicObservations(VOLCANO, rows, CTX);
    expect(problems).toEqual([]);
    expect(observations.map((o) => [o.id, o.anomaly])).toEqual([
      ['testv-usgs-us-a', true],
      ['testv-usgs-us-b', false],
    ]);
    const [a, b] = observations;
    expect(a).toMatchObject({ category: 'seismic', value: 3.0, unit: 'M (mb)', dataMode: 'historical' });
    expect(a.sourceName).toBe('USGS earthquake catalog (ComCat), magnitude type mb');
    expect(a.sourceUrl).toBe('https://earthquake.usgs.gov/earthquakes/eventpage/us7000test');
    expect(a.anomalyReason).toBe(
      `Earthquake M 3.0 (mb), USGS, 30 km from the summit (rule: within 30 km and M 3.0 or more). ${RULE_DISCLAIMER}`,
    );
    expect(b.anomalyReason).toBeNull();
    expect(b.summary).toContain('Context only: below the M 3.0 watch rule.');
    expect(a.ingestedAt).toBe('2026-10-13T07:26:45Z');
  });

  it('keeps USGS and BMKG reports of the same event as separate records, each naming its product', () => {
    const rows = [
      quake({ eventId: 'us7000x', mag: 4.6 }),
      quake({ source: 'bmkg', product: 'live30event', eventId: 'bmg2026abcd', mag: 4.7, magType: null, url: null, status: 'confirmed', place: 'Java, Indonesia' }),
      quake({ source: 'bmkg', product: 'gempadirasakan', eventId: null, mag: 4.1, magType: null, url: null, status: null, place: '12 km BaratLaut TEST' }),
    ];
    const { observations } = seismicObservations(VOLCANO, rows, CTX);
    expect(observations).toHaveLength(3);
    const [usgs, live, felt] = observations;
    expect(usgs.id).toBe('testv-usgs-us7000x');
    expect(live.id).toBe('testv-bmkg-live30event-bmg2026abcd');
    expect(felt.id).toBe(`testv-bmkg-gempadirasakan-20261010T033017Z-${Math.abs(rows[2].lat).toFixed(5)}S-110.44600E`);
    expect(live).toMatchObject({ unit: 'M (type not stated)', sourceUrl: 'https://inatews.bmkg.go.id/' });
    expect(live.sourceName).toBe('BMKG InaTEWS live30event (latest located earthquakes), magnitude type not stated');
    expect(felt.sourceUrl).toBe('https://data.bmkg.go.id/gempabumi/');
    expect(live.summary).toContain('sumber data: BMKG');
    expect(live.anomalyReason).toContain('BMKG live30event');
    expect(usgs.qualityNote).toContain('never merged or averaged');
    // BMKG live30event has a Last-Modified in META; gempadirasakan does not, so it falls back.
    expect(live.ingestedAt).toBe('2026-10-13T06:48:29Z');
    expect(felt.ingestedAt).toBe(META.retrievedAt);
  });

  it('uses the box for a haze watch', () => {
    const rows = [quake({ lat: 0.5, lon: 102.5, eventId: 'in' }), quake({ lat: 1.5, lon: 102.5, eventId: 'out' })];
    const { observations } = seismicObservations(BOX, rows, CTX);
    expect(observations.map((o) => o.id)).toEqual(['testbox-usgs-in']);
    expect(observations[0].summary).toContain('inside the watch box');
  });

  it('drops quakes outside the window and reports unreadable rows', () => {
    const rows = [
      quake({ time: '2026-10-06T23:00:00Z', eventId: 'early' }),
      quake({ time: '2026-10-10T03:30:17+07:00', eventId: 'offset' }),
      quake({ source: 'bmkg', product: 'mystery', eventId: 'x' }),
      quake({ mag: Number.NaN, eventId: 'nan' }),
    ];
    const { observations, problems } = seismicObservations(VOLCANO, rows, CTX);
    expect(observations).toEqual([]);
    expect(problems.map((p) => p.index)).toEqual([1, 2, 3]);
  });
});

describe('per watch', () => {
  it('merges thermal and seismic oldest first, without mutating the inputs', () => {
    const input = deepFreeze({
      firms: [firms({ acq_date: '2026-10-11' }), firms({ acq_date: '2026-10-08', northKm: 1 })],
      quakes: [quake({ time: '2026-10-09T01:00:00Z' })],
    });
    const { observations } = observationsForWatch(VOLCANO, input, CTX);
    expect(observations.map((o) => [o.category, o.replayStep])).toEqual([
      ['thermal', 1],
      ['seismic', 2],
      ['thermal', 4],
    ]);
  });

  it('a watch with no rows produces no records', () => {
    expect(observationsForWatch(VOLCANO, { firms: [], quakes: [] }, CTX).observations).toEqual([]);
  });

  it('every rule text says it is illustrative, and each watch kind gets its own rules', () => {
    for (const text of Object.values(WATCH_RULE_TEXT)) expect(text.endsWith(RULE_DISCLAIMER)).toBe(true);
    expect(rulesForWatch(VOLCANO)).toEqual([WATCH_RULE_TEXT.thermalVolcano, WATCH_RULE_TEXT.seismicVolcano]);
    expect(rulesForWatch(BOX)).toEqual([WATCH_RULE_TEXT.thermalHaze, WATCH_RULE_TEXT.seismicBox]);
    expect(WATCH_RULE_TEXT.thermalVolcano).toContain('within 5 km of the summit');
    expect(WATCH_RULE_TEXT.thermalHaze).toContain('10 or more');
    expect(WATCH_RULE_TEXT.seismicVolcano).toContain('within 30 km');
  });
});
