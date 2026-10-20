import { describe, expect, it } from 'vitest';
import {
  ASEAN_BOUNDS,
  arrowAngleDeg,
  buildOfflineStyle,
  conePolygon,
  dashedPaths,
  destination,
  featureBounds,
  hotspotsUpToDay,
  keepAtStride,
  overlayPadding,
  psiHazeAlpha,
  ringPolygon,
  selectionBounds,
  twelveHourTicks,
  windArrowStride,
} from './mapGeometry';
import regionRaw from '../../../data/region.geojson?raw';
import type { RegionCollection } from './mapGeometry';

const haversineKm = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const dphi = (b[1] - a[1]) * r;
  const dl = (b[0] - a[0]) * r;
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dl / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};

describe('ringPolygon', () => {
  it('is closed and every vertex is the stated distance from the summit', () => {
    const merapi: [number, number] = [110.446, -7.542];
    for (const km of [3, 5, 10, 15]) {
      const ring = ringPolygon(merapi[0], merapi[1], km, 64);
      expect(ring).toHaveLength(65);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      for (const p of ring) expect(haversineKm(merapi, p)).toBeCloseTo(km, 6);
    }
  });

  it('puts the first vertex due north', () => {
    const [lon, lat] = ringPolygon(100, 0, 111.2, 8)[0];
    expect(lon).toBeCloseTo(100, 9);
    expect(lat).toBeCloseTo(1, 2);
  });
});

describe('destination and conePolygon', () => {
  it('moves east along the equator', () => {
    const [lon, lat] = destination(100, 0, 90, 111.19);
    expect(lon).toBeCloseTo(1 + 100, 2);
    expect(lat).toBeCloseTo(0, 9);
  });

  it('builds a closed wedge starting and ending at the apex', () => {
    const cone = conePolygon(101.5, 0.5, 45, 100, 15, 6);
    expect(cone[0]).toEqual([101.5, 0.5]);
    expect(cone[cone.length - 1]).toEqual([101.5, 0.5]);
    expect(cone).toHaveLength(6 + 3);
    for (const p of cone.slice(1, -1)) expect(haversineKm([101.5, 0.5], p)).toBeCloseTo(100, 6);
  });
});

describe('selectionBounds', () => {
  it('frames ±0.3° around a summit', () => {
    expect(selectionBounds({ lon: 110.4, lat: -7.5, area: { kind: 'summit' } })).toEqual([
      [110.10000000000001, -7.8],
      [110.7, -7.2],
    ]);
  });

  it('frames a watch box with a 0.3° margin', () => {
    const b = selectionBounds({ lon: 102, lat: 0.5, area: { kind: 'bbox', minLat: -0.5, maxLat: 1.6, minLon: 101, maxLon: 103.2 } });
    expect(b[0][0]).toBeCloseTo(100.7);
    expect(b[0][1]).toBeCloseTo(-0.8);
    expect(b[1][0]).toBeCloseTo(103.5);
    expect(b[1][1]).toBeCloseTo(1.9);
  });

  it('falls back to the summit frame when the box is incomplete', () => {
    const b = selectionBounds({ lon: 102, lat: 0.5, area: { kind: 'bbox', minLat: -0.5 } });
    expect(b[0][0]).toBeCloseTo(101.7);
    expect(b[1][1]).toBeCloseTo(0.8);
  });
});

describe('featureBounds', () => {
  it('covers polygons and multipolygons', () => {
    const b = featureBounds([
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[100, 0], [101, 1], [100, 1], [100, 0]]] } },
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPolygon', coordinates: [[[[120, -10], [121, -9], [120, -9], [120, -10]]]] },
      },
    ]);
    expect(b).toEqual([
      [100, -10],
      [121, 1],
    ]);
    expect(featureBounds([])).toBeNull();
  });
});

describe('padding helpers', () => {
  it('keeps the panel footprint when there is room and scales it down when there is not', () => {
    expect(overlayPadding(324, 424, 1366)).toEqual({ left: 324, right: 424 });
    const tight = overlayPadding(324, 424, 800, 200);
    expect(tight.left + tight.right).toBe(600);
    expect(tight.left).toBeLessThan(tight.right);
    expect(overlayPadding(0, 0, 375)).toEqual({ left: 0, right: 0 });
  });
});

