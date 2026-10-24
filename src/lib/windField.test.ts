import { afterEach, describe, expect, it } from 'vitest';
import {
  buildWindUrl,
  gridAxes,
  loadWindField,
  loadWindSnapshot,
  normaliseOpenMeteoWind,
  PARTICLE_WIND_LEVEL,
  resetWindCache,
  sampleSlice,
  timeWeights,
  windFromToUV,
  windSlice,
} from './windField';
import { sampleWind } from './transport';

// The bundled snapshots are lazy chunks (loaded with await).
const WIND925 = await loadWindSnapshot('925hPa');
const WIND10 = await loadWindSnapshot('10m');

describe('windFromToUV (meteorological FROM convention)', () => {
  it('converts the cardinal directions', () => {
    expect(windFromToUV(0, 10)).toEqual({ u: 0, v: -10 }); // from N blows south
    expect(windFromToUV(90, 10)).toEqual({ u: -10, v: 0 }); // from E blows west
    expect(windFromToUV(180, 10)).toEqual({ u: 0, v: 10 }); // from S blows north
    expect(windFromToUV(270, 10)).toEqual({ u: 10, v: 0 }); // from W blows east
    const se = windFromToUV(140, 1.8); // NEA Singapore 2026-10-13: from SE, blows NW
    expect(se.u).toBeLessThan(0);
    expect(se.v).toBeGreaterThan(0);
  });
});

describe('normaliseOpenMeteoWind', () => {
  // Trimmed real Open-Meteo multi-location shape (2 x 2 points, 2 hours), values from the 2026-10-13 capture style.
  const loc = (lat: number, lon: number, sp: number[], dir: number[]) => ({
    latitude: lat,
    longitude: lon,
    timezone: 'GMT',
    hourly_units: { time: 'iso8601', wind_speed_10m: 'm/s', wind_direction_10m: '°' },
    hourly: { time: ['2026-10-13T00:00', '2026-10-13T01:00'], wind_speed_10m: sp, wind_direction_10m: dir },
  });
  const axes = { lats: [0, 1], lons: [103, 104] };
  const sample = [loc(0, 103, [2, 3], [180, 180]), loc(0, 104, [2, 3], [90, 90]), loc(1, 103, [1, 1], [270, 270]), loc(1, 104, [0, 0], [0, 0])];

  it('maps request order (lat outer, lon inner) to [t][j][i] u/v and appends Z', () => {
    const g = normaliseOpenMeteoWind(sample, axes, '2026-10-13T08:00:00Z');
    expect(g).not.toBeNull();
    expect(g!.times).toEqual(['2026-10-13T00:00:00Z', '2026-10-13T01:00:00Z']);
    expect(g!.v[0][0][0]).toBeCloseTo(2); // (lat0, lon103) from S
    expect(g!.u[1][0][1]).toBeCloseTo(-3); // (lat0, lon104) from E
    expect(g!.u[0][1][0]).toBeCloseTo(1); // (lat1, lon103) from W
    expect(g!.dataMode).toBe('live');
  });

  it('rejects a partial or malformed response instead of returning a partial grid', () => {
    expect(normaliseOpenMeteoWind(sample.slice(0, 3), axes, 'x')).toBeNull();
    const bad = structuredClone(sample);
    (bad[2].hourly.wind_speed_10m as unknown[])[1] = null;
    expect(normaliseOpenMeteoWind(bad, axes, '2026-10-13T08:00:00Z')).toBeNull();
  });
});

/** The relay's answer around an Open-Meteo multi-location body. */
const relay = (raw: unknown) => ({ feed: 'wind', retrievedAt: '2026-10-13T00:05:00Z', stale: false, raw });

