import { afterEach, describe, expect, it } from 'vitest';
import {
  AQ_PLACES,
  aqRange,
  buildAqUrl,
  describePm25,
  forecastAnchorMs,
  forecastSteps,
  loadAirQuality,
  loadAqSnapshot,
  normaliseOpenMeteoAq,
  placePm25At,
  pm25At,
  pm25Band,
  pm25Label,
  PM25_BANDS,
  PM25_BANDS_NOTE,
  resetAqCache,
  worstPlaceByStep,
  WHO_PM25_24H_UGM3,
} from './airQuality';
import type { AqPlace } from './airQuality';
import { gridAxes } from './windField';

// Trimmed real Open-Meteo Air Quality response (2026-10-14 07:10 UTC capture, first 3 hours): grid points
// (0,103) (0,104) (1,103) (1,104), then Singapore. Note the Greek-mu unit string Open-Meteo returns.
const TIMES = ['2026-10-13T00:00', '2026-10-13T01:00', '2026-10-13T02:00'];
const loc = (lat: number, lon: number, pm: (number | null)[]) => ({
  latitude: lat,
  longitude: lon,
  timezone: 'GMT',
  hourly_units: { time: 'iso8601', pm2_5: 'μg/m³' },
  hourly: { time: [...TIMES], pm2_5: pm },
});
const axes = { lats: [0, 1], lons: [103, 104] };
const sg: AqPlace = { id: 'singapore', name: 'Singapore', country: 'SG', lat: 1.3521, lon: 103.8198, kind: 'city' };
const sample = () => [
  loc(0, 103, [44.8, 45.3, 45.1]),
  loc(0, 104, [58.8, 55.6, 53.6]),
  loc(1, 103, [85.2, 80.3, 76.8]),
  loc(1, 104, [67.8, 64.7, 63.1]),
  loc(1.4, 103.8, [67.8, 64.7, 63.1]),
];

describe('normaliseOpenMeteoAq', () => {
  it('maps request order (grid lat outer, lon inner, then places) and appends Z', () => {
    const d = normaliseOpenMeteoAq(sample(), axes, [sg], '2026-10-14T07:10:00Z');
    expect(d).not.toBeNull();
    expect(d!.times).toEqual(['2026-10-13T00:00:00Z', '2026-10-13T01:00:00Z', '2026-10-13T02:00:00Z']);
    expect(d!.pm25[0][0][1]).toBe(58.8); // (lat 0, lon 104)
    expect(d!.pm25[2][1][0]).toBe(76.8); // (lat 1, lon 103)
    expect(d!.places[0].pm25).toEqual([67.8, 64.7, 63.1]);
    expect(d!.places[0].name).toBe('Singapore');
    expect(d!.dataMode).toBe('live');
    expect(d!.unit).toBe('µg/m³');
  });

  it('drops hours where any location lacks a value, and rejects bad shapes or units', () => {
    const tail = sample();
    tail[3].hourly.pm2_5[2] = null;
    const d = normaliseOpenMeteoAq(tail, axes, [sg], '2026-10-14T07:10:00Z');
    expect(d!.times).toHaveLength(2);
    expect(normaliseOpenMeteoAq(sample().slice(0, 4), axes, [sg], 'x')).toBeNull();
    const unit = sample();
    unit[1].hourly_units.pm2_5 = 'ppb';
    expect(normaliseOpenMeteoAq(unit, axes, [sg], 'x')).toBeNull();
    expect(normaliseOpenMeteoAq({ error: true, reason: 'x' }, axes, [sg], 'x')).toBeNull();
  });

  it('samples the grid bilinearly in space and linearly in time', () => {
    const d = normaliseOpenMeteoAq(sample(), axes, [sg], '2026-10-14T07:10:00Z')!;
    expect(pm25At(d, 0, 103, '2026-10-13T00:00:00Z')).toBeCloseTo(44.8, 5);
    expect(pm25At(d, 0.5, 103.5, '2026-10-13T00:00:00Z')).toBeCloseTo((44.8 + 58.8 + 85.2 + 67.8) / 4, 4);
    expect(pm25At(d, 0, 103, '2026-10-13T00:30:00Z')).toBeCloseTo((44.8 + 45.3) / 2, 4);
    expect(Number.isNaN(pm25At(d, 5, 103, '2026-10-13T00:00:00Z'))).toBe(true);
    expect(placePm25At(d, d.places[0], '2026-10-13T01:30:00Z')).toBeCloseTo((64.7 + 63.1) / 2, 4);
    expect(placePm25At(d, d.places[0], '2030-01-01T00:00:00Z')).toBe(63.1); // clamped
  });
});