describe('wind arrow helpers', () => {
  it('thins the 1° grid at regional zoom and keeps every cell when zoomed in', () => {
    expect(windArrowStride(3)).toBeGreaterThan(1);
    expect(windArrowStride(7)).toBe(1);
    expect(windArrowStride(4)).toBeLessThanOrEqual(windArrowStride(3));
  });

  it('keeps grid points at the stride, including negative latitudes', () => {
    expect(keepAtStride(-4, 102, 2)).toBe(true);
    expect(keepAtStride(-3, 102, 2)).toBe(false);
    expect(keepAtStride(7, 101, 1)).toBe(true);
  });

  it('turns wind-toward vectors into counter-clockwise angles from east', () => {
    expect(arrowAngleDeg(1, 0)).toBeCloseTo(0);
    expect(arrowAngleDeg(0, 1)).toBeCloseTo(90);
    expect(arrowAngleDeg(-1, 0)).toBeCloseTo(180);
    expect(arrowAngleDeg(0, -1)).toBeCloseTo(-90);
  });

  it('marks the 12-hour points of a path', () => {
    const t = (h: number) => new Date(Date.UTC(2026, 9, 13, h)).toISOString();
    const pts = [0, 6, 12, 18, 24].map((h) => ({ lat: h / 10, lon: 100 + h / 10, time: t(h) }));
    expect(twelveHourTicks(pts)).toEqual([
      [101.2, 1.2],
      [102.4, 2.4],
    ]);
    expect(twelveHourTicks([])).toEqual([]);
  });
});

describe('psiHazeAlpha', () => {
  it('rises with the NEA band', () => {
    const bands = ['Good', 'Moderate', 'Unhealthy', 'Very unhealthy', 'Hazardous'].map(psiHazeAlpha);
    for (let i = 1; i < bands.length; i++) expect(bands[i]).toBeGreaterThan(bands[i - 1]);
  });
});

describe('buildOfflineStyle', () => {
  const region: RegionCollection = { type: 'FeatureCollection', features: [] };
  it('is a self-contained style with no glyphs, sprites or remote sources', () => {
    for (const dark of [false, true]) {
      const style = buildOfflineStyle(region, dark);
      expect(style.version).toBe(8);
      expect(style.glyphs).toBeUndefined();
      expect(style.sprite).toBeUndefined();
      expect(Object.keys(style.sources)).toEqual(['region']);
      expect(style.layers.map((l) => l.id)).toContain('land-asean');
    }
  });
});

describe('hotspotsUpToDay', () => {
  const member = (id: string, lat: number) => ({
    id,
    latitude: lat,
    longitude: 110.4,
    frp: 3.2,
    confidenceLabel: 'VIIRS confidence nominal',
    observedAt: '2026-10-12T06:00:00Z',
  });
  const observations = [
    { id: 'a', incidentId: 'merapi', category: 'thermal', replayStep: 1 },
    { id: 'b', incidentId: 'merapi', category: 'thermal', replayStep: 3 },
    { id: 'c', incidentId: 'merapi', category: 'seismic', replayStep: 3 },
    { id: 'd', incidentId: 'semeru', category: 'thermal', replayStep: 3 },
  ];
  const members = { a: [member('m1', -7.5)], b: [member('m2', -7.54), member('m1', -7.5)], c: [member('x', 0)], d: [member('y', 0)] };

  it('returns the selected watch’s detections up to the day, flagging the current day', () => {
    const out = hotspotsUpToDay(observations, members, 'merapi', 3);
    expect(out.map((h) => [h.id, h.current])).toEqual([
      ['m1', false],
      ['m2', true],
    ]);
  });

  it('is empty without a selection, without members or before the first day', () => {
    expect(hotspotsUpToDay(observations, members, null, 3)).toEqual([]);
    expect(hotspotsUpToDay(observations, undefined, 'merapi', 3)).toEqual([]);
    expect(hotspotsUpToDay(observations, members, 'merapi', 0)).toEqual([]);
  });
});

describe('dashedPaths', () => {
  it('splits a ring into evenly spaced dashes that share their end points with the ring', () => {
    const ring = ringPolygon(110, -7.5, 10, 12);
    const dashes = dashedPaths(ring, 2, 1);
    expect(dashes).toHaveLength(4);
    expect(dashes[0]).toEqual(ring.slice(0, 3));
    expect(dashes[1]).toEqual(ring.slice(3, 6));
    for (const d of dashes) expect(d.length).toBeGreaterThanOrEqual(2);
  });

  it('returns nothing for degenerate input', () => {
    expect(dashedPaths([[0, 0]])).toEqual([]);
    expect(dashedPaths([[0, 0], [1, 1]], 0, 1)).toEqual([]);
  });
});

describe('ASEAN_BOUNDS', () => {
  it('is the extent of the ASEAN features in data/region.geojson (so the first view needs no geometry)', () => {
    const region = JSON.parse(regionRaw) as RegionCollection;
    const b = featureBounds(region.features.filter((f) => f.properties.asean));
    expect(b).not.toBeNull();
    expect(ASEAN_BOUNDS).toEqual(b);
  });
});