/** The grid with both levels in each location, as the relay's batched request returns it. */
function bothLevels() {
  const axes = gridAxes();
  return axes.lats.flatMap((lat) =>
    axes.lons.map((lon) => ({
      latitude: lat,
      longitude: lon,
      hourly_units: { wind_speed_10m: 'm/s', wind_speed_925hPa: 'm/s' },
      hourly: {
        time: ['2026-10-13T00:00', '2026-10-13T01:00'],
        wind_speed_10m: [5, 5],
        wind_direction_10m: [140, 140],
        wind_speed_925hPa: [8, 8],
        wind_direction_925hPa: [270, 270],
      },
    })),
  );
}

describe('loadWindField', () => {
  afterEach(() => resetWindCache());

  it('the bundled snapshot is a valid historical grid over the spec', () => {
    const g = WIND10;
    expect(g).not.toBeNull();
    expect(g!.dataMode).toBe('historical');
    expect(g!.lats).toEqual(gridAxes().lats);
    expect(g!.lons).toEqual(gridAxes().lons);
  });

  it('falls back to the snapshot when the live request fails, and never throws', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const r = await loadWindField({ fetchImpl: failing });
    expect(r.status).toBe('snapshot');
    expect(r.grid?.dataMode).toBe('historical');
    expect(r.message).toMatch(/offline/);
  });

  it('dedupes concurrent live requests and serves the cache afterwards', async () => {
    const axes = gridAxes();
    const body = axes.lats.flatMap((lat) =>
      axes.lons.map((lon) => ({
        latitude: lat,
        longitude: lon,
        hourly_units: { wind_speed_10m: 'm/s' },
        hourly: { time: ['2026-10-13T00:00', '2026-10-13T01:00'], wind_speed_10m: [5, 5], wind_direction_10m: [140, 140] },
      })),
    );
    let calls = 0;
    const ok = (async () => {
      calls += 1;
      return new Response(JSON.stringify(relay(body)), { status: 200 });
    }) as unknown as typeof fetch;
    const [a, b] = await Promise.all([loadWindField({ fetchImpl: ok }), loadWindField({ fetchImpl: ok })]);
    expect(calls).toBe(1);
    expect(a.status).toBe('live');
    expect(b.grid).toBe(a.grid);
    expect((await loadWindField({ fetchImpl: ok })).status).toBe('cached');
  });

  it('loads both levels with ONE relay request, stamped with the relay fetch time', async () => {
    const asked: string[] = [];
    const ok = (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify(relay(bothLevels())), { status: 200 });
    }) as unknown as typeof fetch;
    const [ten, p925] = await Promise.all([loadWindField({ fetchImpl: ok }), loadWindField({ fetchImpl: ok, level: '925hPa' })]);
    expect(asked).toEqual(['/api/open-meteo?feed=wind']);
    expect(ten.status).toBe('live');
    expect(p925.status).toBe('live');
    expect(ten.grid!.level).toBe('10 m');
    expect(p925.grid!.level).toBe('925 hPa');
    expect(ten.grid!.retrievedAt).toBe('2026-10-13T00:05:00Z');
    // 10 m from 140°, 925 hPa from 270°: each level reads its own variables.
    expect(ten.grid!.u[0][0][0]).toBeCloseTo(-5 * Math.sin((140 * Math.PI) / 180));
    expect(p925.grid!.u[0][0][0]).toBeCloseTo(8);
  });

  it('shows a stale relay copy as cached, and backs off (snapshot) while the relay is busy', async () => {
    const stale = (async () => new Response(JSON.stringify({ ...relay(bothLevels()), stale: true }), { status: 200 })) as unknown as typeof fetch;
    const r = await loadWindField({ fetchImpl: stale });
    expect(r.status).toBe('cached');
    expect(r.message).toBe('Open-Meteo is not answering; showing the model run retrieved 2026-10-13T00:05:00Z.');
    resetWindCache();
    let calls = 0;
    const busy = (async () => {
      calls += 1;
      return new Response('{"error":"upstream_unavailable"}', { status: 503, headers: { 'retry-after': '60' } });
    }) as unknown as typeof fetch;
    const t0 = Date.parse('2026-10-13T01:00:00Z');
    const b = await loadWindField({ fetchImpl: busy, now: () => t0 });
    expect(b.status).toBe('snapshot');
    expect(b.grid!.dataMode).toBe('historical');
    expect(b.message).toBe('Open-Meteo is busy (HTTP 503); showing the bundled wind snapshot.');
    const again = await loadWindField({ fetchImpl: busy, now: () => t0 + 30_000, level: '925hPa' });
    expect(again.message).toMatch(/backoff in effect/);
    expect(calls).toBe(1);
  });
});

