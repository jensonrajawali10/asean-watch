import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import snapshotJson from '../../data/nea-snapshot.json';
import type { Incident, NeaContext, NeaStationWind } from '../types';
import { buildBriefing } from './briefing';
import {
  NEA_BACKOFF_KEY,
  NEA_BACKOFF_MS,
  NEA_CACHE_KEY,
  NEA_CACHE_TTL_MS,
  NEA_ENDPOINTS,
  NEA_RANGE_KM,
  NEA_RELAY_FEEDS,
  NEA_SOURCE_NAME,
  NEA_SOURCE_URL,
  angleDiff,
  assessDrift,
  compassName,
  loadNeaContext,
  loadNeaSnapshot,
  normaliseNea,
  psiBand,
  resetNeaCache,
  summariseWind,
  toUtcIso,
  type NeaRawResponses,
} from './nea';
import { deriveReview } from './reviewRules';
import { sgRelayUrl, type SgFeed } from './sgRelay';

// ---------------------------------------------------------------------------
// Trimmed copies of real NEA v2 responses (2026-10-13), plus deliberately bad station values.

const STATIONS = [
  { id: 'S108', deviceId: 'S108', name: 'Marina Barrage', location: { latitude: 1.2799, longitude: 103.8703 } },
  { id: 'S109', deviceId: 'S109', name: 'Ang Mo Kio Avenue 5', location: { latitude: 1.3793, longitude: 103.85 } },
  { id: 'S106', deviceId: 'S106', name: 'Jalan Noordin (Pulau Ubin)', location: { latitude: 1.4168, longitude: 103.9673 } },
  { id: 'S117', deviceId: 'S117', name: 'Banyan Road (Jurong Island)', location: { latitude: 1.2542, longitude: 103.6741 } },
  { id: 'S50', deviceId: 'S50', name: 'Clementi Road', location: { latitude: 1.3318, longitude: 103.7762 } },
  { id: 'S44', deviceId: 'S44', name: 'Nanyang Avenue', location: { latitude: 1.3458, longitude: 103.6817 } },
  { id: 'S43', deviceId: 'S43', name: 'Kim Chuan Road', location: { latitude: 1.3406, longitude: 103.8882 } },
];

const RAW_WIND_DIRECTION = {
  code: 0,
  data: {
    stations: STATIONS,
    readings: [
      {
        timestamp: '2026-10-13T14:39:00+08:00',
        data: [
          { stationId: 'S108', value: 182 },
          { stationId: 'S109', value: 263 },
          { stationId: 'S106', value: 77 },
          { stationId: 'S117', value: 340 },
          { stationId: 'S50', value: null }, // bad: no value
          { stationId: 'S44', value: '16' }, // bad: text
          { stationId: 'S43', value: 400 }, // bad: out of range
          { stationId: 'S999', value: 90 }, // bad: unknown station
        ],
      },
    ],
    readingType: 'Wind Dir AVG (S) 10M M1M',
    readingUnit: 'degrees',
  },
  errorMsg: '',
};

const RAW_WIND_SPEED = {
  code: 0,
  data: {
    stations: STATIONS,
    readings: [
      {
        timestamp: '2026-10-13T14:39:00+08:00',
        data: [
          { stationId: 'S108', value: 7.1 },
          { stationId: 'S109', value: 3 },
          { stationId: 'S106', value: 2.5 },
          { stationId: 'S117', value: -1 }, // bad speed: kept as null
        ],
      },
    ],
    readingType: 'Wind Speed AVG(S)10M M1M',
    readingUnit: 'knots',
  },
  errorMsg: '',
};

const RAW_PSI = {
  code: 0,
  data: {
    regionMetadata: [{ name: 'north', labelLocation: { latitude: 1.41803, longitude: 103.82 } }],
    items: [
      {
        date: '2026-10-13',
        updatedTimestamp: '2026-10-13T14:45:48+08:00',
        timestamp: '2026-10-13T14:00:00+08:00',
        readings: {
          psi_twenty_four_hourly: { north: 124, south: 133, west: 173, east: 153, central: 166 },
          pm25_sub_index: { north: 124, south: 133, west: 173, east: 153, central: 166 },
        },
      },
    ],
  },
  errorMsg: '',
};

const RAW_PM25 = {
  code: 0,
  data: {
    regionMetadata: [],
    items: [
      {
        date: '2026-10-13',
        updatedTimestamp: '2026-10-13T14:45:48+08:00',
        timestamp: '2026-10-13T14:00:00+08:00',
        readings: { pm25_one_hourly: { north: 54, south: 85, west: 122, east: 90, central: 100 } },
      },
    ],
  },
  errorMsg: '',
};

const RAW: NeaRawResponses = {
  windDirection: RAW_WIND_DIRECTION,
  windSpeed: RAW_WIND_SPEED,
  psi: RAW_PSI,
  pm25: RAW_PM25,
};

// ---------------------------------------------------------------------------
// Helpers

function station(fromDeg: number, speedKnots: number | null, id = `S${fromDeg}-${speedKnots}`): NeaStationWind {
  return { stationId: id, name: id, lat: 1.35, lon: 103.8, fromDeg, speedKnots };
}

