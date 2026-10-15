import { describe, expect, it } from 'vitest';
import type { AshWindSeries } from '../../lib/ashDrift';
import { buildScenarioFromSeries } from '../../lib/eruptionScenario';
import type { EruptionScenario, PlumeCircle } from '../../lib/eruptionScenario';
import { getMapPalette } from './mapPalette';
import { PLUME_COLORS, buildPlumeLayers, plumeLegend, puffColours } from './plumeLayers';
import type { PlumeDatum } from './plumeLayers';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-14T00:00:00Z');
const times = Array.from({ length: 40 }, (_, k) => new Date(T0 + k * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z'));
const lvl = (speed: number, dir: number) => ({ speed: times.map(() => speed), dir: times.map(() => dir) });
const series: AshWindSeries = {
  volcanoId: 'gvp-263250',
  name: 'Merapi',
  lat: -7.54,
  lon: 110.446,
  times,
  wind: { '700': lvl(6, 60), '500': lvl(15, 80), '300': lvl(7, 100) },
};
const west = { id: 'w', name: 'Westtown', country: 'ID', province: 'Central Java', lat: -7.54, lon: 109.9, source: 'test' };
const sc = buildScenarioFromSeries(series, T0, { places: [west] }) as EruptionScenario;

describe('buildPlumeLayers', () => {
  it('draws nothing before the assumed start or without a scenario', () => {
    expect(buildPlumeLayers(sc, T0 - 1, { theme: 'dark' })).toEqual([]);
    expect(buildPlumeLayers(null, T0, { theme: 'dark' })).toEqual([]);
  });

  it('builds halo, puffs, trail and footprint layers with the prefix; places only on request', () => {
    const layers = buildPlumeLayers(sc, T0 + 6.5 * HOUR, { theme: 'dark', idPrefix: 'mv-plume' });
    expect(layers.map((l) => l.id)).toEqual(['mv-plume-halo', 'mv-plume-puffs', 'mv-plume-trail', 'mv-plume-footprint']);
    const withPlaces = buildPlumeLayers(sc, T0 + 24 * HOUR, { theme: 'light', showPlaces: true, showTrail: false });
    expect(withPlaces.map((l) => l.id)).toEqual(['plume-halo', 'plume-puffs', 'plume-footprint', 'plume-places', 'plume-place-labels']);
    expect((withPlaces[3].props.data as unknown[]).length).toBe(sc.arrivals.length);
  });

  it('draws only the requested heights, oldest ash first', () => {
    const layers = buildPlumeLayers(sc, T0 + 12 * HOUR, { theme: 'dark', levels: ['300'] });
    const data = layers[1].props.data as PlumeDatum[];
    expect(data.length).toBeGreaterThan(13);
    expect(new Set(data.map((d) => d.circle.level))).toEqual(new Set(['300']));
    for (let k = 1; k < data.length; k++) expect(data[k - 1].circle.ageH).toBeGreaterThanOrEqual(data[k].circle.ageH);
    expect(data[0].radiusM).toBeCloseTo(data[0].circle.radiusKm * 1000, 6);
  });

  it('uses grey-violet theme colours, never the reserved red', () => {
    for (const theme of ['dark', 'light'] as const) {
      const p = PLUME_COLORS[theme];
      for (const rgb of Object.values(p.level)) {
        expect(rgb[2]).toBeGreaterThanOrEqual(rgb[0]);
        expect(rgb[0]).toBeLessThan(rgb[2] + 1);
      }
      expect(p.footprint[2]).toBeGreaterThan(p.footprint[0]);
      expect(plumeLegend(theme)).toHaveLength(3);
    }
    expect(PLUME_COLORS.dark.level['500']).not.toEqual(PLUME_COLORS.light.level['500']);
  });

  it('reads its colours from the shared map palette, and takes an override', () => {
    expect(PLUME_COLORS.dark).toBe(getMapPalette('dark').ash.plume);
    expect(PLUME_COLORS.light).toBe(getMapPalette('light').ash.plume);
    const palette = { ...PLUME_COLORS.dark, level: { '700': [1, 2, 3], '500': [4, 5, 6], '300': [7, 8, 9] } as Record<'700' | '500' | '300', [number, number, number]> };
    const layers = buildPlumeLayers(sc, T0 + 6 * HOUR, { theme: 'dark', palette });
    const data = layers[1].props.data as PlumeDatum[];
    expect(data.some((d) => d.color[0] === 4 && d.color[1] === 5)).toBe(true);
  });
});

describe('puffColours', () => {
  it('keeps overlapping ash near the target alpha instead of turning solid', () => {
    const stack: PlumeCircle[] = Array.from({ length: 20 }, () => ({ level: '500', ageH: 0, lat: 0, lon: 100, radiusKm: 10 }));
    const cols = puffColours(stack, 24, PLUME_COLORS.dark);
    const combined = 1 - cols.reduce((acc, c) => acc * (1 - c.color[3] / 255), 1);
    expect(combined).toBeCloseTo(PLUME_COLORS.dark.puffAlpha, 1);
    const lone = puffColours([{ level: '500', ageH: 0, lat: 0, lon: 100, radiusKm: 10 }], 24, PLUME_COLORS.dark)[0];
    expect(lone.color[3]).toBe(Math.round(255 * PLUME_COLORS.dark.puffAlpha));
    const old = puffColours([{ level: '500', ageH: 24, lat: 0, lon: 100, radiusKm: 10 }], 24, PLUME_COLORS.dark)[0];
    expect(old.color[3]).toBeLessThan(lone.color[3]);
  });
});
