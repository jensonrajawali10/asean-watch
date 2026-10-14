import { describe, expect, it } from 'vitest';
import {
  AdaptiveBudget,
  FrameLimiter,
  intersectBox,
  ParticleSystem,
  rasterisePm25,
  scrubLabels,
  smokeRgba,
  streakArrows,
  trailForZoom,
} from './hazeRender';
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

  it('uses a tan smoke capped at 0.55 opacity on the dark map', () => {
    const top = smokeRgba(5000, true);
    expect(top[3]).toBeLessThanOrEqual(Math.round(0.55 * 255));
    expect(top[0]).toBeGreaterThan(top[2]); // warm (red > blue)
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

describe('FrameLimiter', () => {
  const run = (hz: number, fps: number, seconds = 2) => {
    const lim = new FrameLimiter(fps);
    let n = 0;
    for (let t = 0; t < seconds * 1000; t += 1000 / hz) if (lim.shouldRender(t)) n += 1;
    return n / seconds;
  };

  it('caps 60, 120 and 144 Hz displays at about 30 fps with a steady cadence', () => {
    expect(Math.abs(run(60, 30) - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(run(120, 30) - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(run(144, 30) - 30)).toBeLessThanOrEqual(1);
    const lim = new FrameLimiter(30);
    const pattern = [0, 16.7, 33.3, 50, 66.7, 83.3].map((t) => lim.shouldRender(t));
    expect(pattern).toEqual([true, false, true, false, true, false]);
  });

  it('never exceeds the display rate and resyncs after a long gap', () => {
    expect(Math.abs(run(24, 30) - 24)).toBeLessThanOrEqual(1);
    const lim = new FrameLimiter(30);
    expect(lim.shouldRender(0)).toBe(true);
    expect(lim.shouldRender(5000)).toBe(true);
    expect(lim.shouldRender(5016)).toBe(false);
    expect(lim.shouldRender(5034)).toBe(true);
  });
});

describe('AdaptiveBudget', () => {
  const feed = (b: AdaptiveBudget, ms: number, frames: number) => {
    for (let k = 0; k < frames; k += 1) b.record(ms);
    return b.value;
  };

  it('steps down while mean frame time is above ~33 ms, not below the floor', () => {
    const b = new AdaptiveBudget(3500, { min: 600, window: 30 });
    expect(feed(b, 16.7, 30)).toBe(3500);
    expect(feed(b, 45, 30)).toBe(2625);
    expect(feed(b, 45, 30)).toBe(1968);
    expect(feed(b, 45, 600)).toBe(600);
  });

  it('restores slowly after several calm windows, up to the max, and ignores stalls', () => {
    const b = new AdaptiveBudget(3500, { min: 600, window: 30, calmWindows: 4 });
    feed(b, 45, 60);
    const low = b.value;
    expect(feed(b, 16.7, 90)).toBe(low); // 3 calm windows: no change yet
    expect(feed(b, 16.7, 30)).toBe(Math.ceil(low * 1.15));
    feed(b, 16.7, 30 * 4 * 20);
    expect(b.value).toBe(3500);
    expect(feed(b, 5000, 60)).toBe(3500); // tab-switch gaps are ignored
    expect(feed(b, 30, 300)).toBe(3500); // a steady 30 fps display is not "slow"
  });
});

describe('trail length and active particles', () => {
  it('draws fewer trail segments at low zoom', () => {
    expect(trailForZoom(3, 6)).toBe(3);
    expect(trailForZoom(5.5, 6)).toBe(4);
    expect(trailForZoom(9, 6)).toBe(6);
    expect(trailForZoom(9, 2)).toBe(2);
  });

  it('setActive shrinks and regrows within capacity; segments pack by the drawn trail', () => {
    const box = { west: 100, south: 0, east: 102, north: 2 };
    const ps = new ParticleSystem(6, () => 0.5);
    ps.reset(100, box);
    ps.setActive(40, box);
    expect([ps.count, ps.capacity]).toEqual([40, 100]);
    ps.setActive(500, box);
    expect(ps.count).toBe(100);
    ps.setActive(10, null);
    expect(ps.count).toBe(0);
    ps.setActive(10, box);
    ps.age.fill(20);
    ps.maxAge.fill(200);
    const slice = { lats: [0, 1, 2], lons: [100, 101, 102], time: 't', u: new Float32Array(9).fill(5), v: new Float32Array(9) };
    for (let k = 0; k < 6; k += 1) ps.step(slice, box, 0.001, 1);
    const out = { from: new Float32Array(10 * 3 * 2), to: new Float32Array(10 * 3 * 2), color: new Uint8Array(10 * 3 * 4) };
    expect(ps.segments(out, [1, 2, 3], 1, [101, 1], 3)).toBe(30);
    expect(out.from[0]).toBeCloseTo(out.to[0] - 0.005, 4); // offsets from the origin, one step apart
  });
});

describe('scrubLabels', () => {
  it('labels a live run relative to now', () => {
    const l = scrubLabels({ dataMode: 'live', retrievedAt: '2026-10-14T07:19:26Z' }, 0);
    expect(l.offset).toBe('now');
    expect(l.title).toBe('Haze & wind model: now −24 h … +48 h');
    expect([l.jump, l.tick, l.mode, l.run]).toEqual(['Now', 'now', 'LIVE', '14 Oct 07:19 UTC']);
    expect(scrubLabels({ dataMode: 'live', retrievedAt: '2026-10-14T07:19:26Z' }, -3).offset).toBe('now −3 h');
  });

  it('never calls a snapshot "now": the anchor is the snapshot run time', () => {
    const l = scrubLabels({ dataMode: 'historical', retrievedAt: '2026-10-14T07:19:26Z' }, 0);
    expect(l.offset).toBe('snapshot run 14 Oct 07:19 UTC');
    expect(l.title).toBe('Haze & wind model: snapshot run −24 h … +48 h');
    expect([l.jump, l.tick, l.mode]).toEqual(['Snapshot run', 'run', 'SNAPSHOT']);
    expect(scrubLabels({ dataMode: 'historical', retrievedAt: '2026-10-14T07:19:26Z' }, 6).offset).toBe('snapshot run +6 h');
    for (const h of [-24, 0, 48]) expect(JSON.stringify(scrubLabels({ dataMode: 'historical', retrievedAt: '2026-10-14T07:19:26Z' }, h))).not.toMatch(/\bnow\b/i);
  });

  it('has no mode badge before data arrives', () => {
    expect(scrubLabels(null, 0)).toMatchObject({ offset: 'now', mode: null, run: null });
  });
});