function ctxWith(fromDeg: number | null, opts: Partial<NeaContext['wind']> & { dataMode?: NeaContext['dataMode'] } = {}): NeaContext {
  const base = normaliseNea(RAW, opts.dataMode ?? 'live', '2026-10-13T06:45:00Z');
  return {
    ...base,
    wind: {
      fromDeg,
      meanSpeedKnots: opts.meanSpeedKnots === undefined ? 4.1 : opts.meanSpeedKnots,
      consistency: opts.consistency ?? 0.9,
      stationCount: 4,
      label: 'test',
    },
  };
}

// Test incidents defined inline (the real-data fixtures are owned and changed elsewhere).
const TEST_INCIDENTS: Record<string, Incident> = {
  'inc-riau-haze-demo': {
    id: 'inc-riau-haze-demo',
    title: 'Riau peatland hotspots',
    hazard: 'wildfire',
    volcanoId: null,
    locationName: 'Siak-Kampar peatlands, Riau, Sumatra, Indonesia',
    country: 'Indonesia',
    lat: 0.5,
    lon: 102.55,
    dataMode: 'historical',
    scenarioWindow: { start: '2026-10-07T00:00:00Z', end: '2026-10-14T00:00:00Z' },
    replayable: false,
    summary: '',
  },
  'inc-merapi-demo': {
    id: 'inc-merapi-demo',
    title: 'Merapi',
    hazard: 'volcano',
    volcanoId: 'gvp-263250',
    locationName: 'Central Java, Indonesia',
    country: 'Indonesia',
    lat: -7.54,
    lon: 110.446,
    dataMode: 'historical',
    scenarioWindow: { start: '2026-10-07T00:00:00Z', end: '2026-10-14T00:00:00Z' },
    replayable: true,
    summary: '',
  },
};
function incidentById(id: string): Incident {
  const found = TEST_INCIDENTS[id];
  if (!found) throw new Error(`missing incident ${id}`);
  return found;
}

type Reply = { body?: unknown; status?: number } | Error | 'never' | 'abortable';

/**
 * Fake same-origin relay (/api/sg?feed=…) keyed by endpoint. A body is data.gov.sg's answer, which the
 * relay wraps with the time it fetched it (the fake clock's now); a status is the relay's own answer.
 */
