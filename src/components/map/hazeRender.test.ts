import { describe, expect, it } from 'vitest';
import { intersectBox, ParticleSystem, rasterisePm25, smokeRgba, streakArrows } from './hazeRender';
import type { WindSlice } from '../../lib/windField';

describe('smokeRgba', () => {
  it('is transparent for clean air and grows more opaque with PM2.5, in both themes', () => {
    for (const dark of [false, true]) {
      expect(smokeRgba(5, dark)[3]).toBe(0);
      expect(smokeRgba(Number.NaN, dark)[3]).toBe(0);
      const alphas = [20, 40, 80, 160, 300, 3000].map((v) => smokeRgba(v, dark)[3]);
      for (let k = 1; k < alphas.length; k += 1) expect(alphas[k]).toBeGreaterThanOrEqual(alphas[k - 1]);
      expect(alphas[0]).toBeGreaterThan(0);
      expect(alphas[alphas.length - 1]).toBeLessThan(255 * 0.7);
    }
  });

  it('darkens to brown on the light map', () => {
    const lo = smokeRgba(30, false);
    const hi = smokeRgba(400, false);
    expect(hi[0] + hi[1] + hi[2]).toBeLessThan(lo[0] + lo[1] + lo[2]);
  });
});

describe('rasterisePm25', () => {
  const lats = [0, 1, 2];
  const lons = [100, 101, 102];
  const slice = new Float32Array([200, 200, 200, 200, 200, 200, 200, 200, 200]);

  it('covers the grid bounds and feathers the outer edge to transparent', () => {
    const r = rasterisePm25(slice, lats, lons, false, { pxPerDeg: 10, featherDeg: 0.5 });
    expect(r.bounds).toEqual([100, 0, 102, 2]);
    expect([r.width, r.height]).toEqual([20, 20]);
    const alphaAt = (row: number, col: number) => r.data[(row * r.width + col) * 4 + 3];
    expect(alphaAt(10, 10)).toBe(smokeRgba(200, false)[3]);
    expect(alphaAt(0, 10)).toBeLessThan(alphaAt(10, 10) / 4);
    expect(alphaAt(10, 0)).toBeLessThan(alphaAt(10, 10) / 4);
  });
});

describe('ParticleSystem', () => {
  // Uniform westerly 10 m/s over a 3×3 grid.
  const slice: WindSlice = {
    lats: [0, 1, 2],
    lons: [100, 101, 102],
    time: '2026-10-14T06:00:00Z',
    u: new Float32Array(9).fill(10),
    v: new Float32Array(9).fill(0),
  };
  const box = { west: 100, south: 0, east: 102, north: 2 };

  it('moves particles downwind and emits fading trail segments', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ps = new ParticleSystem(4, rand);
    ps.reset(50, { west: 100, south: 0.5, east: 100.5, north: 1.5 });
    ps.age.fill(10);
    ps.maxAge.fill(200);
    const lonAt = (p: number) => ps.hist[(p * 5 + ps.head) * 2];
    const before = lonAt(7);
    for (let k = 0; k < 4; k += 1) ps.step(slice, box, 0.001, 1);
    expect(lonAt(7)).toBeCloseTo(before + 4 * 10 * 0.001, 5);
    const out = { from: new Float64Array(50 * 4 * 2), to: new Float64Array(50 * 4 * 2), color: new Uint8Array(50 * 4 * 4) };
    const n = ps.segments(out, [10, 20, 30], 0.8);
    expect(n).toBe(200);
    expect(out.to[0]).toBeGreaterThan(out.from[0]); // eastward
    expect(out.color[3]).toBeGreaterThan(out.color[3 * 4 + 3]); // newest segment is the most opaque
  });

  it('respawns particles that leave the box', () => {
    const ps = new ParticleSystem(2, () => 0.5);
    ps.reset(1, box);
    ps.age.fill(10);
    ps.maxAge.fill(200);
    for (let k = 0; k < 400; k += 1) ps.step(slice, box, 0.01, 1);
    const lon = ps.hist[ps.head * 2];
    expect(lon).toBeGreaterThanOrEqual(100);
    expect(lon).toBeLessThanOrEqual(102);
  });

  it('streak arrows trace downwind and intersectBox clips', () => {
    const paths = streakArrows(slice, box, 1, 0.05, 5);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0][paths[0].length - 1][0]).toBeGreaterThan(paths[0][0][0]);
    expect(intersectBox(box, { west: 101, south: 1, east: 105, north: 5 })).toEqual({ west: 101, south: 1, east: 102, north: 2 });
    expect(intersectBox(box, { west: 110, south: 1, east: 115, north: 5 })).toBeNull();
  });
});