describe('PM2.5 bands', () => {
  it('uses the stated plain bands with exclusive upper bounds', () => {
    expect(pm25Band(0)!.label).toBe('Good');
    expect(pm25Band(14.9)!.label).toBe('Good');
    expect(pm25Band(15)!.label).toBe('Moderate');
    expect(pm25Band(35)!.label).toBe('Unhealthy for sensitive groups');
    expect(pm25Band(55)!.label).toBe('Unhealthy');
    expect(pm25Band(150)!.label).toBe('Very unhealthy');
    expect(pm25Band(250)!.label).toBe('Hazardous');
    expect(pm25Band(3241)!.label).toBe('Hazardous');
    expect(pm25Band(-1)).toBeNull();
    expect(pm25Band(Number.NaN)).toBeNull();
    expect(PM25_BANDS).toHaveLength(6);
  });

  it('labels values as modelled and the bands as EPA-style, never as NEA PSI', () => {
    expect(pm25Label(23.4)).toBe('PM2.5 23 µg/m³ (modelled)');
    expect(PM25_BANDS_NOTE).toMatch(/US EPA-style/);
    expect(PM25_BANDS_NOTE).toMatch(/MODELLED/);
    expect(PM25_BANDS_NOTE).toMatch(/Not NEA PSI/);
  });
});

describe('forecastSteps', () => {
  it('runs 3-hourly from now −24 h to +48 h around the floored anchor', () => {
    const s = forecastSteps(Date.parse('2026-10-14T07:19:00Z'));
    expect(s.times[0]).toBe('2026-10-13T06:00:00Z');
    expect(s.times[s.nowIndex]).toBe('2026-10-14T06:00:00Z');
    expect(s.times[s.times.length - 1]).toBe('2026-10-16T06:00:00Z');
    expect(s.times).toHaveLength(25);
    expect(s.offsetsH[0]).toBe(-24);
    expect(s.offsetsH[s.offsetsH.length - 1]).toBe(48);
  });

  it('clips to the data range but always keeps the anchor step', () => {
    const s = forecastSteps(Date.parse('2026-10-14T07:19:00Z'), {
      startMs: Date.parse('2026-10-14T00:00:00Z'),
      endMs: Date.parse('2026-10-14T12:00:00Z'),
    });
    expect(s.times).toEqual(['2026-10-14T00:00:00Z', '2026-10-14T03:00:00Z', '2026-10-14T06:00:00Z', '2026-10-14T09:00:00Z', '2026-10-14T12:00:00Z']);
    expect(s.nowIndex).toBe(2);
  });

  it('anchors a snapshot at its capture time, live data at the clock', () => {
    expect(forecastAnchorMs({ dataMode: 'historical', retrievedAt: '2026-10-14T07:19:26Z' }, 0)).toBe(Date.parse('2026-10-14T07:19:26Z'));
    expect(forecastAnchorMs({ dataMode: 'live', retrievedAt: '2026-10-14T07:19:26Z' }, 42)).toBe(42);
  });
});