function fakeFetch(replies: Partial<Record<keyof typeof NEA_ENDPOINTS, Reply>>): typeof fetch {
  const defaults: Record<keyof typeof NEA_ENDPOINTS, Reply> = {
    windDirection: { body: RAW_WIND_DIRECTION },
    windSpeed: { body: RAW_WIND_SPEED },
    psi: { body: RAW_PSI },
    pm25: { body: RAW_PM25 },
  };
  const byUrl = new Map<string, { feed: SgFeed; reply: Reply }>();
  for (const key of Object.keys(NEA_ENDPOINTS) as Array<keyof typeof NEA_ENDPOINTS>) {
    byUrl.set(sgRelayUrl(NEA_RELAY_FEEDS[key]), { feed: NEA_RELAY_FEEDS[key], reply: replies[key] ?? defaults[key] });
  }
  return ((url: string, init?: RequestInit) => {
    const route = byUrl.get(String(url));
    if (route === undefined) return Promise.reject(new Error(`unexpected url ${String(url)}`));
    const { feed, reply } = route;
    if (reply === 'never') return new Promise(() => undefined);
    if (reply === 'abortable') {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
      });
    }
    if (reply instanceof Error) return Promise.reject(reply);
    const status = reply.status ?? 200;
    const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body = status < 400 ? { available: true, feed, retrievedAt, stale: false, raw: reply.body } : reply.body;
    return Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetNeaCache(); // loadNeaContext caches across calls; every test starts clean
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('toUtcIso', () => {
  it('converts +08:00 to UTC Z, including across midnight', () => {
    expect(toUtcIso('2026-10-13T14:39:00+08:00')).toBe('2026-10-13T06:39:00Z');
    expect(toUtcIso('2026-10-13T05:00:00+08:00')).toBe('2026-10-12T21:00:00Z');
    expect(toUtcIso('2026-10-13T06:39:00Z')).toBe('2026-10-13T06:39:00Z');
  });

  it('rejects timestamps without a zone and non-timestamps', () => {
    for (const bad of ['2026-10-13T14:39:00', '2026-10-13', 'later', 20261013, null, undefined]) {
      expect(toUtcIso(bad)).toBeNull();
    }
  });
});

describe('normaliseNea', () => {
  it('joins speed to direction by stationId, converts times, and drops bad station values', () => {
    const ctx = normaliseNea(RAW, 'live', '2026-10-13T06:45:00Z');
    expect(ctx.dataMode).toBe('live');
    expect(ctx.observedAt).toBe('2026-10-13T06:39:00Z');
    expect(ctx.retrievedAt).toBe('2026-10-13T06:45:00Z');
    expect(ctx.stations.map((s) => [s.stationId, s.fromDeg, s.speedKnots])).toEqual([
      ['S108', 182, 7.1],
      ['S109', 263, 3],
      ['S106', 77, 2.5],
      ['S117', 340, null],
    ]);
    expect(ctx.stations[0]).toMatchObject({ name: 'Marina Barrage', lat: 1.2799, lon: 103.8703 });
    expect(ctx.qualityNote).toContain('4 station readings were dropped as invalid.');
    expect(ctx.wind.stationCount).toBe(3); // speed-weighted mean uses stations with a speed
    expect(ctx.sourceName).toBe(NEA_SOURCE_NAME);
    expect(ctx.sourceUrl).toBe(NEA_SOURCE_URL);
  });

  it('reads 24-hour PSI and 1-hour PM2.5 with the NEA band for the highest region', () => {
    const ctx = normaliseNea(RAW, 'live', '2026-10-13T06:45:00Z');
    expect(ctx.haze).toEqual({
      observedAt: '2026-10-13T06:00:00Z',
      psi24h: { north: 124, south: 133, east: 153, west: 173, central: 166 },
      pm25OneHour: { north: 54, south: 85, east: 90, west: 122, central: 100 },
      psiBand: 'Unhealthy',
      dataMode: 'live',
    });
  });

  it('writes the Singapore Open Data Licence attribution with the access date', () => {
    const ctx = normaliseNea(RAW, 'historical', '2026-10-13T06:53:07Z');
    expect(ctx.attribution).toBe(
      'Contains information from Wind Direction across Singapore, Wind Speed across Singapore, Pollutant ' +
        'Standards Index (PSI) and PM2.5 accessed on 2026-10-13 from data.gov.sg which is made available ' +
        'under the terms of the Singapore Open Data Licence version 1.0 https://data.gov.sg/open-data-licence',
    );
    expect(ctx.qualityNote).toContain('Bundled snapshot captured 2026-10-13T06:53:07Z');
  });

  it('gives null haze when PSI is missing or malformed, without failing', () => {
    expect(normaliseNea({ ...RAW, psi: null, pm25: null }, 'live', '2026-10-13T06:45:00Z').haze).toBeNull();
    expect(normaliseNea({ ...RAW, psi: { code: 0, data: { items: [] } } }, 'live', '2026-10-13T06:45:00Z').haze).toBeNull();
    const noPm = normaliseNea({ ...RAW, pm25: 'garbage' }, 'live', '2026-10-13T06:45:00Z');
    expect(noPm.haze?.pm25OneHour).toBeNull();
    expect(noPm.attribution).not.toContain('PM2.5');
  });

  it('throws a readable error only when wind has no usable reading', () => {
    expect(() => normaliseNea({ ...RAW, windDirection: { code: 0, data: {} } }, 'live', 'x')).toThrow(/no readable reading/);
    const allBad = { code: 0, data: { stations: STATIONS, readings: [{ timestamp: '2026-10-13T14:39:00+08:00', data: [{ stationId: 'S108', value: 'n/a' }] }] } };
    expect(() => normaliseNea({ ...RAW, windDirection: allBad }, 'live', 'x')).toThrow(/no usable station readings/);
  });
});

describe('summariseWind', () => {
  it('uniform winds give the exact direction, full consistency, and a compass label', () => {
    const w = summariseWind([station(226, 2), station(226, 4), station(226, 6), station(226, 8)]);
    expect(w.fromDeg).toBeCloseTo(226, 6);
    expect(w.consistency).toBe(1);
    expect(w.meanSpeedKnots).toBe(5);
    expect(w.stationCount).toBe(4);
    expect(w.label).toBe('From SW (226°) at 5.0 kn');
  });

  it('exactly opposite winds have no prevailing direction and read as variable', () => {
    const w = summariseWind([station(90, 5), station(270, 5)]);
    expect(w.fromDeg).toBeNull();
    expect(w.consistency).toBe(0);
    expect(w.label).toContain('variable: stations disagree');
  });

  it('nearly opposite winds give low consistency and the variable suffix', () => {
    const w = summariseWind([station(80, 5), station(280, 4)]);
    expect(w.fromDeg).not.toBeNull();
    expect(w.consistency).toBeLessThan(0.5);
    expect(w.label.endsWith(', variable: stations disagree')).toBe(true);
  });

  it('weights by speed and wraps around north', () => {
    const weighted = summariseWind([station(0, 10), station(90, 1)]);
    expect(weighted.fromDeg).toBeCloseTo((Math.atan2(1, 10) * 180) / Math.PI, 1); // about 5.7, not 45
    const wrap = summariseWind([station(350, 5), station(10, 5)]);
    expect(wrap.fromDeg).toBe(0);
    expect(wrap.label.startsWith('From N (0°)')).toBe(true);
  });

  it('handles missing speeds, calm air, and no data', () => {
    const noSpeed = summariseWind([station(180, null), station(180, null)]);
    expect(noSpeed.fromDeg).toBe(180);
    expect(noSpeed.meanSpeedKnots).toBeNull();
    expect(noSpeed.label).toBe('From S (180°), speed not reported');
    const calm = summariseWind([station(90, 0), station(200, 0)]);
    expect(calm.fromDeg).toBeNull();
    expect(calm.label).toBe('Calm (0.0 kn)');
    const none = summariseWind([]);
    expect(none).toEqual({ fromDeg: null, meanSpeedKnots: null, consistency: 0, stationCount: 0, label: 'No usable wind reading' });
  });
});

describe('compass, angles, and PSI bands', () => {
  it('names the 16 compass points', () => {
    const cases: Array<[number, string]> = [
      [0, 'N'], [11.24, 'N'], [11.25, 'NNE'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'],
      [202.5, 'SSW'], [226, 'SW'], [247.5, 'WSW'], [270, 'W'], [315, 'NW'], [337.5, 'NNW'], [349, 'N'],
      [-45, 'NW'], [720, 'N'],
    ];
    for (const [deg, name] of cases) expect(compassName(deg), `${deg}`).toBe(name);
  });

  it('angleDiff is the signed smallest difference', () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(180, 0)).toBe(180);
  });

  it('uses NEA PSI descriptors', () => {
    const cases: Array<[number, string]> = [
      [0, 'Good'], [50, 'Good'], [51, 'Moderate'], [100, 'Moderate'], [101, 'Unhealthy'], [200, 'Unhealthy'],
      [201, 'Very unhealthy'], [300, 'Very unhealthy'], [301, 'Hazardous'],
    ];
    for (const [psi, band] of cases) expect(psiBand(psi), `${psi}`).toBe(band);
  });
});

