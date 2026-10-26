import { afterEach, describe, expect, it } from 'vitest';
import {
  ASH_LEVELS,
  DRIFT_TICK_HOURS,
  ashDriftTracks,
  bearingDeg,
  compass16,
  distanceKm,
  driftStartTime,
  driftTrack,
  loadAshWind,
  loadAshWindSnapshot,
  normaliseAshWind,
  resetAshWindCache,
  windAt,
} from './ashDrift';
import type { AshWindSeries } from './ashDrift';

const HOURS = 30;
const T0 = Date.parse('2026-10-14T00:00:00Z');
const times = Array.from({ length: HOURS }, (_, k) => new Date(T0 + k * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
const constant = (speed: number, dir: number) => ({ speed: times.map(() => speed), dir: times.map(() => dir) });
function series(w700: { speed: number[]; dir: number[] }, w500 = w700, w300 = w700): AshWindSeries {
  return { volcanoId: 'gvp-263250', name: 'Merapi', lat: -7.54, lon: 110.446, times, wind: { '700': w700, '500': w500, '300': w300 } };
}

describe('wind conversion (FROM direction to u/v)', () => {
  it('wind from the east (90°) blows west: u negative, v zero', () => {
    const w = windAt(series(constant(10, 90)), '700', T0);
    expect(w?.u).toBeCloseTo(-10, 9);
    expect(w?.v).toBeCloseTo(0, 9);
  });
  it('wind from the north (0°) blows south, from the south-west (225°) blows north-east', () => {
    expect(windAt(series(constant(5, 0)), '700', T0)).toEqual({ u: 0, v: -5 });
    const sw = windAt(series(constant(10, 225)), '700', T0);
    expect(sw?.u).toBeCloseTo(7.071, 3);
    expect(sw?.v).toBeCloseTo(7.071, 3);
  });
  it('interpolates u and v linearly in time and never extrapolates', () => {
    const s = series({ speed: times.map((_, k) => (k === 0 ? 0 : 10)), dir: times.map(() => 270) });
    expect(windAt(s, '700', T0 + 1800000)?.u).toBeCloseTo(5, 9);
    expect(windAt(s, '700', T0 - 1)).toBeNull();
    expect(windAt(s, '700', T0 + HOURS * 3600000)).toBeNull();
  });
});

describe('driftTrack', () => {
  it('constant 10 m/s from the west drifts 864 km due east in 24 h', () => {
    const t = driftTrack(series(constant(10, 270)), '700', times[0]);
    expect(t.points).toHaveLength(49);
    expect(t.distanceKm).toBeCloseTo(864, -1);
    // Successive steps follow a rhumb line; the great-circle bearing to its end differs by under 1°.
    expect(Math.abs((t.bearingDeg ?? 0) - 90)).toBeLessThan(1);
    expect(t.label).toBe('~3 km');
  });

  it('constant 20 m/s from the north-east drifts south-west, 1728 km', () => {
    const t = driftTrack(series(constant(20, 45)), '700', times[0]);
    expect(t.distanceKm).toBeCloseTo(1728, -1);
    expect(compass16(t.bearingDeg ?? -1)).toBe('SW');
  });

  it('puts hour ticks at 3, 6, 12 and 24 h with their times', () => {
    const t = driftTrack(series(constant(10, 270)), '700', times[0]);
    expect(t.ticks.map((k) => k.hour)).toEqual([...DRIFT_TICK_HOURS]);
    expect(t.ticks.map((k) => k.time)).toEqual(['2026-10-14T03:00:00Z', '2026-10-14T06:00:00Z', '2026-10-14T12:00:00Z', '2026-10-15T00:00:00Z']);
    // 3 h at 10 m/s = 108 km from the summit.
    expect(distanceKm(-7.54, 110.446, t.ticks[0].lat, t.ticks[0].lon)).toBeCloseTo(108, 0);
  });

  it('stops where the forecast ends instead of extrapolating', () => {
    const t = driftTrack(series(constant(10, 270)), '700', times[HOURS - 6]);
    expect(t.points).toHaveLength(11);
    expect(t.ticks.map((k) => k.hour)).toEqual([3]);
  });

  it('stays at the summit in calm air', () => {
    const t = driftTrack(series(constant(0, 0)), '700', times[0]);
    expect(t.distanceKm).toBe(0);
    expect(t.bearingDeg).toBeNull();
  });

  it('gives three distinct heights', () => {
    const r = ashDriftTracks(series(constant(5, 90), constant(10, 0), constant(20, 180)), T0);
    expect(r?.tracks.map((t) => t.label)).toEqual(ASH_LEVELS.map((l) => l.label));
    expect(r?.tracks.map((t) => compass16(t.bearingDeg ?? -1))).toEqual(['W', 'S', 'N']);
  });
});

describe('driftStartTime', () => {
  it('starts at the hour at or before now and keeps 24 h inside the forecast', () => {
    const s = series(constant(10, 270));
    expect(driftStartTime(s, T0 + 2.5 * 3600000)).toBe('2026-10-14T02:00:00Z');
    expect(driftStartTime(s, T0 + 100 * 3600000)).toBe('2026-10-14T05:00:00Z');
    expect(driftStartTime(s, T0 - 3600000)).toBe('2026-10-14T00:00:00Z');
  });
});

describe('geometry helpers', () => {
  it('bearing and distance agree with known values', () => {
    expect(bearingDeg(0, 100, 0, 101)).toBeCloseTo(90, 6);
    expect(distanceKm(0, 100, 0, 101)).toBeCloseTo(111.2, 1);
    expect(compass16(292)).toBe('WNW');
  });
});

describe('loading', () => {
  afterEach(() => resetAshWindCache());

  it('the bundled snapshot has all four watched volcanoes at three levels', () => {
    const snap = loadAshWindSnapshot();
    expect(snap?.dataMode).toBe('historical');
    expect(snap?.volcanoes.map((v) => v.volcanoId).sort()).toEqual(['gvp-261080', 'gvp-262000', 'gvp-263250', 'gvp-263300']);
    for (const v of snap?.volcanoes ?? []) for (const l of ASH_LEVELS) expect(v.wind[l.key].speed.length).toBe(v.times.length);
  });

  it('falls back to the snapshot on HTTP 429 and never throws', async () => {
    const fetchImpl = (async () => new Response('{"error":true}', { status: 429 })) as typeof fetch;
    const r = await loadAshWind({ fetchImpl });
    expect(r.status).toBe('snapshot');
    expect(r.data?.dataMode).toBe('historical');
    expect(r.message).toMatch(/rate limit/);
    const thrown = await loadAshWind({ fetchImpl: (async () => Promise.reject(new Error('offline'))) as typeof fetch });
    expect(['snapshot', 'cached']).toContain(thrown.status);
  });

  it('normalises a live response and labels it live', async () => {
    const points = [{ volcanoId: 'gvp-263250', name: 'Merapi', lat: -7.54, lon: 110.446 }];
    const hourly: Record<string, unknown> = { time: ['2026-10-14T00:00', '2026-10-14T01:00'] };
    const units: Record<string, string> = {};
    for (const l of ['700', '500', '300']) {
      hourly[`wind_speed_${l}hPa`] = [5, 6];
      hourly[`wind_direction_${l}hPa`] = [90, 95];
      units[`wind_speed_${l}hPa`] = 'm/s';
    }
    const body = { hourly, hourly_units: units };
    expect(normaliseAshWind(body, points, '2026-10-14T00:10:00Z')?.volcanoes[0].times).toEqual(['2026-10-14T00:00:00Z', '2026-10-14T01:00:00Z']);
    expect(normaliseAshWind({ ...body, hourly_units: { ...units, wind_speed_700hPa: 'km/h' } }, points, 'x')).toBeNull();
    const asked: string[] = [];
    const relay = (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ feed: 'ash', retrievedAt: '2026-10-14T00:05:00Z', stale: false, raw: body }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await loadAshWind({ points, fetchImpl: relay });
    expect(r.status).toBe('live');
    expect(r.data?.dataMode).toBe('live');
    expect(r.data?.retrievedAt).toBe('2026-10-14T00:05:00Z');
    expect(asked).toEqual(['/api/open-meteo?feed=ash']);
  });
});