describe('loadAirQuality', () => {
  afterEach(() => resetAqCache());

  it('the bundled snapshot is valid, historical, on the wind grid, with every place and the full scrubber window', () => {
    const d = loadAqSnapshot();
    expect(d).not.toBeNull();
    expect(d!.dataMode).toBe('historical');
    expect(d!.lats).toEqual(gridAxes().lats);
    expect(d!.lons).toEqual(gridAxes().lons);
    expect(d!.places.map((p) => [p.id, p.lat, p.lon, p.kind])).toEqual(AQ_PLACES.map((p) => [p.id, p.lat, p.lon, p.kind]));
    const steps = forecastSteps(forecastAnchorMs(d, 0), aqRange(d));
    expect(steps.offsetsH[0]).toBe(-24);
    expect(steps.offsetsH[steps.offsetsH.length - 1]).toBe(48);
  });

  it('builds one multi-location request for the grid plus the places', () => {
    const url = buildAqUrl();
    expect(url).toContain('air-quality-api.open-meteo.com/v1/air-quality?');
    expect(url).toContain('&hourly=pm2_5&past_days=1&forecast_days=3&timezone=GMT');
    const n = new URL(url).searchParams.get('latitude')!.split(',').length;
    expect(n).toBe(gridAxes().lats.length * gridAxes().lons.length + AQ_PLACES.length);
  });

  it('falls back to the snapshot when the live request fails, is refused or malformed, and never throws', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const r1 = await loadAirQuality({ fetchImpl: failing });
    expect(r1.status).toBe('snapshot');
    expect(r1.data!.dataMode).toBe('historical');
    expect(r1.message).toMatch(/offline/);
    resetAqCache();
    const http500 = (() => Promise.resolve(new Response('nope', { status: 500 }))) as unknown as typeof fetch;
    expect((await loadAirQuality({ fetchImpl: http500 })).status).toBe('snapshot');
    resetAqCache();
    const junk = (() => Promise.resolve(new Response(JSON.stringify({ error: true }), { status: 200 }))) as unknown as typeof fetch;
    const r3 = await loadAirQuality({ fetchImpl: junk });
    expect(r3.status).toBe('snapshot');
    expect(r3.message).toMatch(/expected shape/);
    resetAqCache();
    const throwing = (() => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    expect((await loadAirQuality({ fetchImpl: throwing })).status).toBe('snapshot');
  });

  it('serves a live response from the memory cache afterwards', async () => {
    const d = loadAqSnapshot()!;
    // Re-serialise the snapshot as an Open-Meteo multi-location response (grid then places).
    const times = d.times.map((t) => t.slice(0, 16));
    const body = [
      ...d.lats.flatMap((lat, j) => d.lons.map((lon, i) => loc(lat, lon, d.pm25.map((s) => s[j][i])))),
      ...d.places.map((p) => loc(p.lat, p.lon, p.pm25)),
    ].map((e) => ({ ...e, hourly: { time: times, pm2_5: e.hourly.pm2_5 } }));
    let calls = 0;
    const ok = (() => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as unknown as typeof fetch;
    const r1 = await loadAirQuality({ fetchImpl: ok });
    expect(r1.status).toBe('live');
    expect(r1.data!.places).toHaveLength(AQ_PLACES.length);
    const r2 = await loadAirQuality({ fetchImpl: ok });
    expect(r2.status).toBe('cached');
    expect(calls).toBe(1);
  });
});

describe('worstPlaceByStep', () => {
  it('picks the place with the highest modelled PM2.5 at each step', () => {
    const d = normaliseOpenMeteoAq(sample(), axes, [sg, { ...sg, id: 'b', name: 'B' }], '2026-10-14T07:10:00Z');
    expect(d).toBeNull(); // the sample has one place entry; two places need two series
    const two = normaliseOpenMeteoAq([...sample(), loc(0, 104, [10, 99, 1])], axes, [sg, { ...sg, id: 'b', name: 'B' }], '2026-10-14T07:10:00Z')!;
    const w = worstPlaceByStep(two, ['2026-10-13T00:00:00Z', '2026-10-13T01:00:00Z', '2026-10-13T02:00:00Z']);
    expect(w.map((s) => [s.place.id, s.pm25])).toEqual([
      ['singapore', 67.8],
      ['b', 99],
      ['singapore', 63.1],
    ]);
    expect(worstPlaceByStep(null, ['2026-10-13T00:00:00Z'])).toEqual([]);
  });
});

describe('describePm25', () => {
  it('reads a hazardous modelled value against the WHO 24-hour guideline (15 µg/m³)', () => {
    expect(WHO_PM25_24H_UGM3).toBe(15);
    const d = describePm25(2116);
    expect(d.band?.label).toBe('Hazardous');
    expect(d.timesWho).toBe(141);
    expect(d.valueText).toBe('2,116');
    expect(d.scale).toBe('About 141× the WHO 24-hour guideline (15 µg/m³).');
    expect(d.sentence).toBe('Fine smoke and dust, small enough to reach deep into the lungs. About 141× the WHO 24-hour guideline (15 µg/m³).');
  });

  it('uses one decimal under 10×, and plain words near and under the guideline', () => {
    expect(describePm25(37).timesWho).toBe(2.5);
    expect(describePm25(37).scale).toBe('About 2.5× the WHO 24-hour guideline (15 µg/m³).');
    expect(describePm25(15.4).scale).toBe('About the same as the WHO 24-hour guideline (15 µg/m³).');
    expect(describePm25(6).scale).toBe('Under the WHO 24-hour guideline (15 µg/m³).');
    expect(describePm25(6).band?.label).toBe('Good');
    expect(describePm25(4000).scale).toBe('About 267× the WHO 24-hour guideline (15 µg/m³).');
  });

  it('gives no band or ratio for a missing value and never offers advice', () => {
    const d = describePm25(Number.NaN);
    expect(d.band).toBeNull();
    expect(d.timesWho).toBeNull();
    for (const v of [3, 20, 60, 200, 900]) expect(describePm25(v).sentence).not.toMatch(/safe|stay indoors|mask|all clear|avoid/i);
  });
});