describe('assessDrift', () => {
  const riau = incidentById('inc-riau-haze-demo');
  const merapi = incidentById('inc-merapi-demo');
  // Ayutthaya, central Thailand: well outside NEA range (inline; there is no simulated flood fixture).
  const flood: Incident = { ...merapi, id: 'test-ayutthaya', hazard: 'flood', volcanoId: null, lat: 14.35, lon: 100.56 };

  it('Riau is about 170 km away, with Singapore to the NE (Riau is SW of Singapore)', () => {
    const d = assessDrift(riau, ctxWith(236));
    expect(d).not.toBeNull();
    expect(d?.incidentId).toBe('inc-riau-haze-demo');
    expect(d?.distanceKm).toBeGreaterThan(160);
    expect(d?.distanceKm).toBeLessThan(180);
    expect(d?.bearingToSingaporeDeg).toBeGreaterThan(50);
    expect(d?.bearingToSingaporeDeg).toBeLessThan(62);
    expect(compassName(d?.bearingToSingaporeDeg ?? 0)).toBe('NE');
  });

  it('says plainly that the hotspots are FIRMS detections, the wind is real, and the drift is illustrative', () => {
    const d = assessDrift(riau, ctxWith(236));
    expect(d?.downwindDeg).toBe(56);
    expect(d?.singaporeDownwind).toBe(true);
    expect(d?.text).toBe(
      'Current wind measured at NEA Singapore stations (from SW, 4.1 kn; the wind now, not on the replay day) ' +
        'would carry haze from these FIRMS hotspots toward Singapore, about 170 km away. Illustrative only; not a dispersion model.',
    );
  });

  it('is neutral when Singapore is not downwind', () => {
    const d = assessDrift(riau, ctxWith(56));
    expect(d?.downwindDeg).toBe(236);
    expect(d?.singaporeDownwind).toBe(false);
    expect(d?.text).toBe(
      'Current wind measured at NEA Singapore stations (from NE, 4.1 kn; the wind now, not on the replay day) ' +
        'blows toward SW, not from these FIRMS hotspots toward Singapore (about 170 km away). Haze can still ' +
        "reach Singapore from other fires; use NEA's measured PSI for air quality. Illustrative only; not a dispersion model.",
    );
  });

  it('gives a snapshot its reading time and never calls it current or now', () => {
    const snap = ctxWith(236, { dataMode: 'historical' });
    expect(snap.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const when = `${snap.observedAt.slice(0, 10)} ${snap.observedAt.slice(11, 16)} UTC`;
    expect(assessDrift(riau, snap)?.text).toBe(
      `Wind measured at ${when} (snapshot) at NEA Singapore stations (from SW, 4.1 kn; not on the replay day) ` +
        'would carry haze from these FIRMS hotspots toward Singapore, about 170 km away. Illustrative only; not a dispersion model.',
    );
    expect(assessDrift(riau, ctxWith(56, { dataMode: 'historical' }))?.text).toBe(
      `Wind measured at ${when} (snapshot) at NEA Singapore stations (from NE, 4.1 kn; not on the replay day) ` +
        'blew toward SW, not from these FIRMS hotspots toward Singapore (about 170 km away). Haze can still ' +
        "reach Singapore from other fires; use NEA's measured PSI for air quality. Illustrative only; not a dispersion model.",
    );
    for (const from of [236, 56, null]) {
      expect(assessDrift(riau, ctxWith(from, { dataMode: 'historical' }))?.text).not.toMatch(/\bcurrent\b|\bnow\b/i);
    }
    // The bundled snapshot the server and the offline fallback use reads the same way.
    const bundled = loadNeaSnapshot();
    expect(bundled?.dataMode).toBe('historical');
    const text = assessDrift(riau, bundled as NeaContext)?.text ?? '';
    expect(text).toMatch(/^Wind measured at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \(snapshot\) at NEA Singapore stations/);
    expect(text).not.toMatch(/\bcurrent\b|\bnow\b/i);
  });

  it('uses a ±45° downwind cone', () => {
    const bearing = assessDrift(riau, ctxWith(0))?.bearingToSingaporeDeg as number;
    const fromFor = (offset: number) => (bearing + 180 + offset + 360) % 360;
    expect(assessDrift(riau, ctxWith(fromFor(44.9)))?.singaporeDownwind).toBe(true);
    expect(assessDrift(riau, ctxWith(fromFor(-44.9)))?.singaporeDownwind).toBe(true);
    expect(assessDrift(riau, ctxWith(fromFor(46)))?.singaporeDownwind).toBe(false);
  });

  it('mentions low station agreement, snapshot mode, and missing wind', () => {
    expect(assessDrift(riau, ctxWith(236, { consistency: 0.3 }))?.text).toContain('low station agreement');
    const snap = ctxWith(236, { dataMode: 'historical', consistency: 0.3 });
    expect(assessDrift(riau, snap)?.text).toContain(
      `Wind measured at ${snap.observedAt.slice(0, 10)} ${snap.observedAt.slice(11, 16)} UTC (snapshot) at NEA Singapore stations ` +
        '(from SW, 4.1 kn, low station agreement; not on the replay day)',
    );
    const none = assessDrift(riau, ctxWith(null));
    expect(none?.downwindDeg).toBeNull();
    expect(none?.singaporeDownwind).toBeNull();
    expect(none?.text).toMatch(/No usable real wind direction .* these FIRMS hotspots .* about 170 km away\. Illustrative only; not a dispersion model\.$/);
    expect(assessDrift(riau, ctxWith(236))?.text).not.toMatch(/simulated/i);
  });

  it(`returns null beyond ${NEA_RANGE_KM} km (Merapi, Ayutthaya)`, () => {
    expect(assessDrift(merapi, ctxWith(236))).toBeNull();
    expect(assessDrift(flood, ctxWith(236))).toBeNull();
  });
});

describe('loadNeaContext', () => {
  it('returns live context when all four endpoints succeed', async () => {
    const r = await loadNeaContext({ fetchImpl: fakeFetch({}) });
    expect(r.fellBack).toBe(false);
    expect(r.error).toBeNull();
    expect(r.context?.dataMode).toBe('live');
    expect(r.context?.observedAt).toBe('2026-10-13T06:39:00Z');
    expect(r.context?.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(r.context?.haze?.psiBand).toBe('Unhealthy');
  });

  it('falls back to the snapshot with a readable error when fetch rejects', async () => {
    const r = await loadNeaContext({ fetchImpl: fakeFetch({ windDirection: new Error('boom') }) });
    expect(r.fellBack).toBe(true);
    expect(r.context?.dataMode).toBe('historical');
    expect(r.context).toEqual(loadNeaSnapshot());
    expect(r.error).toMatch(
      /^Live NEA data unavailable \(wind direction: network error \(boom\)\); showing the bundled snapshot captured \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\.$/,
    );
  });

  it('falls back on timeout, whether or not fetch honours the abort signal', async () => {
    for (const reply of ['never', 'abortable'] as const) {
      resetNeaCache();
      const started = Date.now();
      const r = await loadNeaContext({ timeoutMs: 30, fetchImpl: fakeFetch({ windSpeed: reply, psi: reply }) });
      expect(Date.now() - started).toBeLessThan(2000);
      expect(r.fellBack).toBe(true);
      expect(r.context?.dataMode).toBe('historical');
      expect(r.error).toContain('wind speed: timed out after 30 ms');
    }
  });

  it('falls back on HTTP errors, API error codes, unusable wind, and a throwing fetch', async () => {
    const cases: Array<[typeof fetch, RegExp]> = [
      [fakeFetch({ windSpeed: { status: 503, body: {} } }), /wind speed: HTTP 503/],
      [fakeFetch({ windDirection: { body: { code: 17, errorMsg: 'Invalid request' } } }), /API code 17 \(Invalid request\)/],
      [fakeFetch({ windDirection: { body: { code: 0, data: {} } } }), /no readable reading/],
      [(() => { throw new Error('sync failure'); }) as unknown as typeof fetch, /sync failure/],
    ];
    for (const [fetchImpl, pattern] of cases) {
      const r = await loadNeaContext({ fetchImpl });
      expect(r.fellBack).toBe(true);
      expect(r.context?.dataMode).toBe('historical');
      expect(r.error).toMatch(pattern);
    }
  });

  it('keeps live wind and uses the SNAPSHOT haze, clearly marked, when PSI is rate limited', async () => {
    const snap = loadNeaSnapshot() as NeaContext;
    const savedTime = `${snap.haze?.observedAt.slice(0, 10)} ${snap.haze?.observedAt.slice(11, 16)} UTC`;
    for (const psiReply of [{ status: 429, body: {} }, new TypeError('Failed to fetch')] as Reply[]) {
      resetNeaCache();
      const r = await loadNeaContext({ fetchImpl: fakeFetch({ psi: psiReply }) });
      expect(r.fellBack).toBe(false);
      expect(r.context?.dataMode).toBe('live');
      expect(r.context?.stations).toHaveLength(4);
      expect(r.context?.haze).toEqual({ ...snap.haze, dataMode: 'historical' });
      expect(r.error).toMatch(/^Live PSI unavailable \(rate limited( or offline)?\); showing saved NEA PSI and PM2\.5 from /);
      expect(r.error).toContain(`from ${savedTime}.`);
      expect(r.context?.qualityNote).toContain('come from the saved NEA snapshot');
      expect(r.context?.attribution).toContain('Pollutant Standards Index (PSI)');
    }
  });

  it('says when both PSI and PM2.5 fail, and gives null haze only if no snapshot haze exists', async () => {
    const r = await loadNeaContext({ fetchImpl: fakeFetch({ psi: { status: 429, body: {} }, pm25: { status: 429, body: {} } }) });
    expect(r.context?.haze?.dataMode).toBe('historical');
    expect(r.error).toMatch(/^Live PSI and PM2\.5 unavailable \(rate limited\); showing saved NEA PSI and PM2\.5 from .* UTC\.$/);
    const noFallback = normaliseNea({ ...RAW, psi: null }, 'live', '2026-10-13T06:45:00Z', { fallbackHaze: null });
    expect(noFallback.haze).toBeNull();
  });

  it('keeps live PSI with null PM2.5 when only PM2.5 fails', async () => {
    const r = await loadNeaContext({ fetchImpl: fakeFetch({ pm25: new Error('offline') }) });
    expect(r.fellBack).toBe(false);
    expect(r.context?.haze?.dataMode).toBe('live');
    expect(r.context?.haze?.psiBand).toBe('Unhealthy');
    expect(r.context?.haze?.pm25OneHour).toBeNull();
    expect(r.error).toBe('Live PM2.5 unavailable (network error (offline)); PSI is live and PM2.5 is not shown.');
  });

  it('reports HTTP 429 and a CORS-less 429 (fetch TypeError) on wind as rate limited', async () => {
    const r429 = await loadNeaContext({ fetchImpl: fakeFetch({ windDirection: { status: 429, body: {} } }) });
    expect(r429.fellBack).toBe(true);
    expect(r429.error).toContain('wind direction: rate limited');
    resetNeaCache();
    const cors = await loadNeaContext({ fetchImpl: fakeFetch({ windSpeed: new TypeError('Failed to fetch') }) });
    expect(cors.fellBack).toBe(true);
    expect(cors.error).toContain('wind speed: rate limited or offline');
  });

  it('asks only the same-origin relay, and dates the context by when the relay fetched the wind', async () => {
    const urls: string[] = [];
    const relay = fakeFetch({});
    const spy = ((url: string, init?: RequestInit) => {
      urls.push(String(url));
      return relay(url, init);
    }) as unknown as typeof fetch;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
    const r = await loadNeaContext({ fetchImpl: spy });
    expect(urls.sort()).toEqual(['/api/sg?feed=pm25', '/api/sg?feed=psi', '/api/sg?feed=wind-direction', '/api/sg?feed=wind-speed']);
    expect(r.fellBack).toBe(false);
    expect(r.context?.retrievedAt).toBe('2026-10-24T08:00:00Z');
  });

  it('falls back to the snapshot, and backs off, when the relay says data.gov.sg is throttling it', async () => {
    const fetchImpl = ((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ available: false, feed: new URL(String(url), 'http://x').searchParams.get('feed'), checkedAt: '2026-10-24T08:00:00Z', reason: 'rate_limited', message: 'x' }),
      } as unknown as Response)) as unknown as typeof fetch;
    const r = await loadNeaContext({ fetchImpl });
    expect(r.fellBack).toBe(true);
    expect(r.context?.dataMode).toBe('historical');
    expect(r.error).toMatch(/^Live NEA data unavailable \(wind direction: data\.gov\.sg rate limited; wind speed: data\.gov\.sg rate limited; retrying live after \d\d:\d\d:\d\d UTC\); showing the bundled snapshot captured /);
    // The backoff holds: the next call does not ask the relay again.
    let asked = false;
    const second = await loadNeaContext({ fetchImpl: (() => ((asked = true), Promise.reject(new Error('no')))) as unknown as typeof fetch });
    expect(asked).toBe(false);
    expect(second.fellBack).toBe(true);
  });
});