describe('925 hPa level (particle wind)', () => {
  afterEach(() => resetWindCache());

  it('requests the 925 hPa variables and normalises them with the 925 hPa label', () => {
    expect(buildWindUrl([0], [103], 3, '925hPa')).toContain('&hourly=wind_speed_925hPa,wind_direction_925hPa&');
    expect(buildWindUrl([0], [103])).toContain('&hourly=wind_speed_10m,wind_direction_10m&');
    expect(buildWindUrl([0], [103], 3, ['10m', '925hPa'])).toContain('&hourly=wind_speed_10m,wind_direction_10m,wind_speed_925hPa,wind_direction_925hPa&');
    expect(PARTICLE_WIND_LEVEL).toBe('925hPa');
    // Trimmed real 925 hPa shape (2026-10-14 probe: 6.25 m/s).
    const loc = (lat: number, lon: number) => ({
      latitude: lat,
      longitude: lon,
      hourly_units: { time: 'iso8601', wind_speed_925hPa: 'm/s', wind_direction_925hPa: '°' },
      hourly: { time: ['2026-10-14T06:00'], wind_speed_925hPa: [6.25], wind_direction_925hPa: [270] },
    });
    const g = normaliseOpenMeteoWind([loc(0, 103), loc(0, 104), loc(1, 103), loc(1, 104)], { lats: [0, 1], lons: [103, 104] }, '2026-10-14T07:00:00Z', 'live', '925hPa');
    expect(g!.level).toBe('925 hPa');
    expect(g!.u[0][1][1]).toBeCloseTo(6.25);
    // A 10 m parse of a 925 hPa response finds no 10 m variables.
    expect(normaliseOpenMeteoWind([loc(0, 103), loc(0, 104), loc(1, 103), loc(1, 104)], { lats: [0, 1], lons: [103, 104] }, 'x')).toBeNull();
  });

  it('has its own bundled snapshot and per-level live cache', async () => {
    const g = WIND925;
    expect(g).not.toBeNull();
    expect(g!.level).toBe('925 hPa');
    expect(WIND10!.level).toBe('10 m');
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const r = await loadWindField({ fetchImpl: failing, level: '925hPa' });
    expect(r.status).toBe('snapshot');
    expect(r.grid!.level).toBe('925 hPa');
  });
});

describe('windSlice / sampleSlice', () => {
  it('agrees with transport sampleWind inside the grid and returns null outside', () => {
    const g = WIND925!;
    const t = new Date((Date.parse(g.times[3]) + Date.parse(g.times[4])) / 2).toISOString();
    const slice = windSlice(g, t);
    for (const [lat, lon] of [
      [1.35, 103.82],
      [-2.5, 110.7],
      [7.9, 119.1],
      [-6, 95],
    ]) {
      const a = sampleSlice(slice, lat, lon)!;
      const b = sampleWind(g, lat, lon, t)!;
      expect(a.u).toBeCloseTo(b.u, 4);
      expect(a.v).toBeCloseTo(b.v, 4);
    }
    expect(sampleSlice(slice, 9, 103)).toBeNull();
    expect(sampleSlice(slice, 1, 121)).toBeNull();
  });

  it('clamps times outside the grid to its ends', () => {
    expect(timeWeights([0, 10, 20], -5)).toEqual({ a: 0, b: 0, f: 0 });
    expect(timeWeights([0, 10, 20], 25)).toEqual({ a: 2, b: 2, f: 0 });
    expect(timeWeights([0, 10, 20], 15)).toEqual({ a: 1, b: 2, f: 0.5 });
  });
});
