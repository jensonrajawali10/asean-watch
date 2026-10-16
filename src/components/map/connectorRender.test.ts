import { describe, expect, it } from 'vitest';
import type { QuakeEvent } from '../../types';
import {
  QUAKE_DEPTH_RGB,
  isRecentQuake,
  quakeDepthRgb,
  lineChart,
  quakeDepthBand,
  quakeRadiusPx,
  quakeTooltip,
  stackNotes,
} from './connectorRender';

const NOTE = 'USGS "tsunami" flag: ... It is NOT a tsunami warning.';
const quake = (over: Partial<QuakeEvent> = {}): QuakeEvent => ({
  id: 'usgs:us1',
  source: 'USGS',
  product: 'USGS FDSN event service',
  magnitude: 6.1,
  magType: 'mww',
  depthKm: 35,
  lat: -7,
  lon: 120,
  place: '120 km S of Somewhere, Indonesia',
  timeISO: '2026-10-14T03:04:00Z',
  url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1',
  tsunamiFlag: false,
  potential: null,
  dataMode: 'live',
  ...over,
});

describe('quake styling', () => {
  it('sizes by magnitude, monotonic and clamped', () => {
    expect(quakeRadiusPx(4.5)).toBe(3);
    expect(quakeRadiusPx(6)).toBeGreaterThan(quakeRadiusPx(5));
    expect(quakeRadiusPx(9.5)).toBe(16);
    expect(quakeRadiusPx(2)).toBe(3);
    expect(quakeRadiusPx(Number.NaN)).toBe(3);
  });

  it('bins depth as shallow (<70 km), intermediate (70-300 km) and deep (>=300 km)', () => {
    expect(quakeDepthBand(10)).toBe('shallow');
    expect(quakeDepthBand(69.9)).toBe('shallow');
    expect(quakeDepthBand(70)).toBe('intermediate');
    expect(quakeDepthBand(299)).toBe('intermediate');
    expect(quakeDepthBand(300)).toBe('deep');
    expect(quakeDepthBand(null)).toBe('unknown');
  });

  it('never uses the reserved official red for depth colours', () => {
    for (const [r, g] of Object.values(QUAKE_DEPTH_RGB)) expect(r > 190 && g < 110).toBe(false);
    for (const band of ['shallow', 'intermediate', 'deep', 'unknown'] as const) {
      const [r, g] = quakeDepthRgb(band, 'light');
      expect(r > 190 && g < 110).toBe(false);
    }
  });

  it('keeps the dark depth colours as the default and deepens them on the light map', () => {
    expect(quakeDepthRgb('shallow')).toEqual(QUAKE_DEPTH_RGB.shallow);
    expect(quakeDepthRgb('deep', true)).toEqual(QUAKE_DEPTH_RGB.deep);
    const sum = (c: number[]) => c[0] + c[1] + c[2];
    expect(sum(quakeDepthRgb('shallow', 'light'))).toBeLessThan(sum(QUAKE_DEPTH_RGB.shallow));
  });

  it('emphasises the last 24 h', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(isRecentQuake('2026-10-14T00:00:00Z', now)).toBe(true);
    expect(isRecentQuake('2026-10-13T11:59:00Z', now)).toBe(false);
    expect(isRecentQuake('not a time', now)).toBe(false);
  });
});

describe('quakeTooltip', () => {
  it('names the source, product, magnitude type and UTC time', () => {
    const t = quakeTooltip(quake(), NOTE);
    expect(t).toContain('USGS');
    expect(t).toContain('USGS FDSN event service');
    expect(t).toContain('M 6.1 mww');
    expect(t).toContain('2026-10-14 03:04 UTC');
    expect(t).toContain('depth 35 km');
    expect(t).not.toContain('tsunami');
  });

  it('shows the USGS tsunami flag only with its "not a warning" note', () => {
    const t = quakeTooltip(quake({ tsunamiFlag: true }), NOTE);
    expect(t).toContain('USGS tsunami flag set');
    expect(t).toContain(NOTE);
  });

  it('keeps BMKG separate: its own product, magnitude type not given, verbatim potential', () => {
    const t = quakeTooltip(
      quake({ id: 'bmkg-gempaterkini:1', source: 'BMKG', product: 'BMKG gempaterkini (M 5.0+)', magType: null, tsunamiFlag: null, potential: 'Tidak berpotensi tsunami' }),
      NOTE,
    );
    expect(t).toContain('BMKG gempaterkini (M 5.0+)');
    expect(t).toContain('M 6.1 (type not given)');
    expect(t).toContain('Tidak berpotensi tsunami');
    expect(t).not.toContain(NOTE);
  });
});

describe('lineChart', () => {
  it('maps the first and last points to the chart edges and the extremes to top and bottom', () => {
    const c = lineChart(
      [
        { t: 0, v: 1 },
        { t: 50, v: 3 },
        { t: 100, v: 2 },
      ],
      200,
      100,
      10,
    );
    expect(c?.path.startsWith('M10.0,90.0')).toBe(true);
    expect(c?.path).toContain('L100.0,10.0');
    expect(c?.path.endsWith('L190.0,50.0')).toBe(true);
    expect(c).toMatchObject({ min: 1, max: 3, t0: 0, t1: 100 });
  });

  it('breaks the line at missing values and returns null with fewer than two values', () => {
    const c = lineChart(
      [
        { t: 0, v: 1 },
        { t: 1, v: null },
        { t: 2, v: 2 },
        { t: 3, v: 3 },
      ],
      100,
      50,
      0,
    );
    expect(c?.path.match(/M/g)).toHaveLength(2);
    expect(lineChart([{ t: 0, v: 1 }], 100, 50, 0)).toBeNull();
    expect(lineChart([], 100, 50, 0)).toBeNull();
  });

  it('draws a flat series in the middle', () => {
    const c = lineChart(
      [
        { t: 0, v: 5 },
        { t: 1, v: 5 },
      ],
      100,
      50,
      0,
    );
    expect(c?.path).toBe('M0.0,25.0L100.0,25.0');
  });
});

describe('stackNotes', () => {
  it('keeps at most two notes visible and folds the rest', () => {
    expect(stackNotes(['a', 'b', 'c', 'd'])).toEqual({ visible: ['a', 'b'], hidden: ['c', 'd'] });
    expect(stackNotes(['a'])).toEqual({ visible: ['a'], hidden: [] });
    expect(stackNotes(['a', 'b', 'c'], 1)).toEqual({ visible: ['a'], hidden: ['b', 'c'] });
  });
});