/** In-memory Storage stand-in. */
function fakeStorage(opts: { throws?: boolean } = {}): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const guard = () => {
    if (opts.throws) throw new Error('SecurityError: storage is disabled');
  };
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => (guard(), data.clear()),
    getItem: (k: string) => (guard(), data.get(k) ?? null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => (guard(), void data.delete(k)),
    setItem: (k: string, v: string) => (guard(), void data.set(k, v)),
  };
}

/** fakeFetch that counts calls. */
function countingFetch(replies: Parameters<typeof fakeFetch>[0] = {}) {
  const inner = fakeFetch(replies);
  const counter = { calls: 0 };
  const fn = ((url: string, init?: RequestInit) => {
    counter.calls += 1;
    return inner(url, init);
  }) as unknown as typeof fetch;
  return { fn, counter };
}

describe('loadNeaContext dedupe and cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares ONE set of four requests between concurrent calls (StrictMode double mount)', async () => {
    const { fn, counter } = countingFetch();
    const [a, b, c] = await Promise.all([
      loadNeaContext({ fetchImpl: fn }),
      loadNeaContext({ fetchImpl: fn }),
      loadNeaContext({ fetchImpl: fn }),
    ]);
    expect(counter.calls).toBe(4);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a.context?.dataMode).toBe('live');
  });

  it('reuses a successful live result for 5 minutes, keeping dataMode live and the original retrievedAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T07:00:00Z'));
    const { fn, counter } = countingFetch();
    const first = await loadNeaContext({ fetchImpl: fn });
    expect(first.context?.retrievedAt).toBe('2026-10-13T07:00:00Z');

    vi.setSystemTime(new Date('2026-10-13T07:04:59Z'));
    const second = await loadNeaContext({ fetchImpl: fn });
    expect(counter.calls).toBe(4);
    expect(second.context?.dataMode).toBe('live');
    expect(second.context?.retrievedAt).toBe('2026-10-13T07:00:00Z');

    vi.setSystemTime(new Date('2026-10-13T07:05:01Z'));
    const third = await loadNeaContext({ fetchImpl: fn });
    expect(counter.calls).toBe(8);
    expect(third.context?.retrievedAt).toBe('2026-10-13T07:05:01Z');
  });

  it('does not cache a non-transient fallback (HTTP 503), so the next call tries live again', async () => {
    const failing = countingFetch({ windDirection: { status: 503, body: {} } });
    expect((await loadNeaContext({ fetchImpl: failing.fn })).fellBack).toBe(true);
    const ok = countingFetch();
    const r = await loadNeaContext({ fetchImpl: ok.fn });
    expect(ok.counter.calls).toBe(4);
    expect(r.fellBack).toBe(false);
  });

  it('persists to sessionStorage and serves it after a reload (memory cleared)', async () => {
    const storage = fakeStorage();
    vi.stubGlobal('sessionStorage', storage);
    const { fn, counter } = countingFetch();
    const first = await loadNeaContext({ fetchImpl: fn });
    expect(storage.data.has(NEA_CACHE_KEY)).toBe(true);

    resetNeaCache({ keepStorage: true }); // simulates an HMR or page reload
    const again = await loadNeaContext({ fetchImpl: fn });
    expect(counter.calls).toBe(4);
    expect(again.fellBack).toBe(false);
    expect(again.context?.dataMode).toBe('live');
    expect(again.context?.retrievedAt).toBe(first.context?.retrievedAt);
    expect(again.context).toEqual(first.context);
  });

  it('ignores stale or corrupt sessionStorage entries', async () => {
    const storage = fakeStorage();
    vi.stubGlobal('sessionStorage', storage);
    const { fn, counter } = countingFetch();
    storage.data.set(NEA_CACHE_KEY, '{not json');
    await loadNeaContext({ fetchImpl: fn });
    expect(counter.calls).toBe(4);

    const entry = JSON.parse(storage.data.get(NEA_CACHE_KEY) as string);
    storage.data.set(NEA_CACHE_KEY, JSON.stringify({ ...entry, storedAt: entry.storedAt - NEA_CACHE_TTL_MS - 1 }));
    resetNeaCache({ keepStorage: true });
    await loadNeaContext({ fetchImpl: fn });
    expect(counter.calls).toBe(8);
  });

  it('falls through cleanly when storage throws or is missing', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage({ throws: true }));
    const { fn, counter } = countingFetch();
    const r = await loadNeaContext({ fetchImpl: fn });
    expect(r.fellBack).toBe(false);
    expect(r.context?.dataMode).toBe('live');
    const again = await loadNeaContext({ fetchImpl: fn }); // memory cache still works
    expect(counter.calls).toBe(4);
    expect(again.context).toBe(r.context);
    expect(() => resetNeaCache()).not.toThrow();

    vi.stubGlobal('sessionStorage', undefined);
    const r2 = await loadNeaContext({ fetchImpl: fn });
    expect(r2.context?.dataMode).toBe('live');
  });
});

