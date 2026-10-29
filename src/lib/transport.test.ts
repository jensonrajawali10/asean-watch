import { describe, expect, it } from 'vitest';
import { clusterHotspots, computeTrajectories, haversineKm, hazeSourcesFromFixtures, receptorAnalysis, sampleWind, SINGAPORE } from './transport';
import type { HotspotSource } from './transport';
import type { HotspotMember } from './watchRules';
import type { Observation } from '../types';
import type { WindGrid } from './windField';

function uniformGrid(u: number, v: number): WindGrid {
  const lats = Array.from({ length: 15 }, (_, k) => -6 + k);
  const lons = Array.from({ length: 26 }, (_, k) => 95 + k);
  const times = ['2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z', '2026-10-16T00:00:00Z'];
  const f = (x: number) => times.map(() => lats.map(() => lons.map(() => x)));
  return {
    lats,
    lons,
    times,
    u: f(u),
    v: f(v),
    source: 'test',
    sourceUrl: 'https://example.org',
    model: 'test',
    level: '10 m',
    retrievedAt: '2026-10-13T00:00:00Z',
    dataMode: 'historical',
    attribution: 'test',
  };
}

const src = (lat: number, lon: number): HotspotSource => ({
  id: `t:${lat}:${lon}`,
  watchId: 'watch-test',
  label: 'Test hotspots',
  lat,
  lon,
  count: 3,
  frpSum: 30,
});

describe('sampleWind', () => {
  it('is bilinear in space, linear in time, and null outside the grid', () => {
    const g = uniformGrid(0, 0);
    g.u[0][0][0] = 0;
    g.u[0][0][1] = 4;
    g.u[0][1][0] = 8;
    g.u[0][1][1] = 12;
    g.u[1][0][0] = 10;
    expect(sampleWind(g, -5.5, 95.5, '2026-10-13T00:00:00Z')!.u).toBeCloseTo(6);
    expect(sampleWind(g, -6, 95.25, '2026-10-13T00:00:00Z')!.u).toBeCloseTo(1);
    expect(sampleWind(g, -6, 95, '2026-10-13T12:00:00Z')!.u).toBeCloseTo(5);
    expect(sampleWind(g, 9, 100, '2026-10-13T00:00:00Z')).toBeNull();
    expect(sampleWind(g, 0, 100, '2026-10-17T00:00:00Z')).toBeNull();
  });
});

describe('computeTrajectories', () => {
  it('a uniform 5 m/s westerly moves ~432 km east in 24 h', () => {
    const [t] = computeTrajectories(uniformGrid(5, 0), [src(0, 100)], '2026-10-13T00:00:00Z', 24, 30);
    const last = t.points[t.points.length - 1];
    expect(t.points).toHaveLength(49);
    expect(t.endReason).toBe('complete');
    expect(last.lat).toBeCloseTo(0, 6);
    expect(haversineKm(0, 100, last.lat, last.lon)).toBeCloseTo(432, 0);
    expect(last.time).toBe('2026-10-14T00:00:00Z');
  });

  it('stops at the grid edge', () => {
    const [t] = computeTrajectories(uniformGrid(20, 0), [src(0, 118)], '2026-10-13T00:00:00Z', 48, 30);
    expect(t.endReason).toBe('grid-edge');
    expect(t.points[t.points.length - 1].lon).toBeLessThanOrEqual(120);
  });

  it('reaches Singapore from a source to its east under an easterly, and misses under a southerly', () => {
    const east = src(1.3521, 106.5); // ~298 km east of Singapore
    const [hit] = computeTrajectories(uniformGrid(-5, 0), [east], '2026-10-13T00:00:00Z', 48, 30);
    expect(hit.receptor.reaches).toBe(true);
    expect(hit.receptor.closestKm).toBeLessThan(5);
    expect(hit.receptor.arrivalHours).toBeGreaterThan(11);
    expect(hit.receptor.arrivalHours).toBeLessThan(14);
    expect(hit.summary).toMatch(/to within \d+ km of Singapore after ~\d+ h\. Illustrative only; not a dispersion model\./);

    const [miss] = computeTrajectories(uniformGrid(0, 5), [east], '2026-10-13T00:00:00Z', 48, 30);
    expect(miss.receptor.reaches).toBe(false);
    expect(miss.receptor.arrivalHours).toBeNull();
    expect(miss.receptor.closestKm).toBeGreaterThan(250);
    expect(miss.summary).toMatch(/does not reach Singapore .*not a dispersion model/);
  });

  it('receptorAnalysis finds the closest point inside a segment', () => {
    const r = receptorAnalysis([
      { lat: SINGAPORE.lat + 0.1, lon: 103, time: '2026-10-13T00:00:00Z' },
      { lat: SINGAPORE.lat + 0.1, lon: 104.6, time: '2026-10-13T10:00:00Z' },
    ]);
    expect(r.closestKm).toBe(11);
    expect(r.reaches).toBe(true);
  });
});

describe('clusterHotspots', () => {
  const pts = [
    { latitude: 1.1, longitude: 101.2, frp: 10 },
    { latitude: 1.2, longitude: 101.3, frp: 30 },
    { latitude: 0.1, longitude: 102.9, frp: 5 },
    { latitude: 1.15, longitude: 101.45, frp: 1 },
  ];
  it('groups by 0.5° cell, largest first, and is order-independent', () => {
    const a = clusterHotspots('w', 'W', pts);
    const b = clusterHotspots('w', 'W', [...pts].reverse());
    expect(a).toEqual(b);
    expect(a.map((s) => s.count)).toEqual([3, 1]);
    expect(a[0].frpSum).toBe(41);
    expect(clusterHotspots('w', 'W', pts, { max: 1 })).toHaveLength(1);
  });
});

describe('hazeSourcesFromFixtures', () => {
  const member = (i: number, meetsRule = true) => ({ id: `m${i}`, latitude: -2.5 + i * 0.01, longitude: 114, frp: 10, meetsRule }) as HotspotMember;
  const record = (id: string, value: number) =>
    ({ id, incidentId: 'watch-box', category: 'thermal', observedAt: '2026-10-28T17:52:00Z', value }) as Observation;
  const watches = [{ id: 'watch-box', title: 'Box peatlands', hazard: 'wildfire' as const }];

  it('clusters the confident members of the latest day; counts are exact when every hotspot is a member', () => {
    const [s] = hazeSourcesFromFixtures({ watches, observations: [record('r1', 2)], members: { r1: [member(0), member(1), member(2, false)] } });
    expect(s).toMatchObject({ watchId: 'watch-box', count: 2, frpSum: 20 });
    expect(s.countIsLowerBound).toBeUndefined();
  });

  it('marks counts as lower bounds when a record counts more hotspots than it keeps', () => {
    const sources = hazeSourcesFromFixtures({ watches, observations: [record('r1', 1230)], members: { r1: [member(0), member(1)] } });
    expect(sources.map((s) => [s.count, s.countIsLowerBound])).toEqual([[2, true]]);
    const grid = uniformGrid(-5, 0);
    const [t] = computeTrajectories(grid, sources, '2026-10-13T00:00:00Z', 6);
    expect(t.summary).toContain('(at least 2 hotspots)');
  });
});
