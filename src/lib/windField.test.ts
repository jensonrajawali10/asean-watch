import { afterEach, describe, expect, it } from 'vitest';
import { gridAxes, loadWindField, loadWindSnapshot, normaliseOpenMeteoWind, resetWindCache, windFromToUV } from './windField';

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

describe('loadWindField', () => {
  afterEach(() => resetWindCache());

  it('the bundled snapshot is a valid historical grid over the spec', () => {
    const g = loadWindSnapshot();
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
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const [a, b] = await Promise.all([loadWindField({ fetchImpl: ok }), loadWindField({ fetchImpl: ok })]);
    expect(calls).toBe(1);
    expect(a.status).toBe('live');
    expect(b.grid).toBe(a.grid);
    expect((await loadWindField({ fetchImpl: ok })).status).toBe('cached');
  });
});