describe('bundled snapshot', () => {
  it('normalises the real capture as historical with its original timestamps', () => {
    const snap = loadNeaSnapshot();
    expect(snap).not.toBeNull();
    expect(snap?.dataMode).toBe('historical');
    expect(snap?.retrievedAt).toBe((snapshotJson as { capturedAt: string }).capturedAt);
    expect(snap?.observedAt).toMatch(/Z$/);
    expect(snap?.stations.length).toBeGreaterThan(0);
    expect(snap?.haze).not.toBeNull();
    expect(snap?.attribution).toContain('Singapore Open Data Licence version 1.0');
  });
});

describe('brief NEA section', () => {
  const riau = incidentById('inc-riau-haze-demo');
  const review = deriveReview([], riau.scenarioWindow);
  const base = { incident: riau, volcano: null, step: null, review, issues: [] };
  const nea = normaliseNea(RAW, 'live', '2026-10-13T06:45:00Z');
  const drift = assessDrift(riau, nea);
  const flat = (t: string) => t.replace(/\s+/g, ' ');

  it('is included when drift is present, with mode, times, wind, PSI, drift, source, and attribution', () => {
    expect(drift).not.toBeNull();
    const text = flat(buildBriefing({ ...base, nea, drift }));
    expect(text).toContain('CONTEXT: NEA SINGAPORE (not evidence)');
    expect(text).toMatch(/Mode: LIVE/);
    expect(text).toContain('Wind reading time: 2026-10-13T06:39:00Z');
    expect(text).toContain(nea.wind.label);
    expect(text).toContain(`${nea.wind.stationCount} NEA stations used`);
    expect(text).toContain('124 to 173 across 5 regions; NEA band for the highest region: Unhealthy');
    expect(text).toContain('reading time 2026-10-13T06:00:00Z');
    expect(text).toContain(flat(drift?.text ?? 'missing'));
    expect(text).toContain(NEA_SOURCE_URL);
    expect(text).toContain(flat(nea.attribution));
    expect(text).toContain('REAL DATA (');
    expect(text).not.toMatch(/simulated/i);
  });

  it('marks snapshot haze inside a live context', () => {
    const snap = loadNeaSnapshot() as NeaContext;
    const mixed = normaliseNea({ ...RAW, psi: null, pm25: null }, 'live', '2026-10-13T06:45:00Z', {
      fallbackHaze: snap.haze,
      fallbackRetrievedAt: snap.retrievedAt,
    });
    expect(mixed.haze?.dataMode).toBe('historical');
    const text = flat(buildBriefing({ ...base, nea: mixed, drift: assessDrift(riau, mixed) }));
    expect(text).toMatch(/Mode: LIVE/);
    expect(text).toContain('24-hour PSI: HISTORICAL SNAPSHOT (live PSI unavailable):');
  });

  it('labels a snapshot as HISTORICAL SNAPSHOT', () => {
    const snap = loadNeaSnapshot() as NeaContext;
    const text = flat(buildBriefing({ ...base, nea: snap, drift: assessDrift(riau, snap) }));
    expect(text).toMatch(/Mode: HISTORICAL SNAPSHOT/);
    expect(text).toContain(`Snapshot captured: ${snap.retrievedAt}`);
  });

  it('is omitted when drift is absent, leaving the brief unchanged', () => {
    const plain = buildBriefing(base);
    expect(plain).not.toContain('NEA SINGAPORE');
    expect(buildBriefing({ ...base, nea, drift: null })).toBe(plain);
    expect(buildBriefing({ ...base, nea })).toBe(plain);
  });

  it('stays deterministic: only data timestamps, no wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-03-03T03:03:03Z'));
    const a = buildBriefing({ ...base, nea, drift });
    vi.setSystemTime(new Date('2001-01-01T00:00:00Z'));
    const b = buildBriefing({ ...base, nea, drift });
    expect(b).toBe(a);
    expect(a).not.toContain('2031');
    expect(a).not.toContain('2001');
  });
});

describe('loadNeaContext backoff after a live failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips live fetching for 60 s after a 429 and serves the snapshot, then retries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T07:00:00Z'));
    const snap = loadNeaSnapshot() as NeaContext;
    const limited = countingFetch({ windDirection: { status: 429, body: {} } });
    const first = await loadNeaContext({ fetchImpl: limited.fn });
    expect(limited.counter.calls).toBe(4);
    expect(first.fellBack).toBe(true);
    expect(first.error).toContain('wind direction: rate limited; retrying live after 07:01:00 UTC');

    const ok = countingFetch();
    vi.setSystemTime(new Date('2026-10-13T07:00:30Z'));
    const during = await loadNeaContext({ fetchImpl: ok.fn });
    expect(ok.counter.calls).toBe(0);
    expect(during.fellBack).toBe(true);
    expect(during.context).toEqual(snap);
    expect(during.error).toBe(
      `Live NEA data unavailable (rate limited; retrying live after 07:01:00 UTC); showing the bundled snapshot captured ${snap.retrievedAt}.`,
    );

    vi.setSystemTime(new Date('2026-10-13T07:00:00Z').getTime() + NEA_BACKOFF_MS);
    const after = await loadNeaContext({ fetchImpl: ok.fn });
    expect(ok.counter.calls).toBe(4);
    expect(after.fellBack).toBe(false);
    expect(after.context?.dataMode).toBe('live');
  });

  it('also backs off after a fetch TypeError or a timeout, but not after HTTP 503', async () => {
    const cases: Array<[Parameters<typeof fakeFetch>[0], string | null]> = [
      [{ windSpeed: new TypeError('Failed to fetch') }, 'rate limited or offline; retrying live after'],
      [{ windDirection: 'never' }, 'timed out after 20 ms; retrying live after'],
      [{ windDirection: { status: 503, body: {} } }, null],
    ];
    for (const [replies, expected] of cases) {
      resetNeaCache();
      const r = await loadNeaContext({ timeoutMs: 20, fetchImpl: fakeFetch(replies) });
      expect(r.fellBack).toBe(true);
      const ok = countingFetch();
      const next = await loadNeaContext({ fetchImpl: ok.fn });
      if (expected) {
        expect(r.error).toContain(expected);
        expect(ok.counter.calls).toBe(0);
        expect(next.fellBack).toBe(true);
      } else {
        expect(r.error).not.toContain('retrying live after');
        expect(ok.counter.calls).toBe(4);
        expect(next.fellBack).toBe(false);
      }
    }
  });

  it('persists the backoff in sessionStorage under its own key, and survives a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T07:00:00Z'));
    const storage = fakeStorage();
    vi.stubGlobal('sessionStorage', storage);
    await loadNeaContext({ fetchImpl: fakeFetch({ windDirection: { status: 429, body: {} } }) });
    expect(JSON.parse(storage.data.get(NEA_BACKOFF_KEY) as string)).toEqual({
      until: Date.parse('2026-10-13T07:01:00Z'),
      reason: 'rate limited',
    });
    expect(storage.data.has(NEA_CACHE_KEY)).toBe(false);

    resetNeaCache({ keepStorage: true }); // reload: memory gone, storage kept
    const ok = countingFetch();
    const r = await loadNeaContext({ fetchImpl: ok.fn });
    expect(ok.counter.calls).toBe(0);
    expect(r.error).toContain('rate limited; retrying live after 07:01:00 UTC');
  });

  it('serves a fresh cached live result during a backoff', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T07:00:00Z'));
    const storage = fakeStorage();
    vi.stubGlobal('sessionStorage', storage);
    const live = await loadNeaContext({ fetchImpl: fakeFetch({}) });
    storage.data.set(NEA_BACKOFF_KEY, JSON.stringify({ until: Date.now() + 30_000, reason: 'rate limited' }));
    resetNeaCache({ keepStorage: true });
    const ok = countingFetch();
    const r = await loadNeaContext({ fetchImpl: ok.fn });
    expect(ok.counter.calls).toBe(0);
    expect(r.fellBack).toBe(false);
    expect(r.context).toEqual(live.context);
  });

  it('keeps an in-memory backoff when storage throws', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage({ throws: true }));
    await loadNeaContext({ fetchImpl: fakeFetch({ windDirection: { status: 429, body: {} } }) });
    const ok = countingFetch();
    const r = await loadNeaContext({ fetchImpl: ok.fn });
    expect(ok.counter.calls).toBe(0);
    expect(r.fellBack).toBe(true);
    expect(r.error).toContain('rate limited; retrying live after');
  });
});
